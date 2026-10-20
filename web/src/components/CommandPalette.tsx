import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { FileText, MessageCircle, PenLine, Search, Settings, CheckSquare, Users, LayoutTemplate } from 'lucide-react';
import { useApp } from '../store';
import { api, fmtShortDate, meetingTime } from '../api';
import { cx } from './ui';

type Hit = { id: string; title: string; snippet?: string; date?: number };
type Action = { label: string; icon: React.ReactNode; run: () => void };

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, meetings, newNote } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (paletteOpen) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 10); }
  }, [paletteOpen]);

  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(async () => {
      const r = await api.get<any[]>(`/api/search?q=${encodeURIComponent(q)}`);
      setHits(r.map((h) => ({ id: h.id, title: h.title || 'Sin título', snippet: h.snippet, date: h.started_at || h.created_at })));
      setSel(0);
    }, 120);
    return () => clearTimeout(t);
  }, [q]);

  const close = () => setPaletteOpen(false);
  const actions: Action[] = useMemo(() => [
    { label: 'Nueva nota', icon: <PenLine size={15} />, run: () => void newNote() },
    { label: q.trim() ? `Preguntar a Acta: «${q.trim()}»` : 'Pregunta a Acta', icon: <MessageCircle size={15} />, run: () => nav(`/preguntar${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`) },
    { label: 'Tareas', icon: <CheckSquare size={15} />, run: () => nav('/tareas') },
    { label: 'Personas', icon: <Users size={15} />, run: () => nav('/personas') },
    { label: 'Plantillas y recetas', icon: <LayoutTemplate size={15} />, run: () => nav('/plantillas') },
    { label: 'Ajustes', icon: <Settings size={15} />, run: () => nav('/ajustes') },
  ].filter((a) => !q.trim() || a.label.toLowerCase().includes(q.toLowerCase()) || a.label.startsWith('Preguntar')), [q, nav, newNote]);

  const recent: Hit[] = q.trim() ? [] : meetings.slice(0, 6).map((m) => ({ id: m.id, title: m.title || 'Sin título', date: meetingTime(m) }));
  const list: ({ kind: 'note'; hit: Hit } | { kind: 'action'; action: Action })[] = [
    ...(q.trim() ? hits : recent).map((hit) => ({ kind: 'note' as const, hit })),
    ...actions.map((action) => ({ kind: 'action' as const, action })),
  ];

  const choose = (i: number) => {
    const it = list[i];
    if (!it) return;
    close();
    if (it.kind === 'note') nav(`/nota/${it.hit.id}`);
    else it.action.run();
  };

  if (!paletteOpen) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 p-4 pt-[14vh]" onMouseDown={close}>
      <div className="fade-up w-full max-w-[600px] overflow-hidden rounded-2xl border border-hairline bg-elevated shadow-pop" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-hairline px-4">
          <Search size={16} className="text-ink-4" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(list.length - 1, s + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
            }}
            placeholder="Busca en tus notas y transcripciones…"
            className="h-12 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-4"
          />
        </div>
        <div className="max-h-[420px] overflow-y-auto p-1.5">
          {!q.trim() && recent.length > 0 && <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-4">Recientes</div>}
          {q.trim() && !hits.length && <div className="px-3 py-3 text-[13px] text-ink-4">Sin resultados en tus notas.</div>}
          {list.map((it, i) => (
            <button
              key={i}
              onMouseEnter={() => setSel(i)}
              onClick={() => choose(i)}
              className={cx('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left', sel === i && 'bg-soft')}
            >
              <span className="mt-0.5 text-ink-3">{it.kind === 'note' ? <FileText size={15} /> : it.action.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] text-ink">{it.kind === 'note' ? it.hit.title : it.action.label}</span>
                {it.kind === 'note' && it.hit.snippet && (
                  <span
                    className="mt-0.5 block truncate text-[12px] text-ink-3"
                    dangerouslySetInnerHTML={{ __html: it.hit.snippet.replace(/</g, '&lt;').replace(/\[\[/g, '<mark class="bg-accent-tint text-ink rounded px-0.5">').replace(/\]\]/g, '</mark>') }}
                  />
                )}
              </span>
              {it.kind === 'note' && it.hit.date && <span className="mt-0.5 text-[11.5px] text-ink-4">{fmtShortDate(it.hit.date)}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
