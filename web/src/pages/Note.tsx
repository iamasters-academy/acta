import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  CalendarDays, Users, Folder as FolderIcon, LayoutTemplate, Sparkles, MoreHorizontal, Share, AudioLines, MessageCircle, Mic, Pause, Play, Square,
  ChevronDown, Archive, FileDown, Copy, Mail, Webhook, Slack, BookOpen, Check, Plus, Trash2, RefreshCw, ExternalLink, ListChecks, ArrowUp,
} from 'lucide-react';
import { api, fmtClock, fmtDay, fmtTime, fmtDuration, onEvent, streamText, type Meeting, type Template, type Attendee, type Segment } from '../api';
import { useApp } from '../store';
import { NotesEditor, EnhancedEditor } from '../components/Editors';
import { TranscriptPanel } from '../components/TranscriptPanel';
import { ChatPanel, useRecipes } from '../components/ChatPanel';
import { Markdown } from '../components/Markdown';
import { Button, Chip, IconButton, Input, Menu, Modal, cx, toast, type MenuItem } from '../components/ui';
import { folderColor } from '../components/Sidebar';
import { BriefModal } from './Home';

function Waveform({ level, active }: { level: number; active: boolean }) {
  const bars = [0.55, 0.9, 1, 0.75, 0.5];
  return (
    <span className="flex h-4 items-center gap-[2px]">
      {bars.map((b, i) => (
        <span
          key={i}
          className={cx('w-[3px] rounded-full transition-[height] duration-100', active ? 'bg-accent' : 'bg-ink-4')}
          style={{ height: `${Math.max(3, Math.min(16, 3 + level * 14 * b + (active ? Math.sin(Date.now() / 120 + i) * 1.5 : 0)))}px` }}
        />
      ))}
    </span>
  );
}

function AttendeesModal({ open, onClose, attendees, onSave }: { open: boolean; onClose: () => void; attendees: Attendee[]; onSave: (a: Attendee[]) => void }) {
  const [list, setList] = useState<Attendee[]>(attendees);
  const [val, setVal] = useState('');
  useEffect(() => { if (open) setList(attendees); }, [open, attendees]);
  const add = () => {
    const v = val.trim();
    if (!v) return;
    const m = v.match(/^(.*?)\s*<([^>]+)>$/) || v.match(/^()([^\s@]+@[^\s@]+)$/);
    setList((l) => [...l, m ? { name: m[1] || m[2].split('@')[0], email: m[2].toLowerCase() } : { name: v }]);
    setVal('');
  };
  return (
    <Modal open={open} onClose={onClose} title="Asistentes" width={440}>
      <div className="p-5">
        <div className="mb-3 space-y-1">
          {list.map((a, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-soft">
              <div className="min-w-0 flex-1"><div className="truncate text-[13px] text-ink">{a.name}</div>{a.email && <div className="truncate text-[11.5px] text-ink-4">{a.email}</div>}</div>
              <IconButton title="Quitar" onClick={() => setList((l) => l.filter((_, j) => j !== i))}><Trash2 size={13} /></IconButton>
            </div>
          ))}
          {!list.length && <div className="text-[12.5px] text-ink-4">Sin asistentes todavía.</div>}
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Nombre, email o «Nombre <email>»" />
          <Button type="submit" variant="soft"><Plus size={14} /></Button>
        </form>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => { onSave(list); onClose(); }}>Guardar</Button>
        </div>
      </div>
    </Modal>
  );
}

