// Acta server: REST API + live events over WebSocket + the web UI (Vite in dev, static in prod).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import express, { type Request, type Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { DATA_DIR, EXPORT_DIR, HELPER_BIN, IMPORT_DIR, PACKAGED, PORT, ROOT, envSources } from './env.ts';
import { all, get, getSetting, now, parseMeeting, reindexMeeting, run, safeJson, searchMeetings, setSetting, tx, uid } from './db.ts';
import { seedDefaults, listRecipes, listTemplates } from './prompts.ts';
import { availableModels, defaultModel, apiKey, LlmError } from './llm.ts';
import { STT_CATALOG, defaultStt, sttAvailable, localModelPath } from './transcribe.ts';
import {
  bus, activeSession, startRecording, stopRecording, pauseRecording, resumeRecording, helperAvailable, RecordingSession, startFileSource,
} from './recorder.ts';
import { upcomingEvents, calendarErrors, clearCalendarCache, type CalEvent } from './calendar.ts';
import { detectorState, startDetector, startCalendarWatcher } from './detector.ts';
import { enhanceMeeting, extractActionItems, chat, brief, identifySpeakers } from './ai.ts';
import { providerAvailable } from './llm.ts';
import { toHtml, toMarkdown, writeExport, sendTo } from './integrations.ts';
import { accounts as googleAccounts, disconnect as googleDisconnect, googleConfigured, handleCallback as googleCallback, refreshCalendars, setCalendarsEnabled, startAuth as googleAuth, googleErrors } from './google.ts';

const execFileP = promisify(execFile);
const DEV = process.argv.includes('--dev');
seedDefaults();

const app = express();
app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'acta', instance: process.env.ACTA_INSTANCE || '', packaged: PACKAGED });
});

function shellQuote(s: string) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function mcpCommand() {
  const entry = PACKAGED ? path.join(ROOT, 'server', 'mcp.js') : path.join(ROOT, 'server', 'mcp.ts');
  const electron = process.env.ACTA_ELECTRON_EXEC;
  if (PACKAGED && electron) {
    return `claude mcp add acta -- env ACTA_PACKAGED=1 ACTA_DATA_DIR=${shellQuote(DATA_DIR)} ACTA_RESOURCES=${shellQuote(ROOT)} ELECTRON_RUN_AS_NODE=1 ${shellQuote(electron)} ${shellQuote(entry)}`;
  }
  return `claude mcp add acta -- node ${shellQuote(entry)}`;
}

const ah = (fn: (req: any, res: Response) => any) => async (req: Request, res: Response) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e: any) {
    console.error('[api]', req.method, req.path, e?.message || e);
    if (!res.headersSent) res.status(e instanceof LlmError ? 502 : 400).json({ error: String(e?.message || e) });
    else res.end();
  }
};

// ---------- helpers ----------
const FREE_DOMAINS = /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|proton|protonmail|msn|aol)\./i;

function linkAttendees(meetingId: string, attendees: { name?: string; email?: string; self?: boolean }[]) {
  const selfEmails = getSetting<string[]>('selfEmails', []).map((e) => e.toLowerCase());
  for (const a of attendees) {
    const email = (a.email || '').toLowerCase().trim();
    if (a.self || (email && selfEmails.includes(email))) continue;
    let person = email ? get('SELECT * FROM people WHERE email = ?', email) : a.name ? get('SELECT * FROM people WHERE lower(name) = lower(?)', a.name) : undefined;
    if (!person) {
      let companyId: string | null = null;
      const domain = email.split('@')[1];
      if (domain && !FREE_DOMAINS.test(domain)) {
        let c = get('SELECT * FROM companies WHERE domain = ?', domain);
        if (!c) {
          const name = domain.split('.').slice(-2, -1)[0] || domain;
          run('INSERT INTO companies(id, name, domain, created_at) VALUES (?, ?, ?, ?)', uid('co_'), name.charAt(0).toUpperCase() + name.slice(1), domain, now());
          c = get('SELECT * FROM companies WHERE domain = ?', domain);
        }
        companyId = c!.id;
      }
      const id = uid('pe_');
      run('INSERT INTO people(id, name, email, company_id, created_at) VALUES (?, ?, ?, ?, ?)', id, a.name || email.split('@')[0] || 'Sin nombre', email || null, companyId, now());
      person = { id };
    }
    run('INSERT OR IGNORE INTO meeting_people(meeting_id, person_id) VALUES (?, ?)', meetingId, person.id);
  }
}

