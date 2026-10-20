// Speech-to-text for one utterance of 16 kHz mono PCM. Providers: Groq Whisper,
// OpenAI, Deepgram (prerecorded) or a fully local whisper.cpp model.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getSetting } from './db.ts';
import { apiKey } from './llm.ts';

const execFileP = promisify(execFile);
export const SAMPLE_RATE = 16000;

export type SttProvider = 'groq' | 'openai' | 'deepgram' | 'local';

export const STT_CATALOG: { id: SttProvider; label: string; detail: string }[] = [
  { id: 'groq', label: 'Groq · Whisper large v3 turbo', detail: 'Muy rápido y barato. Excelente en español.' },
  { id: 'openai', label: 'OpenAI · gpt-4o-transcribe', detail: 'La mejor precisión con ruido y acentos.' },
  { id: 'deepgram', label: 'Deepgram · Nova-3', detail: 'El motor que usa Granola. Requiere clave de Deepgram.' },
  { id: 'local', label: 'Local · whisper.cpp', detail: '100 % en tu Mac. Gratis y privado; algo más lento.' },
];

export function sttAvailable(p: SttProvider) {
  if (p === 'groq') return !!apiKey('GROQ_API_KEY');
  if (p === 'openai') return !!apiKey('OPENAI_API_KEY');
  if (p === 'deepgram') return !!apiKey('DEEPGRAM_API_KEY');
  return fs.existsSync(localModelPath()) && !!whisperBin();
}

export function defaultStt(): SttProvider {
  const chosen = getSetting<SttProvider | null>('sttProvider', null);
  if (chosen && sttAvailable(chosen)) return chosen;
  for (const p of ['groq', 'openai', 'deepgram', 'local'] as SttProvider[]) if (sttAvailable(p)) return p;
  return 'local';
}

export function localModelPath() {
  const custom = getSetting<string>('localWhisperModel', '');
  if (custom && fs.existsSync(custom)) return custom;
  const candidates = [
    path.join(os.homedir(), '.cache/acta/ggml-large-v3-turbo.bin'),
    path.join(os.homedir(), '.cache/whisper/ggml-large-v3-turbo.bin'),
  ];
  return candidates.find((c) => fs.existsSync(c)) || candidates[0];
}

function whisperBin() {
  for (const c of ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli']) if (fs.existsSync(c)) return c;
  return '';
}

export function pcmToWav(pcm: Int16Array, sampleRate = SAMPLE_RATE): Buffer {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// Phrases Whisper invents on silence or music. Dropped when they are the whole utterance.
const HALLUCINATIONS = [
  /^gracias( por (ver|vernos|su atención|ver el vídeo))?[.!]*$/i,
  /subt[ií]tulos (realizados|por)/i,
  /amara\.org/i,
  /^(thank you|thanks for watching)[.!]*$/i,
  /suscr[ií]b(e|ete) (al|a mi) canal/i,
  /^\.+$/,
  /^(música|music|\[música\]|\(música\))[.!]*$/i,
  /^¡?(hola|adiós)[.!]*$/i,
];

export function cleanTranscript(text: string) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (HALLUCINATIONS.some((r) => r.test(t))) return '';
  return t;
}

export async function transcribe(pcm: Int16Array, opts: { provider?: SttProvider; language?: string; vocabulary?: string } = {}): Promise<string> {
  const provider = opts.provider || defaultStt();
  const language = opts.language && opts.language !== 'auto' ? opts.language : undefined;
  const wav = pcmToWav(pcm);
  let text = '';
  if (provider === 'groq' || provider === 'openai') {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', provider === 'groq' ? 'whisper-large-v3-turbo' : getSetting('openaiSttModel', 'gpt-4o-transcribe'));
    form.append('response_format', 'json');
    if (language) form.append('language', language);
    if (opts.vocabulary) form.append('prompt', opts.vocabulary.slice(0, 800));
    if (provider === 'groq') form.append('temperature', '0');
    const base = provider === 'groq' ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1';
    const res = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey(provider === 'groq' ? 'GROQ_API_KEY' : 'OPENAI_API_KEY')}` },
      body: form,
    });
    if (!res.ok) throw new Error(`${provider} STT ${res.status}: ${(await res.text()).slice(0, 300)}`);
    text = ((await res.json()) as any).text || '';
  } else if (provider === 'deepgram') {
    const params = new URLSearchParams({ model: 'nova-3', smart_format: 'true', punctuate: 'true' });
    if (language) params.set('language', language); else params.set('language', 'multi');
    for (const term of (opts.vocabulary || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 50)) params.append('keyterm', term);
    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey('DEEPGRAM_API_KEY')}`, 'Content-Type': 'audio/wav' },
      body: new Uint8Array(wav),
    });
    if (!res.ok) throw new Error(`deepgram ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j: any = await res.json();
    text = j.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
  } else {
    const tmp = path.join(os.tmpdir(), `acta-${process.pid}-${Math.random().toString(36).slice(2)}.wav`);
    fs.writeFileSync(tmp, wav);
    try {
      const args = ['-m', localModelPath(), '-f', tmp, '-nt', '-np', '-l', language || 'auto', '-t', String(Math.max(2, os.cpus().length - 2))];
      if (opts.vocabulary) args.push('--prompt', opts.vocabulary.slice(0, 400));
      const { stdout } = await execFileP(whisperBin(), args, { maxBuffer: 10 * 1024 * 1024 });
      text = stdout;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  return cleanTranscript(text);
}
