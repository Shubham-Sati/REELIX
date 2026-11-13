#!/bin/bash
# REELIX one-time setup.
#   ./setup.sh                          use the model folder already in config/models.json
#   ./setup.sh "/path/to/AI Video Editor"   point REELIX at a different model folder
# Checks tools, installs Node packages, links the `reelix` command, checks every model path.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
ok()   { printf "  \033[32mok\033[0m       %s\n" "$1"; }
bad()  { printf "  \033[31mMISSING\033[0m  %s\n" "$1"; MISSING=1; }
MISSING=0

echo "1/4  Checking tools"
for t in node npm python3 ffmpeg; do command -v "$t" >/dev/null && ok "$t" || bad "$t  (install with: brew install ${t/python3/python})"; done
if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then bad "node 18 or newer"; fi
[ "$MISSING" = 1 ] && { echo "Install the missing tools, then run ./setup.sh again."; exit 1; }

echo "2/4  Model folder"
if [ -n "$1" ]; then
  python3 - "$ROOT/config/models.json" "$1" <<'PY'
import json, sys
f, root = sys.argv[1], sys.argv[2]; c = json.load(open(f)); c["aveRoot"] = root
json.dump(c, open(f, "w"), indent=2); print("  aveRoot set to", root)
PY
fi

echo "3/4  Installing Node packages"
(cd "$ROOT/cli" && npm install --no-audit --no-fund --silent)
(cd "$ROOT/templates/remotion" && npm install --no-audit --no-fund --silent)
chmod +x "$ROOT/bin/reelix" "$ROOT"/tools/*.py "$ROOT"/tools/*.sh
mkdir -p "$ROOT/videos" "$HOME/.local/bin"
ln -sf "$ROOT/bin/reelix" "$HOME/.local/bin/reelix"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *)
  grep -q '.local/bin' "$HOME/.zshrc" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
  echo "  Added ~/.local/bin to PATH in ~/.zshrc (open a new terminal).";; esac
ok "reelix command linked"

echo "4/4  Checking models"
python3 - "$ROOT" <<'PY'
import json, os, sys
c = json.load(open(os.path.join(sys.argv[1], "config", "models.json"))); r = c["aveRoot"]
for k, p in [("FLUX", c["image"]["model"]), ("mflux", c["image"]["bin"]), ("Kokoro CLI", c["voice"]["bin"]),
             ("whisper", c["captions"]["bin"] if "bin" in c["captions"] else c["captions"]["model"]),
             ("whisper model", c["captions"]["model"]), ("ACE-Step", c["music"]["dir"])]:
    p = os.path.expanduser(p.replace("{aveRoot}", r))
    print(("  \033[32mok\033[0m       " if os.path.exists(p) else "  \033[31mMISSING\033[0m  ") + k + "  " + p)
PY
command -v claude >/dev/null || ls "$HOME/Library/Application Support/Claude/claude-code" >/dev/null 2>&1 && ok "Claude Code" || bad "Claude Code (install it or open the Claude desktop app once)"
echo "Done. Make a video:  reelix <video-name>"
