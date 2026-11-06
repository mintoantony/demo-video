// cards.mjs - full-screen cards, settle/progress helpers, locator coercion.
import { sleep, firstLine } from './util.mjs';
import { cardHtml } from './overlay.mjs';
import { isLive, apply, openSegment, newItem, endItem } from './segments.mjs';

// Show a full-screen card for ms. On a live page it is an overlay (never replaces the app);
// on a blank page (start of a segment) it is plain HTML. `after` is the caption state to restore.
export async function showCard(S, seg, title, lines, ms, after) {
  const live = isLive(seg);
  try {
    if (live) await apply(seg, { card: { title, lines } });
    else { seg.state.current = null; await seg.page.setContent(cardHtml(title, lines)); }
    if (seg.firstContentMs == null) seg.firstContentMs = Date.now() - seg.started;
    await sleep(ms);
  } catch (e) { S.notes.push(`card "${title}": ${firstLine(e.message)}`); }
  if (live) await apply(seg, after ?? null);
}

export async function card(S, kind, title, lines, ms) {
  const seg = S.curSeg || await openSegment(S, false);
  const it = newItem(S, seg, kind, title);
  await showCard(S, seg, title, lines, ms ?? S.o.cardMs, null);
  endItem(seg, it);
  S.log(`${kind} card: ${title}`);
  return it;
}

export async function settle(page, extra = 300) {
  try { await page.waitForLoadState('domcontentloaded', { timeout: 5000 }); } catch { /* ignore */ }
  try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch { /* ignore */ }
  await sleep(extra);
}

// Runs fn; if it takes longer than 2 s, calls onNote(seconds) every 3 s so the screen keeps changing.
export async function withProgress(fn, onNote) {
  const t = Date.now(); let last = t;
  const timer = setInterval(() => { const now = Date.now(); if (now - t >= 2000 && now - last >= 3000) { last = now; Promise.resolve(onNote(Math.round((now - t) / 1000))).catch(() => {}); } }, 500);
  try { return await fn(); } finally { clearInterval(timer); }
}

export const asLoc = (page, l) => (typeof l === 'string' ? page.locator(l).first() : l);
