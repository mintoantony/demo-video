// overlay.mjs - what is drawn on screen: the caption bar and cards (browser side), card HTML, element highlight.
import { esc, sleep, within } from './util.mjs';

// captionInit runs inside every page (browser side). It must stay self-contained: it is serialised by Playwright.
// Runs inside every page (browser side), before the page's own scripts.
// Draws (1) a full-screen chapter intro card until arg.until, so the first paint is never empty,
// and (2) the caption bar from sessionStorage. A MutationObserver puts both on screen at first paint.
export function captionInit(arg) {
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

export function cardHtml(title, lines) {
  return '<!doctype html><html><head><meta charset="utf-8"><title>card</title></head>' +
    '<body style="margin:0;background:#0b1530;color:#fff;font-family:Segoe UI,Arial,sans-serif;display:flex;' +
    'flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center">' +
    `<div style="font-size:64px;font-weight:700;color:#ffd400;max-width:80%">${esc(title)}</div>` +
    lines.map((l) => `<div style="font-size:34px;margin-top:22px;max-width:80%">${esc(l)}</div>`).join('') +
    '</body></html>';
}

// Outline an element before acting on it. Cosmetic: failures are swallowed.
export async function highlight(loc) {
  try {
    await loc.scrollIntoViewIfNeeded({ timeout: 4000 });
    await within(1500, loc.evaluate((el) => { el.__demoPrev = el.style.outline; el.style.outline = '5px solid #ff2d95'; el.style.outlineOffset = '3px'; }, undefined, { timeout: 1500 }));
    await sleep(500);
  } catch { /* highlight is cosmetic */ }
}

// Cosmetic only: never wait more than 1 s, even if the page has moved on.
export async function unhighlight(loc) {
  try { await within(1000, loc.evaluate((el) => { el.style.outline = el.__demoPrev || ''; }, undefined, { timeout: 1000 })); } catch { /* element may be gone */ }
}
