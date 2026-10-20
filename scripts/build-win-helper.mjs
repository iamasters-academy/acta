// Compiles native/win/acta-audio.cpp to a Windows x64 executable.
// On Windows, uses the installed Visual Studio C++ tools.
// Elsewhere, uses the MinGW cross compiler (x86_64-w64-mingw32-g++).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = path.join(root, 'native', 'win', 'acta-audio.cpp');
const out = path.resolve(process.argv[2] || path.join(root, 'bin', 'acta-audio.exe'));
fs.mkdirSync(path.dirname(out), { recursive: true });

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });
  if (r.error) fail(r.error.message);
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!fs.existsSync(src)) fail(`No está ${src}`);

if (process.platform === 'win32') {
  const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!fs.existsSync(vswhere)) {
    fail('No encuentro vswhere. Instala Visual Studio con las herramientas de C++ (escritorio) y vuelve a ejecutar npm run build:native:win.');
  }
  const found = spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' });
  const install = (found.stdout || '').trim();
  if (!install) fail('No hay un Visual Studio con las herramientas de C++ para x64.');
  const vcvars = path.join(install, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  if (!fs.existsSync(vcvars)) fail(`No está ${vcvars}`);
  const cmd = `call "${vcvars}" && cl /nologo /EHsc /O2 /std:c++17 /DUNICODE /D_UNICODE /Fe:"${out}" "${src}" /link ole32.lib uuid.lib oleaut32.lib psapi.lib shell32.lib`;
  run('cmd.exe', ['/d', '/s', '/c', cmd]);
} else {
  const gxx = 'x86_64-w64-mingw32-g++';
  const which = spawnSync('command', ['-v', gxx], { shell: true, encoding: 'utf8' });
  if (which.status !== 0) {
    fail([
      'Falta el compilador cruzado de Windows (x86_64-w64-mingw32-g++).',
      'En Debian/Ubuntu: sudo apt-get install -y g++-mingw-w64-x86-64',
      'En un PC con Windows no hace falta: npm run build:native:win usa Visual Studio.',
    ].join('\n'));
  }
  run(gxx, [
    '-std=c++17', '-O2', '-static-libgcc', '-static-libstdc++', '-s',
    '-o', out, src,
    '-lole32', '-luuid', '-loleaut32', '-lpsapi', '-lshell32',
  ]);
}

if (!fs.existsSync(out)) fail(`La compilación no dejó ${out}`);
console.log(`Detector de Windows listo: ${out}`);
