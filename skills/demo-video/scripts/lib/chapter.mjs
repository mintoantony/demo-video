// chapter.mjs - a chapter: intro card, optional first page, then the user's steps in the shared page.
import { sleep, slugify, firstLine } from './util.mjs';
import { cardHtml } from './overlay.mjs';
import { isLive, apply, openSegment, closeSegment, newItem, endItem } from './segments.mjs';
import { settle, withProgress } from './cards.mjs';
import { makeStep } from './step.mjs';

// All chapters share one browser context and one page, so unsaved input survives a chapter
// boundary. Only `fresh: true` closes the context and starts a new, signed-out one.
export async function chapter(S, title, optsOrFn, maybeFn) {
  const { o, notes, steps, chapters } = S;
  const copts = typeof optsOrFn === 'function' ? {} : (optsOrFn || {});
  const fn = typeof optsOrFn === 'function' ? optsOrFn : maybeFn;
  if (o.only && !(String(title).toLowerCase().includes(String(o.only).toLowerCase()) || slugify(title).includes(slugify(o.only)))) {
    S.log(`chapter skipped (only="${o.only}"): ${title}`);
    return null;
  }
  if (copts.fresh && S.curSeg) await closeSegment(S);
  const seg = S.curSeg || await openSegment(S, !!copts.fresh);
  S.cur = seg;
  const state = seg.state;
  const page = seg.page;
  const it = newItem(S, seg, 'chapter', title);
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
  S.log(`chapter: ${title}${copts.actor ? ` (as ${copts.actor})` : ''}`);

  const c = { seg, it, title, kicker, who, ap, chapterIndex: chapters.length + 1, stepNo: 0 };
  const step = makeStep(S, c);
  const api = S.api;
  const helpers = {
    page, step, rec: api,
    click: (l) => api.click(l),
    type: (l, text) => api.type(l, text),
    goto: async (u) => { await withProgress(() => page.goto(S.url(u), { waitUntil: 'domcontentloaded' }), (s) => ap({ kicker, who, step: 'Loading ' + u, result: `Still loading... (${s} s)`, status: 'WAIT' })); await settle(page); },
    settle: (ms) => settle(page, ms),
  };
  try {
    if (copts.url) {
      await withProgress(() => page.goto(S.url(copts.url), { waitUntil: 'domcontentloaded' }), (s) => ap({ card: { title: kicker, lines: [...introCard.card.lines, `Still loading the first page... (${s} s)`] } }));
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
      chapter: title, chapterIndex: c.chapterIndex, step: ++c.stepNo, label: '(chapter stopped early)', expect: '', status: 'COULD NOT DO',
      seen: firstLine(e.message), captionPresent: false, captionText: '', navigatedDuringStep: false, shot: '', atSec: 0,
      segment: seg.index, segmentSec: +segmentSec.toFixed(1), clip: it.file,
    });
    S.log(`chapter "${title}" crashed: ${firstLine(e.message)}`);
  }
  endItem(seg, it);
  try { S.storage = await seg.ctx.storageState(); } catch { /* keep the old sign-in */ }
  S.cur = null;
  chapters.push({ title, actor: copts.actor || '', clip: it.file, steps: c.stepNo });
  return it;
}
