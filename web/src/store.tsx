// App-wide state: server state, folders, meetings list, live recording + notifications.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, connectEvents, onEvent, type AppState, type Folder, type MeetingSummary, type CalEvent } from './api';
import { toast } from './components/ui';
import { notify } from './lib/notify';
import { startBrowserCapture, stopBrowserCapture } from './lib/browserCapture';

type Live = { meetingId: string; status: 'recording' | 'paused'; me: number; them: number; elapsedMs: number; speaking: { me: boolean; them: boolean } } | null;

type Ctx = {
  state: AppState | null;
  refreshState: () => Promise<void>;
  folders: Folder[];
  refreshFolders: () => Promise<void>;
  meetings: MeetingSummary[];
  refreshMeetings: () => Promise<void>;
  live: Live;
  startRecording: (meetingId: string) => Promise<void>;
  stopRecording: () => Promise<void>;
  pauseRecording: () => Promise<void>;
  resumeRecording: () => Promise<void>;
  newNote: (opts?: { title?: string; calendarEvent?: CalEvent; folderId?: string; record?: boolean }) => Promise<string>;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
};

const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const [state, setState] = useState<AppState | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [live, setLive] = useState<Live>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const browserCapture = useRef(false);

  const refreshState = useCallback(async () => {
    const s = await api.get<AppState>('/api/state');
    setState(s);
    if (s.recording) {
      setLive((l) => l ?? { meetingId: s.recording!.meetingId, status: s.recording!.paused ? 'paused' : 'recording', me: 0, them: 0, elapsedMs: s.recording!.elapsedMs, speaking: { me: false, them: false } });
    }
  }, []);
  const refreshFolders = useCallback(async () => setFolders(await api.get<Folder[]>('/api/folders')), []);
  const refreshMeetings = useCallback(async () => setMeetings(await api.get<MeetingSummary[]>('/api/meetings')), []);

  useEffect(() => {
    connectEvents();
    void refreshState();
    void refreshFolders();
    void refreshMeetings();
  }, [refreshState, refreshFolders, refreshMeetings]);

  const newNote: Ctx['newNote'] = useCallback(async (opts = {}) => {
    const { id } = await api.post<{ id: string }>('/api/meetings', { title: opts.title, calendarEvent: opts.calendarEvent, folderId: opts.folderId });
    await refreshMeetings();
    nav(`/nota/${id}${opts.record ? '?grabar=1' : ''}`);
    return id;
  }, [nav, refreshMeetings]);

  const startRecording = useCallback(async (meetingId: string) => {
    const s = state || (await api.get<AppState>('/api/state'));
    const useHelper = s.helper.available && s.platform === 'darwin';
    const r = await api.post<{ sources: string[] }>(`/api/meetings/${meetingId}/record`, { action: 'start', sources: useHelper ? ['helper'] : ['browser'] });
    setLive({ meetingId, status: 'recording', me: 0, them: 0, elapsedMs: 0, speaking: { me: false, them: false } });
    if (!r.sources.length) {
      try {
        await startBrowserCapture();
        browserCapture.current = true;
        toast('Grabando con el micrófono del navegador. Para captar también a los demás, usa la app de escritorio.');
      } catch (e: any) {
        toast(`No se pudo acceder al micrófono: ${e.message}`, { tone: 'error' });
      }
    }
  }, [state]);

  const stopRecording = useCallback(async () => {
    if (!live) return;
    if (browserCapture.current) { stopBrowserCapture(); browserCapture.current = false; }
    await api.post(`/api/meetings/${live.meetingId}/record`, { action: 'stop' });
  }, [live]);
  const pauseRecording = useCallback(async () => { if (live) await api.post(`/api/meetings/${live.meetingId}/record`, { action: 'pause' }); }, [live]);
  const resumeRecording = useCallback(async () => { if (live) await api.post(`/api/meetings/${live.meetingId}/record`, { action: 'resume' }); }, [live]);

  useEffect(() => onEvent((e) => {
    switch (e.type) {
      case 'recording.level':
        setLive((l) => (l && l.meetingId === e.meetingId ? { ...l, me: e.me, them: e.them, elapsedMs: e.elapsedMs } : l));
        break;
      case 'recording.activity':
        setLive((l) => (l && l.meetingId === e.meetingId ? { ...l, speaking: { ...l.speaking, [e.channel]: e.speaking } } : l));
        break;
      case 'recording.status':
        if (e.status === 'recording' || e.status === 'paused') {
          setLive((l) => (l && l.meetingId === e.meetingId ? { ...l, status: e.status } : { meetingId: e.meetingId, status: e.status, me: 0, them: 0, elapsedMs: 0, speaking: { me: false, them: false } }));
        }
        break;
      case 'recording.stopped':
        setLive(null);
        if (browserCapture.current) { stopBrowserCapture(); browserCapture.current = false; }
        void refreshMeetings();
        if (e.reason === 'autostop' || e.reason === 'meeting-ended') toast('La reunión ha terminado: he parado la transcripción.');
        break;
      case 'recording.autostop':
        notify('Transcripción detenida', e.reason);
        break;
      case 'recording.error':
        toast(e.message, { tone: 'error' });
        break;
      case 'helper':
        if (e.event === 'error' && e.source === 'system') {
          toast(`Audio del sistema no disponible: ${e.message}. Revisa el permiso de «Grabación de pantalla».`, { tone: 'error' });
        }
        break;
      case 'meeting.detected': {
        const title = e.title && !/^Zoom Meeting$/i.test(e.title) ? e.title : `Reunión de ${e.app}`;
        notify(`¿Tomamos notas?`, `Parece que estás en una llamada de ${e.app}.`, async () => { await newNote({ title, record: true }); });
        toast(<span>Parece que estás en una llamada de <b>{e.app}</b>.</span>, { action: { label: 'Tomar notas', onClick: () => void newNote({ title, record: true }) } });
        break;
      }
      case 'calendar.starting': {
        const ev: CalEvent = e.event;
        notify(ev.title, 'Tu reunión empieza ahora. ¿Abrimos las notas?', async () => { await newNote({ calendarEvent: ev, record: true }); });
        toast(<span><b>{ev.title}</b> empieza ahora.</span>, { action: { label: 'Tomar notas', onClick: () => void newNote({ calendarEvent: ev, record: true }) } });
        break;
      }
      case 'google.connected':
        toast(<span>Google Calendar conectado: <b>{e.email}</b></span>);
        break;
      case 'google.error':
        toast(e.message, { tone: 'error', action: e.activationUrl ? { label: 'Activar la API', onClick: () => void api.post('/api/open-url', { url: e.activationUrl }) } : undefined });
        break;
      case 'meetings.changed':
      case 'import.done':
        void refreshMeetings();
        void refreshFolders();
        break;
    }
  }), [newNote, refreshMeetings, refreshFolders]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(true); }
      if (mod && e.key.toLowerCase() === 'n' && !e.shiftKey) { e.preventDefault(); void newNote(); }
      if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); nav('/preguntar'); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [newNote, nav]);

  return (
    <AppCtx.Provider value={{ state, refreshState, folders, refreshFolders, meetings, refreshMeetings, live, startRecording, stopRecording, pauseRecording, resumeRecording, newNote, paletteOpen, setPaletteOpen }}>
      {children}
    </AppCtx.Provider>
  );
}
