import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Check, Plus, Trash2, ExternalLink, ShieldCheck, Copy } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../store';
import { Button, Input, PageHeader, Textarea, Toggle, cx, toast } from '../components/ui';
import { GoogleAccounts } from '../components/Google';

function Card({ id, title, desc, children }: { id: string; title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 rounded-2xl border border-hairline bg-raised">
      <div className="border-b border-hairline px-5 py-4">
        <div className="text-[14px] font-semibold text-ink">{title}</div>
        {desc && <div className="mt-0.5 text-[12.5px] text-ink-3">{desc}</div>}
      </div>
      <div className="divide-y divide-hairline">{children}</div>
    </section>
  );
}
function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-6 px-5 py-3.5">
      <div className="min-w-0 flex-1"><div className="text-[13px] text-ink">{label}</div>{hint && <div className="mt-0.5 text-[12px] text-ink-4">{hint}</div>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={cx('h-8 max-w-[300px] rounded-lg border border-hairline-strong bg-raised px-2 text-[13px] text-ink outline-none', p.className)} />
);

const KEY_DEFS = [
  { id: 'GROQ_API_KEY', label: 'Groq', hint: 'Transcripción y notas. El plan gratuito suele bastar para empezar.', href: 'https://console.groq.com/keys', link: 'Crear clave' },
  { id: 'OPENAI_API_KEY', label: 'OpenAI', hint: 'Transcripción y notas.', href: 'https://platform.openai.com/api-keys', link: 'Crear clave' },
  { id: 'DEEPGRAM_API_KEY', label: 'Deepgram', hint: 'Solo transcripción.', href: 'https://console.deepgram.com/', link: 'Crear clave' },
  { id: 'ANTHROPIC_API_KEY', label: 'Anthropic', hint: 'Solo notas y chat.', href: 'https://console.anthropic.com/settings/keys', link: 'Crear clave' },
] as const;

