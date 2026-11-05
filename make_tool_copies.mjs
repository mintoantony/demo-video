// Builds the install copies under tools/claude from the sources.
//   node make_tool_copies.mjs          writes the copies
//   node make_tool_copies.mjs --check  exits 1 if a copy is missing or stale
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const check = process.argv.includes('--check');
const out = path.join(root, 'tools', 'claude');
let stale = 0;

function put(dest, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const same = fs.existsSync(dest) && fs.readFileSync(dest).equals(buf);
  if (check) {
    if (!same) { console.log('STALE  ' + path.relative(root, dest)); stale += 1; }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!same) fs.writeFileSync(dest, buf);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

// the agent
put(path.join(out, 'agents', 'demo-video-recorder.md'), fs.readFileSync(path.join(root, 'AGENTS.md')));

// the skill: self-contained (SKILL.md, scripts, references) plus a package.json for npm install
const skillSrc = path.join(root, 'skills', 'demo-video');
const skillDest = path.join(out, 'skills', 'demo-video');
const wanted = new Set();
for (const f of walk(skillSrc)) {
  const rel = path.relative(skillSrc, f);
  wanted.add(rel);
  put(path.join(skillDest, rel), fs.readFileSync(f));
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const skillPkg = { name: 'demo-video-skill', private: true, type: 'module', dependencies: pkg.dependencies };
put(path.join(skillDest, 'package.json'), JSON.stringify(skillPkg, null, 2) + '\n');
wanted.add('package.json');

// files in the copy that no longer exist in the source are stale too
if (fs.existsSync(skillDest)) {
  for (const f of walk(skillDest)) {
    const rel = path.relative(skillDest, f);
    if (rel.startsWith('node_modules')) continue;
    if (!wanted.has(rel)) {
      if (check) { console.log('STALE  extra file ' + rel); stale += 1; } else fs.rmSync(f);
    }
  }
}

// the voice-over skill: scripts and docs only, never .venv, voices or caches
const skip = (rel) => rel.split(path.sep).some((s) => ['.venv', '.uv-bootstrap', '.wheelcheck', 'voices', '__pycache__'].includes(s)) || rel.endsWith('.pyc');
const voSrc = path.join(root, 'skills', 'demo-voiceover');
const voDest = path.join(out, 'skills', 'demo-voiceover');
const voWanted = new Set();
for (const f of walk(voSrc)) {
  const rel = path.relative(voSrc, f);
  if (skip(rel)) continue;
  voWanted.add(rel);
  put(path.join(voDest, rel), fs.readFileSync(f));
}
if (fs.existsSync(voDest)) {
  for (const f of walk(voDest)) {
    const rel = path.relative(voDest, f);
    if (skip(rel)) continue;
    if (!voWanted.has(rel)) {
      if (check) { console.log('STALE  extra file ' + rel); stale += 1; } else fs.rmSync(f);
    }
  }
}

if (check) {
  console.log(stale ? `${stale} stale file(s). Run: node make_tool_copies.mjs` : 'Copies are up to date.');
  process.exit(stale ? 1 : 0);
}
console.log('Wrote ' + path.relative(root, out));
