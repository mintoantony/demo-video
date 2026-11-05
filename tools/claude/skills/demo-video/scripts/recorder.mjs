// recorder.mjs - generic walkthrough recording engine (Playwright, webm clips).
//
// One browser context and one page per segment: chapters share it, so unsaved input survives. A segment ends only on `fresh: true` or finish().
// A caption bar is drawn into the page and re-applied after every navigation.
// Nothing here knows about any particular app.
//
//   import { createRecorder } from './recorder.mjs';
//   const rec = await createRecorder({ title, subtitle, baseUrl });
//   await rec.titleCard();
//   await rec.chapter('Sign in', { actor: 'Alex Example' }, async ({ page, step }) => { ... });
//   await rec.closingCard();
//   const out = await rec.finish();

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad2 = (n) => String(n).padStart(2, '0');
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'clip';
const mmss = (sec) => `${pad2(Math.floor(sec / 60))}:${pad2(Math.floor(sec % 60))}`;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const firstLine = (s) => String(s ?? '').split('\n')[0].slice(0, 300);

function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

// Runs inside every page (browser side), before the page's own scripts.
// Draws (1) a full-screen chapter intro card until arg.until, so the first paint is never empty,
// and (2) the caption bar from sessionStorage. A MutationObserver puts both on screen at first paint.
function captionInit(arg) {
  const ID = '__demo_cap';
  const IID = '__demo_intro';
  const E = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // A card (chapter intro or closing card) is a full-screen overlay driven by the same
  // sessionStorage state as the caption bar, so it survives navigations and never replaces the page.
  function drawCard(s) {
    let el = document.getElementById(IID);
    if (!s || !s.card) { if (el) el.remove(); return false; }
    if (!document.documentElement) return true;
    if (!el) {
      el = document.createElement('div');
      el.id = IID;
      el.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;background:#0b1530;color:#fff;' +
        'font-family:Segoe UI,Arial,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;';
      document.documentElement.appendChild(el);
    }
    const key = JSON.stringify(s.card);
    if (el.getAttribute('data-key') !== key) {
      let h = '<div style="font-size:64px;font-weight:700;color:#ffd400;max-width:80%">' + E(s.card.title) + '</div>';
      (s.card.lines || []).forEach((l) => { h += '<div style="font-size:34px;margin-top:22px;max-width:80%">' + E(l) + '</div>'; });
      el.innerHTML = h;
      el.setAttribute('data-key', key);
    }
    return true;
  }
  function render() {
    try {
      let raw = null;
      try { raw = sessionStorage.getItem('__demoCap'); } catch (e) { /* storage blocked */ }
      let el = document.getElementById(ID);
      if (!raw) { if (el) el.remove(); drawCard(null); return; }
      if (!document.documentElement) return;
      const s = JSON.parse(raw);
      if (drawCard(s)) {
        if (el) el.remove();
        document.documentElement.style.paddingBottom = '0px';
        return;
      }
      if (!el) {
        el = document.createElement('div');
        el.id = ID;
        el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483646;pointer-events:none;' +
          'background:rgba(8,14,34,0.96);border-top:8px solid #ffd400;padding:14px 36px 16px;' +
          'font-family:Segoe UI,Arial,sans-serif;line-height:1.3;box-sizing:border-box;';
        (document.body || document.documentElement).appendChild(el);
      }
      if (el.getAttribute('data-key') !== raw) {
        let h = '';
        h += '<div style="font-size:28px;font-weight:700;color:#ffd400">' + E(s.kicker) + (s.who ? ' | Acting as: ' + E(s.who) : '') + '</div>';
        if (s.step) h += '<div style="font-size:32px;font-weight:700;color:#fff">' + E(s.step) + '</div>';
        if (s.expect) h += '<div style="font-size:28px;color:#9fe8ff">You should see: ' + E(s.expect) + '</div>';
        if (s.result) {
          const c = s.status === 'PASS' ? '#5dff9a' : s.status === 'DIFFERENT' ? '#ffb347' : s.status === 'WAIT' ? '#9fe8ff' : '#ff6b6b';
          h += '<div style="font-size:26px;font-weight:700;color:' + c + '">' + E(s.result) + '</div>';
        }
        el.innerHTML = h;
        el.setAttribute('data-key', raw);
      }
      document.documentElement.style.paddingBottom = Math.min(300, el.offsetHeight) + 'px';
    } catch (e) { /* never break the page */ }
  }
  function all() { render(); }
  window.__demoRender = all;
  try {
    const mo = new MutationObserver(all);
    mo.observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => { all(); mo.disconnect(); });
  } catch (e) { document.addEventListener('DOMContentLoaded', all); }
  setInterval(all, 400);
  all();
}

