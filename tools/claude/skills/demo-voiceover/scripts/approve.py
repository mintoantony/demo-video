#!/usr/bin/env python3
"""approve.py <run>/voiceover/narration.json

Records that the user said yes to narration.md. Writes narration.approved.json next to
it, holding the sha256 of narration.json. voiceover.py refuses to run without it, or if
narration.json changed afterwards. Run it only after the user has read and agreed.
"""
import datetime, json, sys
from pathlib import Path
from common import sha256_file


def main():
    if len(sys.argv) < 2:
        sys.exit("Usage: python approve.py <run>/voiceover/narration.json")
    nj = Path(sys.argv[1]).resolve()
    if nj.is_dir():
        nj = nj / "narration.json"
    if not nj.exists():
        sys.exit(f"Not found: {nj}. Run make_script.py first.")
    if not (nj.parent / "narration.md").exists():
        sys.exit("No narration.md beside narration.json. Show the user narration.md first (make_script.py --render).")
    sha = sha256_file(nj)
    marker = nj.parent / "narration.approved.json"
    marker.write_text(json.dumps({"approved": True, "narrationSha256": sha,
                                  "approvedAt": datetime.datetime.now().isoformat()}, indent=2), encoding="utf-8")
    print(f"Approved. Hash: {sha}\nMarker: {marker}")


if __name__ == "__main__":
    main()
