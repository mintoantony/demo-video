#!/usr/bin/env python3
"""make_script.py <run-folder> [--render] [--force] [--voice V] [--engine E]

Phase 1 (nothing is synthesised). Reads <run>/results.json and writes
<run>/voiceover/narration.json (the contract) and narration.md (what the user reads).

The draft wording is mechanical. Claude rewrites the "text" fields in narration.json into
natural narration, then runs `make_script.py <run> --render` to recompute timings and
regenerate narration.md. Keep the line structure (ids, clip, atSec, budgetSec).
"""
import argparse, json, sys
from pathlib import Path
from common import est_seconds, load_json, voice_dir, LEAD_OFFSET, STEP_OFFSET

DEFAULT_VOICE = "en_GB-cori-medium"


def clip_duration(res, rel):
    for c in res["clips"]:
        if c["file"] == rel:
            return float(c["durationSec"])
    return 0.0


def lower_first(s):
    return s[:1].lower() + s[1:] if s and not s[:2].isupper() else s


def step_text(s):
    label = s["label"].rstrip(".")
    expect = s["expect"].rstrip(".")
    seen = (s.get("seen") or "").rstrip(".")
    st = s["status"]
    if st == "PASS":
        return f"{label}. As expected, {lower_first(expect)}."
    if st == "DIFFERENT":
        return (f"{label}. This did not go as expected. We expected {lower_first(expect)}, "
                f"but what actually appeared was: {seen}.")
    if st == "COULD NOT DO":
        return f"{label}. This step could not be done. {seen}."
    return f"{label}. {seen or expect}."


def build(run, voice, engine):
    res = load_json(Path(run) / "results.json")
    title = res["title"]
    summ = res.get("summary", {})
    clips = res["clips"]
    first, last = clips[0], clips[-1]
    sub = (res.get("subtitle") or "").rstrip(".")
    lines = [dict(id="intro", kind="intro", clip=first["file"], atSec=LEAD_OFFSET,
                  budgetSec=round(float(first["durationSec"]) - LEAD_OFFSET, 1),
                  text=f"{title}." + (f" {sub}." if sub else ""))]
    steps = res["steps"]
    for ci, ch in enumerate(res.get("chapters") or [], 1):
        cs = [s for s in steps if s["chapterIndex"] == ci]
        dur = clip_duration(res, ch["clip"])
        first_at = cs[0]["atSec"] if cs else dur
        lead = f"Chapter {ci}: {ch['title']}."
        if ch.get("actor"):
            lead += f" Here we act as {ch['actor']}."
        lines.append(dict(id=f"c{ci}", kind="lead", clip=ch["clip"], atSec=LEAD_OFFSET,
                          budgetSec=round(max(first_at - LEAD_OFFSET, 0), 1), text=lead))
        for k, s in enumerate(cs):
            at = round(s["atSec"] + STEP_OFFSET, 1)
            nxt = cs[k + 1]["atSec"] if k + 1 < len(cs) else dur
            lines.append(dict(id=f"c{ci}s{s['step']}", kind="step", clip=ch["clip"], atSec=at,
                              budgetSec=round(max(nxt - at, 0), 1), status=s["status"], text=step_text(s)))
    n = summ.get("steps", len(steps))
    closing = f"That completes {title}. "
    bad = (summ.get("different", 0) or 0) + (summ.get("couldNot", 0) or 0)
    if bad:
        closing += f"{summ.get('pass', 0)} of {n} steps went as expected, and {bad} did not."
    else:
        closing += f"All {n} steps went as expected."
    lines.append(dict(id="closing", kind="closing", clip=last["file"], atSec=LEAD_OFFSET,
                      budgetSec=round(float(last["durationSec"]) - LEAD_OFFSET, 1), text=closing))
    return dict(run=str(Path(run).name), title=title, engine=engine, voice=voice, lines=lines)


def finish(doc):
    tot = 0.0
    for l in doc["lines"]:
        l["estSec"] = est_seconds(l["text"])
        l["overflow"] = l["estSec"] > l["budgetSec"]
        tot += l["estSec"]
    doc["totalEstSec"] = round(tot, 1)
    doc["overflowCount"] = sum(1 for l in doc["lines"] if l["overflow"])
    return doc


def mmss(t):
    return f"{int(t // 60):02d}:{t % 60:04.1f}"


def render_md(doc, res):
    online = "  (sends the text to Microsoft's online service)" if doc["engine"] == "edge" else "  (offline)"
    out = [f"# Narration: {doc['title']}", "",
           f"- Engine: **{doc['engine']}**{online}",
           f"- Voice: **{doc['voice']}**",
           f"- Total spoken length (estimate, 2.5 words/s): **{doc['totalEstSec']} s**",
           f"- Lines that overflow their slot: **{doc['overflowCount']}** (the video will hold the frame to fit them)", "",
           "Reply with a yes, or tell me which lines to change.", ""]
    cur = None
    titles = {c["file"]: c for c in res["clips"]}
    for l in doc["lines"]:
        if l["clip"] != cur:
            cur = l["clip"]
            c = titles.get(cur, {})
            out += [f"## {c.get('n', '?')}. {c.get('title', cur)}  ({cur})", ""]
        flag = "  **OVERFLOW**" if l["overflow"] else ""
        st = f" [{l['status']}]" if l.get("status") and l["status"] != "PASS" else ""
        out.append(f"- `{mmss(l['atSec'])}` {l['id']}{st}: \"{l['text']}\"  \n  est {l['estSec']} s of {l['budgetSec']} s{flag}")
    out.append("")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("--render", action="store_true", help="recompute timings and narration.md from an edited narration.json")
    ap.add_argument("--force", action="store_true", help="overwrite an existing narration.json draft")
    ap.add_argument("--voice", default=None)
    ap.add_argument("--engine", default=None, choices=["piper", "system", "edge"])
    a = ap.parse_args()
    run = Path(a.run).resolve()
    if not (run / "results.json").exists():
        sys.exit(f"No results.json in {run}. Point at a demo-video run folder.")
    vd = voice_dir(run)
    vd.mkdir(exist_ok=True)
    nj = vd / "narration.json"
    res = load_json(run / "results.json")
    if a.render:
        if not nj.exists():
            sys.exit("No narration.json to render. Run without --render first.")
        doc = load_json(nj)
        if a.voice:
            doc["voice"] = a.voice
        if a.engine:
            doc["engine"] = a.engine
    else:
        if nj.exists() and not a.force:
            sys.exit(f"{nj} exists (it may hold reworded lines). Use --render to refresh narration.md or --force to redraft.")
        doc = build(run, a.voice or DEFAULT_VOICE, a.engine or "piper")
    finish(doc)
    nj.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
    (vd / "narration.md").write_text(render_md(doc, res), encoding="utf-8")
    marker = vd / "narration.approved.json"
    if marker.exists():
        marker.unlink()   # any change needs a fresh yes
    print(f"Wrote {nj}\nWrote {vd / 'narration.md'}\nLines: {len(doc['lines'])}  est {doc['totalEstSec']} s  overflow {doc['overflowCount']}")


if __name__ == "__main__":
    main()
