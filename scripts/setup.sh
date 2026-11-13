#!/bin/bash
# REELIX setup for a new Mac. One command installs everything REELIX needs, one step after another.
# Safe to run again: every finished step is skipped. Full guide: SETUP.md
#
#   scripts/setup.sh                       everything (tools, packages, all models incl. music)   ~21 GB download
#   scripts/setup.sh --no-music            everything except the ACE-Step music model (videos get no music)   ~10 GB
#   scripts/setup.sh --use-existing <dir>  models are already installed by AI Video Editor in <dir>: use them, download nothing
#   scripts/setup.sh --check               only check what is installed
#
# Models go to $REELIX_MODELS (default ~/.reelix), outside the repo, so a re-clone keeps them.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
M="${REELIX_MODELS:-$HOME/.reelix}"
MUSIC=1; CHECK=0; EXISTING=""
while [ $# -gt 0 ]; do case "$1" in
  --no-music) MUSIC=0;; --check) CHECK=1;; --use-existing) EXISTING="$2"; shift;;
  -h|--help) sed -n 2,11p "$0"; exit 0;; *) echo "unknown option $1 (see --help)"; exit 2;; esac; shift; done
B="\033[1m"; G="\033[32m"; R="\033[31m"; Y="\033[33m"; N="\033[0m"
step() { printf "\n${B}== %s${N}\n" "$1"; }
ok()   { printf "  ${G}ok${N}    %s\n" "$1"; }
add()  { printf "  ${Y}add${N}   %s\n" "$1"; }
fail() { printf "  ${R}FAIL${N}  %s\n" "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }
hf()   { "$M/venv-image/bin/python" -c "from huggingface_hub import snapshot_download as d; import sys; print(d(sys.argv[1], local_dir=sys.argv[2] if len(sys.argv)>2 else None, allow_patterns=['*.safetensors','*.json','*.model','*.txt','*.pt','*.pth']))" "$@"; }

if [ $CHECK = 0 ]; then
step "1/5  This Mac"
[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || { fail "REELIX needs a Mac with Apple Silicon (M1 or newer): the models run on MLX/Metal"; exit 1; }
ok "Apple Silicon $(sysctl -n machdep.cpu.brand_string), $(( $(sysctl -n hw.memsize) / 1073741824 )) GB RAM"
[ $(( $(sysctl -n hw.memsize) / 1073741824 )) -ge 16 ] || printf "  ${Y}warn${N}  under 16 GB RAM: FLUX will be slow\n"
FREE=$(df -g "$HOME" | awk 'NR==2{print $4}'); NEED=$([ $MUSIC = 1 ] && echo 25 || echo 13); [ -n "$EXISTING" ] && NEED=2
[ "$FREE" -ge "$NEED" ] && ok "free disk ${FREE} GB (need about ${NEED} GB)" || { fail "only ${FREE} GB free, need about ${NEED} GB"; exit 1; }

step "2/5  Tools (Homebrew)"
have brew || { fail "Homebrew is missing: install it from https://brew.sh, then run this again"; exit 1; }
for pkg in node ffmpeg uv whisper-cpp; do bin=$pkg; [ $pkg = whisper-cpp ] && bin=whisper-cli
  if have $bin; then ok "$pkg"; else add "$pkg"; brew install $pkg; fi; done
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit((a===20&&b>=19)||(a===22&&b>=13)||a>=24?0:1)' \
  && ok "node $(node --version)" || { fail "node $(node --version) is too old for Remotion (need 20.19+, 22.13+ or 24+): brew upgrade node"; exit 1; }
have claude || ls "$HOME/Library/Application Support/Claude/claude-code" >/dev/null 2>&1 \
  && ok "Claude Code" || printf "  ${Y}warn${N}  Claude Code not found: install it from https://claude.com/claude-code (the agents need it)\n"

step "3/5  REELIX packages and the reelix command"
(cd cli && npm install --no-audit --no-fund --silent) && ok "terminal packages"
(cd templates/remotion && npm install --no-audit --no-fund --silent) && ok "Remotion video engine (+ Three.js, GSAP)"
chmod +x bin/reelix tools/*.py tools/*.sh; mkdir -p videos "$HOME/.local/bin"; ln -sf "$ROOT/bin/reelix" "$HOME/.local/bin/reelix"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) grep -q '.local/bin' "$HOME/.zshrc" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
  printf "  ${Y}note${N}  added ~/.local/bin to PATH in ~/.zshrc: open a new terminal after setup\n";; esac
C=templates/remotion/src/custom; mkdir -p $C; [ -f $C/index.ts ] || echo 'export const custom: Record<string, React.FC<any>> = {};' > $C/index.ts
ok "reelix command"; tools/make_sfx.sh >/dev/null && ok "sound-effect library (library/sfx)"

if [ -n "$EXISTING" ]; then
  step "4/5  Use models from $EXISTING"
  [ -d "$EXISTING/Build/_tools" ] || { fail "$EXISTING does not look like an AI Video Editor folder (no Build/_tools)"; exit 1; }
  python3 - "$EXISTING" <<'PY'
import json, sys; A = sys.argv[1] + "/Build/_tools"
json.dump({"_about": "This laptop only: REELIX uses the models AI Video Editor already installed (scripts/setup.sh --use-existing).",
  "image": {"bin": A + "/venv/bin/mflux-generate", "model": A + "/models/flux1-schnell-4bit"},
  "voice": {"bin": A + "/envs/tts/bin/mlx_audio.tts.generate"}, "music": {"dir": A + "/ace-step"}, "cutout": {"bin": A + "/bin/cutout"}},
  open("config/models.local.json", "w"), indent=2)
PY
  ok "config/models.local.json written (this laptop only, not in git)"
  [ -x "$EXISTING/Build/_tools/bin/cutout" ] || { mkdir -p "$M/bin"; swiftc -O tools/cutout.swift -o "$M/bin/cutout" 2>&1 | grep -v warning || true
    python3 -c "import json;p='config/models.local.json';c=json.load(open(p));c['cutout']['bin']='$M/bin/cutout';json.dump(c,open(p,'w'),indent=2)"; ok "cut-out tool built"; }
else
  rm -f config/models.local.json
  [ "$M" = "$HOME/.reelix" ] || echo "{ \"models\": \"$M\" }" > config/models.local.json   # custom REELIX_MODELS folder
  mkdir -p "$M"

  step "4/5  Models (one after another, live progress per model)"
  NM=""; [ $MUSIC = 0 ] && NM="--no-music"
  REELIX_MODELS="$M" node cli/setup-models.mjs $NM || { fail "a model did not install: run scripts/setup.sh again (finished ones are kept)"; exit 1; }
fi
fi

step "5/5  Check"
python3 - <<'PY'
import os, sys; sys.path.insert(0, "tools"); from common import CFG, path
G, R, Y, N = "\033[32m", "\033[31m", "\033[33m", "\033[0m"; bad = 0
for name, p, need in [("FLUX program (mflux)", CFG["image"]["bin"], 1), ("FLUX model", CFG["image"]["model"], 1), ("Kokoro voice program", CFG["voice"]["bin"], 1),
                      ("whisper model", CFG["captions"]["model"], 1), ("ACE-Step music (optional)", CFG["music"]["dir"], 0), ("Apple Vision cut-out", CFG["cutout"]["bin"], 1)]:
    e = os.path.exists(path(p)); bad += (not e) and need
    print(f"  {G+'ok'+N if e else (R+'MISSING'+N if need else Y+'skip'+N)}  {name:26} {path(p)}")
import shutil; w = shutil.which(CFG["captions"]["bin"]); bad += not w
print(f"  {G+'ok'+N if w else R+'MISSING'+N}  {'whisper-cli':26} {w or 'brew install whisper-cpp'}")
sys.exit(1 if bad else 0)
PY
printf "\n${G}${B}REELIX is ready.${N} Open a new terminal and make a video:  ${B}reelix <video-name>${N}\n"
