// Acta desktop shell. In a packaged app the server runs inside Electron's own Node
// (ELECTRON_RUN_AS_NODE), so a clean Mac does not need a system Node install.
// Development still launches the TypeScript server with the system Node.
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, shell, globalShortcut, nativeImage, session, dialog, nativeTheme } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const PACKAGED = app.isPackaged;
const PORT = Number(process.env.ACTA_PORT || (PACKAGED ? 47331 : 4848));
const URL = `http://127.0.0.1:${PORT}`;

function resourcesRoot() {
  if (PACKAGED) return path.join(process.resourcesPath, 'app');
  return path.resolve(__dirname, '..');
}

function findNode() {
  const candidates = [process.env.ACTA_NODE, '/usr/local/bin/node', '/opt/homebrew/bin/node'];
  try { candidates.push(execFileSync('/bin/zsh', ['-lc', 'command -v node'], { encoding: 'utf8' }).trim()); } catch { /* no login shell */ }
  return candidates.find((c) => c && fs.existsSync(c));
}

let win = null;
let tray = null;
let server = null;
let quitting = false;
let recording = null;
const instance = crypto.randomBytes(8).toString('hex');

function probe() {
  return new Promise((resolve) => {
    const req = http.get(`${URL}/api/health`, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(800, () => { req.destroy(); resolve(null); });
  });
}

async function ensureServer() {
  const root = resourcesRoot();
  const dataDir = PACKAGED ? app.getPath('userData') : path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const existing = await probe();
  if (existing && existing.app === 'acta' && (!PACKAGED || existing.instance === instance)) return true;
  if (existing) {
    dialog.showErrorBox('Acta', `El puerto ${PORT} ya está en uso. Cierra la otra copia de Acta (icono de la barra de menús → Salir) y vuelve a abrirla.`);
    return false;
  }

  const logPath = path.join(dataDir, 'server.log');
  fs.appendFileSync(logPath, `\n--- Acta ${new Date().toISOString()} ${PACKAGED ? 'app' : 'dev'} ---\n`);
  const logFile = fs.openSync(logPath, 'a');

  let cmd;
  let args;
  let env;
  if (PACKAGED) {
    const entry = path.join(root, 'server', 'index.js');
    if (!fs.existsSync(entry)) {
      dialog.showErrorBox('Acta', `No encuentro el servidor dentro de la app (${entry}).`);
      return false;
    }
    cmd = process.execPath;
    args = ['--disable-warning=ExperimentalWarning', entry];
    env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      ACTA_PACKAGED: '1',
      ACTA_PORT: String(PORT),
      ACTA_DATA_DIR: dataDir,
      ACTA_RESOURCES: root,
      ACTA_ELECTRON_EXEC: process.execPath,
      ACTA_INSTANCE: instance,
    };
  } else {
    cmd = findNode();
    if (!cmd) {
      dialog.showErrorBox('Acta', 'No encuentro Node.js. Instálalo (https://nodejs.org) o define ACTA_NODE.');
      return false;
    }
    const built = fs.existsSync(path.join(root, 'web', 'dist', 'index.html'));
    args = [path.join(root, 'server', 'index.ts'), ...(built ? [] : ['--dev'])];
    env = { ...process.env, ACTA_PORT: String(PORT), ACTA_INSTANCE: instance };
  }

  server = spawn(cmd, args, { cwd: root, env, stdio: ['ignore', logFile, logFile] });
  server.on('exit', (code) => { server = null; if (!quitting && code) console.error('server exited', code); });
  for (let i = 0; i < 120; i++) {
    const health = await probe();
    if (health && health.app === 'acta' && health.instance === instance) return true;
    if (!server) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  dialog.showErrorBox('Acta', `El servidor no arrancó. Revisa ${logPath}`);
  return false;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 920,
    minHeight: 600,
    title: 'Acta',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 17 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1d1d1c' : '#fcfcf8',
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  win.loadURL(URL);
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(URL)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(URL)) { e.preventDefault(); shell.openExternal(url); }
  });
  win.on('close', (e) => {
    // Closing the window keeps Acta in the menu bar (meeting detection keeps working).
    if (!quitting) { e.preventDefault(); win.hide(); }
  });
}

