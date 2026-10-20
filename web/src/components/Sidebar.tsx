import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Home, Search, MessageCircle, CheckSquare, Users, Building2, LayoutTemplate, Settings, Archive, Plus, Folder as FolderIcon, PenLine, Upload,
} from 'lucide-react';
import { useApp } from '../store';
import { api, fmtClock } from '../api';
import { cx, Modal, Input, Button, toast } from './ui';
import { ImportDialog } from './ImportDialog';

const COLORS: Record<string, string> = { olive: '#788c15', blue: '#3b82c4', purple: '#7a5bc4', clay: '#c26a3d', slate: '#72726e', rose: '#c4517a' };
export const folderColor = (c?: string) => COLORS[c || 'olive'] || COLORS.olive;

function Item({ to, icon, label, end, badge }: { to: string; icon: React.ReactNode; label: string; end?: boolean; badge?: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cx(
        'no-drag flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors',
        isActive ? 'bg-soft-hover text-ink font-medium' : 'text-ink-2 hover:bg-soft',
      )}
    >
      <span className="text-ink-3">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {badge}
    </NavLink>
  );
}

export function Sidebar() {
  const { folders, refreshFolders, newNote, setPaletteOpen, live, state } = useApp();
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [importing, setImporting] = useState(false);
  const isDesktop = !!window.acta?.isDesktop;

  const createFolder = async () => {
    if (!name.trim()) return;
    const { id } = await api.post<{ id: string }>('/api/folders', { name: name.trim() });
    setName('');
    setCreating(false);
    await refreshFolders();
    nav(`/carpeta/${id}`);
  };

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-hairline bg-sunken">
      <div className={cx('drag flex items-center gap-2 px-4', isDesktop ? 'h-12 pl-[84px]' : 'h-14')}>
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary font-display text-[14px] text-primary-ink">A</span>
          <span className="font-display text-[17px] text-ink">Acta</span>
        </div>
      </div>

      <div className="px-3">
        <button
          onClick={() => setPaletteOpen(true)}
          className="no-drag mb-2 flex h-8 w-full items-center gap-2 rounded-lg border border-hairline bg-raised px-2.5 text-[13px] text-ink-4 hover:border-hairline-strong"
        >
          <Search size={14} />
          <span className="flex-1 text-left">Buscar</span>
          <kbd className="rounded border border-hairline px-1 text-[10.5px] text-ink-4">⌘K</kbd>
        </button>
        <button
          onClick={() => void newNote()}
          className="no-drag mb-3 flex h-8 w-full items-center gap-2 rounded-lg bg-primary px-2.5 text-[13px] font-medium text-primary-ink hover:opacity-90"
        >
          <PenLine size={14} />
          <span className="flex-1 text-left">Nueva nota</span>
          <kbd className="text-[10.5px] opacity-60">⌘N</kbd>
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 px-3">
        <Item to="/" end icon={<Home size={16} />} label="Inicio" />
        <Item to="/preguntar" icon={<MessageCircle size={16} />} label="Pregunta a Acta" />
        <Item to="/tareas" icon={<CheckSquare size={16} />} label="Tareas" />
        <Item to="/personas" icon={<Users size={16} />} label="Personas" />
        <Item to="/empresas" icon={<Building2 size={16} />} label="Empresas" />
      </nav>

      <div className="mt-5 flex items-center justify-between px-5">
        <span className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-4">Carpetas</span>
        <button title="Nueva carpeta" onClick={() => setCreating(true)} className="no-drag rounded p-0.5 text-ink-4 hover:bg-soft hover:text-ink">
          <Plus size={14} />
        </button>
      </div>
      <div className="mt-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3">
        {folders.map((f) => (
          <Item
            key={f.id}
            to={`/carpeta/${f.id}`}
            icon={<FolderIcon size={15} style={{ color: folderColor(f.color) }} fill={folderColor(f.color)} fillOpacity={0.18} />}
            label={f.name}
            badge={<span className="text-[11px] text-ink-4">{f.count || ''}</span>}
          />
        ))}
        {!folders.length && (
          <button onClick={() => setCreating(true)} className="no-drag rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ink-4 hover:bg-soft">
            Crea carpetas para clientes, proyectos o equipos.
          </button>
        )}
      </div>

      {live && (
        <button
          onClick={() => nav(`/nota/${live.meetingId}`)}
          className="no-drag mx-3 mb-2 flex items-center gap-2 rounded-lg border border-accent-tint bg-accent-wash px-2.5 py-2 text-left text-[12.5px] text-accent-ink"
        >
          <span className={cx('h-2 w-2 rounded-full bg-accent', live.status === 'recording' && 'pulse-dot')} />
          <span className="flex-1">{live.status === 'recording' ? 'Transcribiendo' : 'En pausa'}</span>
          <span className="tabular-nums">{fmtClock(live.elapsedMs)}</span>
        </button>
      )}

      <div className="flex flex-col gap-0.5 border-t border-hairline px-3 py-2">
        <button onClick={() => setImporting(true)} className="no-drag flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-ink-2 hover:bg-soft">
          <span className="text-ink-3"><Upload size={16} /></span>Importar audio
        </button>
        <Item to="/plantillas" icon={<LayoutTemplate size={16} />} label="Plantillas y recetas" />
        <Item to="/papelera" icon={<Archive size={16} />} label="Archivadas" />
        <Item to="/ajustes" icon={<Settings size={16} />} label="Ajustes" badge={state && !state.models.some((m) => m.available) ? <span className="h-2 w-2 rounded-full bg-danger" /> : null} />
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Nueva carpeta" width={400}>
        <form className="flex gap-2 p-5" onSubmit={(e) => { e.preventDefault(); void createFolder().catch((err) => toast(err.message, { tone: 'error' })); }}>
          <Input autoFocus placeholder="Ej. Clientes" value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="primary" type="submit">Crear</Button>
        </form>
      </Modal>
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </aside>
  );
}
