// "Conectar con Google": OAuth 2.0 (authorization code + PKCE) in the user's browser, then
// Google Calendar read-only via the API. Several accounts can be connected at once.
import http from 'node:http';
import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.ts';
import { PORT, PACKAGED, buildConfig } from './env.ts';
import { bus } from './recorder.ts';
import type { CalEvent } from './calendar.ts';

const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar.readonly'];

export type GoogleCalendar = { id: string; summary: string; primary: boolean; color: string; enabled: boolean };
export type GoogleAccount = {
  email: string;
  name: string;
  picture: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  calendars: GoogleCalendar[];
  connectedAt: number;
};

export class GoogleError extends Error {
  activationUrl?: string;
  constructor(message: string, activationUrl?: string) {
    super(message);
    this.activationUrl = activationUrl;
  }
}

type ClientSource = 'custom' | 'build' | 'env' | '';
type GoogleClient = { id: string; secret: string; redirect: string; source: ClientSource };

/**
 * Where the OAuth client comes from, in order:
 * 1. custom: the one the person loads in Settings (a "Desktop app" client from their own Google Cloud project).
 *    Desktop clients take a loopback redirect without registering it.
 * 2. build: one written into build-config.json when the app was packaged.
 * 3. env: ACTA_GOOGLE_* in development only. Packaged builds never read .env.local.
 */
