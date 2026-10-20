import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, Video, Sparkles, PenLine, ArrowRight, Mic } from 'lucide-react';
import { api, fmtTime, onEvent, streamText, type CalEvent } from '../api';
import { useApp } from '../store';
import { MeetingList } from '../components/MeetingList';
import { AvatarStack, Button, Empty, Modal, Section, cx, toast } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { GoogleButton } from '../components/Google';

function greeting(name: string) {
  const h = new Date().getHours();
  const g = h < 6 ? 'Buenas noches' : h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
  const who = name.trim();
  return who ? `${g}, ${who}` : g;
}

export function BriefModal({ event, meetingId, onClose }: { event?: CalEvent; meetingId?: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    const ctrl = new AbortController();
    setText('');
    setBusy(true);
    streamText('/api/brief', { event, meetingId }, (c) => setText((t) => t + c), ctrl.signal)
      .catch((e) => { if (e.name !== 'AbortError') setText(`**No se pudo preparar el brief:** ${e.message}`); })
      .finally(() => setBusy(false));
    return () => ctrl.abort();
  }, [event, meetingId]);
  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2"><Sparkles size={15} className="text-accent-ink" />Brief · {event?.title || 'reunión'}</span>} width={620}>
      <div className="p-5">
        {!text && busy && <div className="space-y-2">{[80, 95, 60].map((w) => <div key={w} className="shimmer h-3.5 rounded" style={{ width: `${w}%` }} />)}</div>}
        <Markdown text={text} />
      </div>
    </Modal>
  );
}

