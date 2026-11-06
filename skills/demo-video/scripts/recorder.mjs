// recorder.mjs - generic walkthrough recording engine (Playwright, webm clips). Public entry point.
//
// One browser context and one page per segment: chapters share it, so unsaved input survives. A segment ends only on `fresh: true` or finish().
// A caption bar is drawn into the page and re-applied after every navigation.
// Nothing here knows about any particular app. The work lives in ./lib/*.mjs.
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
import { mmss, stamp, words, firstLine } from './lib/util.mjs';
import { highlight, unhighlight } from './lib/overlay.mjs';
import { createMonitor, analyseFrames } from './lib/monitor.mjs';
import { createPlanner } from './lib/planner.mjs';
import { resolveScript, scriptHash, checkApproval } from './lib/approval.mjs';
import { ENGINE_VERSION } from './lib/version.mjs';
import { findFfmpeg } from './lib/cutter.mjs';
import { card, asLoc } from './lib/cards.mjs';
import { closeSegment } from './lib/segments.mjs';
import { chapter } from './lib/chapter.mjs';
import { summarise, writeOutputs } from './lib/report.mjs';
import { runPrecheck, gatePrechecks } from './lib/precheck.mjs';
import { applyProfile, signInWith, signOutWith, productionAllowed } from './lib/profile.mjs';

export { analyseFrames, resolveScript, scriptHash, ENGINE_VERSION };

export async function createRecorder(opts = {}) {
  const o = applyProfile({
    title: 'Walkthrough', subtitle: '', baseUrl: '', outRoot: './demo-runs',
    viewport: { width: 1920, height: 1080 }, slowMo: 150, headless: true, stepPause: 1800,
    cardMs: 4000,
    frameMonitor: true, monitorMs: 400, wordsPerSec: 3, minHold: 1500, maxHold: 5000,
    progressNoteMs: 3000, introMs: 2000,
    ...opts,
  });
  // Time a viewer needs to read a caption: ~3 words/s, at least minHold, at most maxHold,
  // longer only when the text is long enough to need it (capped at 12 s).
  const readMs = (t) => {
    const raw = (words(t) / o.wordsPerSec) * 1000;
    return raw <= o.maxHold ? Math.max(o.minHold, raw) : Math.min(raw, 12000);
  };
  const mode = o.mode || process.env.DEMO_MODE || 'record';
  if (mode === 'plan') return createPlanner(o, readMs);

  // Production gate: a profile or option that says production needs an explicit environment variable as well as the approval.
  if (o.environment === 'production' && !productionAllowed()) {
    throw new Error('This walkthrough targets a PRODUCTION environment. Besides the approved storyboard, recording needs DEMO_ALLOW_PRODUCTION=1 in the environment. Not recording.');
  }
  // Approval gate: nothing is recorded until the user has confirmed the storyboard.
  const approval = checkApproval(o);

  const startedAt = new Date();
  let runDir = path.resolve(o.outRoot, stamp(startedAt));
  for (let i = 2; fs.existsSync(runDir); i++) runDir = path.resolve(o.outRoot, `${stamp(startedAt)}-${i}`); // never reuse a folder
  const clipsDir = path.join(runDir, 'clips');
  const shotsDir = path.join(runDir, 'shots');
  const tmpDir = path.join(runDir, '.video-tmp');
  for (const d of [clipsDir, shotsDir, tmpDir]) fs.mkdirSync(d, { recursive: true });

  const browser = await chromium.launch({ headless: o.headless, slowMo: o.slowMo });
  const t0 = Date.now();
  const S = {
    o, readMs, browser, approval, mode, startedAt, runDir, clipsDir, shotsDir, tmpDir,
    ff: findFfmpeg(),
    clips: [], prechecks: [], refused: null, steps: [], chapters: [], notes: [], items: [], segments: [],
    storage: undefined, n: 0, cur: null, curSeg: null, finished: false,
    log: (m) => console.log(`[${mmss((Date.now() - t0) / 1000)}] ${m}`),
    url: (u) => (/^https?:/i.test(u) || !o.baseUrl ? u : new URL(u, o.baseUrl).toString()),
  };
  for (const w of approval.engineWarnings) { S.notes.push(w); console.log('WARNING ' + w); }
  const monitor = createMonitor(S);
  S.startMonitor = monitor.startMonitor;

  const pageNow = () => (S.cur || S.curSeg).page;
  const api = {
    runDir, clipsDir, shotsDir,
    get page() { return (S.cur || S.curSeg)?.page; },

    async titleCard(extraLines = []) {
      await gatePrechecks(S);
      const lines = [o.subtitle, ...extraLines].filter(Boolean);
      return card(S, 'title', o.title, lines, o.cardMs);
    },

    async closingCard(lines) {
      const s = summarise(S);
      const auto = [`${s.steps} steps checked: ${s.pass} as expected, ${s.different} different, ${s.couldNot} could not be done`];
      return card(S, 'closing', 'End of walkthrough', lines ?? auto, o.cardMs);
    },

    precheck: (name, fn) => runPrecheck(S, name, fn),
    signIn: (page, name) => signInWith(o.profileData, page, name, o.baseUrl),
    signOut: (page) => signOutWith(o.profileData, page, o.baseUrl),

    async chapter(title, optsOrFn, maybeFn) { await gatePrechecks(S); return chapter(S, title, optsOrFn, maybeFn); },

    async click(l) {
      const loc = asLoc(pageNow(), l);
      await loc.waitFor({ state: 'visible', timeout: 10000 });
      await highlight(loc);
      await loc.click({ timeout: 10000 });
      await unhighlight(loc);
    },

    async type(l, text) {
      const loc = asLoc(pageNow(), l);
      await loc.waitFor({ state: 'visible', timeout: 10000 });
      await highlight(loc);
      await loc.fill('', { timeout: 10000 });
      await loc.pressSequentially(text, { delay: 60 });
      await unhighlight(loc);
    },

    async finish() {
      await gatePrechecks(S); // a refusal must survive a return inside finally
      if (S.finished) return api.result;
      S.finished = true;
      try { await closeSegment(S); } catch (e) { S.notes.push(`closing the last segment: ${firstLine(e.message)}`); }
      await monitor.closeHelper();
      try { await browser.close(); } catch { /* ignore */ }
      // writeOutputs reads the segment videos from tmpDir, so it runs before the cleanup.
      api.result = writeOutputs(S);
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* own temp folder only */ }
      return api.result;
    },
  };
  S.api = api;
  return api;
}