function client(): GoogleClient {
  const custom = getSetting<{ id?: string; secret?: string; redirect?: string }>('googleClient', {});
  if (custom.id?.trim() && custom.secret?.trim()) {
    return {
      id: custom.id.trim(),
      secret: custom.secret.trim(),
      // Same shape Google's own installed-app libraries use: loopback IP, its own port, root path.
      // Acta listens there only while signing in (ensureCallbackListener).
      redirect: (custom.redirect || `http://127.0.0.1:${PORT + 1}/`).trim(),
      source: 'custom',
    };
  }
  const baked = buildConfig.google || {};
  if (PACKAGED || baked.clientId) {
    const id = (baked.clientId || '').trim();
    const secret = (baked.clientSecret || '').trim();
    const redirect = (baked.redirectUri || `http://localhost:${PORT}/api/google/callback`).trim();
    return { id, secret, redirect, source: id && secret ? 'build' : '' };
  }
  const id = process.env.ACTA_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
  const secret = process.env.ACTA_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
  const redirect = process.env.ACTA_GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/api/google/callback`;
  return { id, secret, redirect, source: id && secret ? 'env' : '' };
}

/** What Settings shows about the client in use. Never returns the secret. */
export function clientInfo() {
  const c = client();
  return { source: c.source, clientId: c.source === 'custom' ? c.id : '', redirect: c.redirect };
}

const CLIENT_ID_RE = /^[\w-]+\.apps\.googleusercontent\.com$/;

/**
 * Saves the person's own OAuth client. Accepts the fields or the JSON file Google downloads
 * ({"installed": {...}} for Desktop clients, {"web": {...}} for web ones).
 * Accounts connected with another client stop working (their tokens belong to it), so they are dropped.
 */
export function setCustomClient(input: { id?: string; secret?: string; json?: string }) {
  let id = (input.id || '').trim();
  let secret = (input.secret || '').trim();
  let redirect = '';
  if (input.json) {
    let parsed: any;
    try { parsed = JSON.parse(input.json); } catch { throw new GoogleError('Ese archivo no es el JSON que descarga Google Cloud.'); }
    const c = parsed?.installed || parsed?.web || parsed;
    id = String(c?.client_id || '').trim();
    secret = String(c?.client_secret || '').trim();
    if (parsed?.web) {
      const uris: string[] = c.redirect_uris || [];
      redirect = uris.find((u) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u)) || '';
      if (!redirect) throw new GoogleError('Ese cliente es de tipo «Aplicación web». Crea uno de tipo «App de escritorio» (la guía lo explica) y carga su archivo.');
    }
  }
  if (!CLIENT_ID_RE.test(id)) throw new GoogleError('El ID de cliente debe acabar en .apps.googleusercontent.com.');
  if (!secret) throw new GoogleError('Falta el secreto del cliente.');
  const prev = getSetting<{ id?: string }>('googleClient', {});
  if (prev.id && prev.id !== id) saveAccounts([]);
  setSetting('googleClient', redirect ? { id, secret, redirect } : { id, secret });
}

export function clearCustomClient() {
  const prev = getSetting<{ id?: string }>('googleClient', {});
  if (prev.id) saveAccounts([]);
  setSetting('googleClient', {});
}

export const googleConfigured = () => !!client().id && !!client().secret;
export const accounts = () => getSetting<GoogleAccount[]>('googleAccounts', []);
function saveAccounts(a: GoogleAccount[]) { setSetting('googleAccounts', a); }

// ---------- authorization ----------
type Pending = { verifier: string; createdAt: number };
const pending = new Map<string, Pending>();
let callbackServer: http.Server | null = null;
let callbackTimer: NodeJS.Timeout | null = null;

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function startAuth(loginHint?: string) {
  const c = client();
  if (!c.id || !c.secret) {
    throw new GoogleError('Antes de conectar, carga tu acceso de Google en Ajustes → Calendario (la guía está ahí mismo).');
  }
  const state = b64url(crypto.randomBytes(16));
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  pending.set(state, { verifier, createdAt: Date.now() });
  await ensureCallbackListener(c.redirect);
  const params = new URLSearchParams({
    client_id: c.id,
    redirect_uri: c.redirect,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent select_account',
    // Omit include_granted_scopes. If this OAuth client already has other Google grants,
    // merging those scopes makes Google reject the request.
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  if (loginHint) params.set('login_hint', loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** The redirect URI may live on another port (the registered one); listen there only while signing in. */
async function ensureCallbackListener(redirect: string) {
  const u = new URL(redirect);
  if (Number(u.port || 80) === PORT) return;
  if (callbackTimer) clearTimeout(callbackTimer);
  callbackTimer = setTimeout(() => { callbackServer?.close(); callbackServer = null; }, 10 * 60_000);
  if (callbackServer) return;
  callbackServer = http.createServer((req, res) => {
    const url = new URL(req.url || '/', redirect);
    if (url.pathname !== u.pathname) { res.writeHead(404).end(); return; }
    void handleCallback(url.searchParams).then((page) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
    });
  });
  await new Promise<void>((resolve, reject) => {
    callbackServer!.once('error', (e: any) => {
      callbackServer = null;
      reject(new GoogleError(e.code === 'EADDRINUSE'
        ? `El puerto ${u.port} está ocupado por otra app. Ciérrala y vuelve a intentarlo.`
        : String(e.message)));
    });
    callbackServer!.listen(Number(u.port || 80), '127.0.0.1', () => resolve());
  });
}

async function token(body: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const j: any = await res.json();
  if (!res.ok) throw new GoogleError(j.error_description || j.error || `Google ${res.status}`);
  return j as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string };
}

export async function handleCallback(q: URLSearchParams): Promise<string> {
  const state = q.get('state') || '';
  const p = pending.get(state);
  try {
    if (q.get('error')) throw new GoogleError(q.get('error') === 'access_denied' ? 'Has cancelado el acceso.' : String(q.get('error')));
    if (!p || Date.now() - p.createdAt > 15 * 60_000) throw new GoogleError('El enlace de inicio de sesión ha caducado. Vuelve a pulsar «Conectar con Google».');
    pending.delete(state);
    const c = client();
    const t = await token({ code: q.get('code') || '', client_id: c.id, client_secret: c.secret, redirect_uri: c.redirect, grant_type: 'authorization_code', code_verifier: p.verifier });
    const info: any = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
    const email = String(info.email || '').toLowerCase();
    const list = accounts();
    const prev = list.find((a) => a.email === email);
    const account: GoogleAccount = {
      email,
      name: info.name || email,
      picture: info.picture || '',
      refreshToken: t.refresh_token || prev?.refreshToken || '',
      accessToken: t.access_token,
      expiresAt: Date.now() + (t.expires_in - 60) * 1000,
      calendars: prev?.calendars || [],
      connectedAt: Date.now(),
    };
    if (!account.refreshToken) throw new GoogleError('Google no devolvió permiso permanente. Quita el acceso de Acta en tu cuenta de Google y vuelve a conectar.');
    saveAccounts([...list.filter((a) => a.email !== email), account]);
    const selfEmails = getSetting<string[]>('selfEmails', []);
    if (!selfEmails.includes(email)) setSetting('selfEmails', [...selfEmails, email]);
    try {
      await refreshCalendars(email);
    } catch (e: any) {
      bus.emit('event', { type: 'google.error', message: e.message, activationUrl: e.activationUrl });
    }
    bus.emit('event', { type: 'google.connected', email });
    return resultPage(true, `Conectado como <b>${email}</b>. Ya puedes volver a Acta.`);
  } catch (e: any) {
    bus.emit('event', { type: 'google.error', message: e.message, activationUrl: e.activationUrl });
    return resultPage(false, e.message);
  }
}

function resultPage(ok: boolean, msg: string) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Acta</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fcfcf8;color:#292929;font:15px/1.6 -apple-system,BlinkMacSystemFont,Inter,sans-serif}
@media (prefers-color-scheme:dark){body{background:#1d1d1c;color:#fcfcf8}}
.c{text-align:center;max-width:380px;padding:24px}.i{width:44px;height:44px;border-radius:50%;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;font-size:22px;color:#fff;background:${ok ? '#5b6f00' : '#bd4a30'}}
h1{font:500 22px/1.3 Georgia,serif;margin:0 0 6px}p{margin:0;color:#72726e}</style></head>
<body><div class="c"><div class="i">${ok ? '✓' : '!'}</div><h1>${ok ? 'Google conectado' : 'No se pudo conectar'}</h1><p>${msg}</p></div>
<script>setTimeout(()=>{try{window.opener&&window.opener.postMessage('acta-google-done','*')}catch(e){};window.close()},${ok ? 1200 : 6000})</script></body></html>`;
}

