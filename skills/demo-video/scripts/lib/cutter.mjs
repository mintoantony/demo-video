// cutter.mjs - find ffmpeg, cut one clip per card or chapter out of its segment video, join them into full.mp4.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { firstLine } from './util.mjs';
import { segFile } from './segments.mjs';

// Find ffmpeg: DEMO_FFMPEG (the value "none" disables it), then PATH, then the voice-over's imageio-ffmpeg.
// Detected only, never installed. Returns a command or path, or null.
export function findFfmpeg() {
  const works = (cmd) => { try { return spawnSync(cmd, ['-version'], { encoding: 'utf8' }).status === 0; } catch { return false; } };
  const env = (process.env.DEMO_FFMPEG || '').trim();
  if (env) {
    if (env.toLowerCase() === 'none') return null;
    if (works(env)) return env;
  }
  if (works('ffmpeg')) return 'ffmpeg';
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const venv = path.join(here, '..', '..', '..', 'demo-voiceover', '.venv');
    const py = [path.join(venv, 'Scripts', 'python.exe'), path.join(venv, 'bin', 'python')].find((p) => fs.existsSync(p));
    if (py) {
      const r = spawnSync(py, ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' });
      const exe = (r.stdout || '').trim().split(/\r?\n/).pop();
      if (r.status === 0 && exe && works(exe)) return exe;
    }
  } catch { /* no voice-over environment */ }
  return null;
}

// Returns { mode: 'clips' | 'segments', ffmpeg: {...} }.
export function cutClips(S) {
  const { ff, clips, runDir } = S;
  let mode = 'segments';
  let ffmpeg = { available: false, mode, note: 'ffmpeg was not found on PATH (or is disabled with DEMO_FFMPEG=none), so there is no single full.mp4 and no per-chapter clips. Chapters share segment videos; player.html seeks to each chapter.' };
  if (!(ff && clips.length)) return { mode, ffmpeg };
  let cutFailed = '';
  for (const c of clips) {
    const src = segFile(S, c.segment);
    if (!fs.existsSync(src)) { cutFailed = `segment ${c.segment} video is missing`; break; }
    const r = spawnSync(ff, ['-y', '-i', src, '-ss', String(c.segStart), '-to', String(c.segEnd),
      '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '2M', '-an', path.join(runDir, c.file)], { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status !== 0) { cutFailed = `cutting ${c.file}: ${firstLine(r.stderr)}`; break; }
  }
  if (cutFailed) return { mode, ffmpeg: { available: true, mode, path: ff, note: `ffmpeg was found but failed (${cutFailed}); falling back to segment videos.` } };
  mode = 'clips';
  fs.writeFileSync(path.join(runDir, 'concat.txt'), clips.map((c) => `file '${c.file}'`).join('\n') + '\n');
  const r = spawnSync(ff, ['-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', 'full.mp4'], { cwd: runDir, encoding: 'utf8', maxBuffer: 1 << 26 });
  ffmpeg = r.status === 0
    ? { available: true, mode, path: ff, note: 'full.mp4 written with ffmpeg.' }
    : { available: true, mode, path: ff, note: `ffmpeg was found but joining failed: ${firstLine(r.stderr)}` };
  return { mode, ffmpeg };
}
