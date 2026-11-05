#!/usr/bin/env python3
"""Idempotent setup for demo-voiceover.

Creates .venv inside this skill folder, installs requirements.txt and downloads the
default piper voice into voices/. Safe to run again: finished steps are skipped.

    python setup_voice.py [--voice en_GB-cori-medium] [--no-voice] [--recreate]

If the running Python has no wheels for piper-tts / onnxruntime (new Python releases
often lag), it uses `uv` (installed with pip if missing) to fetch a managed Python 3.12.
"""
import argparse, os, subprocess, sys, urllib.request, shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENV = HERE / ".venv"
VOICES = HERE / "voices"
DEFAULT_VOICE = "en_GB-cori-medium"
HF = "https://huggingface.co/rhasspy/piper-voices/resolve/main"


def venv_python():
    return VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def run(cmd, **kw):
    print("+", " ".join(str(c) for c in cmd))
    return subprocess.run([str(c) for c in cmd], **kw)


def can_install(py):
    """True if piper-tts and onnxruntime have wheels for this interpreter."""
    for pkg in ("onnxruntime", "piper-tts"):
        r = run([py, "-m", "pip", "download", pkg, "--no-deps", "--only-binary=:all:", "-d",
                 HERE / ".wheelcheck", "-q"], capture_output=True)
        if r.returncode != 0:
            return False
    shutil.rmtree(HERE / ".wheelcheck", ignore_errors=True)
    return True


def make_venv(recreate):
    if recreate and VENV.exists():
        shutil.rmtree(VENV)
    if venv_python().exists():
        return "pip"
    if can_install(sys.executable):
        run([sys.executable, "-m", "venv", VENV], check=True)
        return "pip"
    print("No piper/onnxruntime wheels for this Python; using uv with a managed Python 3.12.")
    r = run([sys.executable, "-m", "pip", "install", "--quiet", "uv"])
    if r.returncode != 0:
        sys.exit("Could not install uv. Install Python 3.12 and run setup again with it.")
    run([sys.executable, "-m", "uv", "venv", "--python", "3.12", VENV], check=True)
    return "uv"


def install(kind):
    req = HERE / "requirements.txt"
    if kind == "uv":
        run([sys.executable, "-m", "uv", "pip", "install", "--python", venv_python(), "-r", req], check=True)
    else:
        run([venv_python(), "-m", "pip", "install", "--quiet", "-r", req], check=True)


def voice_paths(name, voices_dir=VOICES):
    return Path(voices_dir) / f"{name}.onnx", Path(voices_dir) / f"{name}.onnx.json"


def voice_url_dir(name):
    lang_region, speaker, quality = name.split("-", 2)
    lang = lang_region.split("_")[0]
    return f"{HF}/{lang}/{lang_region}/{speaker}/{quality}/{name}"


def download_voice(name, voices_dir=VOICES):
    onnx, cfg = voice_paths(name, voices_dir)
    Path(voices_dir).mkdir(parents=True, exist_ok=True)
    base = voice_url_dir(name)
    for dest, url in ((cfg, base + ".onnx.json"), (onnx, base + ".onnx")):
        if dest.exists() and dest.stat().st_size > 0:
            continue
        print(f"Downloading {url}")
        tmp = dest.with_suffix(dest.suffix + ".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.replace(dest)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default=DEFAULT_VOICE)
    ap.add_argument("--no-voice", action="store_true")
    ap.add_argument("--recreate", action="store_true")
    a = ap.parse_args()
    kind = make_venv(a.recreate)
    install(kind)
    if not a.no_voice:
        download_voice(a.voice)
    print(f"Setup complete. Python: {venv_python()}")


if __name__ == "__main__":
    main()
