// Cross-platform staging: web build + bundled server + Electron shell sources.
// Does not include the Swift capturer or the Electron macOS binary.
import { spawnSync } from 'node:child_process';
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const payload = path.join(root, 'dist', 'payload');
fs.rmSync(payload, { recursive: true, force: true });
fs.mkdirSync(path.join(payload, 'electron'), { recursive: true });

const vite = spawnSync('npx', ['vite', 'build'], { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' });
if (vite.status !== 0) process.exit(vite.status ?? 1);

await esbuild.build({
  entryPoints: ['server/index.ts', 'server/mcp.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outdir: path.join(payload, 'server'),
  external: ['vite'],
  sourcemap: true,
  legalComments: 'linked',
  logLevel: 'info',
  // Some CJS dependencies (debug) call require() inside try/catch. Give that a real require.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

fs.cpSync(path.join(root, 'web', 'dist'), path.join(payload, 'web', 'dist'), { recursive: true });
for (const file of ['main.cjs', 'preload.cjs', 'Info.plist']) {
  fs.copyFileSync(path.join(root, 'electron', file), path.join(payload, 'electron', file));
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(payload, 'package.json'), JSON.stringify({
  name: 'acta',
  productName: 'Acta',
  version: pkg.version,
  private: true,
  description: pkg.description,
  main: 'electron/main.cjs',
  type: 'module',
}, null, 2) + '\n');

const id = (process.env.ACTA_GOOGLE_CLIENT_ID || '').trim();
const secret = (process.env.ACTA_GOOGLE_CLIENT_SECRET || '').trim();
const redirect = (process.env.ACTA_GOOGLE_REDIRECT_URI || '').trim();
if ((id && !secret) || (!id && secret)) {
  console.error('Define ACTA_GOOGLE_CLIENT_ID y ACTA_GOOGLE_CLIENT_SECRET juntos, o ninguno.');
  console.error('Este script no lee .env.local. Exporta las variables solo si quieres incluirlas en la app.');
  process.exit(1);
}
fs.writeFileSync(path.join(payload, 'build-config.json'), JSON.stringify({
  google: { clientId: id, clientSecret: secret, redirectUri: redirect },
}, null, 2) + '\n');

if (id) console.log('Google OAuth: incluido en esta build.');
else console.log('Google OAuth: desactivado. «Conectar con Google» no aparecerá.');
console.log(`Payload listo: ${payload}`);
