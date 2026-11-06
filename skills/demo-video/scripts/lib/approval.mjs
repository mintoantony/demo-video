// approval.mjs - script identity (sha256) and the approval gate that stops recording until the user has confirmed.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

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
  return { approval: m, hash: now };
}
