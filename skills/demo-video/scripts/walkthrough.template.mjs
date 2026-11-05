// walkthrough.template.mjs - copy this file, rename it, fill in the TODO parts.
// Run it with:  node my-walkthrough.mjs
// It imports the engine from the same folder; keep recorder.mjs next to it,
// or change the import path below.
//
// Rules for a good walkthrough:
//  - One chapter = one thing a viewer wants to learn. 3 to 8 steps each.
//  - Every step says what you should see ("expect"). Write it as a plain sentence.
//  - A check returns { ok, seen }. Say what is on screen, never what you hope is there.
//  - A step that throws is recorded as COULD NOT DO and the chapter goes on.
//  - Do not click anything that cannot be undone unless the brief says so.

import { createRecorder } from './recorder.mjs';

const rec = await createRecorder({
  title: 'TODO: name of the app and the topic',          // shown on the title card
  subtitle: 'TODO: one line, e.g. the date and the build',
  baseUrl: 'http://127.0.0.1:3000',                      // TODO: where the app runs (prefer 127.0.0.1 over localhost)
  outRoot: './demo-runs',                                // every run gets its own timestamped folder here
  // viewport: { width: 1920, height: 1080 },
  // slowMo: 150,       // ms between browser actions; viewers need this to follow
  // stepPause: 1800,   // ms the result stays on screen
  // headless: true,

  // Plan, approve, record (see SKILL.md):
  //   DEMO_MODE=plan node my-walkthrough.mjs     -> writes storyboard.md, records nothing
  //   node approve.mjs my-walkthrough.mjs        -> after the user says yes
  //   DEMO_MODE=record node my-walkthrough.mjs   -> refuses without approval or if this file changed
  scriptPath: import.meta.url,
  environment: 'local',                                  // TODO: local, shared or production
  resetCommand: 'TODO: command that puts the data back, or "none needed"',
  openQuestions: [],                                     // TODO: things the user should decide
});

try {
  await rec.titleCard();

  // ---- Chapter 1: sign in -------------------------------------------------
  // 'actor' is shown in the caption as "Acting as: ...".
  // 'url' is opened first. 'fresh: true' starts signed out (no carried sign-in).
  await rec.chapter('Sign in', { actor: 'TODO person or role', url: '/' }, async ({ page, step, click, type }) => {
    await step(
      'Open the sign-in page',                 // what we do
      'TODO: what the viewer should see',      // what we expect
      null,                                    // nothing to do, we only look
      async () => {                            // check
        const seen = await page.title();
        return { ok: seen.length > 0, seen: `page title is "${seen}"` };
      },
    );

    await step(
      'Click the first person card',
      'TODO: the dashboard opens',
      () => click('text=TODO name'),           // click() outlines the element, then clicks it
      async () => {
        const t = await page.locator('h1').first().innerText();
        return { ok: /dashboard/i.test(t), seen: `heading is "${t}"` };
      },
    );

    // Menus that depend on who you are often appear late. Wait for them in the action,
    // so a missing menu becomes COULD NOT DO instead of a wrong claim.
    // A step that saves, sends or deletes something must say so, so it shows in the storyboard:
    //   await step('Press Submit', 'Request saved', () => click('#submit'), check, { changesData: true });
    //   add irreversible: true when it cannot be undone.
    await step(
      'Open the Reports page from the menu',
      'TODO: the Reports page',
      async () => {
        await page.locator('nav a', { hasText: 'Reports' }).waitFor({ timeout: 8000 });
        await click('nav a:has-text("Reports")');
      },
      async () => ({ ok: page.url().includes('/reports'), seen: `address is ${page.url()}` }),
    );
  });

  // ---- Chapter 2: a second person -------------------------------------------
  // The first chapter's sign-in is carried over automatically.
  // Use fresh: true to start signed out as someone else.
  await rec.chapter('TODO second chapter', { actor: 'TODO other person', fresh: true, url: '/' }, async ({ page, step, click }) => {
    await step('TODO what we do', 'TODO what we expect', () => click('text=TODO'), async () => ({ ok: true, seen: 'TODO' }));
  });

  await rec.closingCard();
} finally {
  // finish() always writes report.md, results.json, chapters.json, player.html (and full.mp4 if ffmpeg exists),
  // even if a chapter crashed.
  const out = await rec.finish();
  console.log('\nRun folder:', out.runDir);
  console.log('Summary:', JSON.stringify(out.summary));
  console.log('Open:', out.player);
}
