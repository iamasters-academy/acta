// A recording session: audio sources -> per-channel voice activity detection ->
// utterances -> speech-to-text -> transcript segments (live over the event bus).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { AUDIO_DIR, HELPER_BIN } from './env.ts';
import { all, get, getSetting, now, reindexMeeting, run } from './db.ts';
import { SAMPLE_RATE, transcribe, type SttProvider } from './transcribe.ts';

export const bus = new EventEmitter();
bus.setMaxListeners(50);

export type Channel = 'me' | 'them';
const FRAME = 480; // 30 ms at 16 kHz
const PREROLL_FRAMES = 10;
const START_FRAMES = 3;

class ChannelVad {
  noise = -60;
  speaking = false;
  speechRun = 0;
  silenceMs = 0;
  speechMs = 0;
  utterStartMs = 0;
  chunks: Int16Array[] = [];
  preroll: Int16Array[] = [];
  carry = new Int16Array(0);
  level = 0;
  lastSpeechAt = 0;
  channel: Channel;
  session: RecordingSession;
  constructor(channel: Channel, session: RecordingSession) {
    this.channel = channel;
    this.session = session;
  }

  push(samples: Int16Array, atMs: number) {
    let data = samples;
    if (this.carry.length) {
      data = new Int16Array(this.carry.length + samples.length);
      data.set(this.carry);
      data.set(samples, this.carry.length);
    }
    let off = 0;
    let t = atMs - (this.carry.length / SAMPLE_RATE) * 1000;
    while (off + FRAME <= data.length) {
      const frame = data.subarray(off, off + FRAME);
      this.frame(frame.slice(), t);
      off += FRAME;
      t += 30;
    }
    this.carry = data.slice(off);
  }

  private frame(frame: Int16Array, t: number) {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    const db = rms > 0 ? Math.max(-90, 20 * Math.log10(rms / 32768)) : -90;
    this.level = Math.max(0, Math.min(1, (db + 60) / 50));
    const threshold = Math.max(-50, this.noise + 10);
    const isSpeech = db > threshold;
    if (!isSpeech) this.noise = this.noise * 0.995 + db * 0.005;

    if (!this.speaking) {
      this.preroll.push(frame);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
      this.speechRun = isSpeech ? this.speechRun + 1 : 0;
      if (this.speechRun >= START_FRAMES) {
        this.speaking = true;
        this.chunks = [...this.preroll];
        this.preroll = [];
        this.utterStartMs = Math.max(0, t - this.chunks.length * 30);
        this.speechMs = this.speechRun * 30;
        this.silenceMs = 0;
        this.session.emitActivity(this.channel, true);
      }
      return;
    }
    this.chunks.push(frame);
    if (isSpeech) {
      this.speechMs += 30;
      this.silenceMs = 0;
      this.lastSpeechAt = Date.now();
    } else {
      this.silenceMs += 30;
    }
    const lenMs = this.chunks.length * 30;
    const endpoint = this.session.endpointMs;
    if ((this.silenceMs >= endpoint && lenMs >= 900) || lenMs >= this.session.maxUtteranceMs) this.flush(t);
  }

  flush(t?: number) {
    if (!this.speaking) return;
    const chunks = this.chunks;
    const startMs = this.utterStartMs;
    const endMs = t ?? startMs + chunks.length * 30;
    const speechMs = this.speechMs;
    this.speaking = false;
    this.chunks = [];
    this.speechRun = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.session.emitActivity(this.channel, false);
    if (speechMs < 300) return;
    const pcm = new Int16Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of chunks) { pcm.set(c, o); o += c.length; }
    this.session.enqueue(this.channel, pcm, startMs, endMs);
  }
}

type Source = { stop: () => void; kind: string };

export type StartOptions = {
  sources?: ('helper' | 'browser')[];
  fakeFiles?: { path: string; channel: Channel; realtime?: boolean }[];
  mic?: boolean;
  system?: boolean;
};

