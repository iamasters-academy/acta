// One streaming interface over several LLM providers. Model ids are "provider:model".
import { spawn } from 'node:child_process';
import { getSetting } from './db.ts';

export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

export type ProviderId = 'openai' | 'groq' | 'anthropic' | 'claude-cli';

export const MODEL_CATALOG: { id: string; label: string; provider: ProviderId; speed: 'rápido' | 'equilibrado' | 'potente' }[] = [
  { id: 'openai:gpt-5.5', label: 'GPT-5.5', provider: 'openai', speed: 'potente' },
  { id: 'openai:gpt-6-sol', label: 'GPT-6 Sol', provider: 'openai', speed: 'potente' },
  { id: 'openai:gpt-5.4', label: 'GPT-5.4', provider: 'openai', speed: 'equilibrado' },
  { id: 'openai:gpt-5.4-mini', label: 'GPT-5.4 mini', provider: 'openai', speed: 'rápido' },
  { id: 'openai:gpt-4.1', label: 'GPT-4.1', provider: 'openai', speed: 'equilibrado' },
  { id: 'anthropic:claude-opus-5-5', label: 'Claude Opus 5.5', provider: 'anthropic', speed: 'potente' },
  { id: 'anthropic:claude-sonnet-5-5', label: 'Claude Sonnet 5.5', provider: 'anthropic', speed: 'equilibrado' },
  { id: 'anthropic:claude-haiku-5-5', label: 'Claude Haiku 5.5', provider: 'anthropic', speed: 'rápido' },
  { id: 'claude-cli:sonnet', label: 'Claude (tu suscripción, vía Claude Code)', provider: 'claude-cli', speed: 'equilibrado' },
  { id: 'groq:openai/gpt-oss-120b', label: 'GPT-OSS 120B (Groq)', provider: 'groq', speed: 'rápido' },
  { id: 'groq:qwen/qwen3.8-27b', label: 'Qwen 3.8 27B (Groq)', provider: 'groq', speed: 'rápido' },
];

export function apiKey(name: 'OPENAI_API_KEY' | 'GROQ_API_KEY' | 'ANTHROPIC_API_KEY' | 'DEEPGRAM_API_KEY'): string | undefined {
  const keys = getSetting<Record<string, string>>('apiKeys', {});
  return keys[name] || process.env[name] || undefined;
}

export function providerAvailable(p: ProviderId): boolean {
  if (p === 'openai') return !!apiKey('OPENAI_API_KEY');
  if (p === 'groq') return !!apiKey('GROQ_API_KEY');
  if (p === 'anthropic') return !!apiKey('ANTHROPIC_API_KEY');
  if (p === 'claude-cli') return getSetting('claudeCliEnabled', false);
  return false;
}

export function availableModels() {
  return MODEL_CATALOG.map((m) => ({ ...m, available: providerAvailable(m.provider) }));
}

export function defaultModel(kind: 'notes' | 'chat' | 'fast'): string {
  const chosen = getSetting<Record<string, string>>('models', {})[kind];
  if (chosen && providerAvailable(chosen.split(':')[0] as ProviderId)) return chosen;
  const prefs: Record<string, string[]> = {
    notes: ['openai:gpt-5.5', 'anthropic:claude-sonnet-5-5', 'groq:openai/gpt-oss-120b', 'claude-cli:sonnet'],
    chat: ['openai:gpt-5.4', 'anthropic:claude-sonnet-5-5', 'groq:openai/gpt-oss-120b', 'claude-cli:sonnet'],
    fast: ['openai:gpt-5.4-mini', 'groq:openai/gpt-oss-120b', 'anthropic:claude-haiku-5-5', 'claude-cli:sonnet'],
  };
  for (const id of prefs[kind]) if (providerAvailable(id.split(':')[0] as ProviderId)) return id;
  return prefs[kind][0];
}

export class LlmError extends Error {}

