// Windows installer (NSIS, x64). Reuses the same payload as the Mac build:
// bundled server, Vite UI, and a build-config.json written only from
// ACTA_GOOGLE_CLIENT_ID / ACTA_GOOGLE_CLIENT_SECRET / ACTA_GOOGLE_REDIRECT_URI.
// Does not read .env.local.
//
//   npm install
//   npm run package:win
//
// On Linux this also needs MinGW (x86_64-w64-mingw32-g++) and 32-bit Wine
// (the NSIS stub is 32-bit). On Windows it uses Visual Studio's C++ tools.
// Output: dist/win/Acta-<version>-x64-Setup.exe
//
// Optional Authenticode signing (electron-builder reads these; omit both to ship unsigned):
//   CSC_LINK = base64 .pfx     CSC_KEY_PASSWORD = the pfx password
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, shell: false, ...opts });
  if (r.error) {
    console.error(r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!fs.existsSync(path.join(root, 'node_modules', 'electron', 'package.json'))) {
  console.error('Falta Electron. Ejecuta npm install en la raíz del repo.');
  process.exit(1);
}
if (!fs.existsSync(path.join(root, 'node_modules', 'electron-builder'))) {
  console.error('Falta electron-builder. Ejecuta npm install en la raíz del repo.');
  process.exit(1);
}

const electronVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
console.log(`Acta ${version} · Electron ${electronVersion} · Windows x64`);

run(process.execPath, ['scripts/build-payload.mjs']);

const helperOut = path.join(root, 'dist', 'payload', 'bin', 'acta-audio.exe');
run(process.execPath, ['scripts/build-win-helper.mjs', helperOut]);

const env = { ...process.env };
if (!env.CSC_LINK) env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';

run(process.execPath, [
  path.join(root, 'node_modules', 'electron-builder', 'cli.js'),
  '--win', 'nsis', '--x64',
  '--publish', 'never',
  '--config', 'electron-builder.yml',
  `--config.electronVersion=${electronVersion}`,
], { env });

const setup = path.join(root, 'dist', 'win', `Acta-${version}-x64-Setup.exe`);
if (!fs.existsSync(setup)) {
  console.error(`No se generó ${setup}`);
  process.exit(1);
}
console.log(`\nListo:\n  ${setup}`);
if (!process.env.CSC_LINK) {
  console.log('\nBuild sin firmar. Quien lo descargue verá el aviso de SmartScreen:');
  console.log('  Más información → Ejecutar de todas formas.');
}
