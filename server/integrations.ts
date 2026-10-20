// Export (Markdown / standalone HTML) and integrations (webhook / Zapier, Slack, Notion).
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import { EXPORT_DIR } from './env.ts';
import { all, fmtTime, get, getSetting, now, parseMeeting, run } from './db.ts';

export type Integrations = {
  webhook?: { url: string; auto: boolean };
  slack?: { url: string; auto: boolean };
  notion?: { token: string; databaseId: string; auto: boolean };
};

const stripUserMarks = (md: string) => md.replace(/\{\{([\s\S]*?)\}\}/g, '$1');
const slug = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'nota';

export function meetingPayload(id: string) {
  const m = parseMeeting(get('SELECT * FROM meetings WHERE id = ?', id));
  if (!m) throw new Error('Nota no encontrada');
  const segments = all('SELECT speaker, start_ms, end_ms, text FROM segments WHERE meeting_id = ? ORDER BY start_ms', id);
  const actionItems = all('SELECT text, owner, due, done FROM action_items WHERE meeting_id = ? ORDER BY created_at', id);
  const folder = m.folder_id ? get('SELECT name FROM folders WHERE id = ?', m.folder_id) : null;
  return { meeting: m, segments, actionItems, folder: folder?.name || null };
}

export function toMarkdown(id: string, opts: { transcript?: boolean } = {}) {
  const { meeting: m, segments, actionItems } = meetingPayload(id);
  const date = new Date(m.started_at || m.created_at).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });
  const lines = [`# ${m.title || 'Sin título'}`, '', `*${date}*${m.attendees.length ? ' · ' + m.attendees.map((a: any) => a.name || a.email).join(', ') : ''}`, ''];
  lines.push(m.enhanced_md ? stripUserMarks(m.enhanced_md) : m.notes_text || '');
  if (actionItems.length) {
    lines.push('', '### Tareas');
    for (const a of actionItems) lines.push(`- [${a.done ? 'x' : ' '}] ${a.text}${a.owner ? ` — ${a.owner}` : ''}${a.due ? ` (${a.due})` : ''}`);
  }
  if (opts.transcript && segments.length) {
    lines.push('', '---', '', '### Transcripción', '');
    const me = getSetting('userName', 'Yo');
    for (const s of segments) lines.push(`**${s.speaker === 'me' ? me : s.speaker === 'them' ? 'Ellos' : s.speaker}** [${fmtTime(s.start_ms)}] ${s.text}  `);
  }
  return lines.join('\n');
}