export async function* streamLLM(opts: {
  model?: string;
  kind?: 'notes' | 'chat' | 'fast';
  system: string;
  messages: ChatMsg[];
  maxTokens?: number;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const model = opts.model || defaultModel(opts.kind || 'chat');
  const idx = model.indexOf(':');
  const provider = model.slice(0, idx) as ProviderId;
  const name = model.slice(idx + 1);
  if (!providerAvailable(provider)) {
    throw new LlmError(`El proveedor «${provider}» no está configurado. Añade la clave en Ajustes → Claves.`);
  }
  if (provider === 'openai' || provider === 'groq') {
    yield* streamOpenAICompatible(provider, name, opts);
  } else if (provider === 'anthropic') {
    yield* streamAnthropic(name, opts);
  } else {
    yield* streamClaudeCli(name, opts);
  }
}

export async function completeLLM(opts: Parameters<typeof streamLLM>[0]): Promise<string> {
  let out = '';
  for await (const chunk of streamLLM(opts)) out += chunk;
  return out;
}

async function* sseLines(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}

async function* streamOpenAICompatible(provider: 'openai' | 'groq', model: string, opts: Parameters<typeof streamLLM>[0]) {
  const base = provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.groq.com/openai/v1';
  const key = apiKey(provider === 'openai' ? 'OPENAI_API_KEY' : 'GROQ_API_KEY');
  const reasoning = /^(gpt-5|gpt-6|o[134])/.test(model);
  const body: any = {
    model,
    stream: true,
    messages: [{ role: 'system', content: opts.system }, ...opts.messages],
  };
  if (reasoning) {
    body.reasoning_effort = 'low';
    if (opts.maxTokens) body.max_completion_tokens = opts.maxTokens + 4000;
  } else {
    body.temperature = 0.3;
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) throw new LlmError(`${provider} ${res.status}: ${(await res.text()).slice(0, 400)}`);
  for await (const data of sseLines(res)) {
    if (data === '[DONE]') return;
    try {
      const j = JSON.parse(data);
      const d = j.choices?.[0]?.delta?.content;
      if (d) yield d as string;
    } catch { /* keep-alive */ }
  }
}

async function* streamAnthropic(model: string, opts: Parameters<typeof streamLLM>[0]) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens || 4096,
      system: opts.system,
      stream: true,
      messages: opts.messages.filter((m) => m.role !== 'system'),
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw new LlmError(`anthropic ${res.status}: ${(await res.text()).slice(0, 400)}`);
  for await (const data of sseLines(res)) {
    try {
      const j = JSON.parse(data);
      if (j.type === 'content_block_delta' && j.delta?.text) yield j.delta.text as string;
    } catch { /* ping */ }
  }
}

async function* streamClaudeCli(model: string, opts: Parameters<typeof streamLLM>[0]) {
  const prompt = opts.messages.map((m) => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`).join('\n\n');
  const child = spawn(
    'claude',
    ['-p', '--model', model, '--output-format', 'stream-json', '--include-partial-messages', '--verbose', '--system-prompt', opts.system, '--tools', ''],
    { stdio: ['pipe', 'pipe', 'pipe'], cwd: process.env.HOME },
  );
  opts.signal?.addEventListener('abort', () => child.kill());
  child.stdin.end(prompt);
  let buf = '';
  let errText = '';
  child.stderr.on('data', (d) => (errText += d));
  for await (const chunk of child.stdout) {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const j = JSON.parse(line);
        if (j.type === 'stream_event' && j.event?.type === 'content_block_delta' && j.event.delta?.text) yield j.event.delta.text;
        if (j.type === 'result' && j.is_error) throw new LlmError(`Claude Code: ${j.result}`);
      } catch (e) {
        if (e instanceof LlmError) throw e;
      }
    }
  }
  if (errText && !buf) console.warn('[claude-cli]', errText.slice(0, 300));
}