function listMeetings(where = 'm.archived_at IS NULL', ...params: any[]) {
  return all(
    `SELECT m.id, m.title, m.created_at, m.started_at, m.ended_at, m.duration_ms, m.status, m.attendees, m.folder_id, m.summary,
            m.calendar_start, m.source, m.archived_at, (m.enhanced_md != '') AS enhanced,
            (SELECT COUNT(*) FROM segments s WHERE s.meeting_id = m.id) AS segment_count
       FROM meetings m WHERE ${where}
      ORDER BY COALESCE(m.calendar_start, m.started_at, m.created_at) DESC LIMIT 500`,
    ...params,
  ).map((m) => ({ ...m, attendees: safeJson(m.attendees, []), enhanced: !!m.enhanced }));
}

function maskKey(v?: string) {
  if (!v) return '';
  return v.length > 10 ? `${v.slice(0, 4)}…${v.slice(-4)}` : '••••';
}

function streamText(res: Response) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

// ---------- state & settings ----------
app.get('/api/state', ah(() => {
  const s = activeSession();
  return {
    userName: getSetting('userName', ''),
    onboarded: getSetting('onboarded', false),
    platform: process.platform,
    packaged: PACKAGED,
    googleConfigured: googleConfigured(),
    helper: { available: helperAvailable(), detector: detectorState },
    recording: s ? { meetingId: s.meetingId, paused: s.paused, elapsedMs: s.elapsedMs(), sources: s.sources.map((x) => x.kind) } : null,
    models: availableModels(),
    defaults: { notes: defaultModel('notes'), chat: defaultModel('chat'), fast: defaultModel('fast') },
    stt: { provider: defaultStt(), options: STT_CATALOG.map((o) => ({ ...o, available: sttAvailable(o.id) })) },
  };
}));

const KEY_NAMES = ['OPENAI_API_KEY', 'GROQ_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPGRAM_API_KEY'] as const;

app.get('/api/settings', ah(() => {
  const appKeys = getSetting<Record<string, string>>('apiKeys', {});
  const keys = Object.fromEntries(KEY_NAMES.map((k) => [k, {
    set: !!apiKey(k), masked: maskKey(apiKey(k)), source: appKeys[k] ? 'guardada en este Mac' : process.env[k] ? (envSources[k] ? `leída de ${path.relative(ROOT, envSources[k]) || envSources[k]}` : 'variable de entorno') : '',
  }]));
  return {
    userName: getSetting('userName', ''),
    selfEmails: getSetting<string[]>('selfEmails', []),
    language: getSetting('language', 'es'),
    vocabulary: getSetting('vocabulary', ''),
    sttProvider: getSetting<string | null>('sttProvider', null) || defaultStt(),
    openaiSttModel: getSetting('openaiSttModel', 'gpt-4o-transcribe'),
    localWhisperModel: localModelPath(),
    echoCancellation: getSetting('echoCancellation', true),
    saveAudio: getSetting('saveAudio', false),
    autoDetect: getSetting('autoDetect', true),
    autoStopMinutes: getSetting('autoStopMinutes', 12),
    autoStopOnMeetingEnd: getSetting('autoStopOnMeetingEnd', true),
    autoEnhance: getSetting('autoEnhance', true),
    calendarNotifyMinutes: getSetting('calendarNotifyMinutes', 1),
    calendars: getSetting('calendars', []),
    macCalendarEnabled: getSetting('macCalendarEnabled', false),
    claudeCliEnabled: getSetting('claudeCliEnabled', false),
    micDeviceUID: getSetting('micDeviceUID', ''),
    identifySpeakers: getSetting('identifySpeakers', true),
    models: { notes: defaultModel('notes'), chat: defaultModel('chat'), fast: defaultModel('fast') },
    integrations: getSetting('integrations', {}),
    keys,
    dataDir: DATA_DIR,
    exportDir: EXPORT_DIR,
    packaged: PACKAGED,
    googleConfigured: googleConfigured(),
    mcpCommand: mcpCommand(),
  };
}));

