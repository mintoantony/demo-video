# demo-voiceover reference

## Engines and voices

- `piper` (default). Offline neural voice. Default voice `en_GB-cori-medium` (British English, female, 22.05 kHz, about 64 MB). Source: huggingface.co/rhasspy/piper-voices. The recordings are public domain (LibriVox), so the output has no restriction. The voice files live in `<skill>/voices/` and are not committed. For another voice, put its `.onnx` and `.onnx.json` pair into `voices/` and pass `--voice <name>`. Check the licence in its model card first.
- `system`. Windows: pyttsx3 with SAPI5 (for example "Microsoft Hazel Desktop" en-GB). macOS: the built-in `say` command, converted to wav with ffmpeg (no extra packages). Linux: `espeak-ng` (install it with `sudo apt-get install espeak-ng` or your package manager), else pyttsx3. Pass `--voice Daniel` (macOS) or `--voice Hazel` (Windows) to pick one by part of its name. Robotic, but needs no download.
- `edge`. edge-tts calls Microsoft's online service. The narration text leaves the machine. Use it only when the user agrees, with `--allow-online`. Default voice `en-GB-SoniaNeural`; pass `--voice en-GB-RyanNeural` for another. Tested on 2026-11-06 with only the invented fixture narration (`DEMO_TEST_ONLINE=1 python tests/test_voiceover.py`): it synthesised, normalised and mixed like the other engines.

Choose `piper` unless the user wants something else. The engine that ran is in the report.

## Timing rules

- Speech is estimated at 2.5 words per second. The estimate only flags risk. The real length of each audio file is measured at synthesis time.
- Each line has a budget: from its start to the next step in the same clip (or the clip end). The intro, chapter lead-in and closing start 0.2 s into a clip. Step lines start 0.3 s after the step.
- If a line would start before the previous line ends plus 0.25 s, the video holds its frame at that point for the difference (ffmpeg `tpad`). If the last line runs past the clip end, the last frame is held for the overflow plus 0.2 s. Every hold is listed in `report.md`.
- Short lines avoid holds. Many holds in a row make a demo feel slow, so shorten the text before accepting them.
- Draft style: `make_script.py` writes plain narration ("First, sign in." / "We click the card. George is signed in and the menu appears.") and shortens a line by dropping trailing sentences and clauses until it fits its slot (rules in `scripts/draft.py`, deterministic). `--style brief` keeps only the outcome.
- Loudness: each synthesised line goes through two-pass ffmpeg `loudnorm` (I=-16 LUFS, TP=-1.5 dBTP, LRA=11), then the mix passes `alimiter` (limit 0.84, about -1.5 dB). Before this, a mixed `full.mp4` peaked at 0.0 dBFS (mean -19.4 dB). `report.md` records the measured values.
- Output is 25 fps, h264, yuv420p, with aac audio at 128 kb/s. Clips are joined with a stream copy, so every clip has the same settings.

## ffmpeg

A system `ffmpeg` on PATH is used when present. Otherwise the binary from the `imageio-ffmpeg` package in `.venv` is used. There is no `ffprobe`, so durations are read from `ffmpeg -i`.

## Troubleshooting

- "narration is not approved": show `narration.md`, get a yes, run `approve.py`.
- "narration.json changed after it was approved": run `make_script.py <run> --render`, ask again, approve again.
- `voiced/ already exists`: add `--force` if the user wants it replaced.
- "No ffmpeg found" or import errors: run `python <skill>/setup_voice.py` (`python3` on macOS and Linux).
- Piper voice missing: `python <skill>/setup_voice.py` downloads it. Without a network use `--engine system`.
- A system voice fails with "produced no audio": the report lists the line. Retry, or use piper.
- Python without wheels for piper or onnxruntime: `setup_voice.py` falls back to `uv` to create the venv with a supported Python.
- No sound in the result: check `report.md` for failed lines, then run `volumedetect` on one clip.

## macOS and Linux

- Use `python3` where this file says `python`. The venv python is `<skill>/.venv/bin/python` (Windows: `.venv\Scripts\python.exe`).
- macOS may ask once whether Terminal (or your editor) may control or record the screen, and the first `say` run can be slow. Allow it.
- If Homebrew or Debian Python refuses `pip install` (externally managed), setup_voice.py already avoids that: it builds its own venv and, when needed, a throwaway venv for `uv`.
- Linux `system` engine needs `espeak-ng`. Piper needs no system packages.
