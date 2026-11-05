// Walkthrough of the invented fixture app. Used by run-tests.mjs.
// Step 3 of the last chapter is deliberately different from its expectation.
import { createRecorder } from '../skills/demo-video/scripts/recorder.mjs';

export async function runFixtureWalkthrough({ baseUrl, outRoot, fast = true, mode, planDir, scriptPath, approvedHash }) {
  const rec = await createRecorder({
    title: 'Fixture Garden Co: request walkthrough',
    subtitle: 'A test run on an invented app',
    baseUrl, outRoot,
    slowMo: fast ? 40 : 150,
    stepPause: fast ? 500 : 1800,
    cardMs: fast ? 2500 : 4000,
    mode, planDir, approvedHash,
    scriptPath: scriptPath || import.meta.url,
    environment: 'local',
    resetCommand: 'none needed: the fixture app keeps no server state',
    openQuestions: ['Should the list chapter be shown to a manager as well?'],
  });
  try {
    await rec.titleCard();

    await rec.chapter('Sign in', { actor: 'Ada Fixture (Manager)', url: '/index.html' }, async ({ page, step, click }) => {
      await step('Open the sign-in page', 'Two person cards: Ada Fixture and Ben Sample', null,
        async () => ({ ok: (await page.locator('.card').count()) === 2, seen: `${await page.locator('.card').count()} person cards` }));
      await step('Choose Ada Fixture', 'The dashboard opens and says "Signed in as Ada Fixture"',
        () => click('#p-ada'),
        async () => {
          const t = await page.locator('#who').innerText();
          return { ok: t.includes('Ada Fixture'), seen: t };
        });
      await step('Wait for the menu', 'The menu shows Approvals (managers only)',
        () => page.locator('#menu a', { hasText: 'Approvals' }).waitFor({ timeout: 5000 }),
        async () => ({ ok: true, seen: 'Approvals link is in the menu' }));
    });

    await rec.chapter('Fill in a request', { actor: 'Ada Fixture (Manager)', url: '/dashboard.html' }, async ({ page, step, click, type }) => {
      await step('Open New request from the menu', 'The New request form with a disabled Submit button',
        async () => { await page.locator('#menu a', { hasText: 'New request' }).waitFor(); await click('#menu a:has-text("New request")'); },
        async () => ({ ok: await page.locator('#submit').isDisabled(), seen: 'Submit is disabled while the form is empty' }));
      await step('Type the plant name', 'Plant name filled in, Submit still disabled',
        () => type('#plant', 'Rosemary'),
        async () => ({ ok: await page.locator('#submit').isDisabled(), seen: 'Submit still disabled' }));
      await step('Type a note', 'Both fields filled in, Submit now enabled',
        () => type('#note', 'Needs full sun'),
        async () => ({ ok: await page.locator('#submit').isEnabled(), seen: 'Submit is enabled' }));
      await step('Press Submit', 'The message "Request saved"',
        () => click('#submit'),
        async () => {
          const t = await page.locator('#saved').innerText();
          return { ok: t.includes('Request saved'), seen: t };
        }, { changesData: true });
      // This page is deliberately slow (about 7 s). The progress note must cover the wait.
      await step('Open the Slow report', 'The Slow report page with "The report is ready"',
        () => click('#menu a:has-text("Slow report")'),
        async () => {
          const t = await page.locator('#rep').innerText();
          return { ok: t.includes('report is ready'), seen: t };
        });
    });

    await rec.chapter('Look at the list as another person', { actor: 'Ben Sample (Staff)', fresh: true, url: '/index.html' }, async ({ page, step, click }) => {
      await step('Choose Ben Sample', 'The dashboard opens and says "Signed in as Ben Sample"',
        () => click('#p-ben'),
        async () => {
          const t = await page.locator('#who').innerText();
          return { ok: t.includes('Ben Sample'), seen: t };
        });
      await step('Check the menu for Ben', 'No Approvals link (staff cannot approve)',
        () => page.locator('#menu a', { hasText: 'Requests' }).waitFor({ timeout: 5000 }),
        async () => {
          const n = await page.locator('#menu a', { hasText: 'Approvals' }).count();
          return { ok: n === 0, seen: n === 0 ? 'no Approvals link' : 'an Approvals link is shown' };
        });
      await step('Open the Requests list', 'The list shows 3 requests',
        () => click('#menu a:has-text("Requests")'),
        async () => {
          const n = await page.locator('#items li').count();
          return { ok: n === 3, seen: `${n} requests listed` };
        });
    });

    await rec.closingCard();
  } finally {
    return await rec.finish();
  }
}
