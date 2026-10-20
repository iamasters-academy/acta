// Thin client for the Acta server: JSON calls, text/NDJSON streams and the live event socket.
export type Attendee = { name: string; email?: string; self?: boolean };
export type MeetingSummary = {
  id: string; title: string; created_at: number; started_at: number | null; ended_at: number | null; duration_ms: number;
  status: string; attendees: Attendee[]; folder_id: string | null; summary: string; calendar_start: number | null;
  source: string; enhanced: boolean; segment_count: number; archived_at: number | null;
};
export type Segment = { id: number; speaker: string; start_ms: number; end_ms: number; text: string };
export type ActionItem = { id: string; meeting_id: string; text: string; owner: string; due: string; done: number; meeting_title?: string; meeting_date?: number };
export type Person = { id: string; name: string; email: string | null; company?: string; company_id?: string; role: string; notes: string; meetings?: number; last_met?: number };
export type Folder = { id: string; name: string; description: string; color: string; count?: number };
export type Template = { id: string; name: string; description: string; instructions: string; sections: string[]; builtin: number };
export type Recipe = { id: string; slug: string; name: string; description: string; prompt: string; builtin: number };
export type CalEvent = {
  id: string; title: string; start: number; end: number; allDay: boolean; location: string; description: string;
  meetingUrl: string; attendees: Attendee[]; calendar: string; meetingId?: string | null;
};
export type Meeting = MeetingSummary & {
  notes_html: string; notes_text: string; enhanced_md: string; enhanced_at: number | null; template_id: string | null;
  segments: Segment[]; actionItems: ActionItem[]; people: Person[]; folder: Folder | null; audio_path: string | null;
  integrationLog: { target: string; ok: number; detail: string; created_at: number }[];
};
export type ModelOpt = { id: string; label: string; provider: string; speed: string; available: boolean };
export type AppState = {
  userName: string; onboarded: boolean; platform: string; packaged?: boolean; googleConfigured?: boolean;
  helper: { available: boolean; detector: { running: boolean; micInUse: boolean; meetings: any[]; permissions: Record<string, string> } };
  recording: { meetingId: string; paused: boolean; elapsedMs: number; sources: string[] } | null;
  models: ModelOpt[]; defaults: { notes: string; chat: string; fast: string };
  stt: { provider: string; options: { id: string; label: string; detail: string; available: boolean }[] };
};

async function req<T>(method: string, url: string, body?: any): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(url: string) => req<T>('GET', url),
  post: <T = any>(url: string, body: any = {}) => req<T>('POST', url, body),
  put: <T = any>(url: string, body: any = {}) => req<T>('PUT', url, body),
  patch: <T = any>(url: string, body: any = {}) => req<T>('PATCH', url, body),
  del: <T = any>(url: string) => req<T>('DELETE', url),
};

/** POST and stream a text/plain response, calling onChunk with each piece. */
export async function streamText(url: string, body: any, onChunk: (s: string) => void, signal?: AbortSignal) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let all = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const s = dec.decode(value, { stream: true });
    all += s;
    onChunk(s);
  }
  return all;
}

/** POST and stream NDJSON events. */
export async function streamNdjson(url: string, body: any, onEvent: (e: any) => void, signal?: AbortSignal) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(`${res.status}`);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim()) onEvent(JSON.parse(line));
    }
  }
}

// ---------- live events ----------
type Listener = (e: any) => void;
const listeners = new Set<Listener>();
let socket: WebSocket | null = null;

export function connectEvents() {
  if (socket && socket.readyState <= 1) return socket;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  socket.binaryType = 'arraybuffer';
  socket.onmessage = (m) => {
    if (typeof m.data !== 'string') return;
    try {
      const e = JSON.parse(m.data);
      for (const l of listeners) l(e);
    } catch { /* ignore */ }
  };
  socket.onclose = () => setTimeout(connectEvents, 1500);
  return socket;
}

export function onEvent(l: Listener) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function sendAudio(channel: 0 | 1, pcm: Int16Array) {
  if (!socket || socket.readyState !== 1) return;
  const out = new Uint8Array(1 + pcm.byteLength);
  out[0] = channel;
  out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 1);
  socket.send(out);
}

// ---------- formatting ----------
export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
export const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
export const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtShortDate = (ms: number) => new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
export const fmtDuration = (ms: number) => {
  const m = Math.round(ms / 60000);
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min' : ''}`.trim();
};
export function dayBucket(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  if (diff < 0) return 'Próximamente';
  if (diff < 7) return d.toLocaleDateString('es-ES', { weekday: 'long' }).replace(/^./, (c) => c.toUpperCase());
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
export const meetingTime = (m: Pick<MeetingSummary, 'calendar_start' | 'started_at' | 'created_at'>) => m.calendar_start || m.started_at || m.created_at;
export const initials = (s: string) => s.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
