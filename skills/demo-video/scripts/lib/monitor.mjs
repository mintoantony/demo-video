// monitor.mjs - frame sampling while recording, and the pure analyseFrames check.
import { createHash } from 'node:crypto';
import { sleep } from './util.mjs';

// Frame analysis. samples: [{ t (sec), hash, words, blank }]. Pure function, unit-tested.
// - blank run: consecutive samples that are near-uniform in colour and carry no caption/card text.
// - static run: consecutive samples with the same hash. Over maxStaticSec it is a violation,
//   unless the text on screen is long enough to need that time to read.
export function analyseFrames(samples, opts = {}) {
  const maxStaticSec = opts.maxStaticSec ?? 5;
  const wordsPerSec = opts.wordsPerSec ?? 3;
  const s = [...samples].sort((a, b) => a.t - b.t);
  const gaps = [];
  for (let i = 1; i < s.length; i++) gaps.push(s[i].t - s[i - 1].t);
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1;
  const r2 = (x) => +x.toFixed(2);

  const blankFrames = [];
  let run = null;
  for (const x of s) {
    const isBlank = x.blank && !(x.words > 0);
    if (isBlank) { if (!run) run = { start: x.t, end: x.t, count: 0 }; run.end = x.t; run.count += 1; }
    else if (run) { blankFrames.push({ start: r2(run.start), end: r2(run.end), count: run.count }); run = null; }
  }
  if (run) blankFrames.push({ start: r2(run.start), end: r2(run.end), count: run.count });

  const staticRuns = [];
  let g = null;
  const flush = () => {
    if (!g) return;
    const duration = g.last - g.first + medianGap;
    if (duration > maxStaticSec) {
      const allowed = Math.max(maxStaticSec, g.words / wordsPerSec + 1);
      staticRuns.push({ start: r2(g.first), end: r2(g.last + medianGap), duration: r2(duration), words: g.words, justified: duration <= allowed });
    }
    g = null;
  };
  for (const x of s) {
    if (g && g.hash === x.hash) { g.last = x.t; g.words = Math.max(g.words, x.words || 0); }
    else { flush(); g = { hash: x.hash, first: x.t, last: x.t, words: x.words || 0 }; }
  }
  flush();
  return {
    samples: s.length, blankFrames, staticRuns,
    unjustified: staticRuns.filter((r) => !r.justified),
    justifiedLongHolds: staticRuns.filter((r) => r.justified),
  };
}

// createMonitor(S) -> startMonitor(page, startedMs). Takes a small jpeg about every monitorMs and notes the caption word count.
// The blank check runs in a separate helper page (no video) so it never shows in a clip.
export function createMonitor(S) {
  let helper = null;
  const blankCache = new Map();
  async function blankCheck(hash, buf) {
    if (blankCache.has(hash)) return blankCache.get(hash);
    let blank = false;
    try {
      if (!helper) {
        const hctx = await S.browser.newContext({ viewport: { width: 200, height: 200 } });
        helper = { ctx: hctx, page: await hctx.newPage() };
      }
      const sd = await helper.page.evaluate(async (b64) => {
        const img = new Image();
        img.src = 'data:image/jpeg;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas'); c.width = 64; c.height = 36;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0, 64, 36);
        const d = x.getImageData(0, 0, 64, 36).data;
        let worst = 0;
        for (let ch = 0; ch < 3; ch++) {
          let sum = 0, sq = 0; const N = 64 * 36;
          for (let i = 0; i < N; i++) { const v = d[i * 4 + ch]; sum += v; sq += v * v; }
          const mean = sum / N; worst = Math.max(worst, Math.sqrt(Math.max(0, sq / N - mean * mean)));
        }
        return worst;
      }, buf.toString('base64'));
      blank = sd < 3;
    } catch { /* cannot judge: treat as not blank */ }
    blankCache.set(hash, blank);
    return blank;
  }

  function startMonitor(page, startedMs) {
    const samples = [];
    let stopFlag = false;
    const loop = (async () => {
      while (!stopFlag) {
        try {
          const buf = await page.screenshot({ type: 'jpeg', quality: 40, timeout: 3000 });
          const t = (Date.now() - startedMs) / 1000;
          const hash = createHash('sha1').update(buf).digest('hex').slice(0, 12);
          let w = 0;
          try {
            w = await page.evaluate(() => {
              const c = (id) => { const e = document.getElementById(id); return e ? e.innerText : ''; };
              const t1 = c('__demo_cap'); if (t1.trim()) return (t1.match(/\S+/g) || []).length;
              const t2 = c('__demo_intro'); if (t2.trim()) return (t2.match(/\S+/g) || []).length;
              const b = document.body ? document.body.innerText : '';
              return (b.match(/\S+/g) || []).length;
            });
          } catch { /* mid navigation */ }
          const blank = await blankCheck(hash, buf);
          samples.push({ t, hash, words: w, blank });
        } catch { /* page busy or closing: skip this sample */ }
        if (!stopFlag) await sleep(S.o.monitorMs);
      }
    })();
    return { samples, async stop() { stopFlag = true; await loop; } };
  }
  return { startMonitor, async closeHelper() { if (helper) { try { await helper.ctx.close(); } catch { /* ignore */ } } } };
}
