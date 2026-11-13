#!/bin/bash
# 2.5D layers: cut the main subject out of a picture with Apple Vision (the tool lives in AI Video Editor; used, not copied).
#   tools/cutout.sh <in.png> <out.png>   -> transparent PNG, same size as the input so it lines up with its background
set -e; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AVE="$(python3 -c "import json;print(json.load(open('$ROOT/config/models.json'))['aveRoot'])")"
"$AVE/Build/_tools/bin/cutout" "$1" "$2" --largest
