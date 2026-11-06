// segments.mjs - one browser context, one page, one video per segment. Cards and chapters are time ranges in it.
import fs from 'node:fs';
import path from 'node:path';
import { captionInit } from './overlay.mjs';
import { analyseFrames } from './monitor.mjs';
import { pad2, slugify, firstLine } from './util.mjs';

export const isLive = (seg) => /^https?:/i.test(seg.page.url());
export const segFile = (S, i) => path.join(S.tmpDir, `segment-${i}.webm`);

// Write (or clear, with null) the caption/card state the init script draws. Survives navigations.
export async function apply(seg, s) {
  seg.state.current = s;
  try {
    await seg.page.evaluate((v) => {
      try { if (v) sessionStorage.setItem('__demoCap', JSON.stringify(v)); else sessionStorage.removeItem('__demoCap'); } catch (e) { /* storage blocked */ }
      if (window.__demoRender) window.__demoRender();
    }, s);
  } catch { /* mid navigation: the hooks below re-apply */ }
}

export async function openSegment(S, fresh) {
  const ctxOpts = { viewport: S.o.viewport, recordVideo: { dir: S.tmpDir, size: S.o.viewport } };
  if (!fresh && S.storage) ctxOpts.storageState = S.storage;
  const ctx = await S.browser.newContext(ctxOpts);
  await ctx.addInitScript(captionInit, {});
  const started = Date.now();
  const page = await ctx.newPage();
  const seg = { index: S.segments.length + 1, ctx, page, started, mon: null, items: [], firstContentMs: null, state: { current: null, navs: 0 } };
  const reapply = () => { if (seg.state.current) apply(seg, seg.state.current); };
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) { seg.state.navs += 1; reapply(); } });
  page.on('domcontentloaded', reapply);
  page.on('load', reapply);
  if (S.o.frameMonitor) seg.mon = S.startMonitor(page, started);
  S.segments.push(seg);
  S.curSeg = seg;
  return seg;
}

// A card or a chapter: a time range [startSec, endSec) in its segment's video.
export function newItem(S, seg, kind, title) {
  const prev = seg.items[seg.items.length - 1];
  S.n += 1;
  const slug = slugify(kind === 'chapter' ? title : kind);
  const it = {
    n: S.n, kind, title, seg, endSec: null,
    startSec: prev ? (prev.endSec ?? (Date.now() - seg.started) / 1000) : 0,
    file: S.ff ? `clips/${pad2(S.n)}-${slug}.webm` : `clips/segment-${seg.index}.webm`,
  };
  seg.items.push(it);
  S.items.push(it);
  return it;
}
export const endItem = (seg, it) => { it.endSec = (Date.now() - seg.started) / 1000; };

export async function closeSegment(S) {
  const seg = S.curSeg;
  if (!seg) return;
  S.curSeg = null; S.cur = null;
  const endSec = (Date.now() - seg.started) / 1000;
  if (seg.mon) { try { await seg.mon.stop(); } catch { /* ignore */ } }
  try { S.storage = await seg.ctx.storageState(); } catch { /* ignore */ }
  const video = seg.page.video();
  await seg.ctx.close();
  seg.durationSec = endSec;
  seg.saved = false;
  try {
    fs.renameSync(await video.path(), segFile(S, seg.index));
    seg.saved = true;
  } catch (e) {
    S.notes.push(`Segment ${seg.index} video could not be saved: ${firstLine(e.message)}`);
  }
  const last = seg.items[seg.items.length - 1];
  if (last) last.endSec = endSec;
  seg.items.forEach((it, i) => {
    if (it.endSec == null) it.endSec = endSec;
    let frames = null;
    if (seg.mon) {
      const samples = seg.mon.samples.filter((x) => x.t >= it.startSec && x.t < it.endSec).map((x) => ({ ...x, t: x.t - it.startSec }));
      frames = { ...analyseFrames(samples, { maxStaticSec: S.o.maxHold / 1000, wordsPerSec: S.o.wordsPerSec }), firstContentMs: i === 0 ? (seg.firstContentMs ?? 0) : 0 };
    }
    const startSec = S.clips.reduce((a, c) => a + c.durationSec, 0);
    const clip = {
      n: it.n, kind: it.kind, title: it.title, file: it.file,
      durationSec: +(it.endSec - it.startSec).toFixed(2), startSec: +startSec.toFixed(2),
      segment: seg.index, segStart: +it.startSec.toFixed(2), segEnd: +it.endSec.toFixed(2),
    };
    if (frames) clip.frames = frames;
    S.clips.push(clip);
  });
}
