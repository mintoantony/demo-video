# Writing walkthroughs

Read this before you write a walkthrough script. The engine is `scripts/recorder.mjs`.
The starting point is `scripts/walkthrough.template.mjs`.

## The three results

Every step ends in one of three results. The caption shows the result, so it must be true.

| Result | When | Caption says |
|---|---|---|
| PASS | The action worked and the check returned `ok: true` | As expected, plus what was seen |
| DIFFERENT | The action worked, the check returned `ok: false` | What was actually on screen |
| COULD NOT DO | The action or the check threw | The error, first line |

- A check returns `{ ok, seen }`. `seen` is a plain description of the screen ("4 requests listed").
- Never write a check that always returns `ok: true`. A check that cannot fail proves nothing.
- Never change `expect` after the fact to match what you saw. Leave it, and let the result say DIFFERENT.
- DIFFERENT is not a failure of the video. It is a finding. Report it.

## Before you record

1. Explore read-only first. Write a throwaway script that opens the pages, prints headings, links and buttons, and takes screenshots. Do not click anything that changes data.
2. Decide for each chapter: does it change data (create, edit, delete, grant, approve, send)? If yes, it is a mutating chapter.
3. Mutating chapters can be recorded once per data reset. After one run the data has changed, so a second run shows a different screen. Find the reset command first (a script, a seed command, a restore). If there is none, tell the person and ask.
4. Never record against shared or production systems unless the person said so in plain words. Prefer a local copy with invented data.
5. Dry-run the read-only chapters with the real script. Record once when they are stable.

## Selectors

Pick the most stable thing, in this order.

| Prefer | Example |
|---|---|
| Role and name | `page.getByRole('button', { name: 'Submit' })` |
| Label | `page.getByLabel('Plant name')` |
| Visible text | `page.getByText('Ada Fixture')` or `'text=Ada Fixture'` |
| Test id or stable id | `'#submit'`, `'[data-testid=save]'` |
| CSS class | last resort; classes change |

- Avoid `nth()` and long CSS paths. A new row in a list will break them.
- `click('...')` and `type('...')` accept a selector string or a Playwright locator. They wait for the element to be visible, outline it in pink, then act.
- If two elements match, a string selector uses the first. Use a locator with `.filter()` when that is not what you want.

## Waiting

- Do not use fixed sleeps in the action. Wait for the thing you need: `locator.waitFor()`, or `page.waitForURL()`.
- Menus that depend on who you are (role, permission, feature flag) often appear after the page has loaded. Wait for the menu item in the action. If it never comes, the step becomes COULD NOT DO, which is the honest result. Do not click blindly.
- After a click that navigates, the engine waits for the page to settle before the check. For slow single-page apps, wait for a specific element in the check or action as well.
- Slow motion (`slowMo`) and the pause after each result (`stepPause`) are for the viewer. Keep them. Lower them only for dry runs.

## Signing in

| Situation | Pattern |
|---|---|
| Person cards or a dev login | Click the card in the first chapter. The sign-in is carried into the next chapter. |
| Username and password | `type('#user', ...)`, `type('#pass', ...)`, click Sign in. Use invented or test accounts only. Never write a real password into a script or a report. |
| Second person | Start the next chapter with `{ fresh: true }`, then sign in as them. |
| Single sign-on you cannot script | Stop and ask for a test account or a saved session. Do not try to get round it. |

The carry-over uses Playwright storage state (cookies and local storage). It does not carry session storage. If the app keeps its sign-in only in session storage, sign in again at the start of each chapter.

## Captions

- The caption bar is drawn by the engine and put back after every page load, so it survives navigations and reloads.
- Keep `step` labels short and in plain words: "Open the New request form".
- Write `expect` as what the viewer should see on screen, not what the code does.
- The caption must never claim something the screen did not show. That is why the result comes from a check, not from the fact that the click worked.

## Chapters

- All chapters share one page; `fresh: true` starts signed out. One chapter, one clip (cut by ffmpeg when available). People want to share one chapter, so each chapter should make sense alone. Start it with `url` so it opens on the right page.
- 3 to 8 steps per chapter. A long chapter is hard to watch.
- Name chapters after what the viewer learns: "Create a request", not "Chapter 2".

## Safety rules

- Never click anything irreversible or destructive (delete, send, pay, approve, publish, disable a user, reset data) unless the brief says to, and then only on a local or test copy.
- If you grant a permission, switch on a flag or create a record to show something, undo it before you finish, and say so in the report.
- Never record real personal data. If the app shows it, stop and tell the person, or use a copy with invented data.
- Never put a secret into a script, a caption, a screenshot name or a report.
- Never run against production.

## Pitfalls

| Pitfall | What to do |
|---|---|
| Second run of a mutating chapter shows different data | Reset first, or record once and say it was a single take |
| `localhost` does not connect | Use `127.0.0.1`. Some PCs resolve localhost to `::1` and the server only listens on IPv4 |
| Git Bash `npm` fails (fnm), Windows only | Use PowerShell: `& "C:\Program Files\nodejs\npm.cmd" install`. On macOS and Linux plain `npm install` works |
| Backslashes lost when writing a script from a shell heredoc | Write the file with the Write tool, not a heredoc |
| Video is only `.webm` | Playwright cannot write mp4. `player.html` plays the clips in order. `full.mp4` is made only if `ffmpeg` is already on PATH |
| Clip is tiny or blank | The page never loaded. Check the base URL and that the app is running |
| Caption missing in a screenshot | Open `results.json`; every step has `captionPresent`. If false, the page replaced the whole document or blocks inline styles. Say so in the report |
| Step passed but the screen looks wrong | Look at the screenshot. Tighten the check. Never fix it by editing `expect` |
| Earlier run overwritten | It cannot be: every run has its own timestamped folder. Never delete older runs |
| No audio | The video has no voice and no narration. The captions carry the story |

## Plan, approve, record

The same script is used three times.

1. `DEMO_MODE=plan node my-walkthrough.mjs` opens no browser. It writes `storyboard.md` from the script.
2. The user reads `storyboard.md` and says yes. Then `node approve.mjs my-walkthrough.mjs` stores the script's sha256.
3. `DEMO_MODE=record node my-walkthrough.mjs` records. It refuses if there is no approval or if the script changed since.

Mark a step that saves, sends, approves or deletes with `{ changesData: true }` as the last argument of `step(...)`. Add `irreversible: true` if it cannot be undone. Both show as flags in the storyboard. Set `environment` (local, shared or production), `resetCommand` and `openQuestions` in `createRecorder`, so the storyboard can show them.

A step that waits more than 3 seconds gets a progress note in the caption on its own. Do not add sleeps to fill the time.
