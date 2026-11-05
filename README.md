# Demo Video

Two skills. `/demo-video` records a captioned walkthrough video of a web app. You type `/demo-video` in Claude Code. It plans the video, shows you a storyboard, waits for your yes, then records one clip per chapter. It also writes a report and a player page. The engine is generic and has no code for any one app. `/demo-voiceover` then adds a spoken voice-over to a recorded run, after you approve the script.

Built 2026-11-05 by Minto Antony.

## What is in the folder

| Path | What it is |
|---|---|
| `skills/demo-video/SKILL.md` | The skill: the steps Claude follows |
| `skills/demo-video/scripts/recorder.mjs` | The engine (Playwright, captions, frame monitor) |
| `skills/demo-video/scripts/approve.mjs` | Writes the approval for a script |
| `skills/demo-video/scripts/walkthrough.template.mjs` | Template for a walkthrough script |
| `skills/demo-video/references/` | How to write good walkthroughs |
| `skills/demo-voiceover/SKILL.md` | The voice-over skill (script, confirm, synthesise) |
| `skills/demo-voiceover/scripts/` | `make_script.py`, `approve.py`, `voiceover.py`, `tts.py`, `common.py` |
| `skills/demo-voiceover/setup_voice.py`, `requirements.txt` | Creates `.venv` and downloads the default voice (safe to run again) |
| `skills/demo-voiceover/references/voiceover.md` | Engines, voices, timing rules, troubleshooting |
| `AGENTS.md` | Source of the `demo-video-recorder` agent (Sonnet) |
| `make_tool_copies.mjs` | Builds `tools/claude` from the sources (`--check` tests it) |
| `tools/claude/` | The copies that get installed |
| `install.ps1`, `install.sh` | Install the agent and skills (Windows; macOS and Linux) |
| `.github/workflows/test.yml` | CI: install and tests on macOS, Linux and Windows |
| `tests/` | The test suite and an invented fixture app |

## How it works

1. **Brief.** You give the URL, what to show, the environment and the reset command. If the app has sign-in and the walkthrough switches between users, also say which user each part is signed in as. Apps without sign-in need none of this.
2. **Plan.** The agent explores read-only and writes a script. Plan mode opens no browser. It writes `storyboard.md` with chapters, steps, "you should see", flags for steps that change data, time estimates and open questions.
3. **Approve.** You read the storyboard and say yes. Then `approve.mjs` stores the sha256 of the script. Record mode refuses without it, and refuses again if the script changes.
4. **Record.** Each chapter gets its own clip. It opens on an intro card while the first page loads. A frame monitor checks for blank frames and long identical frames, and writes "Frame quality" into `report.md` and `results.json`.

## Install

Prerequisites: Node.js 18 or newer, and Python 3.9 or newer (for the voice-over skill). On macOS: `brew install node python@3.12`.

macOS and Linux:

```
node make_tool_copies.mjs        # only if tools/claude is missing or stale
bash install.sh                  # or: bash install.sh --prefix /some/folder
```

Windows (PowerShell):

```
node make_tool_copies.mjs
powershell -ExecutionPolicy Bypass -File .\install.ps1      # or: ... -Prefix D:\some\folder
```

Then restart Claude Code. The default prefix is `~/.claude` (Windows: `%USERPROFILE%\.claude`). If `CLAUDE_CONFIG_DIR` is set, that is used. Running the installer again is safe.

| Copied to (under the prefix) | What |
|---|---|
| `agents/demo-video-recorder.md` | The agent |
| `skills/demo-video/` | The skill and engine, then `npm install` |
| `skills/demo-voiceover/` | The voice-over skill, then `setup_voice.py` |

Downloads: the Chromium browser for Playwright (about 150 MB), Python packages, and the default voice (about 64 MB). It needs a network.

macOS notes: the first run may ask for permission (for example to control the terminal or record the screen). Allow it. The `system` voice uses the built-in `say` command. On Linux, install `espeak-ng` for the `system` voice, and run `npx playwright install-deps chromium` if Chromium will not start.

By hand: copy `tools/claude/agents/*` to `<prefix>/agents` and `tools/claude/skills/*` to `<prefix>/skills`. Then run `npm install` and `npx playwright install chromium` in `skills/demo-video`, and `python3 setup_voice.py` in `skills/demo-voiceover` (Windows: `python`).

## How to use it

Type `/demo-video` in Claude Code and answer the questions. Or say "make a demo video of the request flow at http://127.0.0.1:3000".

## Voice-over

Type `/demo-voiceover` after a recording. `make_script.py` writes `voiceover/narration.md` and `narration.json` and speaks nothing. Claude rewrites the wording, you say yes in a loop, `approve.py` stores the sha256 of `narration.json`, and `voiceover.py` refuses without it. It then writes `voiced/NN-slug.mp4` per clip, `voiced/full.mp4` (h264 + aac), `voiced/player.html`, optional `.srt` files with `--subtitles`, and `voiceover/report.md`. When a line is longer than its slot the frame is held and the hold is listed in the report. Originals are never changed; only `voiced/` is overwritten, and only with `--force`.

| Engine | Notes |
|---|---|
| `piper` (default) | Offline. Voice `en_GB-cori-medium` from huggingface.co/rhasspy/piper-voices, British English, public domain (LibriVox recordings) |
| `system` | Offline. Windows SAPI5 (pyttsx3), macOS `say`, Linux espeak-ng |
| `edge` | edge-tts. Online: the text goes to Microsoft. Opt-in with `--allow-online`, after the user agrees |

Licences: imageio-ffmpeg BSD-2-Clause. The ffmpeg binary it ships is a static GPL build (libx264). Used as a separate program, nothing is linked into this repo. A system ffmpeg is preferred if present. piper-tts MIT, pyttsx3 MPL-2.0, edge-tts LGPL-3.0.

No MCP server: plain scripts called by the skill are enough. Nothing needs to stay running between calls.

## Outputs

Each run has its own timestamped folder under `demo-runs/`. Earlier runs are never deleted. It holds `clips/*.webm`, `player.html`, `report.md`, `results.json`, `chapters.json`, `chapters.txt`, `screenshots/`, and `full.mp4` if ffmpeg is installed.

## Limits

- Without ffmpeg you get webm clips and the player page, no single mp4.
- `/demo-video` records no audio. Use `/demo-voiceover` for speech.
- Voice-over: English voices only by default. Speech length is estimated at 2.5 words/s, then measured.
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
python tests/test_voiceover.py   # python3 on macOS/Linux; voice-over skill; needs skills/demo-voiceover/setup_voice.py run once
```

The test run takes a few minutes because the fixture has a page that loads in 7 s.
