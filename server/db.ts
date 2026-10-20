// Local storage on node:sqlite (no native deps). Everything Acta knows lives in data/acta.db.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './env.ts';

export const db = new DatabaseSync(path.join(DATA_DIR, 'acta.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle',
  calendar_event_id TEXT,
  calendar_start INTEGER,
  attendees TEXT NOT NULL DEFAULT '[]',
  folder_id TEXT,
  template_id TEXT,
  notes_html TEXT NOT NULL DEFAULT '',
  notes_text TEXT NOT NULL DEFAULT '',
  enhanced_md TEXT NOT NULL DEFAULT '',
  enhanced_at INTEGER,
  summary TEXT NOT NULL DEFAULT '',
  language TEXT,
  audio_path TEXT,
  source TEXT NOT NULL DEFAULT 'live',
  archived_at INTEGER
);
CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT NOT NULL REFERENCES meetings(id),
  speaker TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS segments_meeting ON segments(meeting_id, start_ms);
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'olive',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  sections TEXT NOT NULL DEFAULT '[]',
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS action_items (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id),
  text TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT '',
  due TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT UNIQUE,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  company_id TEXT REFERENCES companies(id),
  role TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meeting_people (
  meeting_id TEXT NOT NULL REFERENCES meetings(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  PRIMARY KEY (meeting_id, person_id)
);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  scope_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL REFERENCES chats(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS integration_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT,
  target TEXT NOT NULL,
  ok INTEGER NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  meeting_id UNINDEXED, title, notes, enhanced, transcript,
  tokenize = 'unicode61 remove_diacritics 2'
);
`);

export const uid = (prefix = '') => prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
export const now = () => Date.now();

export type Row = Record<string, any>;
export const all = (sql: string, ...params: any[]): Row[] => db.prepare(sql).all(...params) as Row[];
export const get = (sql: string, ...params: any[]): Row | undefined => db.prepare(sql).get(...params) as Row | undefined;
export const run = (sql: string, ...params: any[]) => db.prepare(sql).run(...params);

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------- settings ----------
export function getSetting<T = any>(key: string, fallback: T): T {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  if (!r) return fallback;
  try { return JSON.parse(r.value) as T; } catch { return fallback; }
}
export function setSetting(key: string, value: any) {
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

// ---------- meetings ----------
export function parseMeeting(m: Row | undefined): any {
  if (!m) return undefined;
  return { ...m, attendees: safeJson(m.attendees, []) };
}
export function safeJson<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export function transcriptText(meetingId: string, names = { me: 'Yo', them: 'Ellos' }) {
  const segs = all('SELECT speaker, start_ms, text FROM segments WHERE meeting_id = ? ORDER BY start_ms', meetingId);
  return segs
    .map((s) => `[${fmtTime(s.start_ms)}] ${s.speaker === 'me' ? names.me : s.speaker === 'them' ? names.them : s.speaker}: ${s.text}`)
    .join('\n');
}

export function fmtTime(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function reindexMeeting(id: string) {
  const m = get('SELECT id, title, notes_text, enhanced_md, archived_at FROM meetings WHERE id = ?', id);
  run('DELETE FROM search_index WHERE meeting_id = ?', id);
  if (!m || m.archived_at) return;
  const transcript = all('SELECT text FROM segments WHERE meeting_id = ? ORDER BY start_ms', id).map((s) => s.text).join(' ');
  run(
    'INSERT INTO search_index(meeting_id, title, notes, enhanced, transcript) VALUES (?, ?, ?, ?, ?)',
    id, m.title || '', m.notes_text || '', m.enhanced_md || '', transcript,
  );
}

export function searchMeetings(q: string, limit = 20) {
  const terms = q
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .map((t) => `"${t}"*`);
  if (!terms.length) return [];
  const match = terms.join(' OR ');
  return all(
    `SELECT s.meeting_id AS id, m.title, m.created_at, m.started_at,
            snippet(search_index, -1, '[[', ']]', '…', 14) AS snippet,
            bm25(search_index, 0, 8.0, 3.0, 2.0, 1.0) AS score
       FROM search_index s JOIN meetings m ON m.id = s.meeting_id
      WHERE search_index MATCH ? AND m.archived_at IS NULL
      ORDER BY score LIMIT ?`,
    match, limit,
  );
}
