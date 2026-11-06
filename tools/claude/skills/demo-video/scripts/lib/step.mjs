// step.mjs - one checked step inside a chapter: show the caption, act, check, show the result, take the screenshot.
import path from 'node:path';
import { sleep, pad2, slugify, firstLine } from './util.mjs';
import { settle } from './cards.mjs';

// c = { seg, it, title, kicker, who, ap, chapterIndex, stepNo } ; stepNo is incremented here.
export function makeStep(S, c) {
  const { o, readMs } = S;
  const { seg, it, title, kicker, who, ap, chapterIndex } = c;
  const page = seg.page;
  const state = seg.state;
  return async function step(label, expect, action, check, sopts = {}) {
    c.stepNo += 1;
    const stepNo = c.stepNo;
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
    try { await page.screenshot({ path: path.join(S.runDir, shot) }); } catch (e) { S.notes.push(`screenshot ${shot}: ${firstLine(e.message)}`); }
    const segmentSec = (startedStepMs - seg.started) / 1000;
    const entry = {
      chapter: title, chapterIndex, step: stepNo, label, expect: expect || '', status, seen,
      captionPresent, captionText, navigatedDuringStep: state.navs > navsBefore, shot,
      atSec: +(segmentSec - it.startSec).toFixed(1), segment: seg.index, segmentSec: +segmentSec.toFixed(1), clip: it.file,
      progressNotes, changesData: !!sopts.changesData, irreversible: !!sopts.irreversible,
    };
    S.steps.push(entry);
    S.log(`${entry.chapter} / ${stepNo} ${status}: ${label}${seen ? ' | ' + seen : ''}`);
    return entry;
  };
}