// ---------- API ----------
async function accessToken(email: string) {
  const list = accounts();
  const a = list.find((x) => x.email === email);
  if (!a) throw new GoogleError('Cuenta no conectada');
  if (a.accessToken && Date.now() < a.expiresAt) return a.accessToken;
  const c = client();
  try {
    const t = await token({ client_id: c.id, client_secret: c.secret, refresh_token: a.refreshToken, grant_type: 'refresh_token' });
    a.accessToken = t.access_token;
    a.expiresAt = Date.now() + (t.expires_in - 60) * 1000;
    saveAccounts(list);
    return a.accessToken;
  } catch (e: any) {
    throw new GoogleError(`La sesión de Google de ${email} ha caducado: vuelve a conectarla. (${e.message})`);
  }
}

async function gget(email: string, path: string) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, { headers: { Authorization: `Bearer ${await accessToken(email)}` } });
  const j: any = await res.json();
  if (!res.ok) {
    const err = j.error || {};
    const disabled = (err.details || []).some((d: any) => d.reason === 'SERVICE_DISABLED') || /has not been used|is disabled/i.test(err.message || '');
    const link = (err.details || []).flatMap((d: any) => d.links || []).find((l: any) => /console/.test(l.url))?.url
      || (err.message || '').match(/https:\/\/console\.developers\.google\.com\S+/)?.[0];
    if (disabled) throw new GoogleError('La API de Google Calendar está desactivada en tu proyecto de Google Cloud. Actívala con un clic y vuelve a intentarlo.', link);
    throw new GoogleError(`Google Calendar ${res.status}: ${err.message || 'error'}`);
  }
  return j;
}