export function toHtml(id: string, opts: { transcript?: boolean } = {}) {
  const { meeting: m, segments, actionItems } = meetingPayload(id);
  const date = new Date(m.started_at || m.created_at).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });
  const notesHtml = marked.parse(
    (m.enhanced_md || m.notes_text || '').replace(/\{\{([\s\S]*?)\}\}/g, '<span class="u">$1</span>'),
  ) as string;
  const me = getSetting('userName', 'Yo');
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(m.title || 'Nota')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@400;500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#fcfcf8;--ink:#292929;--ink2:#72726e;--ink3:#acada8;--line:#47432a26;--accent:#5b6f00;--tint:#f2f6e1}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#1c1c1b;--ink:#fcfcf8;--ink2:#9e9e99;--ink3:#72726e;--line:#ffffff1f;--accent:#b2c248;--tint:#313225}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink2);font:15px/1.65 Inter,system-ui,sans-serif}
main{max-width:720px;margin:0 auto;padding:56px 20px 80px}
h1{font:500 34px/1.2 "IBM Plex Serif",Georgia,serif;color:var(--ink);margin:0 0 8px}
.meta{color:var(--ink3);font-size:13px;margin-bottom:32px}
h3{color:var(--ink);font-size:15px;font-weight:600;margin:28px 0 6px}
ul{padding-left:20px}li{margin:3px 0}.u,strong{color:var(--ink)}
.tasks li{list-style:none;margin-left:-20px}.tasks input{margin-right:8px;accent-color:var(--accent)}
.seg{display:flex;gap:10px;margin:6px 0}.seg b{min-width:64px;color:var(--ink);font-weight:500}.seg time{color:var(--ink3);font-size:12px;min-width:44px}
hr{border:0;border-top:1px solid var(--line);margin:40px 0}
footer{margin-top:48px;color:var(--ink3);font-size:12px}
</style></head><body><main>
<h1>${esc(m.title || 'Sin título')}</h1>
<div class="meta">${esc(date)}${m.attendees.length ? ' · ' + esc(m.attendees.map((a: any) => a.name || a.email).join(', ')) : ''}</div>
${notesHtml}
${actionItems.length ? `<h3>Tareas</h3><ul class="tasks">${actionItems.map((a) => `<li><input type="checkbox" ${a.done ? 'checked' : ''} disabled>${esc(a.text)}${a.owner ? ` <span style="color:var(--ink3)">— ${esc(a.owner)}</span>` : ''}</li>`).join('')}</ul>` : ''}
${opts.transcript && segments.length ? `<hr><h3>Transcripción</h3>${segments.map((s) => `<div class="seg"><time>${fmtTime(s.start_ms)}</time><b>${esc(s.speaker === 'me' ? me : s.speaker === 'them' ? 'Ellos' : s.speaker)}</b><span>${esc(s.text)}</span></div>`).join('')}` : ''}
<footer>Notas generadas con Acta</footer>
</main></body></html>`;
}

export function writeExport(id: string, format: 'md' | 'html', opts: { transcript?: boolean } = {}) {
  const m = get('SELECT title, created_at FROM meetings WHERE id = ?', id)!;
  const day = new Date(m.created_at).toISOString().slice(0, 10);
  const file = path.join(EXPORT_DIR, `${day}-${slug(m.title)}.${format}`);
  fs.writeFileSync(file, format === 'md' ? toMarkdown(id, opts) : toHtml(id, opts));
  return file;
}

function log(meetingId: string, target: string, ok: boolean, detail: string) {
  run('INSERT INTO integration_log(meeting_id, target, ok, detail, created_at) VALUES (?, ?, ?, ?, ?)', meetingId, target, ok ? 1 : 0, detail.slice(0, 500), now());
}

export async function sendTo(target: 'webhook' | 'slack' | 'notion', meetingId: string) {
  const cfg = getSetting<Integrations>('integrations', {});
  try {
    if (target === 'webhook') {
      if (!cfg.webhook?.url) throw new Error('Configura la URL del webhook en Ajustes → Integraciones');
      const p = meetingPayload(meetingId);
      const res = await fetch(cfg.webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'note.enhanced', id: meetingId, title: p.meeting.title, date: new Date(p.meeting.started_at || p.meeting.created_at).toISOString(),
          attendees: p.meeting.attendees, folder: p.folder, summary: p.meeting.summary,
          notes_markdown: stripUserMarks(p.meeting.enhanced_md || p.meeting.notes_text), action_items: p.actionItems,
          transcript: p.segments.map((s) => ({ speaker: s.speaker, start_ms: s.start_ms, text: s.text })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } else if (target === 'slack') {
      if (!cfg.slack?.url) throw new Error('Configura el webhook de Slack en Ajustes → Integraciones');
      const p = meetingPayload(meetingId);
      const md = stripUserMarks(p.meeting.enhanced_md || p.meeting.notes_text)
        .replace(/^###\s+(.*)$/gm, '*$1*').replace(/\*\*(.*?)\*\*/g, '*$1*').slice(0, 2800);
      const res = await fetch(cfg.slack.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `*${p.meeting.title}*\n${md}` }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } else if (target === 'notion') {
      if (!cfg.notion?.token || !cfg.notion.databaseId) throw new Error('Configura el token y la base de datos de Notion en Ajustes → Integraciones');
      const p = meetingPayload(meetingId);
      const blocks = markdownToNotionBlocks(stripUserMarks(p.meeting.enhanced_md || p.meeting.notes_text));
      const db = await fetch(`https://api.notion.com/v1/databases/${cfg.notion.databaseId}`, {
        headers: { Authorization: `Bearer ${cfg.notion.token}`, 'Notion-Version': '2022-06-28' },
      });
      if (!db.ok) throw new Error(`Notion ${db.status}: ${(await db.text()).slice(0, 200)}`);
      const dbj: any = await db.json();
      const titleProp = Object.entries(dbj.properties).find(([, v]: any) => v.type === 'title')?.[0] || 'Name';
      const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.notion.token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent: { database_id: cfg.notion.databaseId },
          properties: { [titleProp]: { title: [{ text: { content: p.meeting.title || 'Reunión' } }] } },
          children: blocks.slice(0, 95),
        }),
      });
      if (!res.ok) throw new Error(`Notion ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    log(meetingId, target, true, 'enviado');
    return { ok: true };
  } catch (e: any) {
    log(meetingId, target, false, String(e?.message || e));
    throw e;
  }
}

function markdownToNotionBlocks(md: string) {
  const rich = (t: string) => [{ type: 'text', text: { content: t.replace(/\*\*/g, '').slice(0, 1900) } }];
  const out: any[] = [];
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    let m;
    if ((m = line.match(/^#{1,3}\s+(.*)/))) out.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: rich(m[1]) } });
    else if ((m = line.match(/^\s*[-*]\s+\[( |x)\]\s+(.*)/i))) out.push({ object: 'block', type: 'to_do', to_do: { rich_text: rich(m[2]), checked: m[1].toLowerCase() === 'x' } });
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) out.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich(m[1]) } });
    else if ((m = line.match(/^\s*\d+\.\s+(.*)/))) out.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: rich(m[1]) } });
    else out.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: rich(line) } });
  }
  return out;
}

export async function autoSendIntegrations(meetingId: string) {
  const cfg = getSetting<Integrations>('integrations', {});
  for (const target of ['webhook', 'slack', 'notion'] as const) {
    if ((cfg as any)[target]?.auto) {
      try { await sendTo(target, meetingId); } catch (e: any) { console.warn(`[integration ${target}]`, e?.message); }
    }
  }
}
