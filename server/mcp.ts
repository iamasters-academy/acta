// Read-only MCP server over stdio: lets Claude Code / Claude Desktop query Acta's meetings.
//   claude mcp add acta -- node "<ruta>/acta/server/mcp.ts"
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { all, get, getSetting, parseMeeting, searchMeetings, transcriptText } from './db.ts';

const server = new McpServer({ name: 'acta', version: '0.1.0' });
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const day = (ms: number) => new Date(ms).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
const stripMarks = (s: string) => s.replace(/\{\{([\s\S]*?)\}\}/g, '$1');

function line(m: any) {
  const att = (JSON.parse(m.attendees || '[]') as any[]).map((a) => a.name || a.email).filter(Boolean).join(', ');
  return `- ${m.id} · ${day(m.calendar_start || m.started_at || m.created_at)} · ${m.title || 'Sin título'}${att ? ` · con ${att}` : ''}${m.summary ? `\n  ${m.summary}` : ''}`;
}

server.registerTool('list_meetings', {
  title: 'Listar reuniones',
  description: 'Lista las reuniones de Acta, las más recientes primero. Filtra por días hacia atrás, carpeta o persona.',
  inputSchema: {
    days: z.number().int().positive().optional().describe('Solo reuniones de los últimos N días'),
    folder: z.string().optional().describe('Nombre (o parte) de la carpeta'),
    person: z.string().optional().describe('Nombre o email (o parte) de un asistente'),
    limit: z.number().int().positive().max(200).optional(),
  },
}, async ({ days, folder, person, limit }) => {
  const where = ['m.archived_at IS NULL'];
  const params: any[] = [];
  if (days) { where.push('COALESCE(m.calendar_start, m.started_at, m.created_at) > ?'); params.push(Date.now() - days * 86400_000); }
  if (folder) { where.push('m.folder_id IN (SELECT id FROM folders WHERE name LIKE ?)'); params.push(`%${folder}%`); }
  if (person) {
    where.push('m.id IN (SELECT mp.meeting_id FROM meeting_people mp JOIN people p ON p.id = mp.person_id WHERE p.name LIKE ? OR p.email LIKE ?)');
    params.push(`%${person}%`, `%${person}%`);
  }
  const rows = all(`SELECT * FROM meetings m WHERE ${where.join(' AND ')} ORDER BY COALESCE(m.calendar_start, m.started_at, m.created_at) DESC LIMIT ?`, ...params, limit || 30);
  return text(rows.length ? rows.map(line).join('\n') : 'No hay reuniones con ese filtro.');
});

server.registerTool('search_meetings', {
  title: 'Buscar en reuniones',
  description: 'Búsqueda de texto completo en títulos, notas, notas mejoradas y transcripciones.',
  inputSchema: { query: z.string().min(2), limit: z.number().int().positive().max(50).optional() },
}, async ({ query, limit }) => {
  const hits = searchMeetings(query, limit || 15);
  return text(hits.length ? hits.map((h) => `- ${h.id} · ${day(h.started_at || h.created_at)} · ${h.title || 'Sin título'}\n  …${String(h.snippet).replace(/\[\[|\]\]/g, '')}…`).join('\n') : 'Sin resultados.');
});

server.registerTool('get_meeting', {
  title: 'Leer una reunión',
  description: 'Devuelve las notas (mejoradas si existen), las tareas y, opcionalmente, la transcripción completa de una reunión.',
  inputSchema: { id: z.string(), include_transcript: z.boolean().optional() },
}, async ({ id, include_transcript }) => {
  const m = parseMeeting(get('SELECT * FROM meetings WHERE id = ?', id));
  if (!m) return text('No existe esa reunión.');
  const tasks = all('SELECT text, owner, due, done FROM action_items WHERE meeting_id = ?', id);
  const parts = [
    `# ${m.title || 'Sin título'}`,
    `${day(m.calendar_start || m.started_at || m.created_at)} · ${m.attendees.map((a: any) => a.name || a.email).join(', ') || 'sin asistentes'}`,
    '',
    stripMarks(m.enhanced_md || m.notes_text || '(sin notas)'),
  ];
  if (tasks.length) parts.push('', '## Tareas', ...tasks.map((t) => `- [${t.done ? 'x' : ' '}] ${t.text}${t.owner ? ` — ${t.owner}` : ''}${t.due ? ` (${t.due})` : ''}`));
  if (include_transcript) parts.push('', '## Transcripción', transcriptText(id, { me: getSetting('userName', 'Yo'), them: 'Ellos' }) || '(vacía)');
  return text(parts.join('\n'));
});

server.registerTool('list_action_items', {
  title: 'Tareas de las reuniones',
  description: 'Lista las tareas extraídas de las reuniones (pendientes por defecto).',
  inputSchema: { status: z.enum(['open', 'done']).optional(), owner: z.string().optional() },
}, async ({ status, owner }) => {
  const rows = all(
    `SELECT a.text, a.owner, a.due, m.title, m.id FROM action_items a JOIN meetings m ON m.id = a.meeting_id
      WHERE a.done = ? AND m.archived_at IS NULL ${owner ? 'AND a.owner LIKE ?' : ''} ORDER BY a.created_at DESC LIMIT 100`,
    status === 'done' ? 1 : 0, ...(owner ? [`%${owner}%`] : []),
  );
  return text(rows.length ? rows.map((r) => `- ${r.text}${r.owner ? ` — ${r.owner}` : ''}${r.due ? ` (${r.due})` : ''} · de «${r.title}» (${r.id})`).join('\n') : 'No hay tareas.');
});

server.registerTool('list_people', {
  title: 'Personas',
  description: 'Personas con las que te has reunido, con su empresa y número de reuniones.',
  inputSchema: { query: z.string().optional() },
}, async ({ query }) => {
  const rows = all(
    `SELECT p.name, p.email, c.name AS company, (SELECT COUNT(*) FROM meeting_people mp WHERE mp.person_id = p.id) AS n
       FROM people p LEFT JOIN companies c ON c.id = p.company_id
      ${query ? 'WHERE p.name LIKE ? OR p.email LIKE ? OR c.name LIKE ?' : ''} ORDER BY n DESC LIMIT 100`,
    ...(query ? [`%${query}%`, `%${query}%`, `%${query}%`] : []),
  );
  return text(rows.length ? rows.map((r) => `- ${r.name}${r.email ? ` <${r.email}>` : ''}${r.company ? ` · ${r.company}` : ''} · ${r.n} reuniones`).join('\n') : 'Sin personas.');
});

server.registerTool('list_folders', {
  title: 'Carpetas',
  description: 'Carpetas de Acta con su número de notas.',
  inputSchema: {},
}, async () => {
  const rows = all('SELECT f.name, (SELECT COUNT(*) FROM meetings m WHERE m.folder_id = f.id AND m.archived_at IS NULL) AS n FROM folders f ORDER BY f.name');
  return text(rows.length ? rows.map((r) => `- ${r.name} (${r.n})`).join('\n') : 'Sin carpetas.');
});

await server.connect(new StdioServerTransport());
