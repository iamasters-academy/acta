import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { useApp } from '../store';
import { Modal, Button, Input, toast } from './ui';

export function ImportDialog({ open, onClose, folderId }: { open: boolean; onClose: () => void; folderId?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const { refreshMeetings } = useApp();

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-filename': encodeURIComponent(file.name),
          'x-title': encodeURIComponent(title || file.name.replace(/\.[^.]+$/, '')),
          ...(folderId ? { 'x-folder': folderId } : {}),
        },
        body: file,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      toast('Transcribiendo el audio. Te aviso cuando esté.');
      await refreshMeetings();
      onClose();
      setFile(null);
      setTitle('');
      nav(`/nota/${j.id}`);
    } catch (e: any) {
      toast(e.message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Importar una grabación" width={480}>
      <div className="space-y-3 p-5">
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
          onClick={() => input.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-8 text-center ${drag ? 'border-accent-ink bg-accent-wash' : 'border-hairline-strong hover:bg-soft'}`}
        >
          <Upload size={20} className="mb-2 text-ink-3" />
          <div className="text-[13px] text-ink">{file ? file.name : 'Arrastra un audio o vídeo, o haz clic para elegirlo'}</div>
          <div className="mt-1 text-[12px] text-ink-4">{file ? `${(file.size / 1e6).toFixed(1)} MB` : 'MP3, M4A, WAV, MP4, MOV… (Loom, Zoom, notas de voz)'}</div>
          <input ref={input} type="file" accept="audio/*,video/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>
        <Input placeholder="Título (opcional)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!file || busy} onClick={upload}>{busy ? 'Subiendo…' : 'Transcribir'}</Button>
        </div>
      </div>
    </Modal>
  );
}