export class RecordingSession {
  meetingId: string;
  startedWall = Date.now();
  baseOffsetMs: number;
  paused = false;
  stopped = false;
  vads: Record<Channel, ChannelVad>;
  sources: Source[] = [];
  queue: Promise<void>[] = [];
  inflight = 0;
  pending: (() => Promise<void>)[] = [];
  endpointMs = getSetting('vadEndpointMs', 650);
  maxUtteranceMs = getSetting('maxUtteranceMs', 14000);
  provider: SttProvider | undefined = getSetting<SttProvider | null>('sttProvider', null) || undefined;
  language = getSetting('language', 'es');
  vocabulary = getSetting('vocabulary', '');
  levelTimer: NodeJS.Timeout;
  silenceTimer: NodeJS.Timeout;
  rawStreams: Partial<Record<Channel, fs.WriteStream>> = {};
  lastActivity = Date.now();
  errors: string[] = [];
  helperInfo: Record<string, any> = {};

  live: boolean;
  constructor(meetingId: string, baseOffsetMs: number, live = true) {
    this.live = live;
    this.meetingId = meetingId;
    this.baseOffsetMs = baseOffsetMs;
    this.vads = { me: new ChannelVad('me', this), them: new ChannelVad('them', this) };
    this.levelTimer = setInterval(() => {
      if (!this.live) return;
      bus.emit('event', { type: 'recording.level', meetingId, me: this.vads.me.level, them: this.vads.them.level, elapsedMs: this.elapsedMs() });
    }, 120);
    const autoStopMin = getSetting('autoStopMinutes', 12);
    this.silenceTimer = setInterval(() => {
      if (this.live && !this.paused && autoStopMin > 0 && Date.now() - this.lastActivity > autoStopMin * 60_000) {
        bus.emit('event', { type: 'recording.autostop', meetingId, reason: `Sin voz durante ${autoStopMin} min` });
        void stopRecording('autostop');
      }
    }, 15_000);
    if (live && getSetting('saveAudio', false)) {
      for (const ch of ['me', 'them'] as Channel[]) {
        this.rawStreams[ch] = fs.createWriteStream(path.join(AUDIO_DIR, `${meetingId}-${ch}-${Date.now()}.raw`));
      }
    }
  }

  elapsedMs() {
    return this.baseOffsetMs + (Date.now() - this.startedWall);
  }

  emitActivity(channel: Channel, speaking: boolean) {
    this.lastActivity = Date.now();
    bus.emit('event', { type: 'recording.activity', meetingId: this.meetingId, channel, speaking });
  }

