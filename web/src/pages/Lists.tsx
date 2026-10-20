// Folder, Tasks, People, Companies, Archived and the global "Ask Acta" page.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Folder as FolderIcon, MessageCircle, MoreHorizontal, Pencil, Trash2, Upload, Check, Users, Building2, Archive, RotateCcw, CheckSquare } from 'lucide-react';
import { api, fmtShortDate, type MeetingSummary, type ActionItem, type Person } from '../api';
import { useApp } from '../store';
import { MeetingList } from '../components/MeetingList';
import { ChatPanel } from '../components/ChatPanel';
import { Avatar, Button, Empty, Input, Menu, Modal, PageHeader, Section, Textarea, cx, toast } from '../components/ui';
import { folderColor } from '../components/Sidebar';
import { ImportDialog } from '../components/ImportDialog';

const COLORS = ['olive', 'blue', 'purple', 'clay', 'rose', 'slate'];

export function FolderPage() {
  const { id = '' } = useParams();
  const { folders, refreshFolders, newNote } = useApp();
  const nav = useNavigate();
  const folder = folders.find((f) => f.id === id);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [tab, setTab] = useState<'notes' | 'chat'>('notes');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', color: 'olive' });
  const [importing, setImporting] = useState(false);

  useEffect(() => { api.get<MeetingSummary[]>(`/api/meetings?folder=${id}`).then(setMeetings); }, [id, folders]);
  useEffect(() => { if (folder) setForm({ name: folder.name, description: folder.description, color: folder.color }); }, [folder]);
  if (!folder) return null;

  const save = async () => { await api.put(`/api/folders/${id}`, form); await refreshFolders(); setEditing(false); };
  const remove = async () => {
    if (!confirm(`¿Eliminar la carpeta «${folder.name}»? Las notas no se borran: quedan sin carpeta.`)) return;
    await api.del(`/api/folders/${id}`);
    await refreshFolders();
    nav('/');
  };

  return (
    <div className="mx-auto flex h-full max-w-[820px] flex-col px-8 pt-10">
      <PageHeader
        title={<span className="flex items-center gap-3"><FolderIcon size={24} style={{ color: folderColor(folder.color) }} fill={folderColor(folder.color)} fillOpacity={0.18} />{folder.name}</span>}
        subtitle={folder.description || `${meetings.length} notas`}
        actions={<>
          <Button variant="primary" onClick={() => void newNote({ folderId: id })}>Nueva nota</Button>
          <Menu align="right" trigger={(o) => <Button variant="ghost" onClick={o}><MoreHorizontal size={16} /></Button>} items={[
            { label: 'Editar carpeta', icon: <Pencil size={14} />, onClick: () => setEditing(true) },
            { label: 'Importar audio aquí', icon: <Upload size={14} />, onClick: () => setImporting(true) },
            'sep',
            { label: 'Eliminar carpeta', icon: <Trash2 size={14} />, danger: true, onClick: () => void remove() },
          ]} />
        </>}
      />
      <div className="mb-5 inline-flex self-start rounded-lg bg-soft p-0.5 text-[12.5px]">
        <button onClick={() => setTab('notes')} className={cx('rounded-md px-3 py-1', tab === 'notes' ? 'bg-raised text-ink shadow-card' : 'text-ink-3')}>Notas</button>
        <button onClick={() => setTab('chat')} className={cx('flex items-center gap-1.5 rounded-md px-3 py-1', tab === 'chat' ? 'bg-raised text-ink shadow-card' : 'text-ink-3')}><MessageCircle size={12} />Chat con la carpeta</button>
      </div>
      {tab === 'notes' ? (
        <div className="pb-24"><MeetingList meetings={meetings} empty={<Empty icon={<FolderIcon size={22} />} title="Carpeta vacía">Mueve notas aquí desde su cabecera, o crea una nueva.</Empty>} /></div>
      ) : (
        <div className="min-h-0 flex-1 pb-6">
          <ChatPanel scope="folder" scopeId={id} variant="page" suggestions={['¿Qué temas se repiten en estas reuniones?', '¿Qué compromisos siguen abiertos?']} />
        </div>
      )}
      <Modal open={editing} onClose={() => setEditing(false)} title="Editar carpeta" width={440}>
        <div className="space-y-3 p-5">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre" />
          <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descripción (opcional)" />
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button key={c} onClick={() => setForm({ ...form, color: c })} className={cx('h-6 w-6 rounded-full ring-offset-2 ring-offset-elevated', form.color === c && 'ring-2 ring-ink')} style={{ background: folderColor(c) }} />
            ))}
          </div>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button><Button variant="primary" onClick={() => void save()}>Guardar</Button></div>
        </div>
      </Modal>
      <ImportDialog open={importing} onClose={() => setImporting(false)} folderId={id} />
    </div>
  );
}

