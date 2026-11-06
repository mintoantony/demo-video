// Run with: node tests/run-tests.mjs   (exit code 1 on any failure)
import { startFixtureServer } from './fixture-server.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runFixtureWalkthrough } from './fixture-walkthrough.mjs';
import { ENGINE_VERSION, analyseFrames } from '../skills/demo-video/scripts/recorder.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outRoot = path.join(here, 'out');

const fixture = await startFixtureServer(); // 127.0.0.1, cookie sign-in, slow API, form state
const { server, state } = fixture;
const baseUrl = fixture.baseUrl;

let failed = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) failed += 1;
};

try {
  // ---- plan mode, approval and refusal (no browser needed for plan mode) ----
  const planDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-plan-'));
  const approve = path.join(here, '..', 'skills', 'demo-video', 'scripts', 'approve.mjs');
  const fixtureScript = path.join(here, 'fixture-walkthrough.mjs');
  const runsBefore = fs.existsSync(outRoot) ? fs.readdirSync(outRoot).length : 0;
  const plan = await runFixtureWalkthrough({ baseUrl, outRoot, mode: 'plan', planDir });
  const sb = fs.readFileSync(path.join(planDir, 'storyboard.md'), 'utf8');
  check('plan mode writes storyboard.md with every chapter', ['Sign in', 'Fill in a request', 'Look at the list as another person'].every((c) => sb.includes(c)) && plan.mode === 'plan');
  check('storyboard names the engine version', sb.includes('- Engine: ' + ENGINE_VERSION), ENGINE_VERSION);
  check('storyboard lists every step', ['Open the sign-in page', 'Choose Ada Fixture', 'Press Submit', 'Open the Slow report', 'Open the Requests list'].every((x) => sb.includes(x)));
  check('storyboard flags the data-changing step', /Press Submit.*(changes data|DATA)/i.test(sb), 'row for Press Submit');
  check('storyboard has environment, reset command, estimate and open questions', /local/i.test(sb) && sb.includes('none needed') && /estimated/i.test(sb) && sb.includes('Open questions'));
  check('plan mode records nothing', !fs.existsSync(outRoot) || fs.readdirSync(outRoot).length === runsBefore);
  check('storyboard has a "Before recording" section listing the precheck', sb.includes('## Before recording') && sb.includes('The sign-in page offers the two fixture people'));
  check('the app profile (tests/app.json) feeds the environment and the reset command into the storyboard', sb.includes('App profile:') && sb.includes('app.json') && /local/i.test(sb) && sb.includes('none needed: the fixture app keeps no server state'));
  const planProd = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-plan-prod-'));
  await runFixtureWalkthrough({ baseUrl, outRoot, mode: 'plan', planDir: planProd, environment: 'production' });
  const sbProd = fs.readFileSync(path.join(planProd, 'storyboard.md'), 'utf8');
  check('a production environment shows a red warning in the storyboard', /production/i.test(sbProd) && sbProd.includes('DEMO_ALLOW_PRODUCTION=1'));

  let refused = '';
  try { await runFixtureWalkthrough({ baseUrl, outRoot, planDir }); } catch (e) { refused = e.message; }
  check('recording without approval refuses', /Not approved/.test(refused), refused.slice(0, 60));

  // changing the script after approval refuses (uses a scratch script so the real one stays untouched)
  const scratch = path.join(planDir, 'scratch-walkthrough.mjs');
  fs.writeFileSync(scratch, '// version 1');
  await runFixtureWalkthrough({ baseUrl, outRoot, mode: 'plan', planDir, scriptPath: scratch });
  const ap0 = spawnSync(process.execPath, [approve, scratch, planDir], { encoding: 'utf8' });
  fs.appendFileSync(scratch, '// version 2');
  let refused2 = '';
  try { await runFixtureWalkthrough({ baseUrl, outRoot, planDir, scriptPath: scratch }); } catch (e) { refused2 = e.message; }
  check('changing the script after approval refuses', ap0.status === 0 && /changed after approval/.test(refused2), refused2.slice(0, 60));

  // approve the real fixture script
  const ap = spawnSync(process.execPath, [approve, fixtureScript, planDir], { encoding: 'utf8' });
  const approvedHash = (ap.stdout.match(/Hash: ([0-9a-f]{64})/) || [])[1];
  check('approve.mjs writes storyboard.approved.json with the sha256', ap.status === 0 && !!approvedHash && JSON.parse(fs.readFileSync(path.join(planDir, 'storyboard.approved.json'), 'utf8')).scriptSha256 === approvedHash);
  const recArgs = { baseUrl, outRoot, planDir, approvedHash: approvedHash && approvedHash.slice(0, 12) };
  // ---- engine version in the approval ----
  const markerFile = path.join(planDir, 'storyboard.approved.json');
  const marker0 = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
  check('approve.mjs records engineVersion', marker0.engineVersion === ENGINE_VERSION, String(marker0.engineVersion));
  const [maj, min, pat] = ENGINE_VERSION.split('+')[0].split('.').map(Number);
  const setEngine = (v) => { const m = { ...marker0 }; if (v === undefined) delete m.engineVersion; else m.engineVersion = v; fs.writeFileSync(markerFile, JSON.stringify(m, null, 2)); };
  const tryRecord = async () => { try { await runFixtureWalkthrough({ baseUrl, outRoot, planDir, approvedHash: approvedHash.slice(0, 12) }); return ''; } catch (e) { return e.message; } };
  setEngine(`${maj}.${min + 1}.0+deadbeef`);
  const rMinor = await tryRecord();
  check('a different minor version refuses', /The engine changed since you approved\. Re-plan and confirm\./.test(rMinor), rMinor.slice(0, 70));
  setEngine(undefined);
  const rOld = await tryRecord();
  check('an old approval with no engineVersion is a mismatch with a clear message', /Re-plan and confirm/.test(rOld) && /no engine version/.test(rOld), rOld.slice(0, 90));
  process.env.DEMO_APPROVED_ENGINE = `${maj}.${min + 1}.0`;
  setEngine(ENGINE_VERSION);
  const rEnv = await tryRecord();
  delete process.env.DEMO_APPROVED_ENGINE;
  check('DEMO_APPROVED_ENGINE with another minor refuses', /Re-plan and confirm/.test(rEnv), rEnv.slice(0, 70));
  setEngine(`${maj}.${min}.${pat + 1}+deadbeef`); // patch-only difference: warns, still records (checked in the DEMO_FFMPEG=none run below)

  // ---- scripted preconditions and the production gate: all refuse before anything is recorded ----
  const runCount = () => (fs.existsSync(outRoot) ? fs.readdirSync(outRoot).length : 0);
  const savedBeforePre = state.submissions.length;
  let preErr = '';
  const runsBeforePre = runCount();
  try {
    await runFixtureWalkthrough({ ...recArgs, prechecks: (rec) => rec.precheck('The form is still open and unsubmitted', async () => ({ ok: false, seen: 'the form was already submitted (1 saved)' })) });
  } catch (e) { preErr = e.message; }
  check('a failing precheck refuses and says what it saw', /Precheck failed/.test(preErr) && preErr.includes('the form was already submitted') && preErr.includes('nothing was recorded'), preErr.slice(0, 90));
  check('a failing precheck leaves no run folder and saves nothing', runCount() === runsBeforePre && state.submissions.length === savedBeforePre, `${runCount() - runsBeforePre} new folders`);
  let preErr2 = '';
  try {
    await runFixtureWalkthrough({ ...recArgs, prechecks: (rec) => rec.precheck('A check that cannot run', async () => { throw new Error('the selector #nothing was not found'); }) });
  } catch (e) { preErr2 = e.message; }
  check('a precheck that throws counts as failed ("could not check")', /could not check/.test(preErr2) && runCount() === runsBeforePre, preErr2.slice(0, 90));

  delete process.env.DEMO_ALLOW_PRODUCTION;
  let prodErr = '';
  try { await runFixtureWalkthrough({ ...recArgs, environment: 'production' }); } catch (e) { prodErr = e.message; }
  check('environment production refuses without DEMO_ALLOW_PRODUCTION=1', /DEMO_ALLOW_PRODUCTION=1/.test(prodErr) && runCount() === runsBeforePre, prodErr.slice(0, 90));

  // rec.signIn / rec.signOut from the profile, on a scratch page via the engine's own hooks
  {
    const { chromium } = await import('playwright');
    const { signInWith, signOutWith } = await import('../skills/demo-video/scripts/lib/profile.mjs');
    const prof = JSON.parse(fs.readFileSync(path.join(here, 'app.json'), 'utf8'));
    const b = await chromium.launch();
    try {
      const pg = await (await b.newContext()).newPage();
      await signInWith(prof, pg, 'ben', baseUrl);
      const who = await pg.locator('#who').innerText();
      check('profile signIn recipe (card) signs in', who.includes('Ben'), who);
      await signOutWith(prof, pg, baseUrl);
      const msg = await pg.locator('#msg').innerText();
      check('profile signOut recipe signs out', /signed out/i.test(msg), msg);
      let noRecipe = '';
      try { await signInWith({}, pg, 'ada', baseUrl); } catch (e) { noRecipe = e.message; }
      check('rec.signIn without a recipe gives a clear error', /signIn recipe/.test(noRecipe));
    } finally { await b.close(); }
  }
  {
    const ex = JSON.parse(fs.readFileSync(path.join(here, '..', 'skills', 'demo-video', 'app.example.json'), 'utf8'));
    check('app.example.json has the documented fields', ['name', 'baseUrl', 'environment', 'signIn', 'signOut', 'reset', 'notes'].every((k) => k in ex) && ['local', 'shared', 'production'].includes(ex.environment));
  }

  const before = fs.existsSync(outRoot) ? fs.readdirSync(outRoot).length : 0;
  const t0 = Date.now();
  const r1 = await runFixtureWalkthrough(recArgs);
  check('recording works after approval', !!r1.runDir && fs.existsSync(path.join(r1.runDir, 'results.json')));
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\nFixture run 1 took ${secs} s: ${r1.runDir}\n`);

  const runs = fs.readdirSync(outRoot);
  check('a new run folder was produced', runs.length === before + 1 && fs.existsSync(r1.runDir));

  const results = JSON.parse(fs.readFileSync(path.join(r1.runDir, 'results.json'), 'utf8'));
  const clipFiles = fs.readdirSync(path.join(r1.runDir, 'clips')).filter((f) => f.endsWith('.webm'));
  const sizes = clipFiles.map((f) => `${f} ${(fs.statSync(path.join(r1.runDir, 'clips', f)).size / 1024).toFixed(0)} KB`);
  console.log('Clips:\n  ' + sizes.join('\n  '));
  const clipsMode = results.mode === 'clips';
  console.log('Mode: ' + results.mode + ', ffmpeg: ' + (results.ffmpeg.path || 'none'));
  check('timeline entries = chapters + 2 cards', results.clips.length === results.chapters.length + 2, `${results.clips.length} entries, ${results.chapters.length} chapters`);
  check(clipsMode ? 'clips mode: one webm per chapter and card' : 'segments mode: one webm per segment', clipsMode ? clipFiles.length === results.clips.length : clipFiles.length === new Set(results.clips.map((c) => c.segment)).size && clipFiles.every((f) => f.startsWith('segment-')), `${clipFiles.length} files`);
  check('every clip is larger than 20 KB', clipFiles.every((f) => fs.statSync(path.join(r1.runDir, 'clips', f)).size > 20 * 1024));

  const ch = JSON.parse(fs.readFileSync(path.join(r1.runDir, 'chapters.json'), 'utf8'));
  check('chapters.json start times increase', ch.length === results.clips.length && ch.every((c, i) => i === 0 ? c.start === 0 : c.start > ch[i - 1].start));
  check('chapters.txt exists', fs.existsSync(path.join(r1.runDir, 'chapters.txt')));

  const report = fs.readFileSync(path.join(r1.runDir, 'report.md'), 'utf8');
  const rows = report.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Chapter'));
  check('report.md has PASS rows', rows.filter((l) => l.includes('| PASS |')).length >= 5);
  check('report.md has exactly one DIFFERENT row', rows.filter((l) => l.includes('| DIFFERENT |')).length === 1);
  check('the DIFFERENT row says what was seen', rows.some((l) => l.includes('| DIFFERENT |') && l.includes('4 requests listed')));
  check('a passing precheck records, and the result is in results.json and report.md',
    Array.isArray(results.prechecks) && results.prechecks.length === 1 && results.prechecks[0].ok === true
    && report.includes('## Before recording') && report.includes('The sign-in page offers the two fixture people') && results.environment === 'local');
  const estimated = plan.estimatedSeconds;
  const actual = results.totalSeconds;
  const off = Math.abs(estimated - actual) / actual;
  console.log(`Estimate: plan said ${estimated} s, recording took ${actual} s (${(off * 100).toFixed(1)}% apart)`);
  check('the plan estimate is within 15% of the recorded duration', off <= 0.15, `estimated ${estimated} s, actual ${actual} s`);

  const withShots = results.steps.filter((s) => s.shot);
  check('every step has a screenshot file', withShots.length === results.steps.length && withShots.every((s) => fs.existsSync(path.join(r1.runDir, s.shot))));
  check('caption bar was in the DOM at every screenshot', results.steps.every((s) => s.captionPresent === true));
  check('caption bar present on a step right after a navigation', results.steps.some((s) => s.navigatedDuringStep && s.captionPresent));
  check('caption text carries the result line', results.steps.every((s) => s.captionText.includes('RESULT')));

  const player = fs.readFileSync(path.join(r1.runDir, 'player.html'), 'utf8');
  check('player.html references every clip', ch.every((c) => player.includes(c.file)) && clipFiles.every((f) => player.includes(`clips/${f}`)));

  const hasMp4 = fs.existsSync(path.join(r1.runDir, 'full.mp4'));
  check('report.md names the mode', report.includes('Mode: ' + (clipsMode ? 'clips' : 'segments')));
  if (clipsMode) check('clips mode writes full.mp4', hasMp4 && fs.statSync(path.join(r1.runDir, 'full.mp4')).size > 20 * 1024);
  else check('ffmpeg absence is reported, not an error', !hasMp4 && results.ffmpeg.available === false && report.includes('ffmpeg was not found'), 'no ffmpeg, noted in report');
  check('chapters.json has segment, segStart and segEnd', ch.every((c) => c.segment >= 1 && c.segEnd > c.segStart));
  const draft = results.steps.find((x) => x.label === 'Check the draft survived the chapter boundary');
  check('regression: unsaved input and page load survive a chapter boundary', !!draft && draft.status === 'PASS' && String(draft.seen).includes('draft kept'), draft && draft.seen);

  const stepOf = (l) => results.steps.find((x) => x.label === l);
  const passed = (l) => { const s = stepOf(l); return !!s && s.status === 'PASS'; };
  check('portal: the SPA view and page load survive the chapter boundary', passed('Check the portal view survived the chapter boundary') && String(stepOf('Check the portal view survived the chapter boundary').seen).includes('kept'), (stepOf('Check the portal view survived the chapter boundary') || {}).seen);
  check('portal: client-side navigation reached the slow report with no reload', passed('Open Reports from the navigation'), (stepOf('Open Reports from the navigation') || {}).seen);
  check('portal: the cookie session carries over to a later chapter', passed('Open the request form while signed in') && state.signIns >= 1, (stepOf('Open the request form while signed in') || {}).seen);
  check('portal: the form is unsubmitted until Submit, saved after it', passed('Fill in the form without submitting') && passed('Press Submit on the portal form'), (stepOf('Press Submit on the portal form') || {}).seen);
  check('portal: a fresh chapter is signed out', passed('Open the portal as a fresh visitor'), (stepOf('Open the portal as a fresh visitor') || {}).seen);
  check('portal: the server holds exactly one saved request per recording so far', state.submissions.length === 1, `${state.submissions.length}`);

  const fq = results.frameQuality || {};
  check('frame monitor ran and wrote data to results.json', fq.enabled === true && fq.clipsChecked === results.clips.length, `${fq.samples} samples`);
  const blankWhere = (fq.perClip || []).flatMap((c) => c.blankFrames.map((b) => `${c.clip} ${b.start}-${b.end}s x${b.count}`)).join('; ');
  check('zero blank frames', fq.blankFrameRuns === 0, `runs: ${fq.blankFrameRuns}${blankWhere ? ' at ' + blankWhere : ''}; navigation flashes: ${fq.navigationFlashes}`);
  {
    // The rule itself: one unreadable blank sample is a flash; two in a row, or a readable blank, is a violation.
    const mk = (t, blank, read = true) => ({ t, hash: 'h' + t, words: 0, blank, read });
    const a = analyseFrames([mk(0, false), mk(0.4, true, false), mk(0.8, false)]);
    const b = analyseFrames([mk(0, false), mk(0.4, true, false), mk(0.8, true, false), mk(1.2, false)]);
    const c = analyseFrames([mk(0, false), mk(0.4, true, true), mk(0.8, false)]);
    check('frame rule: a single mid-navigation blank is a flash, not a violation', a.blankFrames.length === 0 && a.navigationFlashes.length === 1);
    check('frame rule: a longer or readable blank is a violation', b.blankFrames.length === 1 && c.blankFrames.length === 1);
  }
  check('zero unjustified static holds', fq.unjustifiedStaticRuns === 0, `runs: ${fq.unjustifiedStaticRuns}`);
  const slow = results.steps.find((x) => x.label === 'Open the Slow report');
  check('the slow page (7 s) triggered a progress note', !!slow && slow.progressNotes >= 1 && fq.progressNotes >= 1, `notes: ${slow && slow.progressNotes}`);
  check('report.md has a Frame quality section', report.includes('## Frame quality'));
  console.log(`Frame quality: ${fq.samples} samples, blank ${fq.blankFrameRuns}, unjustified ${fq.unjustifiedStaticRuns}, justified long holds ${fq.justifiedLongHolds}, progress notes ${fq.progressNotes}, max first content ${fq.maxFirstContentMs} ms`);

  const r2 = await runFixtureWalkthrough(recArgs);
  check('a second run creates a second folder', r2.runDir !== r1.runDir && fs.existsSync(r2.runDir));
  check('the first run is intact after the second', fs.existsSync(path.join(r1.runDir, 'results.json')) && fs.readdirSync(path.join(r1.runDir, 'clips')).length === clipFiles.length);

  // Segments mode: ffmpeg disabled with DEMO_FFMPEG=none must warn in report.md and write no full.mp4.
  setEngine(`${maj}.${min}.${pat + 1}+deadbeef`); // patch-only difference: must warn but still record
  process.env.DEMO_FFMPEG = 'none';
  let r3;
  try { r3 = await runFixtureWalkthrough(recArgs); } finally { delete process.env.DEMO_FFMPEG; }
  const res3 = JSON.parse(fs.readFileSync(path.join(r3.runDir, 'results.json'), 'utf8'));
  const rep3 = fs.readFileSync(path.join(r3.runDir, 'report.md'), 'utf8');
  check('DEMO_FFMPEG=none gives segments mode', res3.mode === 'segments' && res3.ffmpeg.available === false);
  check('a patch-only engine difference warns in report.md but still records', rep3.includes('Engine patch difference'), 'warning in report');
  check('DEMO_FFMPEG=none writes no full.mp4', !fs.existsSync(path.join(r3.runDir, 'full.mp4')));
  check('report.md warns "segments mode: no per-chapter clips, no full.mp4" and says how to fix it',
    rep3.includes('ffmpeg was not found') && rep3.includes('segments mode: no per-chapter clips, no full.mp4') && rep3.includes('npm install'));
} catch (e) {
  console.log('FAIL  test run crashed: ' + e.stack);
  failed += 1;
} finally {
  server.close();
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