export function SettingsPage() {
  const { state, refreshState } = useApp();
  const loc = useLocation();
  const [s, setS] = useState<any>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [perm, setPerm] = useState<any>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [newCal, setNewCal] = useState({ name: '', url: '' });

  const load = async () => {
    setS(await api.get('/api/settings'));
    api.get('/api/helper/permissions').then(setPerm).catch(() => setPerm(null));
    api.get<any[]>('/api/helper/devices').then(setDevices).catch(() => {});
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (s && loc.hash) setTimeout(() => document.getElementById(loc.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, [s, loc.hash]);

  const save = async (patch: any, msg = 'Guardado') => {
    setS((cur: any) => ({ ...cur, ...patch }));
    await api.put('/api/settings', patch);
    await refreshState();
    toast(msg);
  };
  if (!s) return null;

  const models = state?.models || [];
  const addCalendar = async () => {
    if (!newCal.url.trim()) return;
    try {
      const r = await api.post<{ events: number }>('/api/calendar/test', { url: newCal.url.trim() });
      const calendars = [...s.calendars, { id: `cal${Date.now()}`, name: newCal.name.trim() || 'Calendario', url: newCal.url.trim(), enabled: true }];
      await save({ calendars }, `Calendario conectado (${r.events} eventos)`);
      setNewCal({ name: '', url: '' });
    } catch (e: any) { toast(e.message, { tone: 'error' }); }
  };
  const integ = s.integrations || {};
  const setInteg = (k: string, v: any) => save({ integrations: { ...integ, [k]: { ...(integ[k] || {}), ...v } } });
  const mcpCmd = s.mcpCommand as string;

  return (
    <div className="mx-auto max-w-[760px] space-y-6 px-8 pb-24 pt-10">
      <PageHeader title="Ajustes" subtitle={<>Todo se guarda en tu Mac, en <code className="text-[12px]">{s.dataDir}</code>.</>} />

      <Card id="perfil" title="Tú">
        <Row label="Tu nombre" hint="Así te nombra Acta en las notas y en la transcripción.">
          <Input className="w-56" placeholder="Tu nombre" defaultValue={s.userName} onBlur={(e) => e.target.value !== s.userName && void save({ userName: e.target.value })} />
        </Row>
        <Row label="Apariencia">
          <Select defaultValue={(() => { try { return localStorage.getItem('acta-theme') || 'system'; } catch { return 'system'; } })()} onChange={(e) => {
            const v = e.target.value;
            try { if (v === 'system') localStorage.removeItem('acta-theme'); else localStorage.setItem('acta-theme', v); } catch { /* ignore */ }
            if (v === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v;
          }}>
            <option value="system">Como el sistema</option><option value="light">Claro</option><option value="dark">Oscuro</option>
          </Select>
        </Row>
        <Row label="Tus emails" hint="Para no contarte como asistente. Separados por comas.">
          <Input className="w-72" defaultValue={s.selfEmails.join(', ')} onBlur={(e) => void save({ selfEmails: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
        </Row>
      </Card>

      <Card id="transcripcion" title="Transcripción" desc="Acta graba tu micrófono («Yo») y el audio del sistema («Ellos») por separado. No se une ningún bot a la llamada.">
        <Row label="Motor de transcripción">
          <Select value={s.sttProvider} onChange={(e) => void save({ sttProvider: e.target.value })}>
            {state?.stt.options.map((o) => <option key={o.id} value={o.id} disabled={!o.available}>{o.label}{o.available ? '' : ' (sin configurar)'}</option>)}
          </Select>
        </Row>
        <div className="px-5 pb-3 text-[12px] text-ink-4">{state?.stt.options.find((o) => o.id === s.sttProvider)?.detail}</div>
        <Row label="Idioma de las reuniones">
          <Select value={s.language} onChange={(e) => void save({ language: e.target.value })}>
            <option value="es">Español</option><option value="en">Inglés</option><option value="ca">Catalán</option><option value="pt">Portugués</option><option value="fr">Francés</option><option value="auto">Detectar automáticamente</option>
          </Select>
        </Row>
        <div className="px-5 py-3.5">
          <div className="text-[13px] text-ink">Vocabulario</div>
          <div className="mb-2 mt-0.5 text-[12px] text-ink-4">Nombres, marcas y términos que deben salir bien escritos.</div>
          <Textarea rows={2} defaultValue={s.vocabulary} onBlur={(e) => void save({ vocabulary: e.target.value })} placeholder="Nombre de una empresa, un producto, una sigla" />
        </div>
        {state?.platform !== 'win32' && (
          <Row label="Micrófono">
            <Select value={s.micDeviceUID || ''} onChange={(e) => void save({ micDeviceUID: e.target.value })}>
              <option value="">El del sistema</option>
              {devices.map((d) => <option key={d.uid} value={d.uid}>{d.name}</option>)}
            </Select>
          </Row>
        )}
        <Row label="Cancelación de eco" hint="Actívala si usas altavoces. Con auriculares no hace falta."><Toggle checked={s.echoCancellation} onChange={(v) => void save({ echoCancellation: v })} /></Row>
        <Row label="Guardar el audio" hint="Granola no guarda audio. Si lo activas, Acta guarda un .m4a de cada reunión."><Toggle checked={s.saveAudio} onChange={(v) => void save({ saveAudio: v })} /></Row>
      </Card>

      <Card id="ia" title="Inteligencia artificial" desc="Elige qué modelo escribe tus notas y cuál responde en el chat.">
        {(['notes', 'chat', 'fast'] as const).map((k) => (
          <Row key={k} label={{ notes: 'Notas mejoradas', chat: 'Chat y recetas', fast: 'Tareas, títulos y resúmenes' }[k]}>
            <Select value={s.models[k]} onChange={(e) => void save({ models: { ...s.models, [k]: e.target.value } })}>
              {models.map((m) => <option key={m.id} value={m.id} disabled={!m.available}>{m.label}{m.available ? '' : ' (sin clave)'}</option>)}
            </Select>
          </Row>
        ))}
        <Row label="Mejorar al terminar" hint="Genera las notas automáticamente cuando acaba la reunión."><Toggle checked={s.autoEnhance} onChange={(v) => void save({ autoEnhance: v })} /></Row>
        <Row label="Usar Claude con tu suscripción" hint="Vía Claude Code (claude -p). Sin coste por uso, algo más lento."><Toggle checked={s.claudeCliEnabled} onChange={(v) => void save({ claudeCliEnabled: v })} /></Row>
      </Card>

      <Card id="claves" title="Claves" desc="Pega la clave de tu propia cuenta. Queda en la base de datos de Acta, en este Mac, y no se comparte con nadie. Con Groq u OpenAI basta para transcribir y para las notas.">
        {KEY_DEFS.map((k) => {
          const v = s.keys[k.id] || { set: false, masked: '', source: '' };
          return (
            <div key={k.id} className="px-5 py-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-[13px] text-ink">{k.label}</div>
                <a href={k.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-ink-4 hover:text-ink">{k.link} <ExternalLink size={11} /></a>
              </div>
              <div className="mt-0.5 text-[12px] text-ink-4">{k.hint}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input className="w-56" type="password" autoComplete="off" placeholder={v.set ? 'Reemplazar…' : 'Pegar clave'} value={keys[k.id] || ''} onChange={(e) => setKeys({ ...keys, [k.id]: e.target.value })} />
                <Button variant="outline" disabled={!keys[k.id]} onClick={async () => { await save({ keys: { [k.id]: keys[k.id] } }, 'Clave guardada'); setKeys({ ...keys, [k.id]: '' }); await load(); }}>Guardar</Button>
                {v.set && <Button variant="ghost" onClick={async () => { await save({ keys: { [k.id]: null } }, 'Clave quitada'); await load(); }}>Quitar</Button>}
              </div>
              <div className="mt-1.5 text-[12px] text-ink-4">
                {v.set ? <span className="inline-flex items-center gap-1 text-accent-ink"><Check size={12} />{v.masked}{v.source ? ` · ${v.source}` : ''}</span> : 'Sin configurar'}
              </div>
            </div>
          );
        })}
      </Card>

      <Card id="calendario" title="Calendario" desc="Acta solo lee tus eventos, para mostrar las próximas reuniones y rellenar los asistentes.">
        <GoogleAccounts />
        <div className="px-5 pb-1 pt-3 text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-4">Otras formas de conectar</div>
        <div className="px-5 pb-2 text-[12px] text-ink-4">Outlook u otros: pega la dirección iCal secreta del calendario.</div>
        {s.calendars.map((c: any, i: number) => (
          <Row key={c.id} label={c.name} hint={<span className="block max-w-[380px] truncate">{c.url.replace(/(private-)[a-f0-9]+/, '$1••••')}</span>}>
            <div className="flex items-center gap-2">
              <Toggle checked={c.enabled} onChange={(v) => void save({ calendars: s.calendars.map((x: any, j: number) => (j === i ? { ...x, enabled: v } : x)) })} />
              <button className="text-ink-4 hover:text-danger" title="Quitar" onClick={() => void save({ calendars: s.calendars.filter((_: any, j: number) => j !== i) })}><Trash2 size={14} /></button>
            </div>
          </Row>
        ))}
        <div className="flex gap-2 px-5 py-3.5">
          <Input className="w-40" placeholder="Nombre" value={newCal.name} onChange={(e) => setNewCal({ ...newCal, name: e.target.value })} />
          <Input placeholder="https://outlook.office365.com/owa/calendar/…/calendar.ics" value={newCal.url} onChange={(e) => setNewCal({ ...newCal, url: e.target.value })} />
          <Button variant="primary" onClick={() => void addCalendar()}><Plus size={14} />Añadir</Button>
        </div>
        {state?.platform === 'darwin' && (
          <Row label="Calendario del Mac" hint="Lee los calendarios de la app Calendario (incluye cuentas de Google añadidas al Mac). Pide permiso la primera vez.">
            <Toggle checked={s.macCalendarEnabled} onChange={async (v) => { if (v) await api.post('/api/helper/request', { what: 'calendar' }).catch(() => {}); await save({ macCalendarEnabled: v }); void load(); }} />
          </Row>
        )}
        <Row label="Avisarme antes de empezar" hint="Notificación para abrir las notas de la reunión.">
          <Select value={String(s.calendarNotifyMinutes)} onChange={(e) => void save({ calendarNotifyMinutes: Number(e.target.value) })}>
            <option value="-1">No avisar</option><option value="0">Al empezar</option><option value="1">1 minuto antes</option><option value="5">5 minutos antes</option>
          </Select>
        </Row>
      </Card>

      <Card id="deteccion" title="Detección de reuniones" desc={state?.platform === 'win32' ? 'Acta detecta llamadas de Zoom, Meet, Teams, Slack o Webex y te propone tomar notas.' : 'Acta detecta llamadas de Zoom, Meet, Teams, Slack, FaceTime, Webex o Discord y te propone tomar notas.'}>
        <Row label="Detectar reuniones automáticamente"><Toggle checked={s.autoDetect} onChange={(v) => void save({ autoDetect: v })} /></Row>
        <Row label="Parar cuando termine la llamada"><Toggle checked={s.autoStopOnMeetingEnd} onChange={(v) => void save({ autoStopOnMeetingEnd: v })} /></Row>
        <Row label="Parar tras minutos sin voz">
          <Select value={String(s.autoStopMinutes)} onChange={(e) => void save({ autoStopMinutes: Number(e.target.value) })}>
            <option value="0">Nunca</option><option value="5">5 min</option><option value="12">12 min</option><option value="20">20 min</option><option value="30">30 min</option>
          </Select>
        </Row>
      </Card>

      <Card id="permisos" title={state?.platform === 'win32' ? 'Permisos de Windows' : 'Permisos de macOS'} desc={state?.platform === 'win32' ? 'El micrófono capta tu voz. El audio de la llamada sale del sistema; Acta no graba la imagen.' : 'El micrófono capta tu voz; «Grabación de pantalla» solo se usa para obtener el audio del sistema, nunca la imagen.'}>
        {state?.platform === 'win32' ? (
          <div className="px-5 py-4 text-[13px] text-ink-3">
            La primera vez que grabas, Windows pide el micrófono. El audio de las otras personas usa el loopback del sistema (Windows 10 versión 2004 o más nueva, o Windows 11). No hace falta el permiso de grabar la pantalla.
          </div>
        ) : state?.platform && state.platform !== 'darwin' ? (
          <div className="px-5 py-4 text-[13px] text-ink-3">Los permisos del sistema se piden al empezar a grabar.</div>
        ) : !perm?.available ? (
          <div className="px-5 py-4 text-[13px] text-ink-3">
            {s.packaged
              ? 'Esta copia no incluye el capturador de audio del Mac.'
              : <>El capturador nativo no está compilado. Ejecuta <code>npm run build:native</code>.</>}
          </div>
        ) : (
          (['mic', 'screen', 'calendar'] as const).map((k) => (
            <Row key={k} label={{ mic: 'Micrófono', screen: 'Grabación de pantalla (audio del sistema)', calendar: 'Calendario' }[k]}
              hint={perm[k] === 'granted' ? <span className="inline-flex items-center gap-1 text-accent-ink"><ShieldCheck size={12} />Concedido</span> : 'No concedido'}>
              {perm[k] !== 'granted' && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={async () => { await api.post('/api/helper/request', { what: k }).catch(() => {}); void load(); }}>Pedir permiso</Button>
                  <Button variant="ghost" onClick={() => void api.post('/api/helper/open-privacy', { pane: k })}><ExternalLink size={13} /></Button>
                </div>
              )}
            </Row>
          ))
        )}
      </Card>

      <Card id="integraciones" title="Integraciones" desc="Envía las notas donde trabajas. Con «automático», se envían en cuanto se mejoran.">
        <div className="space-y-2 px-5 py-4">
          <div className="flex items-center justify-between"><div className="text-[13px] text-ink">Webhook (Zapier, Make, n8n, tu CRM)</div><span className="flex items-center gap-2 text-[12px] text-ink-4">automático<Toggle checked={!!integ.webhook?.auto} onChange={(v) => void setInteg('webhook', { auto: v })} /></span></div>
          <Input defaultValue={integ.webhook?.url || ''} placeholder="https://hooks.zapier.com/…" onBlur={(e) => e.target.value !== (integ.webhook?.url || '') && void setInteg('webhook', { url: e.target.value.trim() })} />
        </div>
        <div className="space-y-2 px-5 py-4">
          <div className="flex items-center justify-between"><div className="text-[13px] text-ink">Slack (incoming webhook)</div><span className="flex items-center gap-2 text-[12px] text-ink-4">automático<Toggle checked={!!integ.slack?.auto} onChange={(v) => void setInteg('slack', { auto: v })} /></span></div>
          <Input defaultValue={integ.slack?.url || ''} placeholder="https://hooks.slack.com/services/…" onBlur={(e) => e.target.value !== (integ.slack?.url || '') && void setInteg('slack', { url: e.target.value.trim() })} />
        </div>
        <div className="space-y-2 px-5 py-4">
          <div className="flex items-center justify-between"><div className="text-[13px] text-ink">Notion (base de datos)</div><span className="flex items-center gap-2 text-[12px] text-ink-4">automático<Toggle checked={!!integ.notion?.auto} onChange={(v) => void setInteg('notion', { auto: v })} /></span></div>
          <div className="flex gap-2">
            <Input type="password" defaultValue={integ.notion?.token || ''} placeholder="Token de integración (ntn_…)" onBlur={(e) => e.target.value !== (integ.notion?.token || '') && void setInteg('notion', { token: e.target.value.trim() })} />
            <Input defaultValue={integ.notion?.databaseId || ''} placeholder="ID de la base de datos" onBlur={(e) => e.target.value !== (integ.notion?.databaseId || '') && void setInteg('notion', { databaseId: e.target.value.trim() })} />
          </div>
        </div>
      </Card>

      <Card id="mcp" title="Acta en Claude (MCP)" desc="Conecta tus reuniones a Claude Code o Claude Desktop: podrás pedir «resume mis llamadas de esta semana» desde cualquier conversación.">
        <div className="px-5 py-4">
          <div className="flex items-center gap-2 rounded-lg bg-sunken px-3 py-2">
            <code className="flex-1 truncate text-[12px] text-ink-2">{mcpCmd}</code>
            <button title="Copiar" onClick={() => void navigator.clipboard.writeText(mcpCmd).then(() => toast('Comando copiado'))} className="text-ink-4 hover:text-ink"><Copy size={14} /></button>
          </div>
          <div className="mt-2 text-[12px] text-ink-4">Herramientas: listar, buscar y leer reuniones, transcripciones y tareas. Solo lectura.</div>
        </div>
      </Card>

      <Card id="datos" title="Datos" desc="Nada sale de tu Mac salvo el audio y el texto que envías al proveedor de transcripción y de IA que elijas.">
        <Row label="Carpeta de datos" hint={s.dataDir}><Button variant="outline" onClick={() => void api.post('/api/open-path', { path: s.dataDir })}>Abrir</Button></Row>
        <Row label="Exportaciones" hint={s.exportDir}><Button variant="outline" onClick={() => void api.post('/api/open-path', { path: s.exportDir })}>Abrir</Button></Row>
      </Card>
    </div>
  );
}