function ComingUp() {
  const { newNote, state } = useApp();
  const nav = useNavigate();
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [briefFor, setBriefFor] = useState<CalEvent | null>(null);
  const [hasCalendars, setHasCalendars] = useState(true);
  const [googleOn, setGoogleOn] = useState(false);

  const [, setTick] = useState(0);
  useEffect(() => {
    const checkCalendars = () => Promise.all([api.get<any>('/api/settings'), api.get<any>('/api/google/accounts')])
      .then(([s, g]) => {
        setGoogleOn(!!g.configured);
        setHasCalendars(s.calendars.some((c: any) => c.enabled) || s.macCalendarEnabled || g.accounts.length > 0);
      });
    void checkCalendars();
    const load = () => api.get<{ events: CalEvent[]; errors: Record<string, string> }>('/api/calendar/upcoming?days=2')
      .then((r) => { setEvents(r.events.filter((e) => e.end > Date.now()).slice(0, 6)); setErrors(r.errors); })
      .catch(() => setEvents((e) => e ?? []));
    void load();
    const refetch = setInterval(load, 120_000);
    const tick = setInterval(() => setTick((t) => t + 1), 30_000);
    const off = onEvent((e) => {
      if (e.type === 'meetings.changed') void load();
      if (e.type === 'google.connected') { void checkCalendars(); setEvents(null); void load(); }
    });
    return () => { clearInterval(refetch); clearInterval(tick); off(); };
  }, []);

  if (!hasCalendars) {
    return (
      <div className="mb-10 flex items-center gap-4 rounded-2xl border border-hairline bg-raised p-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-wash text-accent-ink"><CalendarDays size={18} /></span>
        <div className="flex-1">
          <div className="text-[14px] font-medium text-ink">Conecta tu calendario</div>
          <div className="text-[12.5px] text-ink-3">Verás tus próximas reuniones aquí y Acta te avisará cuando empiecen, con los asistentes ya puestos.</div>
          <button onClick={() => nav('/ajustes#calendario')} className="mt-1 text-[12px] text-ink-4 underline-offset-2 hover:text-ink hover:underline">Outlook u otros calendarios</button>
        </div>
        {googleOn ? <GoogleButton variant="primary" /> : (
          <Button variant="primary" onClick={() => nav('/ajustes#calendario')}>Añadir calendario</Button>
        )}
      </div>
    );
  }

  return (
    <Section title="Próximas">
      {Object.keys(errors).length > 0 && (
        <div className="mb-2 rounded-lg bg-soft px-3 py-2 text-[12.5px] text-ink-3">Algún calendario no carga: {Object.values(errors)[0]}</div>
      )}
      {events === null ? (
        <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="shimmer h-14 rounded-xl" />)}</div>
      ) : !events.length ? (
        <div className="rounded-xl border border-dashed border-hairline-strong px-4 py-5 text-center text-[13px] text-ink-4">Nada más en el calendario hoy ni mañana.</div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-hairline bg-raised">
          {events.map((ev, i) => {
            const now = Date.now();
            const happening = ev.start <= now && ev.end > now;
            const soon = !happening && ev.start - now < 15 * 60_000;
            const day = new Date(ev.start).toDateString() === new Date().toDateString() ? '' : 'Mañana · ';
            return (
              <div key={ev.id} className={cx('group flex items-center gap-3 px-4 py-3', i > 0 && 'border-t border-hairline')}>
                <div className="w-[74px] shrink-0">
                  <div className={cx('text-[13px] tabular-nums', happening ? 'font-medium text-accent-ink' : 'text-ink')}>{day}{fmtTime(ev.start)}</div>
                  <div className="text-[11.5px] text-ink-4">{happening ? 'Ahora' : soon ? `En ${Math.max(1, Math.round((ev.start - now) / 60000))} min` : fmtTime(ev.end)}</div>
                </div>
                <div className={cx('h-8 w-[3px] rounded-full', happening ? 'bg-accent' : 'bg-hairline-strong')} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] text-ink">{ev.title}</div>
                  <div className="truncate text-[12px] text-ink-4">{ev.calendar}{ev.attendees.length ? ` · ${ev.attendees.length} asistentes` : ''}</div>
                </div>
                <AvatarStack names={ev.attendees.filter((a) => !a.self).map((a) => a.name || a.email || '')} />
                <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                  <Button size="sm" variant="ghost" onClick={() => setBriefFor(ev)} title="Prepárame para esta reunión"><Sparkles size={13} />Brief</Button>
                  {ev.meetingUrl && (
                    <Button size="sm" variant="ghost" onClick={() => window.open(ev.meetingUrl, '_blank')}><Video size={13} />Unirse</Button>
                  )}
                  {ev.meetingId ? (
                    <Button size="sm" variant="outline" onClick={() => nav(`/nota/${ev.meetingId}`)}>Abrir notas</Button>
                  ) : (
                    <Button size="sm" variant={happening || soon ? 'primary' : 'outline'} onClick={() => void newNote({ calendarEvent: ev, record: happening || soon }).catch((e) => toast(e.message, { tone: 'error' }))}>
                      {happening || soon ? <><Mic size={13} />Tomar notas</> : <><PenLine size={13} />Preparar notas</>}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {briefFor && <BriefModal event={briefFor} onClose={() => setBriefFor(null)} />}
      {!state?.helper.available && state?.platform === 'darwin' && (
        <div className="mt-3 text-[12px] text-ink-4">
          {state.packaged
            ? 'Esta copia no incluye el capturador de audio del Mac. Pide una instalación hecha en un Mac.'
            : <>El capturador nativo no está compilado: ejecuta <code>npm run build:native</code> para captar también el audio de los demás.</>}
        </div>
      )}
    </Section>
  );
}

export function Home() {
  const { meetings, state, newNote } = useApp();
  const missingAi = !!state && !state.models.some((m) => m.available);
  const missingStt = !!state && !state.stt.options.some((o) => o.available);
  const today = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase());
  return (
    <div className="mx-auto max-w-[820px] px-8 pb-24 pt-10">
      <div className="mb-8">
        <div className="text-[13px] text-ink-4">{today}</div>
        <h1 className="font-display text-[32px] leading-tight text-ink">{greeting(state?.userName || '')}</h1>
      </div>
      {(missingAi || missingStt) && (
        <div className="mb-8 rounded-2xl border border-hairline bg-raised px-5 py-4">
          <div className="font-display text-[22px] leading-tight text-ink">Añade tu clave para empezar</div>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">
            Acta vive en tu Mac y no trae claves de fábrica. Pega la de tu cuenta de Groq, OpenAI, Deepgram o Anthropic.
            Se guarda solo en este ordenador.
          </p>
          <ul className="mt-3 space-y-1 text-[13px] text-ink-3">
            <li>Transcripción: Groq, OpenAI o Deepgram. {missingStt ? 'Todavía no hay ninguna.' : 'Lista.'}</li>
            <li>Notas y chat: Groq, OpenAI o Anthropic. {missingAi ? 'Todavía no hay ninguna.' : 'Lista.'}</li>
            <li>La primera vez, macOS pedirá el micrófono y la grabación de pantalla (solo para oír la llamada, no para verte). El calendario es opcional.</li>
          </ul>
          <Link to="/ajustes#claves" className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-ink">Ir a Ajustes <ArrowRight size={14} /></Link>
        </div>
      )}
      <ComingUp />
      <Section title="Notas">
        <MeetingList
          meetings={meetings}
          empty={
            <Empty icon={<PenLine size={22} />} title="Tu primera nota">
              Abre una nota cuando empiece una llamada. Escribe lo que te importe; Acta escucha, transcribe y al terminar convierte tus apuntes en notas completas.
              <div className="mt-4"><Button variant="primary" onClick={() => void newNote({ record: true })}><Mic size={14} />Empezar ahora</Button></div>
            </Empty>
          }
        />
      </Section>
    </div>
  );
}
