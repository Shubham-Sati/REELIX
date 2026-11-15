#!/bin/bash
# Apple Vision cut-outs (REELIX's own tool, built on this Mac on first use; no download).
#   tools/cutout.sh <in.png> <out.png>      2.5D layer: main subject, same size as the input
#   tools/cutout.sh <in.png> --each <dir>   one cropped PNG per person/animal (character references), JSON on stdout
set -e; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${REELIX_MODELS:-$HOME/.reelix}/bin/cutout"
if [ ! -x "$BIN" ] || [ "$ROOT/tools/cutout.swift" -nt "$BIN" ]; then mkdir -p "$(dirname "$BIN")"; swiftc -O "$ROOT/tools/cutout.swift" -o "$BIN" 2>&1 | grep -v warning >&2 || true; fi
if [ "$2" = "--each" ]; then exec "$BIN" "$1" --each "$3"; else exec "$BIN" "$1" "$2" --largest; fi
