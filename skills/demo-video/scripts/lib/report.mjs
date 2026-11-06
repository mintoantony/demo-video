// report.mjs - frame-quality summary text and the results.json / report.md / chapters.* files.
import fs from 'node:fs';
import path from 'node:path';
import { mmss, firstLine } from './util.mjs';
import { segFile } from './segments.mjs';
import { cutClips } from './cutter.mjs';
import { playerHtml } from './player.mjs';

export function frameQualityMd(fq) {
  if (!fq.enabled) return ['Frame monitor was switched off for this run.'];
  const out = [
    `Checked ${fq.samples} frames in ${fq.clipsChecked} clips (about one every 0.4 s).`, '',
    `- Blank frames with no caption or card text: ${fq.blankFrameRuns}`,
    `- Identical frame held too long without a reason: ${fq.unjustifiedStaticRuns}`,
    `- Long holds that are fine (long text to read): ${fq.justifiedLongHolds}`,
    `- Progress notes shown during long actions: ${fq.progressNotes}`,
    `- Slowest first content in a clip: ${fq.maxFirstContentMs} ms`,
  ];
  for (const c of fq.perClip) {
    for (const b of c.blankFrames) out.push(`- VIOLATION blank in ${c.clip}: ${b.start}-${b.end} s`);
    for (const r of c.unjustified) out.push(`- VIOLATION static in ${c.clip}: ${r.start}-${r.end} s (${r.duration} s)`);
  }
  return out;
}

export function summarise(S) {
  const { chapters, clips, steps } = S;
  return {
    chapters: chapters.length,
    clips: clips.length,
    steps: steps.length,
    pass: steps.filter((s) => s.status === 'PASS').length,
    different: steps.filter((s) => s.status === 'DIFFERENT').length,
    couldNot: steps.filter((s) => s.status === 'COULD NOT DO').length,
  };
}

export function frameQuality(S) {
  if (!S.o.frameMonitor) return { enabled: false };
  const perClip = S.clips.filter((c) => c.frames).map((c) => ({
    clip: c.file, samples: c.frames.samples, firstContentMs: c.frames.firstContentMs,
    blankFrames: c.frames.blankFrames, unjustified: c.frames.unjustified, justifiedLongHolds: c.frames.justifiedLongHolds,
  }));
  return {
    enabled: true, clipsChecked: perClip.length, samples: perClip.reduce((a, c) => a + c.samples, 0),
    blankFrameRuns: perClip.reduce((a, c) => a + c.blankFrames.length, 0),
    unjustifiedStaticRuns: perClip.reduce((a, c) => a + c.unjustified.length, 0),
    justifiedLongHolds: perClip.reduce((a, c) => a + c.justifiedLongHolds.length, 0),
    progressNotes: S.steps.reduce((a, s) => a + (s.progressNotes || 0), 0),
    maxFirstContentMs: Math.max(0, ...perClip.map((c) => c.firstContentMs ?? 0)),
    perClip,
  };
}

// Copy every saved segment video into clips/ as segment-N.webm.
function copySegments(S) {
  for (const seg of S.segments) {
    if (!seg.saved) continue;
    try { fs.copyFileSync(segFile(S, seg.index), path.join(S.clipsDir, `segment-${seg.index}.webm`)); }
    catch (e) { S.notes.push(`segment ${seg.index} copy: ${firstLine(e.message)}`); }
  }
}

export function writeOutputs(S) {
  const { o, clips, steps, chapters, notes, runDir, clipsDir, shotsDir, startedAt } = S;
  const summary = summarise(S);
  const total = clips.reduce((a, c) => a + c.durationSec, 0);
  const { mode, ffmpeg } = cutClips(S);

  if (mode === 'segments') {
    // Every clip points at its shared segment video instead.
    const remap = new Map();
    for (const c of clips) { const f = `clips/segment-${c.segment}.webm`; remap.set(c.file, f); c.file = f; }
    for (const s of steps) if (s.clip && remap.has(s.clip)) s.clip = remap.get(s.clip);
    for (const c of chapters) if (remap.has(c.clip)) c.clip = remap.get(c.clip);
    copySegments(S);
  }

  const fullWritten = mode === 'clips' && ffmpeg.note.startsWith('full');
  const timeline = clips.map((c) => ({
    index: c.n, kind: c.kind, title: c.title, file: c.file, start: c.startSec, startText: mmss(c.startSec), duration: c.durationSec,
    segment: c.segment, segStart: c.segStart, segEnd: c.segEnd,
  }));

  const fq = frameQuality(S);
  const results = {
    title: o.title, subtitle: o.subtitle, baseUrl: o.baseUrl, viewport: o.viewport,
    startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
    totalSeconds: +total.toFixed(1), mode, summary, ffmpeg, frameQuality: fq, notes, chapters, clips, steps,
  };
  fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(runDir, 'chapters.json'), JSON.stringify(timeline, null, 2));
  fs.writeFileSync(path.join(runDir, 'chapters.txt'), timeline.map((c) => `${c.startText}  ${c.title}  (${c.file})`).join('\n') + '\n');

  const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
  const md = [
    `# ${o.title}`, '', o.subtitle ? `${o.subtitle}\n` : '',
    `Run: ${startedAt.toISOString()} | Length: ${mmss(total)} | Steps: ${summary.steps} | As expected: ${summary.pass} | Different: ${summary.different} | Could not do: ${summary.couldNot}`, '',
    `Mode: ${mode === 'clips' ? 'clips (ffmpeg cut one clip per chapter and card from the shared segment videos)' : 'segments (chapters share segment videos; no per-chapter clips)'}`, '',
    '| Chapter | Step | Result | What was seen |', '|---|---|---|---|',
    ...steps.map((s) => `| ${cell(s.chapter)} | ${s.step}. ${cell(s.label)} | ${s.status} | ${cell(s.seen)} |`), '',
    '## Chapters in the combined video', '',
    ...timeline.map((c) => `- ${c.startText} ${c.title} (${c.file})`), '',
    '## Frame quality', '', ...frameQualityMd(fq), '',
    '## Files', '',
    '- player.html: open it in a browser; plays every clip in order, click a chapter to jump.',
    mode === 'clips' ? '- clips/: one webm per chapter and per card.' : '- clips/: one webm per segment (chapters share it); player.html seeks to each chapter.',
    '- shots/: one screenshot per step, caption visible.',
    `- full.mp4: ${fullWritten ? 'written.' : 'not written. ' + ffmpeg.note}`,
    ...(notes.length ? ['', '## Notes', '', ...notes.map((x) => `- ${x}`)] : []), '',
  ].join('\n');
  fs.writeFileSync(path.join(runDir, 'report.md'), md);
  fs.writeFileSync(path.join(runDir, 'player.html'), playerHtml(o.title, timeline, mode === 'segments'));

  return { runDir, clipsDir, shotsDir, report: path.join(runDir, 'report.md'), results: path.join(runDir, 'results.json'), player: path.join(runDir, 'player.html'), fullMp4: fullWritten ? path.join(runDir, 'full.mp4') : null, ffmpeg, summary, clips: timeline };
}