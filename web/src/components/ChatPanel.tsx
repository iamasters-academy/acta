import { useEffect, useRef, useState } from 'react';
import { ArrowUp, History, Plus, Square, X, Copy, Sparkles } from 'lucide-react';
import { api, streamNdjson, type Recipe } from '../api';
import { useApp } from '../store';
import { Markdown } from './Markdown';
import { IconButton, Menu, cx, toast } from './ui';

type Msg = { role: 'user' | 'assistant'; content: string; error?: boolean };

function withLastAssistant(ms: Msg[], f: (m: Msg) => Msg): Msg[] {
  const c = [...ms];
  if (!c.length || c[c.length - 1].role !== 'assistant') c.push({ role: 'assistant', content: '' });
  c[c.length - 1] = f(c[c.length - 1]);
  return c;
}
export type ChatScopeProps = { scope: 'meeting' | 'folder' | 'person' | 'company' | 'global'; scopeId?: string };

export function useRecipes() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  useEffect(() => { api.get<Recipe[]>('/api/recipes').then(setRecipes).catch(() => {}); }, []);
  return recipes;
}

export function ChatPanel({
  scope, scopeId, title, onClose, initial, variant = 'drawer', suggestions,
}: ChatScopeProps & { title?: string; onClose?: () => void; initial?: { message?: string; recipe?: string; nonce?: number }; variant?: 'drawer' | 'page'; suggestions?: string[] }) {
  const { state } = useApp();
  const recipes = useRecipes();
  const [chatId, setChatId] = useState<string | undefined>();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState<string>('');
  const [history, setHistory] = useState<any[]>([]);
  const ctrl = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lastNonce = useRef<number | undefined>(undefined);

  const slash = input.startsWith('/') ? input.slice(1).split(' ')[0].toLowerCase() : null;
  const slashMatches = slash !== null ? recipes.filter((r) => r.slug.includes(slash) || r.name.toLowerCase().includes(slash)).slice(0, 7) : [];

  const scopeKey = `${scope}:${scopeId || ''}`;
  const prevScope = useRef(scopeKey);
  useEffect(() => {
    if (prevScope.current === scopeKey) return;
    prevScope.current = scopeKey;
    setChatId(undefined);
    setMessages([]);
  }, [scopeKey]);
  useEffect(() => {
    api.get<any[]>(`/api/chats?scope=${scope}${scopeId ? `&scopeId=${scopeId}` : ''}`).then(setHistory).catch(() => {});
  }, [scope, scopeId, chatId]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [messages]);

  const send = async (text: string, recipe?: string) => {
    if (busy || (!text.trim() && !recipe)) return;
    let message = text.trim();
    let rcp = recipe;
    const m = message.match(/^\/([\w-]+)\s*(.*)$/);
    if (!rcp && m && recipes.some((r) => r.slug === m[1])) { rcp = m[1]; message = m[2]; }
    const r = rcp ? recipes.find((x) => x.slug === rcp) : undefined;
    const shown = r ? `${r.name}${message ? ` — ${message}` : ''}` : message;
    setMessages((ms) => [...ms, { role: 'user', content: shown }, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    ctrl.current = new AbortController();
    try {
      await streamNdjson('/api/chat', { scope, scopeId, chatId, message: message || r?.name || '', recipe: rcp, model: model || undefined }, (e) => {
        if (e.type === 'chat') setChatId(e.chatId);
        if (e.type === 'delta') setMessages((ms) => withLastAssistant(ms, (m) => ({ ...m, content: m.content + e.text })));
        if (e.type === 'error') setMessages((ms) => withLastAssistant(ms, () => ({ role: 'assistant', content: e.message, error: true })));
      }, ctrl.current.signal);
    } catch (e: any) {
      if (e.name !== 'AbortError') setMessages((ms) => withLastAssistant(ms, () => ({ role: 'assistant', content: e.message, error: true })));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initial && initial.nonce !== lastNonce.current && (initial.message || initial.recipe)) {
      lastNonce.current = initial.nonce;
      void send(initial.message || '', initial.recipe);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.nonce, recipes.length]);

  const loadChat = async (id: string) => {
    const r = await api.get<any>(`/api/chats/${id}`);
    setChatId(id);
    setMessages(r.messages.map((m: any) => ({ role: m.role, content: m.content })));
  };

  const models = state?.models.filter((m) => m.available) || [];
  const quick = scope === 'global'
    ? ['semana', 'prep', 'tareas']
    : scope === 'meeting' ? ['email-seguimiento', 'tareas', 'resumen-ejecutivo', 'coach'] : ['resumen-ejecutivo', 'decisiones', 'preguntas-abiertas'];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {variant === 'drawer' && (
        <div className="flex h-12 items-center gap-1 border-b border-hairline px-4">
          <div className="flex-1 truncate text-[13.5px] font-medium">{title || 'Pregunta'}</div>
          <Menu
            align="right"
            trigger={(open) => <IconButton title="Conversaciones anteriores" onClick={open}><History size={15} /></IconButton>}
            items={history.length ? history.slice(0, 12).map((h) => ({ label: <span className="block max-w-[220px] truncate">{h.title}</span>, onClick: () => void loadChat(h.id) })) : [{ label: 'Sin conversaciones', onClick: () => {} }]}
          />
          <IconButton title="Nueva conversación" onClick={() => { setChatId(undefined); setMessages([]); }}><Plus size={16} /></IconButton>
          {onClose && <IconButton title="Cerrar" onClick={onClose}><X size={16} /></IconButton>}
        </div>
      )}
      <div ref={scroller} className={cx('flex-1 overflow-y-auto', variant === 'drawer' ? 'px-4 py-4' : 'py-2')}>
        {!messages.length && (
          <div className={cx(variant === 'drawer' ? 'pt-6' : 'pt-2')}>
            <div className="mb-3 text-[12.5px] text-ink-4">Prueba con una receta o pregunta lo que quieras.</div>
            <div className="flex flex-wrap gap-1.5">
              {(suggestions || []).map((s) => (
                <button key={s} onClick={() => void send(s)} className="rounded-full border border-hairline px-3 py-1 text-[12.5px] text-ink-2 hover:bg-soft">{s}</button>
              ))}
              {quick.map((slug) => recipes.find((r) => r.slug === slug)).filter(Boolean).map((r) => (
                <button key={r!.slug} onClick={() => void send('', r!.slug)} className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1 text-[12.5px] text-ink-2 hover:bg-soft">
                  <Sparkles size={12} className="text-accent-ink" />{r!.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-4">
          {messages.map((m, i) => m.role === 'user' ? (
            <div key={i} className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-md bg-soft-hover px-3.5 py-2 text-[13.5px] text-ink">{m.content}</div></div>
          ) : (
            <div key={i} className="group">
              {m.error ? <div className="rounded-xl bg-soft px-3 py-2 text-[13px] text-danger">{m.content}</div>
                : m.content ? <Markdown text={m.content} />
                  : <div className="space-y-2 pt-1">{[70, 90, 50].map((w) => <div key={w} className="shimmer h-3 rounded" style={{ width: `${w}%` }} />)}</div>}
              {m.content && !m.error && !(busy && i === messages.length - 1) && (
                <button onClick={() => void navigator.clipboard.writeText(m.content.replace(/\[\[m:\w+\|([^\]]+)\]\]/g, '$1')).then(() => toast('Copiado'))} className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-ink-4 opacity-0 hover:text-ink group-hover:opacity-100">
                  <Copy size={11} />Copiar
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className={cx('relative', variant === 'drawer' ? 'border-t border-hairline p-3' : 'pt-3')}>
        {slashMatches.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-1 rounded-xl border border-hairline bg-elevated p-1 shadow-pop">
            {slashMatches.map((r) => (
              <button key={r.slug} onClick={() => setInput(`/${r.slug} `)} className="flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-soft">
                <span className="text-[13px] text-ink">/{r.slug}</span>
                <span className="truncate text-[12px] text-ink-4">{r.description}</span>
              </button>
            ))}
          </div>
        )}
        <div className="rounded-2xl border border-hairline-strong bg-raised focus-within:border-accent-ink focus-within:ring-2 focus-within:ring-accent-tint">
          <textarea
            value={input}
            rows={variant === 'page' ? 2 : 1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (slashMatches.length && slash !== null && !input.includes(' ')) setInput(`/${slashMatches[0].slug} `);
                else void send(input);
              }
            }}
            placeholder="Pregunta lo que quieras, o escribe / para recetas"
            className="block max-h-40 min-h-[40px] w-full resize-none bg-transparent px-3.5 pt-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-4"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <select value={model} onChange={(e) => setModel(e.target.value)} className="max-w-[200px] rounded-md bg-transparent px-1 py-0.5 text-[11.5px] text-ink-4 outline-none hover:bg-soft">
              <option value="">Modelo por defecto</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            {busy ? (
              <button onClick={() => ctrl.current?.abort()} title="Detener" className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-ink"><Square size={11} fill="currentColor" /></button>
            ) : (
              <button onClick={() => void send(input)} disabled={!input.trim()} title="Enviar" className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-ink disabled:opacity-30"><ArrowUp size={15} /></button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