app.put('/api/settings', ah((req) => {
  const b = req.body || {};
  const simple = ['userName', 'selfEmails', 'language', 'vocabulary', 'sttProvider', 'openaiSttModel', 'echoCancellation', 'saveAudio', 'autoDetect',
    'autoStopMinutes', 'autoStopOnMeetingEnd', 'autoEnhance', 'calendarNotifyMinutes', 'calendars', 'macCalendarEnabled', 'claudeCliEnabled',
    'models', 'integrations', 'onboarded', 'localWhisperModel', 'micDeviceUID', 'identifySpeakers'];
  for (const k of simple) if (k in b) setSetting(k, b[k]);
  if (b.keys) {
    const cur = getSetting<Record<string, string>>('apiKeys', {});
    for (const k of KEY_NAMES) {
      const v = b.keys[k];
      if (typeof v === 'string' && v && !v.includes('…') && !v.includes('••')) cur[k] = v.trim();
      if (v === null) delete cur[k];
    }
    setSetting('apiKeys', cur);
  }
  if ('calendars' in b || 'macCalendarEnabled' in b) clearCalendarCache();
  return { ok: true };
}));

// ---------- meetings ----------
app.get('/api/meetings', ah((req) => {
  const { folder, archived, person, company } = req.query as Record<string, string>;
  if (archived) return listMeetings('m.archived_at IS NOT NULL');
  if (folder) return listMeetings('m.archived_at IS NULL AND m.folder_id = ?', folder);
  if (person) return listMeetings('m.archived_at IS NULL AND m.id IN (SELECT meeting_id FROM meeting_people WHERE person_id = ?)', person);
  if (company) return listMeetings('m.archived_at IS NULL AND m.id IN (SELECT mp.meeting_id FROM meeting_people mp JOIN people p ON p.id = mp.person_id WHERE p.company_id = ?)', company);
  return listMeetings();
}));

app.post('/api/meetings', ah((req) => {
  const b = req.body || {};
  const ev: CalEvent | undefined = b.calendarEvent;
  if (ev) {
    const existing = get('SELECT id FROM meetings WHERE calendar_event_id = ? AND archived_at IS NULL', ev.id);
    if (existing) return { id: existing.id };
  }
  const id = uid('mt_');
  const t = now();
  const attendees = ev?.attendees || b.attendees || [];
  run(
    `INSERT INTO meetings(id, title, created_at, updated_at, calendar_event_id, calendar_start, attendees, folder_id, template_id, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, b.title ?? ev?.title ?? '', t, t, ev?.id || null, ev?.start || null, JSON.stringify(attendees), b.folderId || null, b.templateId || null, b.source || 'live',
  );
  linkAttendees(id, attendees);
  reindexMeeting(id);
  bus.emit('event', { type: 'meetings.changed' });
  return { id };
}));

app.get('/api/meetings/:id', ah((req) => {
  const m = parseMeeting(get('SELECT * FROM meetings WHERE id = ?', req.params.id));
  if (!m) throw new Error('Nota no encontrada');
  return {
    ...m,
    segments: all('SELECT id, speaker, start_ms, end_ms, text FROM segments WHERE meeting_id = ? ORDER BY start_ms', m.id),
    actionItems: all('SELECT * FROM action_items WHERE meeting_id = ? ORDER BY created_at', m.id),
    people: all('SELECT p.*, c.name AS company FROM people p JOIN meeting_people mp ON mp.person_id = p.id LEFT JOIN companies c ON c.id = p.company_id WHERE mp.meeting_id = ?', m.id),
    folder: m.folder_id ? get('SELECT * FROM folders WHERE id = ?', m.folder_id) : null,
    integrationLog: all('SELECT target, ok, detail, created_at FROM integration_log WHERE meeting_id = ? ORDER BY id DESC LIMIT 5', m.id),
  };
}));

app.patch('/api/meetings/:id', ah((req) => {
  const id = req.params.id;
  const b = req.body || {};
  const fields: Record<string, any> = {};
  for (const k of ['title', 'notes_html', 'notes_text', 'enhanced_md', 'folder_id', 'template_id']) if (k in b) fields[k] = b[k];
  if ('attendees' in b) {
    fields.attendees = JSON.stringify(b.attendees || []);
    linkAttendees(id, b.attendees || []);
  }
  const keys = Object.keys(fields);
  if (keys.length) {
    run(`UPDATE meetings SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => fields[k]), now(), id);
    reindexMeeting(id);
  }
  if ('title' in b || 'folder_id' in b) bus.emit('event', { type: 'meetings.changed' });
  return { ok: true };
}));