  pushAudio(channel: Channel, samples: Int16Array, atMs = this.elapsedMs()) {
    if (this.paused || this.stopped) return;
    this.rawStreams[channel]?.write(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
    this.vads[channel].push(samples, atMs);
  }

  enqueue(channel: Channel, pcm: Int16Array, startMs: number, endMs: number) {
    const job = async () => {
      bus.emit('event', { type: 'transcript.pending', meetingId: this.meetingId, channel, startMs });
      try {
        const text = await transcribe(pcm, { provider: this.provider, language: this.language, vocabulary: this.vocabulary });
        if (!text) return;
        if (channel === 'me' && isEcho(this.meetingId, text, startMs, endMs)) return;
        const r = run(
          'INSERT INTO segments(meeting_id, speaker, start_ms, end_ms, text, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          this.meetingId, channel, Math.round(startMs), Math.round(endMs), text, now(),
        );
        bus.emit('event', {
          type: 'transcript.segment',
          meetingId: this.meetingId,
          segment: { id: Number(r.lastInsertRowid), speaker: channel, start_ms: Math.round(startMs), end_ms: Math.round(endMs), text },
        });
      } catch (e: any) {
        const msg = String(e?.message || e);
        console.warn('[stt]', msg);
        this.errors.push(msg);
        bus.emit('event', { type: 'recording.error', meetingId: this.meetingId, message: msg });
      }
    };
    this.pending.push(job);
    this.pump();
  }

  private pump() {
    while (this.inflight < 3 && this.pending.length) {
      const job = this.pending.shift()!;
      this.inflight++;
      const p = job().finally(() => {
        this.inflight--;
        this.pump();
      });
      this.queue.push(p);
    }
  }

  async drain() {
    while (this.pending.length || this.inflight) {
      await Promise.allSettled(this.queue);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  addSource(s: Source) {
    this.sources.push(s);
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.levelTimer);
    clearInterval(this.silenceTimer);
    for (const s of this.sources) s.stop();
    for (const v of Object.values(this.vads)) v.flush();
    await this.drain();
    for (const ws of Object.values(this.rawStreams)) ws?.end();
  }
}

function tokens(s: string) {
  return new Set(s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter((w) => w.length > 2));
}
function isEcho(meetingId: string, text: string, startMs: number, endMs: number) {
  const near = all(
    "SELECT text FROM segments WHERE meeting_id = ? AND speaker = 'them' AND end_ms >= ? AND start_ms <= ?",
    meetingId, startMs - 4000, endMs + 4000,
  );
  const a = tokens(text);
  if (a.size < 3) return false;
  for (const n of near) {
    const b = tokens(n.text);
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    if (inter / a.size > 0.6) return true;
  }
  return false;
}

// ---------- sources ----------
export function helperAvailable() {
  return fs.existsSync(HELPER_BIN);
}

function startHelperSource(session: RecordingSession, opts: { mic: boolean; system: boolean }): Source {
  const args = ['capture'];
  if (!opts.mic) args.push('--no-mic');
  if (!opts.system) args.push('--no-system');
  if (getSetting('echoCancellation', true)) args.push('--aec');
  const micDevice = getSetting<string>('micDeviceUID', '');
  if (micDevice) args.push('--mic-device', micDevice);
  const child: ChildProcess = spawn(HELPER_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let buf: Buffer = Buffer.alloc(0);
  child.stdout!.on('data', (d: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    while (buf.length >= 5) {
      const ch = buf[0];
      const count = buf.readUInt32LE(1);
      const need = 5 + count * 2;
      if (buf.length < need) break;
      const bytes = buf.subarray(5, need);
      const samples = new Int16Array(count);
      for (let i = 0; i < count; i++) samples[i] = bytes.readInt16LE(i * 2);
      buf = buf.subarray(need);
      session.pushAudio(ch === 0 ? 'me' : 'them', samples);
    }
  });
  let errBuf = '';
  child.stderr!.on('data', (d) => {
    errBuf += d;
    let i;
    while ((i = errBuf.indexOf('\n')) >= 0) {
      const line = errBuf.slice(0, i);
      errBuf = errBuf.slice(i + 1);
      try {
        const j = JSON.parse(line);
        console.log('[acta-audio]', line);
        session.helperInfo[j.source || j.event] = j;
        bus.emit('event', { type: 'helper', meetingId: session.meetingId, ...j });
        if (j.event === 'error') session.errors.push(`${j.source}: ${j.message}`);
      } catch {
        if (line.trim()) console.warn('[acta-audio]', line);
      }
    }
  });
  child.on('exit', (code) => {
    if (!session.stopped) bus.emit('event', { type: 'recording.error', meetingId: session.meetingId, message: `El capturador de audio se cerró (código ${code}).` });
  });
  return { kind: 'helper', stop: () => child.kill('SIGTERM') };
}

export function startFileSource(session: RecordingSession, file: string, channel: Channel, realtime: boolean, onEnd?: () => void): Source {
  const args = [...(realtime ? ['-re'] : []), '-hide_banner', '-loglevel', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(SAMPLE_RATE), '-'];
  const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let samplesSoFar = 0;
  let rest: Buffer = Buffer.alloc(0);
  child.stdout.on('data', (d: Buffer) => {
    const b = rest.length ? Buffer.concat([rest, d]) : d;
    const n = Math.floor(b.length / 2);
    const samples = new Int16Array(n);
    for (let i = 0; i < n; i++) samples[i] = b.readInt16LE(i * 2);
    rest = b.subarray(n * 2);
    // Offline imports use the file clock, live (realtime) playback uses the wall clock.
    const at = realtime ? undefined : session.baseOffsetMs + (samplesSoFar / SAMPLE_RATE) * 1000;
    samplesSoFar += n;
    session.pushAudio(channel, samples, at);
  });
  child.stderr.on('data', (d) => console.warn('[ffmpeg]', String(d).trim()));
  child.on('exit', () => onEnd?.());
  return { kind: 'file', stop: () => child.kill('SIGTERM') };
}

// ---------- the single active session ----------
let active: RecordingSession | null = null;
export const activeSession = () => active;

export async function startRecording(meetingId: string, opts: StartOptions = {}) {
  if (active && active.meetingId !== meetingId) await stopRecording('switch');
  if (active) {
    active.paused = false;
    setStatus(meetingId, 'recording');
    return active;
  }
  const m = get('SELECT duration_ms, started_at FROM meetings WHERE id = ?', meetingId);
  if (!m) throw new Error('Nota no encontrada');
  const s = new RecordingSession(meetingId, m.duration_ms || 0);
  active = s;
  if (!m.started_at) run('UPDATE meetings SET started_at = ? WHERE id = ?', now(), meetingId);
  setStatus(meetingId, 'recording');

  const fake = opts.fakeFiles || (process.env.ACTA_FAKE_AUDIO ? process.env.ACTA_FAKE_AUDIO.split(',').map((p, i) => ({ path: p, channel: (i === 0 ? 'them' : 'me') as Channel, realtime: true })) : null);
  if (fake?.length) {
    for (const f of fake) s.addSource(startFileSource(s, f.path, f.channel, f.realtime ?? true));
  } else {
    const wantsHelper = (opts.sources || ['helper']).includes('helper');
    if (wantsHelper && helperAvailable() && process.platform === 'darwin') {
      s.addSource(startHelperSource(s, { mic: opts.mic ?? true, system: opts.system ?? true }));
    }
  }
  bus.emit('event', { type: 'recording.status', meetingId, status: 'recording', sources: s.sources.map((x) => x.kind) });
  return s;
}

export function pauseRecording(meetingId: string) {
  if (!active || active.meetingId !== meetingId) return;
  active.paused = true;
  for (const v of Object.values(active.vads)) v.flush();
  setStatus(meetingId, 'paused');
}

export function resumeRecording(meetingId: string) {
  if (!active || active.meetingId !== meetingId) return;
  active.paused = false;
  setStatus(meetingId, 'recording');
}

export async function stopRecording(reason = 'user') {
  const s = active;
  if (!s) return;
  active = null;
  await s.stop();
  const elapsed = s.elapsedMs();
  run('UPDATE meetings SET duration_ms = ?, ended_at = ?, updated_at = ? WHERE id = ?', elapsed, now(), now(), s.meetingId);
  setStatus(s.meetingId, 'done');
  reindexMeeting(s.meetingId);
  const raws = Object.values(s.rawStreams).map((w) => (w as any)?.path as string).filter(Boolean);
  if (raws.length === 2) void mixAudio(s.meetingId, raws as string[]);
  bus.emit('event', { type: 'recording.stopped', meetingId: s.meetingId, reason, errors: s.errors.slice(-5) });
}

function setStatus(meetingId: string, status: string) {
  run('UPDATE meetings SET status = ?, updated_at = ? WHERE id = ?', status, now(), meetingId);
  bus.emit('event', { type: 'recording.status', meetingId, status });
}

async function mixAudio(meetingId: string, raws: string[]) {
  const out = path.join(AUDIO_DIR, `${meetingId}.m4a`);
  const args = ['-y', '-loglevel', 'error'];
  for (const r of raws) args.push('-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', r);
  args.push('-filter_complex', 'amix=inputs=2:duration=longest', '-c:a', 'aac', '-b:a', '64k', out);
  await new Promise<void>((resolve) => spawn('ffmpeg', args).on('exit', () => resolve()));
  if (fs.existsSync(out)) {
    run('UPDATE meetings SET audio_path = ? WHERE id = ?', out, meetingId);
    for (const r of raws) fs.rmSync(r, { force: true }); // intermediate raw PCM, regenerable
  }
}
