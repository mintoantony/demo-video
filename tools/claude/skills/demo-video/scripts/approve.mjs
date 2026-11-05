#!/usr/bin/env node
// approve.mjs <walkthrough.mjs>  - records that the user said yes to storyboard.md.
// Run it only after the user has read the storyboard and agreed.
// It writes storyboard.approved.json next to the script, holding the script's sha256.
// If the script changes afterwards, recording refuses until you approve again.
import fs from 'node:fs';
import path from 'node:path';
import { resolveScript, scriptHash } from './recorder.mjs';

const arg = process.argv[2];
if (!arg) { console.error('Usage: node approve.mjs <walkthrough.mjs> [planDir]'); process.exit(2); }
const sp = resolveScript(arg);
if (!fs.existsSync(sp)) { console.error(`Script not found: ${sp}`); process.exit(2); }
const dir = path.resolve(process.argv[3] || path.dirname(sp));
if (!fs.existsSync(path.join(dir, 'storyboard.md'))) {
  console.error(`No storyboard.md in ${dir}. Run the plan phase first (DEMO_MODE=plan node ${path.basename(sp)}).`);
  process.exit(2);
}
const sha = scriptHash(sp);
const file = path.join(dir, 'storyboard.approved.json');
fs.writeFileSync(file, JSON.stringify({ approved: true, script: path.basename(sp), scriptSha256: sha, approvedAt: new Date().toISOString() }, null, 2));
console.log(`Approved. Hash: ${sha}`);
console.log(`Marker: ${file}`);