app.post('/api/meetings/:id/archive', ah((req) => {
  run('UPDATE meetings SET archived_at = ? WHERE id = ?', now(), req.params.id);
  reindexMeeting(req.params.id);
  bus.emit('event', { type: 'meetings.changed' });
  return { ok: true };
}));
app.post('/api/meetings/:id/restore', ah((req) => {
  run('UPDATE meetings SET archived_at = NULL WHERE id = ?', req.params.id);
  reindexMeeting(req.params.id);
  bus.emit('event', { type: 'meetings.changed' });
  return { ok: true };
}));

app.post('/api/meetings/:id/record', ah(async (req) => {
  const { action, sources, mic, system } = req.body || {};
  const id = req.params.id;
  if (action === 'start') {
    const s = await startRecording(id, { sources, mic, system });
    return { ok: true, sources: s.sources.map((x) => x.kind) };
  }
  if (action === 'pause') pauseRecording(id);
  if (action === 'resume') resumeRecording(id);
  if (action === 'stop') await stopRecording('user');
  return { ok: true };
}));

app.post('/api/meetings/:id/speakers', ah(async (req) => {
  const r = await identifySpeakers(req.params.id);
  bus.emit('event', { type: 'meeting.updated', meetingId: req.params.id });
  return r;
}));

app.post('/api/meetings/:id/enhance', ah(async (req, res) => {
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
  const gen = enhanceMeeting(req.params.id, req.body?.templateId, ctrl.signal);
  const first = await gen.next(); // surface configuration errors as JSON before streaming
  streamText(res);
  if (!first.done) res.write(first.value);
  for await (const chunk of gen) res.write(chunk);
  res.end();
  bus.emit('event', { type: 'meeting.enhanced', meetingId: req.params.id });
}));

// ---------- action items ----------
app.get('/api/action-items', ah((req) => {
  const done = req.query.status === 'done' ? 1 : 0;
  return all(`SELECT a.*, m.title AS meeting_title, COALESCE(m.started_at, m.created_at) AS meeting_date FROM action_items a
              JOIN meetings m ON m.id = a.meeting_id WHERE a.done = ? AND m.archived_at IS NULL ORDER BY a.created_at DESC LIMIT 300`, done);
}));
app.post('/api/meetings/:id/action-items', ah((req) => {
  const id = uid('ai_');
  run('INSERT INTO action_items(id, meeting_id, text, owner, due, done, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)', id, req.params.id, req.body.text || '', req.body.owner || '', req.body.due || '', now());
  return { id };
}));
app.post('/api/meetings/:id/action-items/extract', ah(async (req) => ({ items: await extractActionItems(req.params.id) })));
app.patch('/api/action-items/:id', ah((req) => {
  const b = req.body || {};
  for (const k of ['text', 'owner', 'due']) if (k in b) run(`UPDATE action_items SET ${k} = ? WHERE id = ?`, b[k], req.params.id);
  if ('done' in b) run('UPDATE action_items SET done = ? WHERE id = ?', b.done ? 1 : 0, req.params.id);
  return { ok: true };
}));
app.delete('/api/action-items/:id', ah((req) => { run('DELETE FROM action_items WHERE id = ?', req.params.id); return { ok: true }; }));