function cardHtml(title, lines) {
  return '<!doctype html><html><head><meta charset="utf-8"><title>card</title></head>' +
    '<body style="margin:0;background:#0b1530;color:#fff;font-family:Segoe UI,Arial,sans-serif;display:flex;' +
    'flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center">' +
    `<div style="font-size:64px;font-weight:700;color:#ffd400;max-width:80%">${esc(title)}</div>` +
    lines.map((l) => `<div style="font-size:34px;margin-top:22px;max-width:80%">${esc(l)}</div>`).join('') +
    '</body></html>';
}

const words = (t) => (String(t ?? '').match(/\S+/g) || []).length;

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

// ---- Script identity and approval -------------------------------------------------

export function resolveScript(p) {
  if (!p) throw new Error('No script path given.');
  const s = String(p);
  return path.resolve(s.startsWith('file:') ? fileURLToPath(s) : s);
}

export function scriptHash(p) {
  return createHash('sha256').update(fs.readFileSync(resolveScript(p))).digest('hex');
}

// ---- Plan mode: same script, no browser, writes storyboard.md --------------------

function createPlanner(o, readMs) {
  const sp = o.scriptPath ? resolveScript(o.scriptPath) : null;
  const planDir = path.resolve(o.planDir || (sp ? path.dirname(sp) : '.'));
  const env = o.environment || 'unknown';
  const plan = { chapters: [], title: o.title };
  // A stand-in for the browser page: any call or property works and does nothing.
  const ghost = () => new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? undefined : ghost()),
    apply: () => ghost(),
  });
  const estimate = (steps) => {
    let sec = o.introMs / 1000;
    for (const s of steps) {
      sec += readMs(`${s.label} ${s.expect}`) / 1000 + 1.5 + Math.max(o.stepPause, readMs('RESULT: as expected - ' + s.expect)) / 1000;
    }
    return Math.round(sec);
  };
  const api = {
    mode: 'plan',
    async titleCard() { plan.hasTitle = true; },
    async closingCard() { plan.hasClosing = true; },
    async click() {}, async type() {},
    async chapter(title, optsOrFn, maybeFn) {
      const copts = typeof optsOrFn === 'function' ? {} : (optsOrFn || {});
      const fn = typeof optsOrFn === 'function' ? optsOrFn : maybeFn;
      const ch = { title, actor: copts.actor || '', url: copts.url || '', fresh: !!copts.fresh, steps: [] };
      plan.chapters.push(ch);
      const step = async (label, expect, _action, _check, sopts = {}) => {
        ch.steps.push({ label, expect: expect || '', changesData: !!sopts.changesData, irreversible: !!sopts.irreversible });
      };
      await fn({ page: ghost(), step, rec: api, click: async () => {}, type: async () => {}, goto: async () => {}, settle: async () => {} });
    },
    async finish() {
      const md = storyboardMd(o, plan, env, estimate);
      fs.mkdirSync(planDir, { recursive: true });
      const file = path.join(planDir, 'storyboard.md');
      fs.writeFileSync(file, md);
      const total = plan.chapters.reduce((a, c) => a + estimate(c.steps), 0) + (plan.hasTitle ? o.cardMs / 1000 : 0) + (plan.hasClosing ? o.cardMs / 1000 : 0);
      api.result = { mode: 'plan', storyboard: file, scriptSha256: sp ? scriptHash(sp) : '', estimatedSeconds: Math.round(total), runDir: planDir, summary: { chapters: plan.chapters.length, steps: plan.chapters.reduce((a, c) => a + c.steps.length, 0) } };
      console.log(`Storyboard written: ${file}`);
      console.log(`Estimated length: about ${mmss(total)}. Nothing was recorded.`);
      return api.result;
    },
  };
  return api;
}

