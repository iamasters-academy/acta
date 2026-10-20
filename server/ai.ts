// AI features: enhanced notes, action items, titles, chat (meeting / folder / person / global),
// recipes and pre-meeting briefs. Everything streams.
import { all, get, getSetting, now, parseMeeting, reindexMeeting, run, searchMeetings, transcriptText, uid } from './db.ts';
import { completeLLM, streamLLM, type ChatMsg } from './llm.ts';
import {
  ACTION_ITEMS_SYSTEM, TITLE_SYSTEM, briefSystemPrompt, chatSystemPrompt, enhanceSystemPrompt, enhanceUserPrompt, getTemplate,
} from './prompts.ts';
import { autoSendIntegrations } from './integrations.ts';
import type { CalEvent } from './calendar.ts';

const userName = () => getSetting('userName', '') || 'Yo';
const fmtDate = (ms: number) => new Date(ms).toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' });
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '\n[…recortado…]' : s);

export async function* enhanceMeeting(meetingId: string, templateId?: string, signal?: AbortSignal) {
  const m = parseMeeting(get('SELECT * FROM meetings WHERE id = ?', meetingId));
  if (!m) throw new Error('Nota no encontrada');
  const tpl = getTemplate(templateId || m.template_id);
  const transcript = transcriptText(meetingId, { me: userName() || 'Yo', them: 'Ellos' });
  if (!transcript.trim() && !m.notes_text.trim()) throw new Error('No hay notas ni transcripción que mejorar todavía.');
  const system = enhanceSystemPrompt({
    userName: userName(), templateName: tpl.name, sections: tpl.sections, instructions: tpl.instructions || '', language: getSetting('language', 'es'),
  });
  const user = enhanceUserPrompt({
    title: m.title, attendees: m.attendees, notes: m.notes_text, transcript: clip(transcript, 180_000),
    date: fmtDate(m.started_at || m.created_at),
  });
  let out = '';
  for await (const chunk of streamLLM({ kind: 'notes', system, messages: [{ role: 'user', content: user }], maxTokens: 4000, signal })) {
    out += chunk;
    yield chunk;
  }
  run('UPDATE meetings SET enhanced_md = ?, enhanced_at = ?, template_id = ?, updated_at = ? WHERE id = ?', out.trim(), now(), tpl.id, now(), meetingId);
  reindexMeeting(meetingId);
  // Follow-up work that should not block the stream.
  void postEnhance(meetingId).catch((e) => console.warn('[postEnhance]', e?.message || e));
}

async function postEnhance(meetingId: string) {
  const m = get('SELECT * FROM meetings WHERE id = ?', meetingId)!;
  const context = `NOTAS:\n${m.enhanced_md}\n\nTRANSCRIPT:\n${clip(transcriptText(meetingId, { me: userName(), them: 'Ellos' }), 60_000)}`;
  const tasks: Promise<any>[] = [];
  if (!m.title || /^(nueva nota|nota sin título|sin título)$/i.test(m.title.trim())) {
    tasks.push(completeLLM({ kind: 'fast', system: TITLE_SYSTEM, messages: [{ role: 'user', content: clip(context, 20_000) }], maxTokens: 40 })
      .then((t) => { const title = t.trim().replace(/^["«]|["».]$/g, ''); if (title) run('UPDATE meetings SET title = ? WHERE id = ?', title, meetingId); }));
  }
  tasks.push(extractActionItems(meetingId, context));
  tasks.push(completeLLM({ kind: 'fast', system: 'Resume la reunión en UNA frase de máximo 25 palabras, en español. Solo la frase.', messages: [{ role: 'user', content: clip(context, 20_000) }], maxTokens: 80 })
    .then((s) => run('UPDATE meetings SET summary = ? WHERE id = ?', s.trim(), meetingId)));
  await Promise.allSettled(tasks);
  reindexMeeting(meetingId);
  await autoSendIntegrations(meetingId);
}

