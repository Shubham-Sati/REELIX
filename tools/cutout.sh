#!/bin/bash
# 2.5D layers: cut the main subject out of a picture with Apple Vision.
#   tools/cutout.sh <in.png> <out.png>   -> transparent PNG, same size as the input so it lines up with its background
set -e; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$(python3 "$ROOT/tools/common.py" cutout.bin)" "$1" "$2" --largest