function storyboardMd(o, plan, env, estimate) {
  const mark = (s) => [s.irreversible ? 'IRREVERSIBLE' : '', s.changesData ? 'CHANGES DATA' : ''].filter(Boolean).join(', ');
  const total = plan.chapters.reduce((a, c) => a + estimate(c.steps), 0) + (plan.hasTitle ? o.cardMs / 1000 : 0) + (plan.hasClosing ? o.cardMs / 1000 : 0);
  const risky = plan.chapters.flatMap((c) => c.steps.filter((s) => s.changesData || s.irreversible).map((s) => ({ c: c.title, s })));
  const L = [
    `# Storyboard: ${o.title}`, '',
    'Nothing has been recorded yet. Please read this and say yes, or tell me what to change.', '',
    '## Where and how', '',
    `- Target URL: ${o.baseUrl || '(not set)'}`,
    `- Environment: ${env}${env === 'local' ? '' : '  (not local: needs your explicit OK)'}`,
    `- Reset command: ${o.resetCommand || 'none given'}`,
    `- Chapters: ${plan.chapters.length}, steps: ${plan.chapters.reduce((a, c) => a + c.steps.length, 0)}`,
    `- Estimated length: about ${mmss(total)} (${Math.round(total)} s)`, '',
    '## Steps that change data', '',
    ...(risky.length ? risky.map((r) => `- ${r.c} / ${r.s.label}: ${mark(r.s)}`) : ['None marked.']), '',
  ];
  plan.chapters.forEach((c, i) => {
    L.push(`## Chapter ${i + 1}: ${c.title}`, '',
      ...(c.actor ? [`- Acting as: ${c.actor}`] : []),
      `- Starts at: ${c.url || '(current page)'}${c.fresh ? ' (signed out first)' : ''}`,
      `- Estimated length: about ${estimate(c.steps)} s`, '',
      '| # | Action | Caption | You should see | Flag |', '|---|---|---|---|---|');
    c.steps.forEach((s, j) => {
      const cell = (t) => String(t).replace(/\|/g, '/').replace(/\n/g, ' ');
      L.push(`| ${j + 1} | ${cell(s.label)} | ${cell(s.label)} | ${cell(s.expect)} | ${mark(s) || '-'} |`);
    });
    L.push('');
  });
  L.push('## Open questions', '', ...((o.openQuestions && o.openQuestions.length) ? o.openQuestions.map((q) => `- ${q}`) : ['None.']), '');
  return L.join('\n');
}

