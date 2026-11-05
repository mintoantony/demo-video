#!/usr/bin/env python3
"""voiceover.py <run-folder> [--voice V] [--engine piper|system|edge] [--subtitles] [--force]
                [--voices-dir DIR] [--allow-online]

Phase 2. Needs an approved narration (approve.py). Synthesises every line, places it at
its step's start, mixes it into the silent clip and writes <run>/voiced/NN-slug.mp4,
voiced/full.mp4, voiced/player.html and <run>/voiceover/report.md.
When a line is longer than its slot, the frame is held (ffmpeg tpad) and the hold is
recorded in the report. The original clips are only ever read.
"""
import argparse, shutil, subprocess, sys, tempfile
from pathlib import Path
from common import (reexec_in_venv, sha256_file, load_json, find_ffmpeg, ffmpeg_info,
                    srt_time, voice_dir, SKILL_DIR, GAP)

reexec_in_venv()
import tts  # noqa: E402

DEFAULT_VOICE = "en_GB-cori-medium"


def die(msg):
    sys.exit("voiceover: " + msg)


def check_approval(vd):
    nj, marker = vd / "narration.json", vd / "narration.approved.json"
    if not nj.exists():
        die(f"{nj} not found. Run make_script.py first.")
    if not marker.exists():
        die("narration is not approved. Show narration.md to the user, get a yes, then run approve.py. Refusing to synthesise.")
    want = load_json(marker).get("narrationSha256")
    if want != sha256_file(nj):
        die("narration.json changed after it was approved. Re-run make_script.py --render, get a new yes and run approve.py again.")
    return want


def plan_clip(lines, clip_dur, durs):
    """Place the lines of one clip. Returns (placements, holds, total_extension).
    placements: (line, start_in_output, dur); holds: [(video_time, seconds)]."""
    placed, holds, shift, prev_end = [], {}, 0.0, None
    for l in sorted(lines, key=lambda x: x["atSec"]):
        d = durs.get(l["id"])
        if d is None:
            continue
        start = l["atSec"] + shift
        if prev_end is not None and start < prev_end + GAP:
            ext = prev_end + GAP - start
            t = round(min(l["atSec"], clip_dur), 3)
            holds[t] = holds.get(t, 0.0) + ext
            shift += ext
            start += ext
        prev_end = start + d
        placed.append((l, start, d))
    if prev_end is not None and prev_end > clip_dur + shift:
        ext = prev_end - (clip_dur + shift) + 0.2
        holds[round(clip_dur, 3)] = holds.get(round(clip_dur, 3), 0.0) + ext
        shift += ext
    return placed, sorted(holds.items()), shift


