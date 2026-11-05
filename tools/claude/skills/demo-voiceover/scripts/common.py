"""Shared helpers for demo-voiceover (stdlib only, except the ffmpeg lookup)."""
import hashlib, json, os, re, shutil, subprocess, sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
VENV_PY = SKILL_DIR / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
WORDS_PER_SEC = 2.5
STEP_OFFSET = 0.3      # a step's line starts this long after the step starts
LEAD_OFFSET = 0.2      # the intro, chapter lead-in and closing start this far into the clip
GAP = 0.25             # silence kept between two spoken lines


def reexec_in_venv():
    """Re-run the current script inside the skill's venv when its libraries are needed."""
    if os.environ.get("DEMO_VOICEOVER_NO_REEXEC"):
        return
    try:
        inside = Path(sys.prefix).resolve() == (SKILL_DIR / ".venv").resolve()
    except OSError:
        inside = False
    if not inside and VENV_PY.exists():
        env = dict(os.environ, DEMO_VOICEOVER_NO_REEXEC="1")
        sys.exit(subprocess.run([str(VENV_PY), *sys.argv], env=env).returncode)


def sha256_file(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def est_seconds(text):
    return round(len(re.findall(r"\S+", text)) / WORDS_PER_SEC, 1)


def voice_dir(run):
    return Path(run) / "voiceover"


def load_json(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def find_ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        sys.exit("No ffmpeg found. Run: python setup_voice.py (installs imageio-ffmpeg into .venv)")


def ffmpeg_info(ffmpeg, path):
    """Return (duration_sec, has_audio, has_video) from `ffmpeg -i`."""
    r = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path)], capture_output=True, text=True)
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", r.stderr)
    dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0.0
    return dur, " Audio:" in r.stderr, " Video:" in r.stderr


def srt_time(t):
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def load_results(run):
    """Read results.json. A run recorded without ffmpeg shares one webm per segment, so cut one
    clip per chapter and card into <run>/voiceover/clips/ and point the timeline at those files.
    The original run files are only read."""
    run = Path(run)
    res = load_json(run / "results.json")
    if res.get("mode") != "segments":
        return res
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        raise SystemExit("This run has no per-chapter clips (recorded without ffmpeg) and no ffmpeg is available to cut them.")
    out = run / "voiceover" / "clips"
    out.mkdir(parents=True, exist_ok=True)
    remap = {}
    for c in res["clips"]:
        slug = re.sub(r"[^a-z0-9]+", "-", str(c["title"]).lower()).strip("-")[:40] or "clip"
        rel = f"voiceover/clips/{int(c['n']):02d}-{slug}.webm"
        dst = run / rel
        if not dst.exists():
            r = subprocess.run([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(run / c["file"]),
                                "-ss", str(c["segStart"]), "-to", str(c["segEnd"]), "-c:v", "libvpx",
                                "-deadline", "realtime", "-cpu-used", "8", "-b:v", "2M", "-an", str(dst)],
                               capture_output=True, text=True)
            if r.returncode != 0:
                raise SystemExit(f"Could not cut {rel}: {r.stderr[-300:]}")
        remap.setdefault(c["file"], {})[c["n"]] = rel
        c["file"] = rel
    # chapters and steps still name the shared segment file; their chapter's own clip is found by index
    by_title = {c["title"]: c["file"] for c in res["clips"] if c.get("kind") == "chapter"}
    for ch in res.get("chapters", []):
        if ch["title"] in by_title:
            ch["clip"] = by_title[ch["title"]]
    for s in res.get("steps", []):
        if s.get("chapter") in by_title:
            s["clip"] = by_title[s["chapter"]]
    return res
