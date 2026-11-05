# Demo Video

Records a captioned walkthrough video of a web app. You type `/demo-video` in Claude Code. It plans the video, shows you a storyboard, waits for your yes, then records one clip per chapter. It also writes a report and a player page. The engine is generic and has no code for any one app.

Built 2026-11-05 by Minto Antony.

## What is in the folder

| Path | What it is |
|---|---|
| `skills/demo-video/SKILL.md` | The skill: the steps Claude follows |
| `skills/demo-video/scripts/recorder.mjs` | The engine (Playwright, captions, frame monitor) |
| `skills/demo-video/scripts/approve.mjs` | Writes the approval for a script |
| `skills/demo-video/scripts/walkthrough.template.mjs` | Template for a walkthrough script |
| `skills/demo-video/references/` | How to write good walkthroughs |
| `AGENTS.md` | Source of the `demo-video-recorder` agent (Sonnet) |
| `make_tool_copies.mjs` | Builds `tools/claude` from the sources (`--check` tests it) |
| `tools/claude/` | The copies that get installed |
| `install.ps1` | Installs the agent and skill for your user |
| `tests/` | The test suite and an invented fixture app |

## How it works

1. **Brief.** You give the URL, what to show, who acts, the environment and the reset command.
2. **Plan.** The agent explores read-only and writes a script. Plan mode opens no browser. It writes `storyboard.md` with chapters, steps, "you should see", flags for steps that change data, time estimates and open questions.
3. **Approve.** You read the storyboard and say yes. Then `approve.mjs` stores the sha256 of the script. Record mode refuses without it, and refuses again if the script changes.
4. **Record.** Each chapter gets its own clip. It opens on an intro card while the first page loads. A frame monitor checks for blank frames and long identical frames, and writes "Frame quality" into `report.md` and `results.json`.

## Install it

1. Run `node make_tool_copies.mjs`.
2. Run `powershell -ExecutionPolicy Bypass -File .\install.ps1`.
3. Restart Claude Code.

| Copied to | What |
|---|---|
| `%USERPROFILE%\.claude\agents\demo-video-recorder.md` | The agent |
| `%USERPROFILE%\.claude\skills\demo-video\` | The skill and engine, then `npm install` |

By hand: copy `tools\claude\agents\*` to `%USERPROFILE%\.claude\agents` and `tools\claude\skills\demo-video` to `%USERPROFILE%\.claude\skills\demo-video`. Then run `npm install` and `npx playwright install chromium` there.

## How to use it

Type `/demo-video` in Claude Code and answer the questions. Or say "make a demo video of the request flow at http://127.0.0.1:3000".

## Outputs

Each run has its own timestamped folder under `demo-runs/`. Earlier runs are never deleted. It holds `clips/*.webm`, `player.html`, `report.md`, `results.json`, `chapters.json`, `chapters.txt`, `screenshots/`, and `full.mp4` if ffmpeg is installed.

## Limits

- Without ffmpeg you get webm clips and the player page, no single mp4.
- No audio and no narration. Captions only.
- Chromium only.
- A step that changes data needs a reset command, or it must be marked and approved.

## Rules

- Never record without an approved storyboard.
- Never click an irreversible button unless the storyboard marks it and you allowed it.
- No production without a clear yes.
- Never fake a result. A mismatch is DIFFERENT.

## Run the tests

```
npm install
node tests/run-tests.mjs
node make_tool_copies.mjs --check
```

The test run takes a few minutes because the fixture has a page that loads in 7 s.