function ActionItems({ meeting, reload }: { meeting: Meeting; reload: () => void }) {
  const [text, setText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const items = meeting.actionItems;
  const toggle = async (id: string, done: boolean) => { await api.patch(`/api/action-items/${id}`, { done }); reload(); };
  const remove = async (id: string) => { await api.del(`/api/action-items/${id}`); reload(); };
  const add = async () => { if (!text.trim()) return; await api.post(`/api/meetings/${meeting.id}/action-items`, { text: text.trim(), owner: 'Yo' }); setText(''); reload(); };
  const extract = async () => {
    setExtracting(true);
    try { await api.post(`/api/meetings/${meeting.id}/action-items/extract`); reload(); }
    catch (e: any) { toast(e.message, { tone: 'error' }); }
    finally { setExtracting(false); }
  };
  return (
    <div className="mt-10 rounded-2xl border border-hairline bg-raised p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13.5px] font-medium text-ink"><ListChecks size={15} className="text-accent-ink" />Tareas</div>
        <Button size="sm" variant="ghost" onClick={extract} disabled={extracting}><RefreshCw size={12} className={extracting ? 'animate-spin' : ''} />{items.length ? 'Volver a extraer' : 'Extraer tareas'}</Button>
      </div>
      <div className="space-y-0.5">
        {items.map((a) => (
          <div key={a.id} className="group flex items-start gap-2.5 rounded-lg px-1.5 py-1 hover:bg-soft">
            <button onClick={() => void toggle(a.id, !a.done)} className={cx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border', a.done ? 'border-accent bg-accent text-on-accent' : 'border-hairline-strong')}>
              {!!a.done && <Check size={11} strokeWidth={3} />}
            </button>
            <div className={cx('flex-1 text-[13.5px]', a.done ? 'text-ink-4 line-through' : 'text-ink')}>
              {a.text}
              {(a.owner || a.due) && <span className="ml-2 text-[12px] text-ink-4">{[a.owner, a.due].filter(Boolean).join(' · ')}</span>}
            </div>
            <button onClick={() => void remove(a.id)} className="opacity-0 group-hover:opacity-100 text-ink-4 hover:text-danger" title="Quitar"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
      <form className="mt-2 flex items-center gap-2 px-1.5" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <Plus size={14} className="text-ink-4" />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Añadir tarea" className="h-7 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-4" />
      </form>
    </div>
  );
}

export function Note() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { live, startRecording, stopRecording, pauseRecording, resumeRecording, folders, refreshMeetings, state } = useApp();
  const recipes = useRecipes();
  const [m, setM] = useState<Meeting | null>(null);
  const [title, setTitle] = useState('');
  const [view, setView] = useState<'enhanced' | 'notes'>('notes');
  const [enhancing, setEnhancing] = useState(false);
  const [stream, setStream] = useState('');
  const [panel, setPanel] = useState<'transcript' | 'chat' | null>(null);
  const [chatInitial, setChatInitial] = useState<{ message?: string; recipe?: string; nonce?: number }>();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [attOpen, setAttOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [ask, setAsk] = useState('');
  const [askFocus, setAskFocus] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  const titleTimer = useRef<number | undefined>(undefined);
  const autoStarted = useRef(false);

  const isLive = live?.meetingId === id;
  const otherLive = live && live.meetingId !== id;

  const load = useCallback(async () => {
    const r = await api.get<Meeting>(`/api/meetings/${id}`);
    setM(r);
    return r;
  }, [id]);

  useEffect(() => {
    setM(null);
    setStream('');
    setEnhancing(false);
    setPanel(null);
    load().then((r) => {
      setTitle(r.title);
      setView(r.enhanced_md ? 'enhanced' : 'notes');
    }).catch(() => nav('/'));
    api.get<Template[]>('/api/templates').then(setTemplates);
    api.get<any>('/api/settings').then(setSettings);
  }, [id, load, nav]);

  // Live transcript + background updates for this note.
  useEffect(() => onEvent((e) => {
    if (e.meetingId !== id) return;
    if (e.type === 'transcript.segment') setM((cur) => (cur ? { ...cur, segments: [...cur.segments, e.segment as Segment].sort((a, b) => a.start_ms - b.start_ms) } : cur));
    if (e.type === 'import.done' || e.type === 'recording.stopped' || e.type === 'meeting.updated') void load();
  }), [id, load]);

  const enhance = useCallback(async (templateId?: string) => {
    if (enhancing) return;
    setEnhancing(true);
    setView('enhanced');
    setStream('');
    try {
      await streamText(`/api/meetings/${id}/enhance`, { templateId }, (c) => setStream((s) => s + c));
      await load();
      setTimeout(() => { void load().then((r) => setTitle((t) => t || r.title)); void refreshMeetings(); }, 5000);
      setTimeout(() => { void load().then((r) => setTitle((t) => t || r.title)); void refreshMeetings(); }, 12000);
    } catch (e: any) {
      toast(e.message, { tone: 'error' });
      setView(m?.enhanced_md ? 'enhanced' : 'notes');
    } finally {
      setEnhancing(false);
      setStream('');
    }
  }, [enhancing, id, load, m?.enhanced_md, refreshMeetings]);

  // Auto-start when opened from a "take notes" action; auto-enhance when the call ends.
  useEffect(() => {
    if (params.get('grabar') && m && !autoStarted.current && !isLive) {
      autoStarted.current = true;
      setParams({}, { replace: true });
      void startRecording(id).then(() => setPanel(null)).catch((e) => toast(e.message, { tone: 'error' }));
    }
  }, [params, m, isLive, id, startRecording, setParams]);
  useEffect(() => onEvent((e) => {
    if (e.type === 'recording.stopped' && e.meetingId === id && settings?.autoEnhance !== false) {
      setTimeout(async () => {
        const r = await load();
        if (r.segments.length >= 2 || r.notes_text.trim()) void enhance();
      }, 600);
    }
  }), [id, settings, load, enhance]);

  const saveTitle = (t: string) => {
    setTitle(t);
    clearTimeout(titleTimer.current);
    titleTimer.current = window.setTimeout(() => { void api.patch(`/api/meetings/${id}`, { title: t }).then(() => refreshMeetings()); }, 500);
  };

  const patch = async (body: any) => { await api.patch(`/api/meetings/${id}`, body); await load(); await refreshMeetings(); };

  const exportFile = async (format: 'md' | 'html', transcript = false) => {
    const r = await api.post<{ file: string }>(`/api/meetings/${id}/export-file`, { format, transcript, open: format === 'html', reveal: format === 'md' });
    toast(<span>Guardado en <code className="text-[11.5px]">{r.file.split('/').slice(-2).join('/')}</code></span>);
  };
  const copyNotes = async (rich: boolean) => {
    const md = await (await fetch(`/api/meetings/${id}/export?format=md`)).text();
    if (rich) {
      const html = await (await fetch(`/api/meetings/${id}/export?format=html`)).text();
      const body = html.match(/<main>([\s\S]*)<\/main>/)?.[1] || html;
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([body], { type: 'text/html' }), 'text/plain': new Blob([md], { type: 'text/plain' }) })]);
    } else await navigator.clipboard.writeText(md);
    toast('Notas copiadas');
  };
  const send = async (target: 'webhook' | 'slack' | 'notion') => {
    try { await api.post(`/api/meetings/${id}/send`, { target }); toast(`Enviado a ${target === 'webhook' ? 'tu webhook' : target === 'slack' ? 'Slack' : 'Notion'}`); }
    catch (e: any) { toast(e.message, { tone: 'error', action: { label: 'Configurar', onClick: () => nav('/ajustes#integraciones') } }); }
  };
  const followUpEmail = () => { setPanel('chat'); setChatInitial({ recipe: 'email-seguimiento', nonce: Date.now() }); };
  const openMail = () => {
    const to = (m?.attendees || []).filter((a) => a.email && !a.self).map((a) => a.email).join(',');
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(`Seguimiento: ${m?.title || ''}`)}`;
  };

  const tpl = templates.find((t) => t.id === m?.template_id) || templates.find((t) => t.id === 'tpl_general');
  const date = m ? (m.calendar_start || m.started_at || m.created_at) : 0;
  const names = useMemo(() => (m?.attendees || []).filter((a) => !a.self).map((a) => a.name || a.email || ''), [m?.attendees]);
  const hasContent = !!m && (m.segments.length > 0 || m.notes_text.trim().length > 0);

  if (!m) return <div className="mx-auto max-w-[720px] px-8 pt-24"><div className="shimmer h-9 w-2/3 rounded-lg" /><div className="shimmer mt-4 h-4 w-1/3 rounded" /></div>;

  const shareItems: MenuItem[] = [
    { label: 'Copiar notas', icon: <Copy size={14} />, onClick: () => void copyNotes(true), hint: 'Docs, Gmail' },
    { label: 'Copiar como Markdown', icon: <Copy size={14} />, onClick: () => void copyNotes(false) },
    { label: 'Email de seguimiento', icon: <Mail size={14} />, onClick: followUpEmail },
    { label: 'Abrir en Mail', icon: <Mail size={14} />, onClick: openMail },
    'sep',
    { label: 'Exportar página HTML', icon: <FileDown size={14} />, onClick: () => void exportFile('html') },
    { label: 'Exportar Markdown', icon: <FileDown size={14} />, onClick: () => void exportFile('md') },
    { label: 'Exportar con transcripción', icon: <FileDown size={14} />, onClick: () => void exportFile('html', true) },
    'sep',
    { label: 'Enviar a Slack', icon: <Slack size={14} />, onClick: () => void send('slack') },
    { label: 'Enviar a Notion', icon: <BookOpen size={14} />, onClick: () => void send('notion') },
    { label: 'Enviar a webhook / Zapier', icon: <Webhook size={14} />, onClick: () => void send('webhook') },
  ];
  const moreItems: MenuItem[] = [
    { label: 'Prepárame (brief)', icon: <Sparkles size={14} />, onClick: () => setBriefOpen(true) },
    { label: 'Regenerar notas', icon: <RefreshCw size={14} />, onClick: () => void enhance() },
    { label: 'Identificar quién habla', icon: <Users size={14} />, onClick: async () => { toast('Identificando interlocutores…'); try { const r = await api.post<{ changed: number }>(`/api/meetings/${id}/speakers`); await load(); toast(`Listo: ${r.changed} fragmentos reasignados`); } catch (e: any) { toast(e.message, { tone: 'error' }); } } },
    ...(m.audio_path ? [{ label: 'Abrir audio', icon: <ExternalLink size={14} />, onClick: () => void api.post('/api/open-path', { path: m.audio_path }) }] : []),
    'sep',
    { label: 'Archivar nota', icon: <Archive size={14} />, danger: true, onClick: async () => { if (isLive) await stopRecording(); await api.post(`/api/meetings/${id}/archive`); await refreshMeetings(); toast('Nota archivada. La tienes en «Archivadas».'); nav('/'); } },
  ];

  const level = isLive ? Math.max(live!.me, live!.them) : 0;

  return (
    <div className="flex h-full min-h-0">
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* top bar */}
        <div className="drag flex h-12 shrink-0 items-center gap-2 px-5">
          <div className="no-drag flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] text-ink-4">
            <Link to="/" className="hover:text-ink">Inicio</Link>
            {m.folder && <><span>/</span><Link to={`/carpeta/${m.folder.id}`} className="truncate hover:text-ink">{m.folder.name}</Link></>}
          </div>
          <div className="no-drag flex items-center gap-1">
            <Button size="sm" variant={panel === 'transcript' ? 'soft' : 'ghost'} onClick={() => setPanel(panel === 'transcript' ? null : 'transcript')}><AudioLines size={14} />Transcripción</Button>
            <Button size="sm" variant={panel === 'chat' ? 'soft' : 'ghost'} onClick={() => setPanel(panel === 'chat' ? null : 'chat')}><MessageCircle size={14} />Chat</Button>
            <Menu align="right" trigger={(o) => <Button size="sm" variant="ghost" onClick={o}><Share size={14} />Compartir</Button>} items={shareItems} />
            <Menu align="right" trigger={(o) => <IconButton title="Más" onClick={o}><MoreHorizontal size={16} /></IconButton>} items={moreItems} />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[720px] px-8 pb-40 pt-8">
            <input
              value={title}
              onChange={(e) => saveTitle(e.target.value)}
              placeholder="Nueva nota"
              className="w-full bg-transparent font-display text-[32px] leading-tight text-ink outline-none placeholder:text-ink-4"
            />
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Chip><CalendarDays size={13} />{fmtDay(date)} · {fmtTime(date)}{m.duration_ms > 30000 ? ` · ${fmtDuration(m.duration_ms)}` : ''}</Chip>
              <Chip onClick={() => setAttOpen(true)}><Users size={13} />{names.length ? (names.length <= 2 ? names.join(', ') : `${names[0]} y ${names.length - 1} más`) : 'Añadir asistentes'}</Chip>
              <Menu
                trigger={(o) => (
                  <Chip onClick={o}>
                    {m.folder ? <><span className="h-2 w-2 rounded-full" style={{ background: folderColor(m.folder.color) }} />{m.folder.name}</> : <><FolderIcon size={13} />Añadir a carpeta</>}
                  </Chip>
                )}
                items={[
                  ...folders.map((f) => ({ label: f.name, icon: <span className="block h-2 w-2 rounded-full" style={{ background: folderColor(f.color) }} />, onClick: () => void patch({ folder_id: f.id }) })),
                  ...(folders.length ? ['sep' as const] : []),
                  ...(m.folder ? [{ label: 'Quitar de la carpeta', onClick: () => void patch({ folder_id: null }) }] : []),
                  { label: 'Gestionar carpetas…', onClick: () => nav('/') },
                ]}
              />
              <Menu
                trigger={(o) => <Chip onClick={o}><LayoutTemplate size={13} />{tpl?.name || 'Plantilla'}<ChevronDown size={12} /></Chip>}
                items={templates.map((t) => ({
                  label: t.name,
                  hint: t.id === m.template_id ? 'actual' : undefined,
                  onClick: () => { void patch({ template_id: t.id }); if (m.enhanced_md) toast(`Plantilla «${t.name}»`, { action: { label: 'Regenerar con ella', onClick: () => void enhance(t.id) } }); },
                }))}
              />
              {m.people.some((p) => p.company) && <Chip onClick={() => nav(`/empresas/${m.people.find((p) => p.company_id)?.company_id}`)}>{m.people.find((p) => p.company)?.company}</Chip>}
            </div>

            {(m.enhanced_md || enhancing) && (
              <div className="mt-6 inline-flex rounded-lg bg-soft p-0.5 text-[12.5px]">
                <button onClick={() => setView('enhanced')} className={cx('flex items-center gap-1.5 rounded-md px-2.5 py-1', view === 'enhanced' ? 'bg-raised text-ink shadow-card' : 'text-ink-3')}><Sparkles size={12} />Notas mejoradas</button>
                <button onClick={() => setView('notes')} className={cx('rounded-md px-2.5 py-1', view === 'notes' ? 'bg-raised text-ink shadow-card' : 'text-ink-3')}>Mis notas</button>
              </div>
            )}

            <div className="mt-6">
              {view === 'notes' && (
                <NotesEditor
                  key={`notes-${id}`}
                  html={m.notes_html}
                  autoFocus={!m.notes_html && !m.enhanced_md}
                  placeholder={isLive ? 'Escribe lo que te importe. Acta está escuchando y completará el resto.' : 'Escribe tus notas…'}
                  onChange={(html, text) => { void api.patch(`/api/meetings/${id}`, { notes_html: html, notes_text: text }); setM((c) => (c ? { ...c, notes_html: html, notes_text: text } : c)); }}
                />
              )}
              {view === 'enhanced' && enhancing && (
                <div>
                  {!stream && <div className="space-y-3">{[45, 92, 80, 88, 35, 70].map((w, i) => <div key={i} className="shimmer h-3.5 rounded" style={{ width: `${w}%` }} />)}</div>}
                  <Markdown text={stream} ai className="text-[15px]" />
                </div>
              )}
              {view === 'enhanced' && !enhancing && m.enhanced_md && (
                <>
                  <EnhancedEditor key={`enh-${id}-${m.enhanced_at}`} markdown={m.enhanced_md} onChange={(md) => void api.patch(`/api/meetings/${id}`, { enhanced_md: md })} />
                  <ActionItems meeting={m} reload={() => void load()} />
                </>
              )}
            </div>

            {m.status === 'importing' && (
              <div className="mt-8 flex items-center gap-2 rounded-xl bg-soft px-4 py-3 text-[13px] text-ink-3">
                <span className="h-2 w-2 rounded-full bg-accent pulse-dot" />Transcribiendo la grabación… {m.segments.length} fragmentos listos.
              </div>
            )}
          </div>
        </div>

        {/* bottom bar */}
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-6">
          <div className="pointer-events-auto relative flex max-w-full items-center gap-1 rounded-full border border-hairline bg-elevated p-1.5 shadow-pop">
            {isLive ? (
              <Menu
                side="top"
                trigger={(o) => (
                  <button onClick={o} className="flex h-9 items-center gap-2 rounded-full bg-accent-wash px-3 text-accent-ink">
                    <Waveform level={level} active={live!.status === 'recording'} />
                    <span className="text-[12.5px] tabular-nums">{live!.status === 'paused' ? 'En pausa' : fmtClock(live!.elapsedMs)}</span>
                    <ChevronDown size={13} />
                  </button>
                )}
                items={[
                  live!.status === 'recording'
                    ? { label: 'Pausar', icon: <Pause size={14} />, onClick: () => void pauseRecording() }
                    : { label: 'Reanudar', icon: <Play size={14} />, onClick: () => void resumeRecording() },
                  { label: 'Terminar y mejorar notas', icon: <Square size={13} />, onClick: () => void stopRecording() },
                  'sep',
                  { label: 'Ver transcripción', icon: <AudioLines size={14} />, onClick: () => setPanel('transcript') },
                ]}
              />
            ) : otherLive ? (
              <Button variant="ghost" className="rounded-full" onClick={() => nav(`/nota/${live!.meetingId}`)}><span className="h-2 w-2 rounded-full bg-accent pulse-dot" />Grabando otra nota</Button>
            ) : (
              <button
                onClick={() => void startRecording(id).catch((e) => toast(e.message, { tone: 'error' }))}
                className="flex h-9 items-center gap-2 rounded-full px-3 text-[13px] text-ink-2 hover:bg-soft"
                title="Transcribir esta reunión"
              >
                <Mic size={15} className="text-accent-ink" />{m.segments.length ? 'Reanudar' : 'Transcribir'}
              </button>
            )}
            <div className="mx-0.5 h-5 w-px bg-hairline" />
            <div className="relative">
              {askFocus && (
                <div className="absolute bottom-full left-0 mb-3 flex w-[440px] flex-wrap gap-1.5">
                  {recipes.filter((r) => ['email-seguimiento', 'tareas', 'resumen-ejecutivo', 'decisiones', 'objeciones', 'coach'].includes(r.slug)).map((r) => (
                    <button
                      key={r.slug}
                      onMouseDown={(e) => { e.preventDefault(); setPanel('chat'); setChatInitial({ recipe: r.slug, nonce: Date.now() }); setAskFocus(false); }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-elevated px-3 py-1 text-[12.5px] text-ink-2 shadow-card hover:bg-soft"
                    >
                      <Sparkles size={11} className="text-accent-ink" />{r.name}
                    </button>
                  ))}
                </div>
              )}
              <form onSubmit={(e) => { e.preventDefault(); if (!ask.trim()) return; setPanel('chat'); setChatInitial({ message: ask, nonce: Date.now() }); setAsk(''); }} className="flex items-center">
                <input
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                  onFocus={() => setAskFocus(true)}
                  onBlur={() => setTimeout(() => setAskFocus(false), 120)}
                  placeholder="Pregunta lo que quieras"
                  className="h-9 w-[220px] bg-transparent px-2 text-[13px] text-ink outline-none placeholder:text-ink-4 lg:w-[280px]"
                />
                {ask && <button type="submit" className="mr-1 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-ink"><ArrowUp size={14} /></button>}
              </form>
            </div>
            {(hasContent || m.enhanced_md) && !isLive && (
              <Menu
                align="right"
                side="top"
                trigger={(o) => (
                  <div className="flex items-center">
                    <button
                      disabled={enhancing}
                      onClick={() => void enhance()}
                      className="flex h-9 items-center gap-1.5 rounded-l-full bg-accent pl-3.5 pr-2.5 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
                    >
                      <Sparkles size={14} />{enhancing ? 'Mejorando…' : m.enhanced_md ? 'Regenerar' : 'Mejorar notas'}
                    </button>
                    <button onClick={o} disabled={enhancing} className="flex h-9 items-center rounded-r-full border-l border-white/25 bg-accent pl-1.5 pr-2.5 text-on-accent hover:bg-accent-hover" title="Elegir plantilla">
                      <ChevronDown size={14} />
                    </button>
                  </div>
                )}
                items={templates.map((t) => ({ label: t.name, hint: t.id === (m.template_id || 'tpl_general') ? 'actual' : undefined, onClick: () => void enhance(t.id) }))}
              />
            )}
          </div>
        </div>
      </div>

      {panel && (
        <aside className="fade-up h-full w-[400px] shrink-0 border-l border-hairline bg-canvas">
          {panel === 'transcript'
            ? <TranscriptPanel meetingId={id} segments={m.segments} onClose={() => setPanel(null)} />
            : <ChatPanel scope="meeting" scopeId={id} title={`Chat · ${m.title || 'esta reunión'}`} onClose={() => setPanel(null)} initial={chatInitial} />}
        </aside>
      )}
      <AttendeesModal open={attOpen} onClose={() => setAttOpen(false)} attendees={m.attendees} onSave={(a) => void patch({ attendees: a })} />
      {briefOpen && <BriefModal meetingId={id} event={{ title: m.title } as any} onClose={() => setBriefOpen(false)} />}
      {state && !state.models.some((x) => x.available) && hasContent && !m.enhanced_md && (
        <div className="pointer-events-none fixed bottom-24 left-1/2 -translate-x-1/2 text-[12px] text-ink-4">Añade una clave de IA en Ajustes para mejorar las notas.</div>
      )}
    </div>
  );
}