export async function extractActionItems(meetingId: string, context?: string) {
  const m = get('SELECT * FROM meetings WHERE id = ?', meetingId)!;
  const ctx = context || `NOTAS:\n${m.enhanced_md || m.notes_text}\n\nTRANSCRIPT:\n${clip(transcriptText(meetingId), 60_000)}`;
  const raw = await completeLLM({ kind: 'fast', system: ACTION_ITEMS_SYSTEM, messages: [{ role: 'user', content: ctx }], maxTokens: 1200 });
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  let items: { text: string; owner?: string; due?: string }[] = [];
  try { items = JSON.parse(json).items || []; } catch { return []; }
  // Keep the ones the user already ticked; replace the rest.
  const kept = all('SELECT text FROM action_items WHERE meeting_id = ? AND done = 1', meetingId).map((r) => r.text.toLowerCase());
  run('DELETE FROM action_items WHERE meeting_id = ? AND done = 0', meetingId);
  for (const it of items.slice(0, 12)) {
    if (!it.text || kept.includes(it.text.toLowerCase())) continue;
    run('INSERT INTO action_items(id, meeting_id, text, owner, due, done, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
      uid('ai_'), meetingId, it.text, it.owner || '', it.due || '', now());
  }
  return items;
}

// ---------- chat ----------
export type ChatScope = { scope: 'meeting' | 'folder' | 'person' | 'company' | 'global'; scopeId?: string };

function meetingBlock(m: any, budget: number, includeTranscript = true) {
  const head = `=== REUNIÓN ID=${m.id} | «${m.title || 'Sin título'}» | ${fmtDate(m.started_at || m.created_at)} ===`;
  const notes = m.enhanced_md || m.notes_text || '';
  let body = `NOTAS:\n${notes || '(sin notas)'}`;
  if (includeTranscript) {
    const t = transcriptText(m.id, { me: userName(), them: 'Ellos' });
    if (t) body += `\nTRANSCRIPT:\n${t}`;
  }
  return clip(`${head}\n${body}`, budget);
}

export function buildContext(sc: ChatScope, question: string) {
  if (sc.scope === 'meeting') {
    const m = get('SELECT * FROM meetings WHERE id = ?', sc.scopeId);
    if (!m) throw new Error('Nota no encontrada');
    return { label: `la reunión «${m.title}»`, context: meetingBlock(m, 200_000) };
  }
  let meetings: any[] = [];
  let label = 'todas tus reuniones';
  if (sc.scope === 'folder') {
    const f = get('SELECT name FROM folders WHERE id = ?', sc.scopeId);
    label = `la carpeta «${f?.name || ''}»`;
    meetings = all('SELECT * FROM meetings WHERE folder_id = ? AND archived_at IS NULL ORDER BY COALESCE(started_at, created_at) DESC LIMIT 40', sc.scopeId);
  } else if (sc.scope === 'person') {
    const p = get('SELECT name FROM people WHERE id = ?', sc.scopeId);
    label = `las reuniones con ${p?.name || ''}`;
    meetings = all(`SELECT m.* FROM meetings m JOIN meeting_people mp ON mp.meeting_id = m.id
                    WHERE mp.person_id = ? AND m.archived_at IS NULL ORDER BY COALESCE(m.started_at, m.created_at) DESC LIMIT 30`, sc.scopeId);
  } else if (sc.scope === 'company') {
    const c = get('SELECT name FROM companies WHERE id = ?', sc.scopeId);
    label = `las reuniones con ${c?.name || ''}`;
    meetings = all(`SELECT DISTINCT m.* FROM meetings m JOIN meeting_people mp ON mp.meeting_id = m.id JOIN people p ON p.id = mp.person_id
                    WHERE p.company_id = ? AND m.archived_at IS NULL ORDER BY COALESCE(m.started_at, m.created_at) DESC LIMIT 30`, sc.scopeId);
  } else {
    const hits = searchMeetings(question, 10).map((h) => h.id);
    const recent = all("SELECT id FROM meetings WHERE archived_at IS NULL AND COALESCE(started_at, created_at) > ? ORDER BY COALESCE(started_at, created_at) DESC LIMIT 8", Date.now() - 8 * 86400_000).map((r) => r.id);
    const ids = [...new Set([...hits, ...recent])].slice(0, 16);
    meetings = ids.map((id) => get('SELECT * FROM meetings WHERE id = ?', id)).filter(Boolean);
  }
  const per = Math.max(4000, Math.floor(140_000 / Math.max(1, meetings.length)));
  const blocks = meetings.map((m) => meetingBlock(m, per, meetings.length <= 12));
  const tasks = all("SELECT a.text, a.owner, a.due, m.title FROM action_items a JOIN meetings m ON m.id = a.meeting_id WHERE a.done = 0 AND m.archived_at IS NULL ORDER BY a.created_at DESC LIMIT 40");
  const taskBlock = tasks.length ? `\n=== TAREAS ABIERTAS ===\n${tasks.map((t) => `- ${t.text} (${t.owner || 'sin responsable'}${t.due ? ', ' + t.due : ''}) — de «${t.title}»`).join('\n')}` : '';
  return { label, context: (blocks.join('\n\n') || '(no hay reuniones en este ámbito)') + taskBlock };
}