def build_filter(clip_dur, holds, placed, first_audio_index):
    parts = []
    cuts = [(t, d) for t, d in holds if 0.04 < t < clip_dur - 0.04]
    end_hold = sum(d for t, d in holds if t >= clip_dur - 0.04)
    bounds = [0.0] + [t for t, _ in cuts] + [clip_dur]
    n = len(bounds) - 1
    parts.append("[0:v]fps=25,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p" +
                 (f",split={n}" + "".join(f"[s{i}]" for i in range(n)) if n > 1 else "[s0]"))
    for i in range(n):
        pad = ""
        if i < len(cuts):
            pad = f",tpad=stop_mode=clone:stop_duration={cuts[i][1]:.3f}"
        elif end_hold > 0:
            pad = f",tpad=stop_mode=clone:stop_duration={end_hold:.3f}"
        parts.append(f"[s{i}]trim=start={bounds[i]:.3f}:end={bounds[i+1]:.3f},setpts=PTS-STARTPTS{pad}[v{i}]")
    parts.append("".join(f"[v{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[vout]")
    labels = []
    for k, (_, start, _) in enumerate(placed):
        ms = int(round(start * 1000))
        parts.append(f"[{first_audio_index + k}:a]aresample=44100,aformat=channel_layouts=mono,adelay={ms}:all=1[a{k}]")
        labels.append(f"[a{k}]")
    if labels:
        parts.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0:dropout_transition=0,apad[aout]")
    else:
        parts.append("anullsrc=r=44100:cl=mono[aout]")
    return ";".join(parts)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        die("ffmpeg failed:\n" + r.stderr[-1500:])


def write_srt(path, cues):
    out = []
    for i, (a, b, text) in enumerate(cues, 1):
        out.append(f"{i}\n{srt_time(a)} --> {srt_time(b)}\n{text}\n")
    Path(path).write_text("\n".join(out), encoding="utf-8")


def player_html(title, items, chapters):
    btn = "\n".join(f'<button data-t="{t:.2f}">{n}. {h}</button>' for n, h, t in chapters)
    clips = "\n".join(f'<li><a href="{f}">{f}</a></li>' for f in items)
    return f"""<!doctype html><html lang="en"><meta charset="utf-8"><title>{title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{{font:16px system-ui;margin:0 auto;max-width:960px;padding:16px}}video{{width:100%;background:#000}}
button{{margin:4px 4px 0 0;padding:6px 10px}}</style>
<h1>{title}</h1><video id="v" src="full.mp4" controls></video>
<p>Jump to:</p><div>{btn}</div><p>Single clips:</p><ul>{clips}</ul>
<script>document.querySelectorAll("button").forEach(b=>b.onclick=()=>{{const v=document.getElementById("v");v.currentTime=+b.dataset.t;v.play()}})</script></html>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("--voice")
    ap.add_argument("--engine", choices=list(tts.ENGINES))
    ap.add_argument("--subtitles", action="store_true")
    ap.add_argument("--force", action="store_true", help="overwrite this tool's own voiced/ output")
    ap.add_argument("--voices-dir", default=str(SKILL_DIR / "voices"))
    ap.add_argument("--allow-online", action="store_true", help="needed for --engine edge (sends text to Microsoft)")
    a = ap.parse_args()

    run_dir = Path(a.run).resolve()
    vd = voice_dir(run_dir)
    sha = check_approval(vd)
    doc = load_json(vd / "narration.json")
    res = load_json(run_dir / "results.json")

    engine, note = a.engine, ""
    voice = a.voice or doc.get("voice") or DEFAULT_VOICE
    if engine is None:
        engine = doc.get("engine") or "piper"
        if engine == "piper" and not tts.piper_ready(voice, a.voices_dir):
            engine, note = "system", "piper or its voice was not available, so the system engine was used. "
    if engine == "edge" and not a.allow_online:
        die("the edge engine sends the narration text to Microsoft. Get the user's OK, then add --allow-online.")

    out_dir = run_dir / "voiced"
    if out_dir.exists() and any(out_dir.iterdir()):
        if not a.force:
            die(f"{out_dir} already exists. Use --force to overwrite it (only voiced/ is replaced).")
        shutil.rmtree(out_dir)
    out_dir.mkdir(exist_ok=True)

    ffmpeg = find_ffmpeg()
    eng = tts.make_engine(engine, voice, a.voices_dir)
    work = Path(tempfile.mkdtemp(prefix="voiceover_"))
    failed, durs, audio = [], {}, {}
    for l in doc["lines"]:
        try:
            p = eng.synth(l["text"], work / l["id"])
            d, has_a, _ = ffmpeg_info(ffmpeg, p)
            if not has_a or d <= 0:
                raise RuntimeError("empty audio")
            audio[l["id"]], durs[l["id"]] = p, d
        except Exception as e:  # noqa: BLE001
            failed.append((l["id"], str(e)[:200]))

    extended, voiced, subs_full, chapters = [], [], [], []
    offset = 0.0
    for c in res["clips"]:
        src = run_dir / c["file"]
        clip_dur = float(c["durationSec"])
        lines = [l for l in doc["lines"] if l["clip"] == c["file"]]
        placed, holds, total_ext = plan_clip(lines, clip_dur, durs)
        for t, d in holds:
            extended.append((c["file"], t, d))
        slug = Path(c["file"]).stem
        dst = out_dir / f"{slug}.mp4"
        cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src)]
        for l, _, _ in placed:
            cmd += ["-i", str(audio[l["id"]])]
        cmd += ["-filter_complex", build_filter(clip_dur, holds, placed, 1),
                "-map", "[vout]", "-map", "[aout]", "-t", f"{clip_dur + total_ext:.3f}",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(dst)]
        run(cmd)
        dur, _, _ = ffmpeg_info(ffmpeg, dst)
        cues = [(s, s + d, l["text"]) for l, s, d in placed]
        if a.subtitles:
            write_srt(out_dir / f"{slug}.srt", cues)
        subs_full += [(s + offset, e + offset, t) for s, e, t in cues]
        chapters.append((c["n"], c["title"], offset))
        voiced.append((dst, dur))
        offset += dur

    lst = work / "list.txt"
    lst.write_text("".join(f"file '{p.as_posix()}'\n" for p, _ in voiced), encoding="utf-8")
    full = out_dir / "full.mp4"
    run([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
         "-i", str(lst), "-c", "copy", "-movflags", "+faststart", str(full)])
    if a.subtitles:
        write_srt(out_dir / "full.srt", subs_full)
    full_dur, _, _ = ffmpeg_info(ffmpeg, full)
    (out_dir / "player.html").write_text(
        player_html(res["title"], [p.name for p, _ in voiced], chapters), encoding="utf-8")

    orig = sum(float(c["durationSec"]) for c in res["clips"])
    rep = [f"# Voice-over report: {res['title']}", "",
           f"- Engine: {engine}" + (" (online, text sent to Microsoft)" if engine == "edge" else " (offline)"),
           f"- Voice: {voice}", f"- Narration hash (approved): {sha}",
           f"- Original length: {orig:.1f} s; voiced full.mp4: {full_dur:.1f} s",
           f"- Lines: {len(doc['lines'])}; failed: {len(failed)}; extended slots: {len(extended)}", ""]
    if note:
        rep += [f"Note: {note.strip()}", ""]
    rep += ["## Extended slots (frame held so the speech fits)", ""]
    rep += [f"- {f} at {t:.1f} s: +{d:.1f} s" for f, t, d in extended] or ["- none"]
    rep += ["", "## Failed lines", ""]
    rep += [f"- {i}: {e}" for i, e in failed] or ["- none"]
    rep += ["", "## Files", "", f"- {full}"] + [f"- {p}" for p, _ in voiced] + [f"- {out_dir / 'player.html'}", ""]
    (vd / "report.md").write_text("\n".join(rep), encoding="utf-8")
    shutil.rmtree(work, ignore_errors=True)
    print(f"Done. full.mp4 {full_dur:.1f} s, extended {len(extended)}, failed {len(failed)}\nReport: {vd / 'report.md'}")


if __name__ == "__main__":
    main()
