// Starts the packaged server bundle and checks it does not inherit walked .env.local secrets.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const payload = path.join(root, 'dist', 'payload');
const entry = path.join(payload, 'server', 'index.js');
if (!fs.existsSync(entry)) {
  console.error('No está dist/payload. Ejecuta npm run build:payload');
  process.exit(1);
}

const secretNames = ['GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPGRAM_API_KEY', 'ACTA_GOOGLE_CLIENT_ID', 'ACTA_GOOGLE_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
const cleanEnv = { ...process.env };
for (const name of secretNames) delete cleanEnv[name];

const decoy = 'from-dotenv-local-should-not-load';
fs.writeFileSync(path.join(payload, '.env.local'), `GROQ_API_KEY=${decoy}\nACTA_GOOGLE_CLIENT_ID=should-not\nACTA_GOOGLE_CLIENT_SECRET=should-not\n`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', '.env.local'), `OPENAI_API_KEY=${decoy}\n`);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acta-smoke-'));
const port = 47399;
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', entry], {
  cwd: payload,
  env: {
    ...cleanEnv,
    ACTA_PACKAGED: '1',
    ACTA_DATA_DIR: dataDir,
    ACTA_RESOURCES: payload,
    ACTA_PORT: String(port),
    ACTA_INSTANCE: 'smoke',
    ACTA_ELECTRON_EXEC: '/Applications/Acta.app/Contents/MacOS/Acta',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', (d) => { logs += d; });
child.stderr.on('data', (d) => { logs += d; });

const base = `http://127.0.0.1:${port}`;
async function waitForHealth() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`el servidor salió con ${child.exitCode}\n${logs}`);
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return await res.json();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`el servidor no respondió\n${logs}`);
}

function fail(msg) {
  console.error(msg);
  console.error(logs);
  process.exitCode = 1;
}

try {
  const health = await waitForHealth();
  if (health.app !== 'acta' || health.packaged !== true || health.instance !== 'smoke') fail(`health inesperado: ${JSON.stringify(health)}`);
  const settings = await (await fetch(`${base}/api/settings`)).json();
  for (const name of ['GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPGRAM_API_KEY']) {
    if (settings.keys[name]?.set) fail(`${name} está configurada en la app empaquetada sin que el usuario la pegue`);
    if (String(settings.keys[name]?.masked || '').includes(decoy)) fail(`${name} filtró el valor de .env.local`);
  }
  if (settings.googleConfigured) fail('Google OAuth aparece configurado sin client id de build');
  const accounts = await (await fetch(`${base}/api/google/accounts`)).json();
  if (accounts.configured) fail('/api/google/accounts.configured es true');
  if (settings.userName !== '') fail(`userName por defecto debería estar vacío, es ${JSON.stringify(settings.userName)}`);
  if (settings.dataDir !== dataDir) fail(`DATA_DIR ${settings.dataDir} != ${dataDir}`);
  for (const sub of ['', 'audio', 'exports', 'imports']) {
    const dir = path.join(dataDir, sub);
    if (!fs.existsSync(dir)) fail(`no se creó ${dir}`);
  }
  if (!fs.existsSync(path.join(dataDir, 'acta.db'))) fail('no se creó acta.db');
  const home = await fetch(`${base}/`);
  const html = await home.text();
  if (!home.ok || !html.includes('<title>Acta</title>')) fail('la UI empaquetada no se sirve');
  const created = await (await fetch(`${base}/api/meetings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  if (!created.id) fail(`no se pudo crear una nota: ${JSON.stringify(created)}`);
  if (!String(settings.mcpCommand).includes('ELECTRON_RUN_AS_NODE=1')) fail(`mcpCommand inesperado: ${settings.mcpCommand}`);
  const state = await (await fetch(`${base}/api/state`)).json();
  if (!state.packaged) fail('state.packaged es false');

  const envFile = path.join(root, '.env.local');
  const backup = fs.existsSync(envFile) ? fs.readFileSync(envFile) : null;
  try {
    fs.writeFileSync(envFile, `GROQ_API_KEY=${decoy}\n`);
    const { spawnSync } = await import('node:child_process');
    const walked = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { envSources } from './server/env.ts';
      if (process.env.GROQ_API_KEY !== ${JSON.stringify(decoy)}) process.exit(3);
      if (!envSources.GROQ_API_KEY) process.exit(2);
    `], { cwd: root, env: cleanEnv, encoding: 'utf8' });
    if (walked.status !== 0) fail(`el modo desarrollo dejó de leer .env.local (status ${walked.status})\n${walked.stderr}`);
  } finally {
    if (backup) fs.writeFileSync(envFile, backup);
    else fs.rmSync(envFile, { force: true });
  }

  if (!process.exitCode) console.log('smoke ok');
} catch (err) {
  fail(err?.stack || String(err));
} finally {
  child.kill('SIGTERM');
  fs.rmSync(path.join(payload, '.env.local'), { force: true });
  fs.rmSync(path.join(root, 'dist', '.env.local'), { force: true });
  await Promise.race([
    new Promise((r) => child.on('exit', r)),
    new Promise((r) => setTimeout(() => { child.kill('SIGKILL'); r(); }, 4000)),
  ]);
}
process.exit(process.exitCode || 0);
