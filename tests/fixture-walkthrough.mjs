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

    // Regression: chapters share one page. A chapter without a url must find the page as it was left.
    let draftLoad = null;
    await rec.chapter('Start a draft', { actor: 'Ada Fixture (Manager)', url: '/form.html' }, async ({ page, step, type }) => {
      await step('Type a draft plant name without saving', 'Plant name filled in, nothing saved',
        async () => { await type('#plant', 'Draft basil'); draftLoad = await page.evaluate(() => window.__loadId); },
        async () => ({ ok: draftLoad != null, seen: 'draft typed, not saved' }));
    });

    await rec.chapter('Continue the draft', { actor: 'Ada Fixture (Manager)' }, async ({ page, step }) => {
      await step('Check the draft survived the chapter boundary', 'The field still holds "Draft basil" on the same page load', null,
        async () => {
          const v = await page.locator('#plant').inputValue();
          const id = await page.evaluate(() => window.__loadId);
          const ok = v === 'Draft basil' && id === draftLoad;
          return { ok, seen: ok ? 'draft kept: same page load, field value kept' : `draft lost: value "${v}", same load ${id === draftLoad}` };
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

    // ---- The portal: cookie sign-in, a client-routed app, a slow API, a form that saves only on Submit ----
    let spaLoad = null;
    let savedBefore = 0;
    const countSaved = (page) => page.evaluate(() => fetch('/api/request/count').then((r) => r.json()).then((j) => j.count));
    await rec.chapter('Portal sign-in', { actor: 'Ada Fixture (Manager)', url: '/app/' }, async ({ page, step, click }) => {
      await step('Open the portal without signing in', 'The portal sends us to its sign-in page (no cookie yet)',
        null,
        async () => ({ ok: page.url().endsWith('/app/signin.html'), seen: 'at ' + new URL(page.url()).pathname }));
      await step('Sign in as Ada Fixture', 'The portal opens and its navigation appears after a short wait',
        async () => { await click('#in-ada'); await page.locator('nav.app-nav a', { hasText: 'Reports' }).waitFor({ timeout: 8000 }); },
        async () => ({ ok: (await page.locator('#who').innerText()).includes('Ada Fixture'), seen: await page.locator('#who').innerText() }));
    });

    await rec.chapter('Portal reports', { actor: 'Ada Fixture (Manager)' }, async ({ page, step, click }) => {
      await step('Open Reports from the navigation', 'The Reports view loads its report from a slow service (about 2.5 s), with no page reload',
        async () => {
          spaLoad = await page.evaluate(() => window.__spaLoad);
          await click('nav.app-nav a[data-view="reports"]');
          await page.locator('#rep', { hasText: 'is ready' }).waitFor({ timeout: 15000 });
        },
        async () => {
          const same = (await page.evaluate(() => window.__spaLoad)) === spaLoad;
          const t = await page.locator('#rep').innerText();
          return { ok: same && page.url().endsWith('/app/reports'), seen: `${t} (url ${new URL(page.url()).pathname}, same page load: ${same})` };
        }, { estSec: 3 });
    });

    await rec.chapter('Portal continued', { actor: 'Ada Fixture (Manager)' }, async ({ page, step, click }) => {
      await step('Check the portal view survived the chapter boundary', 'Still on /app/reports, same page load, still signed in',
        null,
        async () => {
          const same = (await page.evaluate(() => window.__spaLoad)) === spaLoad;
          const ok = same && page.url().endsWith('/app/reports') && (await page.locator('#who').innerText()).includes('Ada');
          return { ok, seen: ok ? 'portal view kept across the chapter boundary' : `lost: url ${page.url()}, same load ${same}` };
        });
      await step('Open Team from the navigation', 'The Team view, still without a reload',
        () => click('nav.app-nav a[data-view="team"]'),
        async () => ({ ok: page.url().endsWith('/app/team') && (await page.locator('#team').count()) === 1, seen: 'at ' + new URL(page.url()).pathname }));
    });

    await rec.chapter('Fill in the portal request', { actor: 'Ada Fixture (Manager)', url: '/app/request.html' }, async ({ page, step, type }) => {
      await step('Open the request form while signed in', 'The form opens (the cookie carried over, no sign-in redirect)',
        null,
        async () => ({ ok: page.url().endsWith('/app/request.html'), seen: 'at ' + new URL(page.url()).pathname }));
      await step('Fill in the form without submitting', 'Plant and note filled in; nothing is saved yet',
        async () => { savedBefore = await countSaved(page); await type('#plant', 'Thyme'); await type('#note', 'Shade is fine'); },
        async () => {
          const n = await countSaved(page);
          return { ok: (await page.locator('#plant').inputValue()) === 'Thyme' && n === savedBefore, seen: `filled in, not submitted (${n} saved on the server)` };
        });
    });

    await rec.chapter('Submit the portal request', { actor: 'Ada Fixture (Manager)' }, async ({ page, step, click }) => {
      await step('Press Submit on the portal form', 'The status page says the request is saved',
        async () => {
          if ((await page.locator('#plant').inputValue()) !== 'Thyme') throw new Error('the form was not still filled in');
          await click('#submit');
          await page.locator('#status', { hasText: 'saved' }).waitFor({ timeout: 5000 });
        },
        async () => {
          const t = await page.locator('#status').innerText();
          const n = await countSaved(page);
          return { ok: t.includes('Thyme') && t.includes('Ada Fixture') && n === savedBefore + 1, seen: `${t} (${n} saved on the server)` };
        },
        { changesData: true });
    });

    await rec.chapter('Signed out check', { actor: 'A new visitor', fresh: true, url: '/app/' }, async ({ page, step }) => {
      await step('Open the portal as a fresh visitor', 'The sign-in page says "You are signed out." (the earlier session is not shared)',
        null,
        async () => {
          const t = await page.locator('#msg').innerText();
          return { ok: page.url().endsWith('/app/signin.html') && t.includes('signed out'), seen: t + ' at ' + new URL(page.url()).pathname };
        });
    });

    await rec.closingCard();
  } finally {
    return await rec.finish();
  }
}