// ---------- chat, recipes, brief ----------
app.post('/api/chat', ah(async (req, res) => {
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();
  try {
    for await (const ev of chat({ ...req.body, signal: ctrl.signal })) res.write(JSON.stringify(ev) + '\n');
  } catch (e: any) {
    res.write(JSON.stringify({ type: 'error', message: String(e?.message || e) }) + '\n');
  }
  res.end();
}));
app.get('/api/chats', ah((req) => {
  const { scope, scopeId } = req.query as Record<string, string>;
  return scopeId
    ? all('SELECT * FROM chats WHERE scope = ? AND scope_id = ? ORDER BY updated_at DESC LIMIT 30', scope, scopeId)
    : all('SELECT * FROM chats WHERE scope = ? ORDER BY updated_at DESC LIMIT 30', scope || 'global');
}));
app.get('/api/chats/:id', ah((req) => ({
  chat: get('SELECT * FROM chats WHERE id = ?', req.params.id),
  messages: all('SELECT role, content, citations, created_at FROM chat_messages WHERE chat_id = ? ORDER BY id', req.params.id),
})));
app.post('/api/brief', ah(async (req, res) => {
  const gen = brief(req.body || {});
  const first = await gen.next();
  streamText(res);
  if (!first.done) res.write(first.value);
  for await (const chunk of gen) res.write(chunk);
  res.end();
}));

// ---------- templates, recipes, folders ----------
app.get('/api/templates', ah(() => listTemplates()));
app.post('/api/templates', ah((req) => {
  const b = req.body;
  const id = uid('tpl_');
  run('INSERT INTO templates(id, name, description, instructions, sections, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
    id, b.name || 'Nueva plantilla', b.description || '', b.instructions || '', JSON.stringify(b.sections || []), now(), now());
  return { id };
}));
app.put('/api/templates/:id', ah((req) => {
  const b = req.body;
  run('UPDATE templates SET name = ?, description = ?, instructions = ?, sections = ?, updated_at = ? WHERE id = ?',
    b.name, b.description || '', b.instructions || '', JSON.stringify(b.sections || []), now(), req.params.id);
  return { ok: true };
}));
app.delete('/api/templates/:id', ah((req) => { run('DELETE FROM templates WHERE id = ? AND builtin = 0', req.params.id); return { ok: true }; }));

app.get('/api/recipes', ah(() => listRecipes()));
app.post('/api/recipes', ah((req) => {
  const b = req.body;
  const slug = String(b.slug || b.name || 'receta').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = uid('rcp_');
  run('INSERT INTO recipes(id, slug, name, description, prompt, builtin, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)', id, slug, b.name, b.description || '', b.prompt, now());
  return { id, slug };
}));
app.put('/api/recipes/:id', ah((req) => {
  const b = req.body;
  run('UPDATE recipes SET name = ?, description = ?, prompt = ? WHERE id = ?', b.name, b.description || '', b.prompt, req.params.id);
  return { ok: true };
}));
app.delete('/api/recipes/:id', ah((req) => { run('DELETE FROM recipes WHERE id = ? AND builtin = 0', req.params.id); return { ok: true }; }));

