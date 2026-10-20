// Merges the arm64 and x64 Acta.app bundles. macOS only (lipo via @electron/universal).
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { makeUniversalApp } = require('@electron/universal');

const [x64, arm64, out] = process.argv.slice(2);
if (!x64 || !arm64 || !out) {
  console.error('Uso: node scripts/make-universal.mjs <x64.app> <arm64.app> <salida.app>');
  process.exit(1);
}
await makeUniversalApp({
  x64AppPath: path.resolve(x64),
  arm64AppPath: path.resolve(arm64),
  outAppPath: path.resolve(out),
  force: true,
});
console.log(`App universal: ${path.resolve(out)}`);
