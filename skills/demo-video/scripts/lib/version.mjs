// version.mjs - the engine version: a semver plus a short hash of the engine's own source, computed at runtime.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ENGINE_SEMVER = '1.1.0';

function engineHash() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const files = fs.readdirSync(here).filter((f) => f.endsWith('.mjs')).sort().map((f) => path.join(here, f));
  files.push(path.join(here, '..', 'recorder.mjs'));
  const h = createHash('sha256');
  for (const f of files) {
    try { h.update(path.basename(f)).update(fs.readFileSync(f)); } catch { /* missing file: skip */ }
  }
  return h.digest('hex').slice(0, 8);
}

export const ENGINE_VERSION = `${ENGINE_SEMVER}+${engineHash()}`;