app.get('/api/folders', ah(() => all(`SELECT f.*, (SELECT COUNT(*) FROM meetings m WHERE m.folder_id = f.id AND m.archived_at IS NULL) AS count FROM folders f ORDER BY f.name`)));
app.post('/api/folders', ah((req) => {
  const id = uid('fd_');
  run('INSERT INTO folders(id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)', id, req.body.name || 'Nueva carpeta', req.body.description || '', req.body.color || 'olive', now());
  bus.emit('event', { type: 'meetings.changed' });
  return { id };
}));
app.put('/api/folders/:id', ah((req) => {
  run('UPDATE folders SET name = ?, description = ?, color = ? WHERE id = ?', req.body.name, req.body.description || '', req.body.color || 'olive', req.params.id);
  bus.emit('event', { type: 'meetings.changed' });
  return { ok: true };
}));
app.delete('/api/folders/:id', ah((req) => {
  tx(() => {
    run('UPDATE meetings SET folder_id = NULL WHERE folder_id = ?', req.params.id);
    run('DELETE FROM folders WHERE id = ?', req.params.id);
  });
  bus.emit('event', { type: 'meetings.changed' });
  return { ok: true };
}));

// ---------- people & companies ----------
app.get('/api/people', ah(() => all(`SELECT p.*, c.name AS company, (SELECT COUNT(*) FROM meeting_people mp JOIN meetings m ON m.id = mp.meeting_id WHERE mp.person_id = p.id AND m.archived_at IS NULL) AS meetings,
  (SELECT MAX(COALESCE(m.started_at, m.created_at)) FROM meeting_people mp JOIN meetings m ON m.id = mp.meeting_id WHERE mp.person_id = p.id) AS last_met
  FROM people p LEFT JOIN companies c ON c.id = p.company_id ORDER BY last_met DESC NULLS LAST, p.name`)));
app.get('/api/people/:id', ah((req) => ({
  person: get('SELECT p.*, c.name AS company FROM people p LEFT JOIN companies c ON c.id = p.company_id WHERE p.id = ?', req.params.id),
  meetings: listMeetings('m.archived_at IS NULL AND m.id IN (SELECT meeting_id FROM meeting_people WHERE person_id = ?)', req.params.id),
})));
app.patch('/api/people/:id', ah((req) => {
  for (const k of ['name', 'role', 'notes', 'email']) if (k in req.body) run(`UPDATE people SET ${k} = ? WHERE id = ?`, req.body[k], req.params.id);
  return { ok: true };
}));
app.post('/api/people', ah((req) => {
  const id = uid('pe_');
  run('INSERT INTO people(id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)', id, req.body.name, req.body.email || null, req.body.role || '', now());
  return { id };
}));
app.get('/api/companies', ah(() => all(`SELECT c.*, (SELECT COUNT(*) FROM people p WHERE p.company_id = c.id) AS people,
  (SELECT COUNT(DISTINCT mp.meeting_id) FROM meeting_people mp JOIN people p ON p.id = mp.person_id WHERE p.company_id = c.id) AS meetings
  FROM companies c ORDER BY meetings DESC, c.name`)));
app.get('/api/companies/:id', ah((req) => ({
  company: get('SELECT * FROM companies WHERE id = ?', req.params.id),
  people: all('SELECT * FROM people WHERE company_id = ? ORDER BY name', req.params.id),
  meetings: listMeetings('m.archived_at IS NULL AND m.id IN (SELECT mp.meeting_id FROM meeting_people mp JOIN people p ON p.id = mp.person_id WHERE p.company_id = ?)', req.params.id),
})));
app.patch('/api/companies/:id', ah((req) => {
  for (const k of ['name', 'notes']) if (k in req.body) run(`UPDATE companies SET ${k} = ? WHERE id = ?`, req.body[k], req.params.id);
  return { ok: true };
}));

// ---------- calendar, search ----------
app.get('/api/calendar/upcoming', ah(async (req) => {
  const days = Number(req.query.days || 7);
  const events = await upcomingEvents({ fromMs: Date.now() - 6 * 3600_000, toMs: Date.now() + days * 86400_000 });
  const linked = Object.fromEntries(all('SELECT calendar_event_id, id FROM meetings WHERE calendar_event_id IS NOT NULL AND archived_at IS NULL').map((r) => [r.calendar_event_id, r.id]));
  return { events: events.map((e) => ({ ...e, meetingId: linked[e.id] || null })), errors: calendarErrors() };
}));
app.post('/api/calendar/test', ah(async (req) => {
  const res = await fetch(String(req.body.url || '').replace(/^webcal:/i, 'https:'));
  const text = await res.text();
  if (!res.ok || !text.includes('BEGIN:VCALENDAR')) throw new Error('Esa URL no devuelve un calendario iCal válido.');
  return { ok: true, events: (text.match(/BEGIN:VEVENT/g) || []).length };
}));
app.get('/api/search', ah((req) => searchMeetings(String(req.query.q || ''), 30)));

