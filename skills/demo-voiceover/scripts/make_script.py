#!/usr/bin/env python3
"""make_script.py <run-folder> [--render] [--force] [--voice V] [--engine E]

Phase 1 (nothing is synthesised). Reads <run>/results.json and writes
<run>/voiceover/narration.json (the contract) and narration.md (what the user reads).

The draft is plain narration that already fits every slot (draft.py shortens a line by dropping
clauses before it may overflow). Claude may polish the "text" fields in narration.json, then runs `make_script.py <run> --render` to recompute timings and
regenerate narration.md. Keep the line structure (ids, clip, atSec, budgetSec).
"""
import argparse, json, sys
import draft as D
from pathlib import Path
from common import est_seconds, load_json, load_results, voice_dir, LEAD_OFFSET, STEP_OFFSET

DEFAULT_VOICE = "en_GB-cori-medium"


def clip_duration(res, rel):
    for c in res["clips"]:
        if c["file"] == rel:
            return float(c["durationSec"])
    return 0.0


def build(run, voice, engine, style="plain"):
    res = load_results(run)
    title = res["title"]
    summ = res.get("summary", {})
    clips = res["clips"]
    first, last = clips[0], clips[-1]
    b0 = round(float(first["durationSec"]) - LEAD_OFFSET, 1)
    lines = [dict(id="intro", kind="intro", clip=first["file"], atSec=LEAD_OFFSET, budgetSec=b0,
                  text=D.intro_text(title, res.get("subtitle") or "", b0))]
    steps = res["steps"]
    chapters = res.get("chapters") or []
    prev_actor = None
    for ci, ch in enumerate(chapters, 1):
        cs = [s for s in steps if s["chapterIndex"] == ci]
        dur = clip_duration(res, ch["clip"])
        first_at = cs[0]["atSec"] if cs else dur
        lb = round(max(first_at - LEAD_OFFSET, 0), 1)
        lines.append(dict(id=f"c{ci}", kind="lead", clip=ch["clip"], atSec=LEAD_OFFSET, budgetSec=lb,
                          text=D.lead_text(ci, len(chapters), ch, prev_actor, lb, style)))
        prev_actor = ch.get("actor") or prev_actor
        for k, s in enumerate(cs):
            at = round(s["atSec"] + STEP_OFFSET, 1)
            nxt = cs[k + 1]["atSec"] if k + 1 < len(cs) else dur
            b = round(max(nxt - at, 0), 1)
            lines.append(dict(id=f"c{ci}s{s['step']}", kind="step", clip=ch["clip"], atSec=at,
                              budgetSec=b, status=s["status"], text=D.step_text(s, b, style)))
    n = summ.get("steps", len(steps))
    bad = (summ.get("different", 0) or 0) + (summ.get("couldNot", 0) or 0)
    bl = round(float(last["durationSec"]) - LEAD_OFFSET, 1)
    lines.append(dict(id="closing", kind="closing", clip=last["file"], atSec=LEAD_OFFSET, budgetSec=bl,
                      text=D.closing_text(title, n, bad, summ.get("pass", 0), bl)))
    return dict(run=str(Path(run).name), title=title, engine=engine, voice=voice, style=style, lines=lines)




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
    ap.add_argument("--style", default="plain", choices=["plain", "brief"], help="plain: action then outcome (default); brief: outcome only")
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
    res = load_results(run)
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
        doc = build(run, a.voice or DEFAULT_VOICE, a.engine or "piper", a.style)
    finish(doc)
    nj.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
    (vd / "narration.md").write_text(render_md(doc, res), encoding="utf-8")
    marker = vd / "narration.approved.json"
    if marker.exists():
        marker.unlink()   # any change needs a fresh yes
    print(f"Wrote {nj}\nWrote {vd / 'narration.md'}\nLines: {len(doc['lines'])}  est {doc['totalEstSec']} s  overflow {doc['overflowCount']}")


if __name__ == "__main__":
    main()
