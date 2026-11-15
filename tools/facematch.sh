#!/bin/bash
# tools/facematch.sh <ref.png> <frame.png> [...]   Apple Vision face distance per frame (built on first use, no download)
set -e; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${REELIX_MODELS:-$HOME/.reelix}/bin/facematch"
if [ ! -x "$BIN" ] || [ "$ROOT/tools/facematch.swift" -nt "$BIN" ]; then mkdir -p "$(dirname "$BIN")"; swiftc -O "$ROOT/tools/facematch.swift" -o "$BIN" 2>&1 | grep -v warning >&2 || true; fi
exec "$BIN" "$@"
