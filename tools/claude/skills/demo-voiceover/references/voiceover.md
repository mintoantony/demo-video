# demo-voiceover reference

## Engines and voices

- `piper` (default). Offline neural voice. Default voice `en_GB-cori-medium` (British English, female, 22.05 kHz, about 64 MB). Source: huggingface.co/rhasspy/piper-voices. The recordings are public domain (LibriVox), so the output has no restriction. The voice files live in `<skill>/voices/` and are not committed. For another voice, put its `.onnx` and `.onnx.json` pair into `voices/` and pass `--voice <name>`. Check the licence in its model card first.
- `system`. Uses pyttsx3: Windows SAPI5 (for example "Microsoft Hazel Desktop" en-GB), macOS NSSpeechSynthesizer, or espeak on Linux. Pass `--voice Hazel` to pick one by part of its name. Robotic, but needs no download.
- `edge`. edge-tts calls Microsoft's online service. The narration text leaves the machine. Use it only when the user agrees, with `--allow-online`. Default voice `en-GB-SoniaNeural`; pass `--voice en-GB-RyanNeural` for another.

Choose `piper` unless the user wants something else. The engine that ran is in the report.

## Timing rules

- Speech is estimated at 2.5 words per second. The estimate only flags risk. The real length of each audio file is measured at synthesis time.
- Each line has a budget: from its start to the next step in the same clip (or the clip end). The intro, chapter lead-in and closing start 0.2 s into a clip. Step lines start 0.3 s after the step.
- If a line would start before the previous line ends plus 0.25 s, the video holds its frame at that point for the difference (ffmpeg `tpad`). If the last line runs past the clip end, the last frame is held for the overflow plus 0.2 s. Every hold is listed in `report.md`.
- Short lines avoid holds. Many holds in a row make a demo feel slow, so shorten the text before accepting them.
- Output is 25 fps, h264, yuv420p, with aac audio at 128 kb/s. Clips are joined with a stream copy, so every clip has the same settings.

## ffmpeg

A system `ffmpeg` on PATH is used when present. Otherwise the binary from the `imageio-ffmpeg` package in `.venv` is used. There is no `ffprobe`, so durations are read from `ffmpeg -i`.

## Troubleshooting

- "narration is not approved": show `narration.md`, get a yes, run `approve.py`.
- "narration.json changed after it was approved": run `make_script.py <run> --render`, ask again, approve again.
- `voiced/ already exists`: add `--force` if the user wants it replaced.
- "No ffmpeg found" or import errors: run `python <skill>/setup_voice.py`.
- Piper voice missing: `python <skill>/setup_voice.py` downloads it. Without a network use `--engine system`.
- A system voice fails with "produced no audio": the report lists the line. Retry, or use piper.
- Python without wheels for piper or onnxruntime: `setup_voice.py` falls back to `uv` to create the venv with a supported Python.
- No sound in the result: check `report.md` for failed lines, then run `volumedetect` on one clip.