export async function refreshCalendars(email: string) {
  const j = await gget(email, '/users/me/calendarList?minAccessRole=reader&maxResults=250');
  const list = accounts();
  const a = list.find((x) => x.email === email)!;
  const prev = new Map(a.calendars.map((c) => [c.id, c.enabled]));
  a.calendars = (j.items || []).map((c: any) => ({
    id: c.id,
    summary: c.summaryOverride || c.summary,
    primary: !!c.primary,
    color: c.backgroundColor || '#788c15',
    // By default: your main calendar plus the ones you show in Google Calendar, except holidays/birthdays.
    enabled: prev.has(c.id) ? prev.get(c.id)! : !!c.primary || (!!c.selected && !/holiday|#contacts|birthday|festivos/i.test(c.id)),
  }));
  saveAccounts(list);
  return a.calendars;
}

export function setCalendarsEnabled(email: string, ids: string[]) {
  const list = accounts();
  const a = list.find((x) => x.email === email);
  if (!a) return;
  for (const c of a.calendars) c.enabled = ids.includes(c.id);
  saveAccounts(list);
  cache.clear();
}

export async function disconnect(email: string) {
  const a = accounts().find((x) => x.email === email);
  if (a?.refreshToken) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(a.refreshToken)}`, { method: 'POST' }).catch(() => {});
  }
  saveAccounts(accounts().filter((x) => x.email !== email));
  cache.clear();
}

const MEETING_URL = /(https?:\/\/(?:[\w-]+\.)?(?:zoom\.us\/[jw]\/[^\s"<>]+|meet\.google\.com\/[a-z0-9-]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>]+|[\w.-]*webex\.com\/[^\s"<>]+|whereby\.com\/[^\s"<>]+|riverside\.(?:fm|com)\/[^\s"<>]+))/i;
const cache = new Map<string, { at: number; events: CalEvent[] }>();
const errors: Record<string, string> = {};

export async function googleEvents(from: Date, to: Date): Promise<CalEvent[]> {
  const out: CalEvent[] = [];
  for (const k of Object.keys(errors)) delete errors[k];
  await Promise.all(accounts().map(async (a) => {
    for (const cal of a.calendars.filter((c) => c.enabled)) {
      const key = `${a.email}|${cal.id}|${from.getTime() - (from.getTime() % 60000)}|${to.getTime() - (to.getTime() % 60000)}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < 2 * 60_000) { out.push(...hit.events); continue; }
      try {
        const params = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', timeMin: from.toISOString(), timeMax: to.toISOString(), maxResults: '250' });
        const j = await gget(a.email, `/calendars/${encodeURIComponent(cal.id)}/events?${params}`);
        const events: CalEvent[] = (j.items || [])
          .filter((e: any) => e.status !== 'cancelled' && e.start?.dateTime)
          .filter((e: any) => !(e.attendees || []).some((x: any) => x.self && x.responseStatus === 'declined'))
          .map((e: any) => {
            const video = (e.conferenceData?.entryPoints || []).find((p: any) => p.entryPointType === 'video')?.uri || e.hangoutLink;
            const text = `${e.location || ''} ${e.description || ''}`;
            return {
              id: `g:${cal.id}:${e.id}`,
              title: e.summary || '(sin título)',
              start: new Date(e.start.dateTime).getTime(),
              end: new Date(e.end?.dateTime || e.start.dateTime).getTime(),
              allDay: false,
              location: e.location || '',
              description: String(e.description || '').replace(/<[^>]+>/g, ' ').slice(0, 4000),
              meetingUrl: video || text.match(MEETING_URL)?.[1] || '',
              attendees: (e.attendees || []).filter((x: any) => !x.resource).map((x: any) => ({
                name: x.displayName || String(x.email || '').split('@')[0],
                email: String(x.email || '').toLowerCase(),
                self: !!x.self,
              })),
              calendar: cal.summary,
            };
          });
        cache.set(key, { at: Date.now(), events });
        out.push(...events);
      } catch (e: any) {
        errors[`${a.email}`] = e.message;
      }
    }
  }));
  return out;
}

export const googleErrors = () => ({ ...errors });
