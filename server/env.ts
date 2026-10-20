// Paths and secrets.
// Development walks parent folders for .env.local (closest wins) and never overrides
// variables already in the environment. The packaged app does not: keys live in Settings,
// and a Google OAuth client is included only when it was passed at build time.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const PACKAGED = process.env.ACTA_PACKAGED === '1';

/** Folder that contains server/, web/ and bin/ (the repo in dev, Resources/app when packaged). */
export const ROOT = process.env.ACTA_RESOURCES
  ? path.resolve(process.env.ACTA_RESOURCES)
  : path.resolve(here, '..');

export const DATA_DIR = process.env.ACTA_DATA_DIR || path.join(ROOT, 'data');
export const AUDIO_DIR = path.join(DATA_DIR, 'audio');
export const EXPORT_DIR = path.join(DATA_DIR, 'exports');
export const IMPORT_DIR = path.join(DATA_DIR, 'imports');
const helperFile = process.platform === 'win32' ? 'acta-audio.exe' : 'acta-audio';
export const HELPER_BIN = process.env.ACTA_HELPER || path.join(ROOT, 'bin', helperFile);
export const PORT = Number(process.env.ACTA_PORT || (PACKAGED ? 47331 : 4848));

for (const dir of [DATA_DIR, AUDIO_DIR, EXPORT_DIR, IMPORT_DIR]) fs.mkdirSync(dir, { recursive: true });

export type GoogleBuildConfig = { clientId?: string; clientSecret?: string; redirectUri?: string };
export type BuildConfig = { google?: GoogleBuildConfig };

function readBuildConfig(): BuildConfig {
  try {
    const file = path.join(ROOT, 'build-config.json');
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export const buildConfig: BuildConfig = readBuildConfig();

export const envSources: Record<string, string> = {};

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

if (!PACKAGED) {
  let dir = ROOT;
  for (let i = 0; i < 6; i++) {
    const f = path.join(dir, '.env.local');
    if (fs.existsSync(f)) {
      const vars = parseEnv(fs.readFileSync(f, 'utf8'));
      for (const [k, v] of Object.entries(vars)) {
        if (process.env[k] === undefined) {
          process.env[k] = v;
          envSources[k] = f;
        }
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}
