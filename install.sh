#!/usr/bin/env bash
# Installs the demo-video agent and skills for Claude Code (macOS, Linux, Git Bash).
# Usage: bash install.sh [--prefix DIR] [--skip-voice] [--skip-browser]
# Prefix defaults to $CLAUDE_CONFIG_DIR, else ~/.claude. Safe to run again.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
prefix="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
skip_voice=0
skip_browser=0

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) [ $# -ge 2 ] || { echo "--prefix needs a folder" >&2; exit 2; }; prefix="$2"; shift 2 ;;
    --prefix=*) prefix="${1#--prefix=}"; shift ;;
    --skip-voice) skip_voice=1; shift ;;
    --skip-browser) skip_browser=1; shift ;;
    -h|--help) sed -n 2,4p "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

hint() {
  case "$(uname -s)" in
    Darwin) echo "  Install it with Homebrew: brew install $1" >&2 ;;
    *) echo "  Install it with your package manager (for example: sudo apt-get install $2)." >&2 ;;
  esac
}

# --- prerequisites -------------------------------------------------------
command -v node >/dev/null 2>&1 || { echo "Node.js 18 or newer is required." >&2; hint node nodejs; exit 1; }
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 18 ]; then echo "Node.js 18 or newer is required (found $(node -v))." >&2; hint node nodejs; exit 1; fi
command -v npm >/dev/null 2>&1 || { echo "npm was not found (it comes with Node.js)." >&2; exit 1; }

py=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then py="$c"; break; fi
done
if [ -z "$py" ] && [ "$skip_voice" -eq 0 ]; then
  echo "Python 3.9 or newer is required for the voice-over skill." >&2; hint python@3.12 python3 python3-venv; exit 1
fi

src="$here/tools/claude"
[ -d "$src" ] || { echo "tools/claude not found. Run: node make_tool_copies.mjs" >&2; exit 1; }

# --- copy ----------------------------------------------------------------
copy_dir() { # copy_dir FROM TO : merges, overwrites, keeps untracked files such as .venv and node_modules
  mkdir -p "$2"
  cp -R "$1/." "$2/"
}

mkdir -p "$prefix/agents"
cp -R "$src/agents/." "$prefix/agents/"
echo "Agent copied to $prefix/agents"
copy_dir "$src/skills/demo-video" "$prefix/skills/demo-video"
echo "Skill copied to $prefix/skills/demo-video"
copy_dir "$src/skills/demo-voiceover" "$prefix/skills/demo-voiceover"
echo "Voice-over skill copied to $prefix/skills/demo-voiceover"

# --- demo-video: npm + Chromium -----------------------------------------
(
  cd "$prefix/skills/demo-video"
  npm install
  if [ "$skip_browser" -eq 0 ]; then
    if [ "$(uname -s)" = "Linux" ]; then
      npx playwright install chromium || npx playwright install --with-deps chromium
    else
      npx playwright install chromium
    fi
  fi
)
if [ "$(uname -s)" = "Linux" ] && [ "$skip_browser" -eq 0 ]; then
  echo "Linux note: if Chromium does not start, run: npx playwright install-deps chromium (needs sudo)."
fi

# --- demo-voiceover: venv, packages, voice ------------------------------
if [ "$skip_voice" -eq 0 ]; then
  (cd "$prefix/skills/demo-voiceover" && "$py" setup_voice.py)
fi

echo "Done. Restart Claude Code, then type /demo-video (and /demo-voiceover for a voice)."