function show(pathname = '') {
  if (!win) createWindow();
  if (pathname) win.loadURL(`${URL}${pathname}`);
  win.show();
  win.focus();
}

async function newNote(record) {
  const body = JSON.stringify({});
  const id = await new Promise((resolve) => {
    const req = http.request(`${URL}/api/meetings`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d).id); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.end(body);
  });
  if (id) show(`/nota/${id}${record ? '?grabar=1' : ''}`);
}

function trayIcon(active) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><path d="M8 29 16.6 7h2.8L28 29h-4.2l-2-5.4h-7.6l-2 5.4Zm7.4-9h5.2L18 12.8Z" fill="#000"/>${active ? '<circle cx="30" cy="7" r="5" fill="#000"/>' : ''}</svg>`;
  const img = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({ width: 18, height: 18 });
  img.setTemplateImage(true);
  return img;
}

function refreshTray() {
  if (!tray) return;
  tray.setImage(trayIcon(!!recording));
  tray.setToolTip(recording ? 'Acta · transcribiendo' : 'Acta');
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(recording ? [{ label: 'Transcribiendo… abrir nota', click: () => show(`/nota/${recording}`) }, { type: 'separator' }] : []),
    { label: 'Nueva nota y transcribir', accelerator: 'CommandOrControl+Shift+N', click: () => void newNote(true) },
    { label: 'Nueva nota', click: () => void newNote(false) },
    { label: 'Abrir Acta', click: () => show() },
    { label: 'Pregunta a Acta', click: () => show('/preguntar') },
    { type: 'separator' },
    { label: 'Ajustes', click: () => show('/ajustes') },
    { label: 'Salir de Acta', click: () => { quitting = true; app.quit(); } },
  ]));
}

function watchEvents() {
  const connect = () => {
    let ws;
    try { ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); }
    catch { return; }
    ws.addEventListener('message', (ev) => {
      try {
        const raw = typeof ev.data === 'string' ? ev.data : '';
        if (!raw) return;
        const e = JSON.parse(raw);
        if (e.type === 'recording.status' && (e.status === 'recording' || e.status === 'paused')) { if (recording !== e.meetingId) { recording = e.meetingId; refreshTray(); } }
        if (e.type === 'recording.stopped') { recording = null; refreshTray(); }
        if (e.type === 'google.connected' || e.type === 'google.error') show();
      } catch { /* binary audio frames */ }
    });
    ws.addEventListener('close', () => { if (!quitting) setTimeout(connect, 2000); });
    ws.addEventListener('error', () => {});
  };
  connect();
}

app.setName('Acta');
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
app.on('second-instance', () => show());

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'display-capture'].includes(permission)));
  if (!(await ensureServer())) { app.quit(); return; }
  createWindow();
  tray = new Tray(trayIcon(false));
  refreshTray();
  watchEvents();
  globalShortcut.register('CommandOrControl+Shift+N', () => void newNote(true));
  const appMenu = Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'Archivo', submenu: [
      { label: 'Nueva nota', accelerator: 'CommandOrControl+N', click: () => win?.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown',{key:'n',metaKey:true}))") },
      { label: 'Buscar', accelerator: 'CommandOrControl+K', click: () => win?.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true}))") },
      { type: 'separator' }, { role: 'close' },
    ] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]);
  Menu.setApplicationMenu(appMenu);
});

ipcMain.on('notify', (_e, { title, body, id }) => {
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => { show(); win?.webContents.send('notification-click', id); });
  n.show();
});

app.on('activate', () => show());
app.on('before-quit', () => {
  quitting = true;
  globalShortcut.unregisterAll();
  if (server) server.kill('SIGTERM');
});