export async function createRecorder(opts = {}) {
  const o = {
    title: 'Walkthrough', subtitle: '', baseUrl: '', outRoot: './demo-runs',
    viewport: { width: 1920, height: 1080 }, slowMo: 150, headless: true, stepPause: 1800,
    cardMs: 4000,
    frameMonitor: true, monitorMs: 400, wordsPerSec: 3, minHold: 1500, maxHold: 5000,
    progressNoteMs: 3000, introMs: 2000,
    ...opts,
  };
  // Time a viewer needs to read a caption: ~3 words/s, at least minHold, at most maxHold,
  // longer only when the text is long enough to need it (capped at 12 s).
  const readMs = (t) => {
    const raw = (words(t) / o.wordsPerSec) * 1000;
    return raw <= o.maxHold ? Math.max(o.minHold, raw) : Math.min(raw, 12000);
  };
  const mode = o.mode || process.env.DEMO_MODE || 'record';
  if (mode === 'plan') return createPlanner(o, readMs);

  // Approval gate: nothing is recorded until the user has confirmed the storyboard,
  // and the confirmation is tied to this exact script (sha256).
  if (!o.scriptPath) throw new Error('Recording needs the option scriptPath (use import.meta.url) so the approval can be checked. Not recording.');
  {
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
  }
  const startedAt = new Date();
  let runDir = path.resolve(o.outRoot, stamp(startedAt));
  for (let i = 2; fs.existsSync(runDir); i++) runDir = path.resolve(o.outRoot, `${stamp(startedAt)}-${i}`); // never reuse a folder
  const clipsDir = path.join(runDir, 'clips');
  const shotsDir = path.join(runDir, 'shots');
  const tmpDir = path.join(runDir, '.video-tmp');
  for (const d of [clipsDir, shotsDir, tmpDir]) fs.mkdirSync(d, { recursive: true });

  const browser = await chromium.launch({ headless: o.headless, slowMo: o.slowMo });
  const t0 = Date.now();
  const ff = findFfmpeg();   // path to ffmpeg, or null
  const clips = [];      // { n, kind, title, file, durationSec, startSec, segment, segStart, segEnd, frames }
  const steps = [];
  const chapters = [];   // { title, actor, clip }
  const notes = [];
  const items = [];      // every card and chapter, in order
  const segments = [];   // one per browser context
  let storage;           // carried sign-in (only used to seed a non-fresh new segment)
  let n = 0; let cur = null; let curSeg = null; let finished = false;

  const log = (m) => console.log(`[${mmss((Date.now() - t0) / 1000)}] ${m}`);
  const url = (u) => (/^https?:/i.test(u) || !o.baseUrl ? u : new URL(u, o.baseUrl).toString());

  // ---- frame monitor ------------------------------------------------------
  // Takes a small jpeg about every monitorMs, hashes it, and notes the caption word count.
  // Blank check runs in a separate helper page (no video) so it never shows in a clip.
  let helper = null;
  const blankCache = new Map();
  async function blankCheck(hash, buf) {
    if (blankCache.has(hash)) return blankCache.get(hash);
    let blank = false;
    try {
      if (!helper) {
        const hctx = await browser.newContext({ viewport: { width: 200, height: 200 } });
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
        if (!stopFlag) await sleep(o.monitorMs);
      }
    })();
    return { samples, async stop() { stopFlag = true; await loop; } };
  }

  // ---- Segments: one browser context, one page, one video. Chapters and cards are time ranges in it.

  const isLive = (seg) => /^https?:/i.test(seg.page.url());
  const segFile = (i) => path.join(tmpDir, `segment-${i}.webm`);

  // Write (or clear, with null) the caption/card state the init script draws. Survives navigations.
  async function apply(seg, s) {
    seg.state.current = s;
    try {
      await seg.page.evaluate((v) => {
        try { if (v) sessionStorage.setItem('__demoCap', JSON.stringify(v)); else sessionStorage.removeItem('__demoCap'); } catch (e) { /* storage blocked */ }
        if (window.__demoRender) window.__demoRender();
      }, s);
    } catch { /* mid navigation: the hooks below re-apply */ }
  }

  async function openSegment(fresh) {
    const ctxOpts = { viewport: o.viewport, recordVideo: { dir: tmpDir, size: o.viewport } };
    if (!fresh && storage) ctxOpts.storageState = storage;
    const ctx = await browser.newContext(ctxOpts);
    await ctx.addInitScript(captionInit, {});
    const started = Date.now();
    const page = await ctx.newPage();
    const seg = { index: segments.length + 1, ctx, page, started, mon: null, items: [], firstContentMs: null, state: { current: null, navs: 0 } };
    const reapply = () => { if (seg.state.current) apply(seg, seg.state.current); };
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) { seg.state.navs += 1; reapply(); } });
    page.on('domcontentloaded', reapply);
    page.on('load', reapply);
    if (o.frameMonitor) seg.mon = startMonitor(page, started);
    segments.push(seg);
    curSeg = seg;
    return seg;
  }

  // A card or a chapter: a time range [startSec, endSec) in its segment's video.
  function newItem(seg, kind, title) {
    const prev = seg.items[seg.items.length - 1];
    n += 1;
    const slug = slugify(kind === 'chapter' ? title : kind);
    const it = {
      n, kind, title, seg, endSec: null,
      startSec: prev ? (prev.endSec ?? (Date.now() - seg.started) / 1000) : 0,
      file: ff ? `clips/${pad2(n)}-${slug}.webm` : `clips/segment-${seg.index}.webm`,
    };
    seg.items.push(it);
    items.push(it);
    return it;
  }
  const endItem = (seg, it) => { it.endSec = (Date.now() - seg.started) / 1000; };

  async function closeSegment() {
    const seg = curSeg;
    if (!seg) return;
    curSeg = null; cur = null;
    const endSec = (Date.now() - seg.started) / 1000;
    if (seg.mon) { try { await seg.mon.stop(); } catch { /* ignore */ } }
    try { storage = await seg.ctx.storageState(); } catch { /* ignore */ }
    const video = seg.page.video();
    await seg.ctx.close();
    seg.durationSec = endSec;
    seg.saved = false;
    try {
      fs.renameSync(await video.path(), segFile(seg.index));
      seg.saved = true;
    } catch (e) {
      notes.push(`Segment ${seg.index} video could not be saved: ${firstLine(e.message)}`);
    }
    const last = seg.items[seg.items.length - 1];
    if (last) last.endSec = endSec;
    seg.items.forEach((it, i) => {
      if (it.endSec == null) it.endSec = endSec;
      let frames = null;
      if (seg.mon) {
        const samples = seg.mon.samples.filter((x) => x.t >= it.startSec && x.t < it.endSec).map((x) => ({ ...x, t: x.t - it.startSec }));
        frames = { ...analyseFrames(samples, { maxStaticSec: o.maxHold / 1000, wordsPerSec: o.wordsPerSec }), firstContentMs: i === 0 ? (seg.firstContentMs ?? 0) : 0 };
      }
      const startSec = clips.reduce((a, c) => a + c.durationSec, 0);
      const clip = {
        n: it.n, kind: it.kind, title: it.title, file: it.file,
        durationSec: +(it.endSec - it.startSec).toFixed(2), startSec: +startSec.toFixed(2),
        segment: seg.index, segStart: +it.startSec.toFixed(2), segEnd: +it.endSec.toFixed(2),
      };
      if (frames) clip.frames = frames;
      clips.push(clip);
    });
  }

  // Show a full-screen card for ms. On a live page it is an overlay (never replaces the app);
  // on a blank page (start of a segment) it is plain HTML. `after` is the caption state to restore.
  async function showCard(seg, title, lines, ms, after) {
    const live = isLive(seg);
    try {
      if (live) await apply(seg, { card: { title, lines } });
      else { seg.state.current = null; await seg.page.setContent(cardHtml(title, lines)); }
      if (seg.firstContentMs == null) seg.firstContentMs = Date.now() - seg.started;
      await sleep(ms);
    } catch (e) { notes.push(`card "${title}": ${firstLine(e.message)}`); }
    if (live) await apply(seg, after ?? null);
  }

  async function card(kind, title, lines, ms) {
    const seg = curSeg || await openSegment(false);
    const it = newItem(seg, kind, title);
    await showCard(seg, title, lines, ms ?? o.cardMs, null);
    endItem(seg, it);
    log(`${kind} card: ${title}`);
    return it;
  }

  async function settle(page, extra = 300) {
    try { await page.waitForLoadState('domcontentloaded', { timeout: 5000 }); } catch { /* ignore */ }
    try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch { /* ignore */ }
    await sleep(extra);
  }

  // Runs fn; if it takes longer than 2 s, calls onNote(seconds) every 3 s so the screen keeps changing.
  async function withProgress(fn, onNote) {
    const t = Date.now(); let last = t;
    const timer = setInterval(() => { const now = Date.now(); if (now - t >= 2000 && now - last >= 3000) { last = now; Promise.resolve(onNote(Math.round((now - t) / 1000))).catch(() => {}); } }, 500);
    try { return await fn(); } finally { clearInterval(timer); }
  }

  const asLoc = (page, l) => (typeof l === 'string' ? page.locator(l).first() : l);

  async function highlight(loc) {
    try {
      await loc.scrollIntoViewIfNeeded({ timeout: 4000 });
      await within(1500, loc.evaluate((el) => { el.__demoPrev = el.style.outline; el.style.outline = '5px solid #ff2d95'; el.style.outlineOffset = '3px'; }, undefined, { timeout: 1500 }));
      await sleep(500);
    } catch { /* highlight is cosmetic */ }
  }

  // Cosmetic only: never wait more than 1 s, even if the page has moved on (a navigation can make the element vanish).
  async function unhighlight(loc) {
    try { await within(1000, loc.evaluate((el) => { el.style.outline = el.__demoPrev || ''; }, undefined, { timeout: 1000 })); } catch { /* element may be gone */ }
  }

  function within(ms, p) {
    let t;
    return Promise.race([p, new Promise((_r, rej) => { t = setTimeout(() => rej(new Error('timed out')), ms); })]).finally(() => clearTimeout(t));
  }

  const api = {
    runDir, clipsDir, shotsDir,
    get page() { return (cur || curSeg)?.page; },

    async titleCard(extraLines = []) {
      const lines = [o.subtitle, ...extraLines].filter(Boolean);
      return card('title', o.title, lines, o.cardMs);
    },

    async closingCard(lines) {
      const s = summarise();
      const auto = [`${s.steps} steps checked: ${s.pass} as expected, ${s.different} different, ${s.couldNot} could not be done`];
      return card('closing', 'End of walkthrough', lines ?? auto, o.cardMs);
    },

    // All chapters share one browser context and one page, so unsaved input survives a chapter
    // boundary. Only `fresh: true` closes the context and starts a new, signed-out one.
    async chapter(title, optsOrFn, maybeFn) {
      const copts = typeof optsOrFn === 'function' ? {} : (optsOrFn || {});
      const fn = typeof optsOrFn === 'function' ? optsOrFn : maybeFn;
      if (o.only && !(String(title).toLowerCase().includes(String(o.only).toLowerCase()) || slugify(title).includes(slugify(o.only)))) {
        log(`chapter skipped (only="${o.only}"): ${title}`);
        return null;
      }
      if (copts.fresh && curSeg) await closeSegment();
      const seg = curSeg || await openSegment(!!copts.fresh);
      cur = seg;
      const state = seg.state;
      const page = seg.page;
      const it = newItem(seg, 'chapter', title);
      const kicker = `Chapter: ${title}`;
      const who = copts.actor || '';
      const ap = (s) => apply(seg, s);
      const introCard = { card: { title: kicker, lines: copts.actor ? ['Acting as: ' + copts.actor] : [] } };
      const tIntro = Date.now();
      // Intro card: an overlay on a live page; plain HTML only while the page is still blank.
      try {
        if (isLive(seg)) await ap(introCard);
        else {
          state.current = null;
          await page.setContent(cardHtml(introCard.card.title, introCard.card.lines), { waitUntil: 'domcontentloaded' });
          state.current = introCard;
        }
        if (seg.firstContentMs == null) seg.firstContentMs = Date.now() - seg.started;
      } catch (e) { notes.push(`chapter card "${title}": ${firstLine(e.message)}`); }
      log(`chapter: ${title}${copts.actor ? ` (as ${copts.actor})` : ''}`);

      let stepNo = 0;
      const chapterIndex = chapters.length + 1;
      const step = async (label, expect, action, check, sopts = {}) => {
        stepNo += 1;
        const startedStepMs = Date.now();
        const navsBefore = state.navs;
        await ap({ kicker, who, step: label, expect });
        await sleep(readMs(`${label} ${expect || ''}`));
        let status = 'PASS';
        let seen = '';
        // Progress note: if the action or load runs long, say so on screen instead of freezing.
        // First note after 2 s of work, then every 3 s, so no frame is held for long.
        let progressNotes = 0;
        const tWait = Date.now();
        let lastNote = tWait;
        const timer = o.progressNoteMs > 0 ? setInterval(() => {
          const now = Date.now();
          if (now - tWait < 2000 || now - lastNote < o.progressNoteMs) return;
          lastNote = now;
          progressNotes += 1;
          const secs = Math.round((now - tWait) / 1000);
          ap({ kicker, who, step: label, expect, result: `Still working... waiting for the page (${secs} s)`, status: 'WAIT' });
        }, 500) : null;
        try {
          try {
            if (action) await action();
          } catch (e) {
            status = 'COULD NOT DO';
            seen = firstLine(e.message);
          }
          await settle(page, 300);
          if (status === 'PASS' && check) {
            try {
              const r = await check();
              if (r && r.ok === false) { status = 'DIFFERENT'; seen = String(r.seen ?? ''); }
              else seen = String(r?.seen ?? '');
            } catch (e) {
              status = 'COULD NOT DO';
              seen = firstLine(e.message);
            }
          }
        } finally {
          if (timer) clearInterval(timer);
        }
        const resultText = status === 'PASS'
          ? 'RESULT: as expected' + (seen ? ` - ${seen}` : '')
          : status === 'DIFFERENT' ? `RESULT: DIFFERENT - what was actually seen: ${seen}`
            : `RESULT: could not do this step - ${seen}`;
        await ap({ kicker, who, step: label, expect, result: resultText, status });
        await sleep(Math.max(sopts.pause ?? o.stepPause, readMs(resultText)));
        // Prove the bar is on screen right now, then take the picture.
        let captionPresent = false;
        let captionText = '';
        try {
          await page.evaluate(() => { if (window.__demoRender) window.__demoRender(); });
          const info = await page.evaluate(() => {
            const el = document.getElementById('__demo_cap');
            if (!el) return { present: false, text: '' };
            const r = el.getBoundingClientRect();
            return { present: r.height > 20 && r.width > 100, text: el.innerText };
          });
          captionPresent = info.present;
          captionText = info.text;
        } catch { /* page mid-navigation */ }
        const shot = `shots/${pad2(chapterIndex)}-${pad2(stepNo)}-${slugify(label)}.png`;
        try { await page.screenshot({ path: path.join(runDir, shot) }); } catch (e) { notes.push(`screenshot ${shot}: ${firstLine(e.message)}`); }
        const segmentSec = (startedStepMs - seg.started) / 1000;
        const entry = {
          chapter: title, chapterIndex, step: stepNo, label, expect: expect || '', status, seen,
          captionPresent, captionText, navigatedDuringStep: state.navs > navsBefore, shot,
          atSec: +(segmentSec - it.startSec).toFixed(1), segment: seg.index, segmentSec: +segmentSec.toFixed(1), clip: it.file,
          progressNotes, changesData: !!sopts.changesData, irreversible: !!sopts.irreversible,
        };
        steps.push(entry);
        log(`${entry.chapter} / ${stepNo} ${status}: ${label}${seen ? ' | ' + seen : ''}`);
        return entry;
      };

      const helpers = {
        page, step, rec: api,
        click: (l) => api.click(l),
        type: (l, text) => api.type(l, text),
        goto: async (u) => { await withProgress(() => page.goto(url(u), { waitUntil: 'domcontentloaded' }), (s) => ap({ kicker, who, step: 'Loading ' + u, result: `Still loading... (${s} s)`, status: 'WAIT' })); await settle(page); },
        settle: (ms) => settle(page, ms),
      };
      try {
        if (copts.url) {
          await withProgress(() => page.goto(url(copts.url), { waitUntil: 'domcontentloaded' }), (s) => ap({ card: { title: kicker, lines: [...introCard.card.lines, `Still loading the first page... (${s} s)`] } }));
          await settle(page);
          await ap(introCard);   // the page is live now: the overlay covers the app, never replaces it
        }
        const left = o.introMs - (Date.now() - tIntro);
        if (left > 0) await sleep(left);
        await ap({ kicker, who, step: '' });
        await fn(helpers);
      } catch (e) {
        notes.push(`Chapter "${title}" stopped early: ${firstLine(e.message)}`);
        const segmentSec = (Date.now() - seg.started) / 1000;
        steps.push({
          chapter: title, chapterIndex, step: ++stepNo, label: '(chapter stopped early)', expect: '', status: 'COULD NOT DO',
          seen: firstLine(e.message), captionPresent: false, captionText: '', navigatedDuringStep: false, shot: '', atSec: 0,
          segment: seg.index, segmentSec: +segmentSec.toFixed(1), clip: it.file,
        });
        log(`chapter "${title}" crashed: ${firstLine(e.message)}`);
      }
      endItem(seg, it);
      try { storage = await seg.ctx.storageState(); } catch { /* keep the old sign-in */ }
      cur = null;
      chapters.push({ title, actor: copts.actor || '', clip: it.file, steps: stepNo });
      return it;
    },

    async click(l) {
      const page = (cur || curSeg).page;
      const loc = asLoc(page, l);
      await loc.waitFor({ state: 'visible', timeout: 10000 });
      await highlight(loc);
      await loc.click({ timeout: 10000 });
      await unhighlight(loc);
    },

    async type(l, text) {
      const loc = asLoc((cur || curSeg).page, l);
      await loc.waitFor({ state: 'visible', timeout: 10000 });
      await highlight(loc);
      await loc.fill('', { timeout: 10000 });
      await loc.pressSequentially(text, { delay: 60 });
      await unhighlight(loc);
    },

    async finish() {
      if (finished) return api.result;
      finished = true;
      try { await closeSegment(); } catch (e) { notes.push(`closing the last segment: ${firstLine(e.message)}`); }
      try { if (helper) await helper.ctx.close(); } catch { /* ignore */ }
      try { await browser.close(); } catch { /* ignore */ }
      // writeOutputs reads the segment videos from tmpDir, so it runs before the cleanup.
      api.result = writeOutputs();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* own temp folder only */ }
      return api.result;
    },
  };

  function summarise() {
    return {
      chapters: chapters.length,
      clips: clips.length,
      steps: steps.length,
      pass: steps.filter((s) => s.status === 'PASS').length,
      different: steps.filter((s) => s.status === 'DIFFERENT').length,
      couldNot: steps.filter((s) => s.status === 'COULD NOT DO').length,
    };
  }

  function frameQuality() {
    if (!o.frameMonitor) return { enabled: false };
    const perClip = clips.filter((c) => c.frames).map((c) => ({
      clip: c.file, samples: c.frames.samples, firstContentMs: c.frames.firstContentMs,
      blankFrames: c.frames.blankFrames, unjustified: c.frames.unjustified, justifiedLongHolds: c.frames.justifiedLongHolds,
    }));
    return {
      enabled: true, clipsChecked: perClip.length, samples: perClip.reduce((a, c) => a + c.samples, 0),
      blankFrameRuns: perClip.reduce((a, c) => a + c.blankFrames.length, 0),
      unjustifiedStaticRuns: perClip.reduce((a, c) => a + c.unjustified.length, 0),
      justifiedLongHolds: perClip.reduce((a, c) => a + c.justifiedLongHolds.length, 0),
      progressNotes: steps.reduce((a, s) => a + (s.progressNotes || 0), 0),
      maxFirstContentMs: Math.max(0, ...perClip.map((c) => c.firstContentMs ?? 0)),
      perClip,
    };
  }

  // Copy every saved segment video into clips/ as segment-N.webm.
  function copySegments() {
    for (const seg of segments) {
      if (!seg.saved) continue;
      try { fs.copyFileSync(segFile(seg.index), path.join(clipsDir, `segment-${seg.index}.webm`)); }
      catch (e) { notes.push(`segment ${seg.index} copy: ${firstLine(e.message)}`); }
    }
  }

  function writeOutputs() {
    const summary = summarise();
    const total = clips.reduce((a, c) => a + c.durationSec, 0);
    let mode = 'segments';
    let ffmpeg = { available: false, mode, note: 'ffmpeg was not found on PATH (or is disabled with DEMO_FFMPEG=none), so there is no single full.mp4 and no per-chapter clips. Chapters share segment videos; player.html seeks to each chapter.' };

    if (ff && clips.length) {
      // Cut one clip per card or chapter out of its segment, then join them into full.mp4.
      let cutFailed = '';
      for (const c of clips) {
        const src = segFile(c.segment);
        if (!fs.existsSync(src)) { cutFailed = `segment ${c.segment} video is missing`; break; }
        const r = spawnSync(ff, ['-y', '-i', src, '-ss', String(c.segStart), '-to', String(c.segEnd),
          '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '2M', '-an', path.join(runDir, c.file)], { encoding: 'utf8', maxBuffer: 1 << 26 });
        if (r.status !== 0) { cutFailed = `cutting ${c.file}: ${firstLine(r.stderr)}`; break; }
      }
      if (cutFailed) {
        ffmpeg = { available: true, mode, path: ff, note: `ffmpeg was found but failed (${cutFailed}); falling back to segment videos.` };
      } else {
        mode = 'clips';
        const list = clips.map((c) => `file '${c.file}'`).join('\n') + '\n';
        fs.writeFileSync(path.join(runDir, 'concat.txt'), list);
        const r = spawnSync(ff, ['-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', 'full.mp4'], { cwd: runDir, encoding: 'utf8', maxBuffer: 1 << 26 });
        ffmpeg = r.status === 0
          ? { available: true, mode, path: ff, note: 'full.mp4 written with ffmpeg.' }
          : { available: true, mode, path: ff, note: `ffmpeg was found but joining failed: ${firstLine(r.stderr)}` };
      }
    }

    if (mode === 'segments') {
      // Every clip points at its shared segment video instead.
      const remap = new Map();
      for (const c of clips) { const f = `clips/segment-${c.segment}.webm`; remap.set(c.file, f); c.file = f; }
      for (const s of steps) if (s.clip && remap.has(s.clip)) s.clip = remap.get(s.clip);
      for (const c of chapters) if (remap.has(c.clip)) c.clip = remap.get(c.clip);
      copySegments();
    }

    const fullWritten = mode === 'clips' && ffmpeg.note.startsWith('full');
    const timeline = clips.map((c) => ({
      index: c.n, kind: c.kind, title: c.title, file: c.file, start: c.startSec, startText: mmss(c.startSec), duration: c.durationSec,
      segment: c.segment, segStart: c.segStart, segEnd: c.segEnd,
    }));

    const fq = frameQuality();
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

  return api;
}

function frameQualityMd(fq) {
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

// Find ffmpeg: DEMO_FFMPEG (the value "none" disables it), then PATH, then the voice-over's imageio-ffmpeg.
// Detected only, never installed. Returns a command or path, or null.
function findFfmpeg() {
  const works = (cmd) => { try { return spawnSync(cmd, ['-version'], { encoding: 'utf8' }).status === 0; } catch { return false; } };
  const env = (process.env.DEMO_FFMPEG || '').trim();
  if (env) {
    if (env.toLowerCase() === 'none') return null;
    if (works(env)) return env;
  }
  if (works('ffmpeg')) return 'ffmpeg';
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const venv = path.join(here, '..', '..', 'demo-voiceover', '.venv');
    const py = [path.join(venv, 'Scripts', 'python.exe'), path.join(venv, 'bin', 'python')].find((p) => fs.existsSync(p));
    if (py) {
      const r = spawnSync(py, ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' });
      const exe = (r.stdout || '').trim().split(/\r?\n/).pop();
      if (r.status === 0 && exe && works(exe)) return exe;
    }
  } catch { /* no voice-over environment */ }
  return null;
}

function playerHtml(title, timeline, seekMode) {
  const data = JSON.stringify(timeline).replace(/</g, '&lt;');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
 body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:#0b1530;color:#fff;display:flex;min-height:100vh}
 nav{width:320px;padding:16px;background:#101c40;overflow:auto}
 nav h1{font-size:18px;color:#ffd400;margin:0 0 12px}
 nav button{display:block;width:100%;text-align:left;margin:0 0 6px;padding:10px;border:0;border-radius:6px;background:#1a2a5c;color:#fff;font-size:15px;cursor:pointer}
 nav button.on{background:#ffd400;color:#0b1530;font-weight:700}
 nav small{opacity:.7}
 main{flex:1;padding:16px}
 video{width:100%;max-height:90vh;background:#000}
</style></head><body>
<nav><h1>${esc(title)}</h1><div id="list"></div></nav>
<main><video id="v" controls autoplay muted></video><p id="now"></p></main>
<script>
const clips = ${data};
const seek = ${seekMode ? 'true' : 'false'};
const v = document.getElementById('v'), list = document.getElementById('list'), now = document.getElementById('now');
let i = 0;
function play(k){
  i = k;
  const c = clips[k];
  const go = function(){ if (seek) v.currentTime = c.segStart; v.play().catch(function(){}); };
  if (seek && v.getAttribute('data-src') === c.file && v.readyState >= 1) { go(); }
  else {
    v.setAttribute('data-src', c.file);
    v.src = c.file;
    if (seek) v.addEventListener('loadedmetadata', go, { once: true }); else v.play().catch(function(){});
  }
  now.textContent = (k+1) + ' / ' + clips.length + ': ' + c.title;
  Array.prototype.forEach.call(list.children, function(b, j){ b.className = j === k ? 'on' : ''; });
}
clips.forEach(function(c, k){ const b = document.createElement('button'); b.innerHTML = c.startText + ' ' + c.title.replace(/</g,'&lt;') + ' <small>(' + c.kind + ')</small>'; b.onclick = function(){ play(k); }; list.appendChild(b); });
v.addEventListener('ended', function(){ if (i + 1 < clips.length) play(i + 1); });
if (seek) v.addEventListener('timeupdate', function(){ const c = clips[i]; if (c && v.currentTime >= c.segEnd - 0.05 && i + 1 < clips.length) play(i + 1); });
play(0);
</script></body></html>
`;
}
