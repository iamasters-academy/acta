import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw, LogOut, Plus, FileJson, BookOpen, ExternalLink } from 'lucide-react';
import { api, onEvent } from '../api';
import { Button, Input, Modal, Toggle, cx, toast } from './ui';

export type GoogleCal = { id: string; summary: string; primary: boolean; color: string; enabled: boolean };
export type GoogleAccount = { email: string; name: string; picture: string; calendars: GoogleCal[] };

export function GoogleLogo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Opens Google's sign-in: a popup in the browser, the default browser from the desktop app. */
export async function connectGoogle(loginHint?: string) {
  try {
    const { url } = await api.post<{ url: string }>('/api/google/connect', { loginHint });
    const w = 520;
    const h = 680;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(url, 'acta-google', `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
    if (!popup && !window.acta?.isDesktop) await api.post('/api/open-url', { url });
    toast('Inicia sesión con Google en la ventana que se ha abierto.');
  } catch (e: any) {
    toast(e.message, { tone: 'error' });
  }
}

export function GoogleButton({ label = 'Conectar con Google', variant = 'outline', loginHint }: { label?: string; variant?: 'outline' | 'primary'; loginHint?: string }) {
  return (
    <button
      onClick={() => void connectGoogle(loginHint)}
      className={cx(
        'inline-flex h-9 items-center gap-2.5 rounded-lg px-3.5 text-[13px] font-medium transition-colors',
        variant === 'primary' ? 'bg-primary text-primary-ink hover:opacity-90' : 'border border-hairline-strong bg-raised text-ink hover:bg-soft',
      )}
    >
      <span className={cx('flex h-5 w-5 items-center justify-center rounded-full', variant === 'primary' && 'bg-white')}><GoogleLogo size={14} /></span>
      {label}
    </button>
  );
}

export function useGoogleAccounts() {
  const [data, setData] = useState<{
    configured: boolean;
    client: { source: 'custom' | 'build' | 'env' | ''; clientId: string; redirect: string };
    accounts: GoogleAccount[];
    errors: Record<string, string>;
  } | null>(null);
  const load = useCallback(() => api.get<any>('/api/google/accounts').then(setData).catch(() => {}), []);
  useEffect(() => {
    void load();
    return onEvent((e) => { if (e.type === 'google.connected' || e.type === 'google.error') void load(); });
  }, [load]);
  return { data, reload: load };
}

export function GoogleAccounts() {
  const { data, reload } = useGoogleAccounts();
  const [busy, setBusy] = useState('');
  if (!data) return null;

  const toggle = async (a: GoogleAccount, id: string, on: boolean) => {
    const ids = a.calendars.filter((c) => (c.id === id ? on : c.enabled)).map((c) => c.id);
    await api.put(`/api/google/accounts/${encodeURIComponent(a.email)}/calendars`, { ids });
    void reload();
  };
  const refresh = async (email: string) => {
    setBusy(email);
    const r = await api.post<any>(`/api/google/accounts/${encodeURIComponent(email)}/refresh`);
    setBusy('');
    if (r.error) toast(r.error, { tone: 'error', action: r.activationUrl ? { label: 'Activar la API', onClick: () => void api.post('/api/open-url', { url: r.activationUrl }) } : undefined });
    void reload();
  };
  const disconnect = async (email: string) => {
    if (!confirm(`¿Desconectar ${email}? Acta dejará de ver sus calendarios (tus notas no se tocan).`)) return;
    await api.del(`/api/google/accounts/${encodeURIComponent(email)}`);
    void reload();
  };

  if (!data.configured) return <GoogleClientSetup onSaved={() => void reload()} />;

  return (
    <div className="px-5 py-4">
      {!data.accounts.length ? (
        <div className="flex items-center gap-4">
          <div className="flex-1 text-[12.5px] text-ink-3">Inicia sesión con tu cuenta de Google y elige qué calendarios ver. Sin copiar enlaces ni compartir nada: solo lectura.</div>
          <GoogleButton variant="primary" />
        </div>
      ) : (
        <div className="space-y-4">
          {data.accounts.map((a) => (
            <div key={a.email} className="rounded-xl border border-hairline">
              <div className="flex items-center gap-3 border-b border-hairline px-3.5 py-2.5">
                {a.picture ? <img src={a.picture} alt="" referrerPolicy="no-referrer" className="h-7 w-7 rounded-full" /> : <GoogleLogo size={20} />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink">{a.name}</div>
                  <div className="truncate text-[12px] text-ink-4">{a.email}</div>
                </div>
                <button title="Actualizar calendarios" onClick={() => void refresh(a.email)} className="rounded-md p-1.5 text-ink-4 hover:bg-soft hover:text-ink">
                  <RefreshCw size={14} className={busy === a.email ? 'animate-spin' : ''} />
                </button>
                <button title="Desconectar" onClick={() => void disconnect(a.email)} className="rounded-md p-1.5 text-ink-4 hover:bg-soft hover:text-danger"><LogOut size={14} /></button>
              </div>
              {data.errors[a.email] && <div className="border-b border-hairline px-3.5 py-2 text-[12px] text-danger">{data.errors[a.email]}</div>}
              <div className="divide-y divide-hairline">
                {a.calendars.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 px-3.5 py-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                    <span className="flex-1 truncate text-[13px] text-ink-2">{c.summary}{c.primary && <span className="ml-2 text-[11.5px] text-ink-4">principal</span>}</span>
                    <Toggle checked={c.enabled} onChange={(v) => void toggle(a, c.id, v)} label={c.summary} />
                  </div>
                ))}
                {!a.calendars.length && <div className="px-3.5 py-2 text-[12.5px] text-ink-4">Sin calendarios. Pulsa ↻ para cargarlos.</div>}
              </div>
            </div>
          ))}
          <Button variant="ghost" onClick={() => void connectGoogle()}><Plus size={14} />Añadir otra cuenta de Google</Button>
        </div>
      )}
      {data.client.source === 'custom' && <ClientFooter clientId={data.client.clientId} onChanged={() => void reload()} />}
    </div>
  );
}

const shortId = (id: string) => (id.length > 24 ? `${id.slice(0, 12)}…${id.slice(id.indexOf('.apps'))}` : id);

function ClientFooter({ clientId, onChanged }: { clientId: string; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const remove = async () => {
    if (!confirm('¿Quitar tu acceso de Google? Las cuentas conectadas se desconectan y tendrás que volver a cargarlo para usar Google Calendar.')) return;
    await api.del('/api/google/client');
    onChanged();
  };
  if (editing) {
    return (
      <div className="mt-4 rounded-xl border border-hairline">
        <GoogleClientSetup compact onSaved={() => { setEditing(false); onChanged(); }} />
        <div className="px-4 pb-3"><Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancelar</Button></div>
      </div>
    );
  }
  return (
    <div className="mt-3 flex items-center gap-2 text-[12px] text-ink-4">
      <span className="truncate">Acceso de Google: tu cliente {shortId(clientId)}</span>
      <button className="text-ink-3 underline-offset-2 hover:underline" onClick={() => setEditing(true)}>Cambiar</button>
      <span>·</span>
      <button className="text-ink-3 underline-offset-2 hover:text-danger hover:underline" onClick={() => void remove()}>Quitar</button>
    </div>
  );
}

/** Loads the person's own OAuth client: the JSON Google downloads, or the two fields by hand. */
function GoogleClientSetup({ onSaved, compact = false }: { onSaved: () => void; compact?: boolean }) {
  const [guide, setGuide] = useState(false);
  const [manual, setManual] = useState(false);
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const save = async (body: { json?: string; id?: string; secret?: string }) => {
    setBusy(true);
    try {
      await api.put('/api/google/client', body);
      toast('Acceso de Google guardado. Ya puedes conectar tu cuenta.');
      onSaved();
    } catch (e: any) {
      toast(e.message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const onFile = async (f?: File) => {
    if (!f) return;
    await save({ json: await f.text() });
    if (file.current) file.current.value = '';
  };

  return (
    <div className="px-5 py-4">
      {!compact && (
        <>
          <div className="flex items-center gap-2 text-[13px] font-medium text-ink"><GoogleLogo size={15} />Conectar con Google</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
            Para leer tu Google Calendar, Acta usa un acceso de Google que creas tú, gratis y una sola vez (unos 8 minutos).
            Así la conexión es solo tuya: no pasa por nadie más y no caduca.
          </p>
        </>
      )}
      <div className={cx('flex flex-wrap items-center gap-2', !compact && 'mt-3')}>
        <Button variant="primary" disabled={busy} onClick={() => file.current?.click()}><FileJson size={14} />Cargar el archivo de Google (.json)</Button>
        <Button variant="outline" onClick={() => setGuide(true)}><BookOpen size={14} />Cómo conseguirlo</Button>
        <button className="ml-1 text-[12px] text-ink-4 underline-offset-2 hover:text-ink hover:underline" onClick={() => setManual(!manual)}>
          {manual ? 'Ocultar' : 'O pegar los datos a mano'}
        </button>
        <input ref={file} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>
      {manual && (
        <div className="mt-3 grid gap-2">
          <Input placeholder="ID de cliente (acaba en .apps.googleusercontent.com)" value={id} onChange={(e) => setId(e.target.value)} />
          <Input placeholder="Secreto del cliente (empieza por GOCSPX-)" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
          <div><Button variant="primary" disabled={busy || !id || !secret} onClick={() => void save({ id, secret })}>Guardar</Button></div>
        </div>
      )}
      {!compact && (
        <p className="mt-3 text-[12px] text-ink-4">
          ¿Prisa? La dirección iCal secreta de Google Calendar funciona en un minuto: pégala más abajo, en «Otras formas de conectar».
        </p>
      )}
      <GoogleGuide open={guide} onClose={() => setGuide(false)} />
    </div>
  );
}

const STEPS: { title: string; body: ReactNode; href?: string; link?: string }[] = [
  {
    title: 'Crea un proyecto en Google Cloud',
    body: <>Entra con tu cuenta de Google, ponle de nombre <b>Acta</b> y pulsa <b>Crear</b>. Es gratis y no pide tarjeta.</>,
    href: 'https://console.cloud.google.com/projectcreate',
    link: 'Crear proyecto',
  },
  {
    title: 'Activa la API de Google Calendar',
    body: <>Con el proyecto Acta seleccionado arriba, pulsa <b>Habilitar</b>.</>,
    href: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
    link: 'Abrir la API de Calendar',
  },
  {
    title: 'Configura la pantalla de acceso',
    body: <>Pulsa <b>Comenzar</b>. Nombre de la app: <b>Acta</b>; correo de asistencia: el tuyo. En <b>Público</b> elige <b>Externo</b>. Pon tu correo de contacto, acepta y pulsa <b>Crear</b>.</>,
    href: 'https://console.cloud.google.com/auth/branding',
    link: 'Abrir Google Auth Platform',
  },
  {
    title: 'Publica la app (para que no caduque)',
    body: <>En <b>Público</b>, pulsa <b>Publicar app</b> y confirma. Si la dejas «En pruebas», Google te desconecta cada 7 días.</>,
    href: 'https://console.cloud.google.com/auth/audience',
    link: 'Abrir Público',
  },
  {
    title: 'Crea el cliente de escritorio y descarga el archivo',
    body: <>Pulsa <b>Crear cliente</b>. Tipo de aplicación: <b>App de escritorio</b>; nombre: <b>Acta</b>. Al crearlo, pulsa <b>Descargar JSON</b> (el secreto solo se enseña ahora).</>,
    href: 'https://console.cloud.google.com/auth/clients',
    link: 'Abrir Clientes',
  },
  {
    title: 'Cárgalo en Acta y conecta',
    body: <>Pulsa <b>Cargar el archivo de Google</b>, elige el JSON y después <b>Conectar con Google</b>. Google avisará de que la app «no está verificada»: es normal, porque la app es tuya. Pulsa <b>Configuración avanzada → Ir a Acta</b> y acepta.</>,
  },
];

function GoogleGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Tu acceso de Google, paso a paso" width={600}>
      <ol className="space-y-4 px-5 py-4">
        {STEPS.map((st, i) => (
          <li key={st.title} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-soft text-[12px] font-semibold text-ink">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium text-ink">{st.title}</div>
              <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">{st.body}</div>
              {st.href && (
                <a href={st.href} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-ink underline-offset-2 hover:underline">
                  {st.link}<ExternalLink size={12} />
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="border-t border-hairline px-5 py-3 text-[12px] text-ink-4">
        Acta solo pide permiso de lectura del calendario. El archivo y las sesiones se guardan en este ordenador.
      </div>
    </Modal>
  );
}