export async function* chat(opts: ChatScope & { chatId?: string; message: string; recipe?: string; model?: string; signal?: AbortSignal }) {
  let chatId = opts.chatId;
  if (!chatId || !get('SELECT id FROM chats WHERE id = ?', chatId)) {
    chatId = uid('ch_');
    run('INSERT INTO chats(id, scope, scope_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      chatId, opts.scope, opts.scopeId || null, opts.message.slice(0, 80), now(), now());
  }
  yield { type: 'chat', chatId } as const;

  let question = opts.message;
  if (opts.recipe) {
    const r = get('SELECT * FROM recipes WHERE slug = ?', opts.recipe);
    if (r) question = r.prompt.replace(/\{\{nombre\}\}/g, userName()) + (opts.message && opts.message !== r.name ? `\n\nPetición adicional: ${opts.message}` : '');
  }
  const history = all('SELECT role, content FROM chat_messages WHERE chat_id = ? ORDER BY id DESC LIMIT 10', chatId).reverse() as ChatMsg[];
  run('INSERT INTO chat_messages(chat_id, role, content, created_at) VALUES (?, ?, ?, ?)', chatId, 'user', opts.recipe ? `/${opts.recipe} ${opts.message}`.trim() : opts.message, now());
  const { label, context } = buildContext(opts, question);
  const system = chatSystemPrompt({ userName: userName(), scopeLabel: label, today: fmtDate(Date.now()) }) + `\n\nCONTEXTO:\n${context}`;
  let answer = '';
  for await (const chunk of streamLLM({ model: opts.model, kind: 'chat', system, messages: [...history, { role: 'user', content: question }], maxTokens: 3000, signal: opts.signal })) {
    answer += chunk;
    yield { type: 'delta', text: chunk } as const;
  }
  const citations = [...answer.matchAll(/\[\[m:([\w]+)\|/g)].map((x) => x[1]);
  run('INSERT INTO chat_messages(chat_id, role, content, citations, created_at) VALUES (?, ?, ?, ?, ?)', chatId, 'assistant', answer, JSON.stringify([...new Set(citations)]), now());
  run('UPDATE chats SET updated_at = ? WHERE id = ?', now(), chatId);
}

// ---------- pre-meeting brief ----------
export async function* brief(input: { event?: CalEvent; meetingId?: string }, signal?: AbortSignal) {
  let title = input.event?.title || '';
  let emails: string[] = (input.event?.attendees || []).map((a) => a.email).filter(Boolean);
  let names: string[] = (input.event?.attendees || []).map((a) => a.name).filter(Boolean);
  if (input.meetingId) {
    const m = parseMeeting(get('SELECT * FROM meetings WHERE id = ?', input.meetingId));
    if (m) {
      title = m.title;
      emails = m.attendees.map((a: any) => a.email).filter(Boolean);
      names = m.attendees.map((a: any) => a.name).filter(Boolean);
    }
  }
  const selfEmails = getSetting<string[]>('selfEmails', []).map((e) => e.toLowerCase());
  emails = emails.filter((e) => !selfEmails.includes(e.toLowerCase()));
  const domains = [...new Set(emails.map((e) => e.split('@')[1]).filter((d) => d && !/gmail|hotmail|outlook|yahoo|icloud/.test(d)))];
  const ids = new Set<string>();
  for (const e of emails) for (const r of all('SELECT mp.meeting_id FROM meeting_people mp JOIN people p ON p.id = mp.person_id WHERE p.email = ?', e)) ids.add(r.meeting_id);
  for (const d of domains) for (const r of all('SELECT mp.meeting_id FROM meeting_people mp JOIN people p ON p.id = mp.person_id WHERE p.email LIKE ?', `%@${d}`)) ids.add(r.meeting_id);
  if (title) for (const h of searchMeetings(title, 4)) ids.add(h.id);
  if (input.meetingId) ids.delete(input.meetingId);
  const past = [...ids].map((id) => get('SELECT * FROM meetings WHERE id = ? AND archived_at IS NULL', id)).filter(Boolean)
    .sort((a: any, b: any) => (b.started_at || b.created_at) - (a.started_at || a.created_at)).slice(0, 6);
  const ctx = `PRÓXIMA REUNIÓN: ${title}\nASISTENTES: ${names.join(', ') || emails.join(', ') || 'desconocidos'}\nDESCRIPCIÓN: ${input.event?.description?.slice(0, 1500) || '-'}\n\nHISTORIAL:\n${past.map((m: any) => meetingBlock(m, 12_000, false)).join('\n\n') || '(sin reuniones previas)'}`;
  yield* streamLLM({ kind: 'chat', system: briefSystemPrompt(userName()), messages: [{ role: 'user', content: ctx }], maxTokens: 1500, signal });
}

// ---------- speaker attribution ----------
// Imported recordings arrive as a single channel, and "Ellos" can be several people in a live call.
// An LLM pass labels each fragment with a speaker name using the conversation itself.
export async function identifySpeakers(meetingId: string) {
  const segs = all('SELECT id, speaker, text FROM segments WHERE meeting_id = ? ORDER BY start_ms', meetingId);
  if (segs.length < 2) return { changed: 0 };
  const m = parseMeeting(get('SELECT title, attendees, source FROM meetings WHERE id = ?', meetingId));
  const me = userName();
  const attendees = (m?.attendees || []).map((a: any) => a.name).filter(Boolean);
  const imported = m?.source === 'import';
  let changed = 0;
  for (let off = 0; off < segs.length; off += 220) {
    const chunk = segs.slice(off, off + 220);
    const listing = chunk.map((s, i) => `${i}. ${s.speaker === 'me' && !imported ? '[Yo, confirmado] ' : ''}${s.text}`).join('\n');
    const raw = await completeLLM({
      kind: 'fast',
      system: `Identificas quién habla en cada fragmento de una conversación transcrita. El usuario se llama ${me}. ${attendees.length ? `Asistentes conocidos: ${attendees.join(', ')}.` : ''}
Devuelve SOLO JSON {"speakers":[...]} con exactamente una etiqueta por fragmento, en el mismo orden. Usa "Yo" para ${me}. Usa nombres propios cuando el contexto los revele (alguien saluda «Hola Laura» → quien responde es Laura). Si no se puede saber, usa "Persona 1", "Persona 2"… de forma consistente. Los fragmentos marcados [Yo, confirmado] son siempre "Yo".`,
      messages: [{ role: 'user', content: `Reunión: ${m?.title || ''}\n\n${listing}` }],
      maxTokens: 4000,
    });
    let labels: string[] = [];
    try { labels = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).speakers || []; } catch { continue; }
    if (labels.length !== chunk.length) continue;
    chunk.forEach((s, i) => {
      const l = String(labels[i] || '').trim();
      if (!l) return;
      const speaker = /^(yo|me)$/i.test(l) || l.toLowerCase() === me.toLowerCase() ? 'me' : l.slice(0, 40);
      if (s.speaker === 'me' && !imported) return;
      if (speaker !== s.speaker) { run('UPDATE segments SET speaker = ? WHERE id = ?', speaker, s.id); changed++; }
    });
  }
  return { changed };
}
