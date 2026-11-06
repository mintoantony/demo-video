// approval.mjs - script identity (sha256) and the approval gate that stops recording until the user has confirmed.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ENGINE_VERSION } from './version.mjs';

export function resolveScript(p) {
  if (!p) throw new Error('No script path given.');
  const s = String(p);
  return path.resolve(s.startsWith('file:') ? fileURLToPath(s) : s);
}

export function scriptHash(p) {
  return createHash('sha256').update(fs.readFileSync(resolveScript(p))).digest('hex');
}

// Nothing is recorded until the user has confirmed the storyboard, and the
// confirmation is tied to this exact script (sha256). Throws when not approved.
export function checkApproval(o) {
  if (!o.scriptPath) throw new Error('Recording needs the option scriptPath (use import.meta.url) so the approval can be checked. Not recording.');
  const sp = resolveScript(o.scriptPath);
  const marker = path.join(o.planDir ? path.resolve(o.planDir) : path.dirname(sp), 'storyboard.approved.json');
  if (!fs.existsSync(marker)) {
    throw new Error(`Not approved: ${marker} does not exist. Run the plan phase (DEMO_MODE=plan), show the user storyboard.md, and approve it (node approve.mjs <script>) before recording.`);
  }
  let m = {};
  try { m = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch { /* treated as invalid below */ }
  const now = scriptHash(sp);
  if (!m.approved || m.scriptSha256 !== now) {
    throw new Error('The script changed after approval (or the approval file is invalid). Re-confirm: run the plan phase again, show the user the new storyboard.md, and approve it again. Not recording.');
  }
  const want = o.approvedHash || process.env.DEMO_APPROVED_HASH;
  if (want && !now.startsWith(String(want).toLowerCase())) {
    throw new Error('The script does not match the approved hash given in the brief. Re-confirm with the user. Not recording.');
  }
  const engineNote = checkEngine(m.engineVersion, 'the approval file');
  const wantEngine = o.approvedEngine || process.env.DEMO_APPROVED_ENGINE;
  const briefNote = wantEngine ? checkEngine(wantEngine, 'the brief') : null;
  return { approval: m, hash: now, engineWarnings: [engineNote, briefNote].filter(Boolean) };
}

const majorMinor = (v) => { const x = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || '')); return x ? { mm: `${x[1]}.${x[2]}`, patch: Number(x[3]) } : null; };

// Compares the engine now running with the one that was approved. Different major.minor (or no
// version at all, as in an old approval file) refuses; a patch-only difference returns a warning.
export function checkEngine(approved, where, current = ENGINE_VERSION) {
  const a = majorMinor(approved);
  const c = majorMinor(current);
  if (!a) throw new Error(`The engine changed since you approved. Re-plan and confirm. (${where} records no engine version, so it was approved with an older engine; now ${current}. Not recording.)`);
  if (a.mm !== c.mm) throw new Error(`The engine changed since you approved. Re-plan and confirm. (approved with ${approved} in ${where}, now ${current}. Not recording.)`);
  if (String(approved) !== String(current)) return `Engine patch difference: approved with ${approved} in ${where}, recorded with ${current}. Same major.minor, so recording went ahead.`;
  return null;
}
