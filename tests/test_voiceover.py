"""Tests for the demo-voiceover skill. Run: python tests/test_voiceover.py   (or pytest tests/test_voiceover.py)

Works on a COPY of the newest run in tests/out (made by tests/run-tests.mjs). The original run is never modified.
"""
import hashlib, json, re, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "skills" / "demo-voiceover"
SCRIPTS = SKILL / "scripts"
_RUNS = sorted(d for d in (ROOT / "tests" / "out").glob("2*") if (d / "chapters.json").exists())     if (ROOT / "tests" / "out").exists() else []
if not _RUNS:
    sys.exit("No recorded run in tests/out. Run: node tests/run-tests.mjs")
SRC_RUN = _RUNS[-1]  # newest fixture run
PY = SKILL / ".venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
PY = str(PY if PY.exists() else sys.executable)
sys.path.insert(0, str(SCRIPTS))
import common  # noqa: E402
common.reexec_in_venv()  # need imageio-ffmpeg from the skill's venv

FFMPEG = common.find_ffmpeg()
_cache = {}


def sh(script, *args):
    r = subprocess.run([PY, str(SCRIPTS / script), *map(str, args)], capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def sha_tree(d):
    return {str(p.relative_to(d)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(Path(d).rglob("*")) if p.is_file()}


def fresh_run():
    tmp = Path(tempfile.mkdtemp(prefix="vo_test_"))
    run = tmp / "run"
    shutil.copytree(SRC_RUN, run)
    return run


def draft(run):
    code, out = sh("make_script.py", run)
    assert code == 0, out
    return json.loads((run / "voiceover" / "narration.json").read_text(encoding="utf-8"))


def approve(run):
    code, out = sh("approve.py", run / "voiceover" / "narration.json")
    assert code == 0, out


def test_make_script():
    run = fresh_run()
    doc = draft(run)
    vd = run / "voiceover"
    assert (vd / "narration.md").exists() and (vd / "narration.json").exists()
    res = json.loads((run / "results.json").read_text(encoding="utf-8"))
    ids = {l["id"] for l in doc["lines"]}
    assert "intro" in ids and "closing" in ids
    for i, ch in enumerate(res["chapters"], 1):
        assert f"c{i}" in ids, f"missing lead-in c{i}"
    for s in res["steps"]:
        assert f"c{s['chapterIndex']}s{s['step']}" in ids, f"missing step line {s}"
    assert not list((run / "voiced").glob("*")) if (run / "voiced").exists() else True
    # a second draft must not clobber reworded lines
    code, _ = sh("make_script.py", run)
    assert code != 0
    return run, doc, res


def test_different_step_mentions_seen():
    run, doc, res = test_make_script()
    diff = [s for s in res["steps"] if s["status"] == "DIFFERENT"]
    assert diff, "fixture should hold a DIFFERENT step"
    for s in diff:
        line = next(l for l in doc["lines"] if l["id"] == f"c{s['chapterIndex']}s{s['step']}")
        seen = s["seen"].rstrip(".")
        assert seen in line["text"], line["text"]
        assert "expected" in line["text"].lower() or "could not" in line["text"].lower(), line["text"]


def test_draft_is_usable():
    """The draft fits every slot, has no 'As expected' filler and no stray capitals after the first word."""
    run, doc, _ = test_make_script()
    assert doc["overflowCount"] == 0, [l["id"] for l in doc["lines"] if l["overflow"]]
    assert doc["style"] == "plain"
    for l in doc["lines"]:
        t = l["text"]
        assert "As expected," not in t and not t.startswith("As expected"), t
        assert l["estSec"] <= l["budgetSec"], (l["id"], t)
        if l["kind"] == "step":
            assert t.startswith("We "), t
            assert not re.match(r"We [A-Z][a-z]+ ", t), t       # "We Open ..." is a stray capital
    lead = [l for l in doc["lines"] if l["kind"] == "lead"]
    assert re.match(r"First, ", lead[0]["text"])


def test_brief_style():
    run = fresh_run()
    code, out = sh("make_script.py", run, "--style", "brief")
    assert code == 0, out
    doc = json.loads((run / "voiceover" / "narration.json").read_text(encoding="utf-8"))
    assert doc["style"] == "brief" and doc["overflowCount"] == 0
    plain = draft(fresh_run())
    assert doc["totalEstSec"] <= plain["totalEstSec"]


def test_overflow_flags():
    run, doc, _ = test_make_script()
    nj = run / "voiceover" / "narration.json"
    doc["lines"][0]["text"] = "word " * 80
    nj.write_text(json.dumps(doc), encoding="utf-8")
    code, out = sh("make_script.py", run, "--render")
    assert code == 0, out
    d2 = json.loads(nj.read_text(encoding="utf-8"))
    first = d2["lines"][0]
    assert first["estSec"] == round(80 / 2.5, 1) and first["overflow"] is True
    for l in d2["lines"]:
        assert l["overflow"] == (l["estSec"] > l["budgetSec"])
    assert d2["overflowCount"] == sum(1 for l in d2["lines"] if l["overflow"])
    assert "OVERFLOW" in (run / "voiceover" / "narration.md").read_text(encoding="utf-8")


def test_refuses_without_approval_and_after_edit():
    run = fresh_run()
    draft(run)
    code, out = sh("voiceover.py", run, "--engine", "system")
    assert code != 0 and "not approved" in out, out
    assert not (run / "voiced").exists() or not any((run / "voiced").iterdir())
    approve(run)
    nj = run / "voiceover" / "narration.json"
    d = json.loads(nj.read_text(encoding="utf-8"))
    d["lines"][0]["text"] += " Edited after approval."
    nj.write_text(json.dumps(d), encoding="utf-8")
    code, out = sh("voiceover.py", run, "--engine", "system")
    assert code != 0 and "changed after it was approved" in out, out
    assert not (run / "voiced").exists() or not any((run / "voiced").iterdir())


def check_engine(engine, extra=()):
    run = fresh_run()
    before = sha_tree(run / "clips")
    res_before = hashlib.sha256((run / "results.json").read_bytes()).hexdigest()
    doc = draft(run)
    nj = run / "voiceover" / "narration.json"
    # shorten lines a little so the check is quick, keep structure
    code, out = sh("make_script.py", run, "--render", "--engine", engine)
    assert code == 0, out
    approve(run)
    code, out = sh("voiceover.py", run, "--engine", engine, "--subtitles", *extra)
    assert code == 0, out
    res = json.loads((run / "results.json").read_text(encoding="utf-8"))
    voiced = run / "voiced"
    total = 0.0
    files = sorted(p for p in voiced.glob("*.mp4") if p.name != "full.mp4")
    assert len(files) == len(res["clips"]), files
    for f in files:
        d, has_a, has_v = common.ffmpeg_info(FFMPEG, f)
        assert has_a and has_v and d > 0, f
        total += d
    full = voiced / "full.mp4"
    assert full.exists() and (voiced / "player.html").exists()
    fd, fa, _ = common.ffmpeg_info(FFMPEG, full)
    assert fa
    assert fd >= total - 1.0, (fd, total)
    # loudness: speech is normalised, nothing near clipping
    mean, mx = volume(first_voiced := files[0])
    assert mx <= -1.0, (first_voiced, mx)
    assert -24 <= mean <= -14, (first_voiced, mean)
    # originals untouched
    assert sha_tree(run / "clips") == before
    assert hashlib.sha256((run / "results.json").read_bytes()).hexdigest() == res_before
    assert (run / "voiceover" / "report.md").exists()
    # subtitles
    srts = list(voiced.glob("*.srt"))
    assert len(srts) == len(files) + 1
    for s in srts:
        check_srt(s)
    # re-running refuses without --force, works with it
    code, out = sh("voiceover.py", run, "--engine", engine)
    assert code != 0 and "already exists" in out
    return run, fd, total


def volume(path):
    """(mean_volume, max_volume) in dB from ffmpeg volumedetect."""
    r = subprocess.run([FFMPEG, "-hide_banner", "-nostats", "-i", str(path), "-af", "volumedetect", "-vn", "-f", "null", "-"],
                       capture_output=True, text=True)
    m = re.search(r"mean_volume:\s*(-?[\d.]+) dB", r.stderr)
    x = re.search(r"max_volume:\s*(-?[\d.]+) dB", r.stderr)
    assert m and x, r.stderr[-300:]
    return float(m.group(1)), float(x.group(1))


def test_edge_engine_online():
    """Opt-in: sends the fixture's invented narration to Microsoft's online voice. Run with DEMO_TEST_ONLINE=1."""
    import os
    if os.environ.get("DEMO_TEST_ONLINE") != "1":
        print("SKIP edge engine: set DEMO_TEST_ONLINE=1 to run it (needs internet)")
        return
    run = fresh_run()
    draft(run)
    code, out = sh("make_script.py", run, "--render", "--engine", "edge")
    assert code == 0, out
    approve(run)
    code, out = sh("voiceover.py", run, "--engine", "edge", "--allow-online")
    assert code == 0, out
    full = run / "voiced" / "full.mp4"
    assert full.exists()
    d, has_a, _ = common.ffmpeg_info(FFMPEG, full)
    assert has_a and d > 0


def check_srt(path):
    txt = Path(path).read_text(encoding="utf-8").strip()
    assert txt, path
    blocks = re.split(r"\n\s*\n", txt)
    last_end = -1
    for n, b in enumerate(blocks, 1):
        lines = b.split("\n")
        assert lines[0] == str(n), (path, b)
        m = re.fullmatch(r"(\d\d):(\d\d):(\d\d),(\d{3}) --> (\d\d):(\d\d):(\d\d),(\d{3})", lines[1])
        assert m, (path, lines[1])
        g = [int(x) for x in m.groups()]
        a = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
        e = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
        assert e > a and a >= last_end - 0.001, (path, lines[1])
        last_end = e
        assert len(lines) >= 3 and lines[2].strip()


def system_voice_works():
    """True if the OS voice can write a wav here (a CI Windows runner has no SAPI voice or audio device)."""
    code = ("import sys; sys.path.insert(0, sys.argv[1]); import tts; "
            "p = tts.SystemEngine().synth('Hello.', sys.argv[2]); print(p)")
    out = Path(tempfile.mkdtemp(prefix="vo_probe_")) / "probe"
    try:
        r = subprocess.run([PY, "-c", code, str(SCRIPTS), str(out)], capture_output=True, text=True, timeout=90)
    except subprocess.TimeoutExpired:
        return False
    return r.returncode == 0


def test_system_engine():
    if not system_voice_works():
        print("SKIP system engine: no usable system voice on this machine")
        return
    check_engine("system")


def test_piper_engine():
    if not (SKILL / "voices" / "en_GB-cori-medium.onnx").exists():
        print("SKIP piper: voice not downloaded")
        return
    run, fd, total = check_engine("piper")
    report = (run / "voiceover" / "report.md").read_text(encoding="utf-8")
    assert "Engine: piper" in report


def test_long_line_extends_slot():
    if not system_voice_works():
        print("SKIP long line: no usable system voice on this machine")
        return
    run = fresh_run()
    doc = draft(run)
    nj = run / "voiceover" / "narration.json"
    for l in doc["lines"]:
        if l["id"] == "c2s1":
            l["text"] = "This is a deliberately long line. " * 8
    nj.write_text(json.dumps(doc), encoding="utf-8")
    code, out = sh("make_script.py", run, "--render", "--engine", "system")
    assert code == 0, out
    approve(run)
    code, out = sh("voiceover.py", run, "--engine", "system")
    assert code == 0, out
    rep = (run / "voiceover" / "report.md").read_text(encoding="utf-8")
    sect = rep.split("## Extended slots")[1].split("## Failed lines")[0]
    assert re.search(r"\+\d+\.\d s", sect), sect
    m = re.search(r"extended slots: (\d+)", rep)
    assert m and int(m.group(1)) >= 1


def test_voiceover_force_only_touches_voiced():
    run = fresh_run()
    draft(run)
    approve(run)
    assert sh("voiceover.py", run, "--engine", "system")[0] == 0
    marker = run / "voiced" / "stale.txt"
    marker.write_text("x")
    other = run / "shots_marker.txt"
    other.write_text("keep")
    assert sh("voiceover.py", run, "--engine", "system", "--force")[0] == 0
    assert not marker.exists() and other.exists()


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    failed = 0
    for n, f in tests:
        try:
            f()
            print(f"PASS {n}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"FAIL {n}: {type(e).__name__}: {e}")
    print(f"{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
