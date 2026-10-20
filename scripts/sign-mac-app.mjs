// Developer ID signing. Skipped unless ACTA_CODESIGN_IDENTITY is set.
// Ad-hoc signing (codesign -s -) is done by package-mac.sh when this is not used.
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { signApp } = require('@electron/osx-sign');

const app = process.argv[2];
const identity = process.env.ACTA_CODESIGN_IDENTITY || '';
if (!app || !identity) {
  console.error('Uso: ACTA_CODESIGN_IDENTITY="Developer ID Application: Nombre (TEAMID)" node scripts/sign-mac-app.mjs Acta.app');
  process.exit(1);
}
const root = process.cwd();
const helper = path.join(app, 'Contents', 'Resources', 'app', 'bin', 'acta-audio');
const entitlements = path.join(root, 'electron', 'entitlements.mac.plist');
await signApp({
  app: path.resolve(app),
  identity,
  platform: 'darwin',
  hardenedRuntime: true,
  entitlements,
  binaries: [helper],
  preEmbedProvisioningProfile: false,
});
console.log(`Firmada con ${identity}`);