export function TasksPage() {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [status, setStatus] = useState<'open' | 'done'>('open');
  const [mineOnly, setMineOnly] = useState(false);
  const { state } = useApp();
  const load = () => api.get<ActionItem[]>(`/api/action-items?status=${status}`).then(setItems);
  useEffect(() => { void load(); }, [status]);
  const me = (state?.userName || '').toLowerCase();
  const shown = mineOnly ? items.filter((i) => !i.owner || i.owner.toLowerCase() === 'yo' || (me && i.owner.toLowerCase().includes(me))) : items;
  const groups = shown.reduce<Record<string, ActionItem[]>>((acc, it) => { (acc[it.meeting_id] ||= []).push(it); return acc; }, {});
  const toggle = async (it: ActionItem) => { await api.patch(`/api/action-items/${it.id}`, { done: !it.done }); void load(); };
  return (
    <div className="mx-auto max-w-[820px] px-8 pb-24 pt-10">
      <PageHeader title="Tareas" subtitle="Todo lo que salió de tus reuniones, en un solo sitio." actions={
        <div className="flex items-center gap-2">
          <button onClick={() => setMineOnly((v) => !v)} className={cx('h-8 rounded-lg px-3 text-[12.5px]', mineOnly ? 'bg-accent-wash text-accent-ink' : 'text-ink-3 hover:bg-soft')}>Solo las mías</button>
          <div className="inline-flex rounded-lg bg-soft p-0.5 text-[12.5px]">
            <button onClick={() => setStatus('open')} className={cx('rounded-md px-3 py-1', status === 'open' ? 'bg-raised text-ink shadow-card' : 'text-ink-3')}>Pendientes</button>
            <button onClick={() => setStatus('done')} className={cx('rounded-md px-3 py-1', status === 'done' ? 'bg-raised text-ink shadow-card' : 'text-ink-3')}>Hechas</button>
          </div>
        </div>
      } />
      {!shown.length && <Empty icon={<CheckSquare size={22} />} title={status === 'open' ? 'Nada pendiente' : 'Aún no has cerrado tareas'}>Las tareas aparecen solas cuando Acta mejora las notas de una reunión.</Empty>}
      <div className="space-y-6">
        {Object.entries(groups).map(([mid, list]) => (
          <div key={mid}>
            <Link to={`/nota/${mid}`} className="mb-1 flex items-baseline gap-2 px-2 text-[12.5px] text-ink-4 hover:text-ink">
              <span className="font-medium text-ink-3">{list[0].meeting_title || 'Sin título'}</span>{list[0].meeting_date && <span>{fmtShortDate(list[0].meeting_date)}</span>}
            </Link>
            {list.map((it) => (
              <div key={it.id} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-soft">
                <button onClick={() => void toggle(it)} className={cx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border', it.done ? 'border-accent bg-accent text-on-accent' : 'border-hairline-strong')}>
                  {!!it.done && <Check size={11} strokeWidth={3} />}
                </button>
                <span className={cx('flex-1 text-[13.5px]', it.done ? 'text-ink-4 line-through' : 'text-ink')}>{it.text}</span>
                <span className="text-[12px] text-ink-4">{[it.owner, it.due].filter(Boolean).join(' · ')}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [q, setQ] = useState('');
  const nav = useNavigate();
  useEffect(() => { api.get<Person[]>('/api/people').then(setPeople); }, []);
  const shown = people.filter((p) => !q || `${p.name} ${p.email} ${p.company}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="mx-auto max-w-[820px] px-8 pb-24 pt-10">
      <PageHeader title="Personas" subtitle="Se crean solas a partir de los asistentes de tus reuniones." actions={<Input className="w-56" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />} />
      {!shown.length && <Empty icon={<Users size={22} />} title="Todavía no hay personas">Conecta el calendario o añade asistentes a una nota.</Empty>}
      <div className="overflow-hidden rounded-2xl border border-hairline bg-raised">
        {shown.map((p, i) => (
          <button key={p.id} onClick={() => nav(`/personas/${p.id}`)} className={cx('flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-soft', i > 0 && 'border-t border-hairline')}>
            <Avatar name={p.name} size={28} />
            <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] text-ink">{p.name}</span><span className="block truncate text-[12px] text-ink-4">{[p.email, p.company].filter(Boolean).join(' · ')}</span></span>
            <span className="text-[12px] text-ink-4">{p.meetings || 0} reuniones{p.last_met ? ` · ${fmtShortDate(p.last_met)}` : ''}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function PersonPage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<{ person: Person; meetings: MeetingSummary[] } | null>(null);
  const [notes, setNotes] = useState('');
  useEffect(() => { api.get<any>(`/api/people/${id}`).then((d) => { setData(d); setNotes(d.person?.notes || ''); }); }, [id]);
  if (!data?.person) return null;
  const p = data.person;
  return (
    <div className="mx-auto grid max-w-[1100px] grid-cols-1 gap-8 px-8 pb-10 pt-10 lg:grid-cols-[1fr_380px]">
      <div>
        <div className="mb-6 flex items-center gap-4">
          <Avatar name={p.name} size={48} />
          <div>
            <h1 className="font-display text-[28px] leading-tight text-ink">{p.name}</h1>
            <div className="text-[13px] text-ink-3">{[p.email, p.company].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        <Section title="Notas sobre esta persona">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => void api.patch(`/api/people/${id}`, { notes })} placeholder="Contexto, preferencias, cómo la conociste…" />
        </Section>
        <Section title={`Reuniones (${data.meetings.length})`}><MeetingList meetings={data.meetings} /></Section>
      </div>
      <div className="h-[calc(100vh-120px)] rounded-2xl border border-hairline bg-raised lg:sticky lg:top-6">
        <ChatPanel scope="person" scopeId={id} title={`Chat sobre ${p.name}`} suggestions={[`¿Qué tengo pendiente con ${p.name.split(' ')[0]}?`, '¿Qué le preocupa?']} />
      </div>
    </div>
  );
}

export function CompaniesPage() {
  const [items, setItems] = useState<any[]>([]);
  const nav = useNavigate();
  useEffect(() => { api.get<any[]>('/api/companies').then(setItems); }, []);
  return (
    <div className="mx-auto max-w-[820px] px-8 pb-24 pt-10">
      <PageHeader title="Empresas" subtitle="Agrupadas por el dominio del email de los asistentes." />
      {!items.length && <Empty icon={<Building2 size={22} />} title="Todavía no hay empresas">Aparecen en cuanto te reúnes con alguien que usa el email de su empresa.</Empty>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((c) => (
          <button key={c.id} onClick={() => nav(`/empresas/${c.id}`)} className="flex items-center gap-3 rounded-2xl border border-hairline bg-raised p-4 text-left hover:border-hairline-strong">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sunken font-display text-[17px] text-ink">{c.name[0]}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-[14px] text-ink">{c.name}</span><span className="block text-[12px] text-ink-4">{c.domain} · {c.people} personas · {c.meetings} reuniones</span></span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function CompanyPage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<any>(null);
  const nav = useNavigate();
  useEffect(() => { api.get<any>(`/api/companies/${id}`).then(setData); }, [id]);
  if (!data?.company) return null;
  return (
    <div className="mx-auto grid max-w-[1100px] grid-cols-1 gap-8 px-8 pb-10 pt-10 lg:grid-cols-[1fr_380px]">
      <div>
        <PageHeader title={data.company.name} subtitle={data.company.domain} />
        <Section title="Personas">
          <div className="flex flex-wrap gap-2">
            {data.people.map((p: Person) => (
              <button key={p.id} onClick={() => nav(`/personas/${p.id}`)} className="flex items-center gap-2 rounded-full border border-hairline py-1 pl-1 pr-3 text-[13px] hover:bg-soft"><Avatar name={p.name} size={22} />{p.name}</button>
            ))}
          </div>
        </Section>
        <Section title="Reuniones"><MeetingList meetings={data.meetings} /></Section>
      </div>
      <div className="h-[calc(100vh-120px)] rounded-2xl border border-hairline bg-raised lg:sticky lg:top-6">
        <ChatPanel scope="company" scopeId={id} title={`Chat sobre ${data.company.name}`} suggestions={['¿En qué punto está la relación?', '¿Qué les hemos prometido?']} />
      </div>
    </div>
  );
}

export function AskPage() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  return (
    <div className="mx-auto flex h-full max-w-[760px] flex-col px-8 pb-6 pt-10">
      <PageHeader title="Pregunta a Acta" subtitle="Pregunta sobre todas tus reuniones. Acta busca en notas y transcripciones y cita de dónde sale cada cosa." />
      <div className="min-h-0 flex-1">
        <ChatPanel
          scope="global"
          variant="page"
          initial={q ? { message: q, nonce: 1 } : undefined}
          suggestions={['¿Qué decidimos esta semana?', '¿Qué clientes me pidieron propuesta?', '¿Qué me comprometí a enviar?']}
        />
      </div>
    </div>
  );
}

export function ArchivedPage() {
  const [items, setItems] = useState<MeetingSummary[]>([]);
  const { refreshMeetings } = useApp();
  const load = () => api.get<MeetingSummary[]>('/api/meetings?archived=1').then(setItems);
  useEffect(() => { void load(); }, []);
  return (
    <div className="mx-auto max-w-[820px] px-8 pb-24 pt-10">
      <PageHeader title="Archivadas" subtitle="Acta nunca borra notas: las archivadas se quedan aquí y puedes recuperarlas cuando quieras." />
      {!items.length && <Empty icon={<Archive size={22} />} title="No hay notas archivadas" />}
      {items.map((m) => (
        <div key={m.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-soft">
          <span className="flex-1 truncate text-[14px] text-ink">{m.title || 'Sin título'}</span>
          <span className="text-[12px] text-ink-4">{fmtShortDate(m.created_at)}</span>
          <Button size="sm" variant="outline" onClick={async () => { await api.post(`/api/meetings/${m.id}/restore`); await load(); await refreshMeetings(); toast('Nota recuperada'); }}><RotateCcw size={13} />Recuperar</Button>
        </div>
      ))}
    </div>
  );
}
