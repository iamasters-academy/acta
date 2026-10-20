import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Search, X } from 'lucide-react';
import { fmtClock, type Segment } from '../api';
import { useApp } from '../store';
import { IconButton, cx, toast } from './ui';

export function TranscriptPanel({ meetingId, segments, onClose }: { meetingId: string; segments: Segment[]; onClose: () => void }) {
  const { live, state } = useApp();
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const isLive = live?.meetingId === meetingId;
  const me = state?.userName || 'Yo';

  const shown = useMemo(() => (q.trim() ? segments.filter((s) => s.text.toLowerCase().includes(q.toLowerCase())) : segments), [segments, q]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown.length, live?.speaking.me, live?.speaking.them]);

  const label = (sp: string) => (sp === 'me' ? me : sp === 'them' ? 'Ellos' : sp);
  const copy = () => {
    const txt = segments.map((s) => `[${fmtClock(s.start_ms)}] ${label(s.speaker)}: ${s.text}`).join('\n');
    void navigator.clipboard.writeText(txt).then(() => toast('Transcripción copiada'));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center gap-1 border-b border-hairline px-4">
        {searching ? (
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en la transcripción" className="h-8 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-4" />
        ) : (
          <div className="flex flex-1 items-center gap-2 text-[13.5px] font-medium">
            Transcripción
            {isLive && live?.status === 'recording' && <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" />}
          </div>
        )}
        <IconButton title="Buscar" onClick={() => { setSearching((s) => !s); setQ(''); }}><Search size={15} /></IconButton>
        <IconButton title="Copiar todo" onClick={copy} disabled={!segments.length}><Copy size={15} /></IconButton>
        <IconButton title="Cerrar" onClick={onClose}><X size={16} /></IconButton>
      </div>
      <div
        ref={scroller}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}
        className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4"
      >
        {!segments.length && !isLive && <div className="py-10 text-center text-[13px] text-ink-4">Todavía no hay transcripción.</div>}
        {!segments.length && isLive && <div className="py-10 text-center text-[13px] text-ink-4">Escuchando… la transcripción aparecerá aquí en unos segundos.</div>}
        {shown.map((s, i) => {
          const mine = s.speaker === 'me';
          const prev = shown[i - 1];
          const showHead = !prev || prev.speaker !== s.speaker || s.start_ms - prev.end_ms > 60_000;
          return (
            <div key={s.id} className={cx('flex flex-col', mine ? 'items-end' : 'items-start')}>
              {showHead && (
                <div className="mb-0.5 px-1 text-[11px] text-ink-4">{label(s.speaker)} · {fmtClock(s.start_ms)}</div>
              )}
              <div className={cx('max-w-[88%] rounded-2xl px-3 py-1.5 text-[13px] leading-relaxed', mine ? 'rounded-br-md bg-accent-wash text-ink' : 'rounded-bl-md bg-soft text-ink')}>
                {s.text}
              </div>
            </div>
          );
        })}
        {isLive && (live?.speaking.them || live?.speaking.me) && (
          <div className={cx('flex', live?.speaking.me && !live?.speaking.them ? 'justify-end' : 'justify-start')}>
            <div className="flex gap-1 rounded-2xl bg-soft px-3 py-2.5">
              {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-ink-4 pulse-dot" style={{ animationDelay: `${i * 0.2}s` }} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