// ---------- Google (sign in with Google → Calendar) ----------
app.post('/api/google/connect', ah(async (req) => ({ url: await googleAuth(req.body?.loginHint) })));
app.get('/api/google/callback', async (req, res) => {
  res.type('html').send(await googleCallback(new URLSearchParams(req.url.split('?')[1] || '')));
});
app.get('/api/google/accounts', ah(() => ({
  configured: googleConfigured(),
  accounts: googleAccounts().map((a) => ({ email: a.email, name: a.name, picture: a.picture, calendars: a.calendars, connectedAt: a.connectedAt })),
  errors: googleErrors(),
})));
app.post('/api/google/accounts/:email/refresh', ah(async (req) => {
  try { return { calendars: await refreshCalendars(req.params.email) }; }
  catch (e: any) { return { error: e.message, activationUrl: e.activationUrl }; }
}));
app.put('/api/google/accounts/:email/calendars', ah((req) => {
  setCalendarsEnabled(req.params.email, req.body.ids || []);
  clearCalendarCache();
  bus.emit('event', { type: 'meetings.changed' });
  return { ok: true };
}));
app.delete('/api/google/accounts/:email', ah(async (req) => {
  await googleDisconnect(req.params.email);
  clearCalendarCache();
  bus.emit('event', { type: 'meetings.changed' });
  return { ok: true };
}));
app.post('/api/open-url', ah((req) => {
  const url = String(req.body.url || '');
  if (!/^https:\/\/(accounts\.google\.com|console\.(cloud|developers)\.google\.com|myaccount\.google\.com)\//.test(url)) throw new Error('URL no permitida');
  if (process.platform === 'darwin') spawn('open', [url]);
  return { ok: true };
}));

// ---------- export & integrations ----------
app.get('/api/meetings/:id/export', ah((req, res) => {
  const fmt = req.query.format === 'html' ? 'html' : 'md';
  const transcript = req.query.transcript === '1';
  const body = fmt === 'html' ? toHtml(req.params.id, { transcript }) : toMarkdown(req.params.id, { transcript });
  res.setHeader('Content-Type', fmt === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8');
  if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="nota.${fmt}"`);
  res.send(body);
}));
app.post('/api/meetings/:id/export-file', ah(async (req) => {
  const file = writeExport(req.params.id, req.body.format === 'html' ? 'html' : 'md', { transcript: !!req.body.transcript });
  if (req.body.open && process.platform === 'darwin') spawn('open', [file]);
  if (req.body.reveal && process.platform === 'darwin') spawn('open', ['-R', file]);
  return { file };
}));
app.post('/api/meetings/:id/send', ah(async (req) => sendTo(req.body.target, req.params.id)));
app.post('/api/open-path', ah((req) => {
  const p = String(req.body.path || '');
  if (!p.startsWith(DATA_DIR)) throw new Error('Ruta no permitida');
  if (process.platform === 'darwin') spawn('open', [p]);
  return { ok: true };
}));

// ---------- import audio ----------
app.post('/api/import', express.raw({ type: '*/*', limit: '4gb' }), ah(async (req) => {
  const name = decodeURIComponent(String(req.headers['x-filename'] || 'audio'));
  const safe = name.replace(/[^\w.\- ]+/g, '_');
  const file = path.join(IMPORT_DIR, `${Date.now()}-${safe}`);
  fs.writeFileSync(file, req.body as Buffer);
  const id = uid('mt_');
  const t = now();
  const title = decodeURIComponent(String(req.headers['x-title'] || '')) || safe.replace(/\.[^.]+$/, '');
  run('INSERT INTO meetings(id, title, created_at, updated_at, started_at, status, source, audio_path, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, title, t, t, t, 'importing', 'import', file, req.headers['x-folder'] || null);
  bus.emit('event', { type: 'meetings.changed' });
  const session = new RecordingSession(id, 0, false);
  session.addSource(startFileSource(session, file, 'them', false, async () => {
    await session.stop();
    const dur = Number(get('SELECT MAX(end_ms) AS d FROM segments WHERE meeting_id = ?', id)?.d || 0);
    run("UPDATE meetings SET status = 'done', duration_ms = ?, ended_at = ? WHERE id = ?", dur, now(), id);
    if (getSetting('identifySpeakers', true) && ['openai', 'groq', 'anthropic'].some((p) => providerAvailable(p as any))) {
      await identifySpeakers(id).catch((e) => console.warn('[speakers]', e?.message));
    }
    reindexMeeting(id);
    bus.emit('event', { type: 'import.done', meetingId: id, errors: session.errors.slice(-3) });
    bus.emit('event', { type: 'meetings.changed' });
  }));
  return { id };
}));

// ---------- native helper ----------
app.get('/api/helper/permissions', ah(async () => {
  if (!helperAvailable()) return { available: false };
  const { stdout } = await execFileP(HELPER_BIN, ['check'], { timeout: 8000 });
  return { available: true, ...JSON.parse(stdout) };
}));
app.post('/api/helper/request', ah(async (req) => {
  if (!helperAvailable()) throw new Error('El capturador nativo no está compilado (npm run build:native).');
  const { stdout } = await execFileP(HELPER_BIN, ['request', String(req.body.what || 'all')], { timeout: 120000 });
  return JSON.parse(stdout || '{}');
}));
app.post('/api/helper/open-privacy', ah((req) => {
  const pane = { screen: 'Privacy_ScreenCapture', mic: 'Privacy_Microphone', calendar: 'Privacy_Calendars', accessibility: 'Privacy_Accessibility' }[String(req.body.pane)] || 'Privacy';
  spawn('open', [`x-apple.systempreferences:com.apple.preference.security?${pane}`]);
  return { ok: true };
}));
app.get('/api/helper/devices', ah(async () => {
  if (!helperAvailable()) return [];
  const { stdout } = await execFileP(HELPER_BIN, ['devices'], { timeout: 8000 });
  return JSON.parse(stdout);
}));

// ---------- server, websocket, UI ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/ws')) wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
const clients = new Set<WebSocket>();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    // Browser fallback capture: [channel byte][int16 PCM @16 kHz]
    const buf = data as Buffer;
    const s = activeSession();
    if (!s || buf.length < 3) return;
    const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset + 1, buf.byteOffset + 1 + ((buf.length - 1) & ~1)));
    s.pushAudio(buf[0] === 0 ? 'me' : 'them', pcm);
  });
});
bus.on('event', (ev) => {
  const msg = JSON.stringify(ev);
  for (const c of clients) if (c.readyState === 1) c.send(msg);
});

if (DEV) {
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: path.join(ROOT, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  const dist = path.join(ROOT, 'web', 'dist');
  app.use(express.static(dist));
  app.use((req, res, next) => (req.method === 'GET' && !req.path.startsWith('/api') ? res.sendFile(path.join(dist, 'index.html')) : next()));
}

server.on('error', (err) => {
  console.error('[server]', err);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Acta escuchando en http://127.0.0.1:${PORT}${DEV ? ' (dev)' : ''}${PACKAGED ? ' (app)' : ''}`);
  console.log(`Datos: ${DATA_DIR}`);
  startDetector();
  startCalendarWatcher();
});

process.on('SIGTERM', async () => { await stopRecording('shutdown'); process.exit(0); });
process.on('SIGINT', async () => { await stopRecording('shutdown'); process.exit(0); });
