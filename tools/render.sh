#!/bin/bash
# Render a video with the shared Remotion engine.  tools/render.sh <video_dir>
# Uses <video_dir>/project/timeline.json as props and <video_dir>/assets as the public folder.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; VD="$(cd "$1" && pwd)"
cd "$ROOT/templates/remotion"
npx remotion render src/index.ts Main "$VD/final.mp4" --props="$VD/project/timeline.json" --public-dir="$VD/assets" \
  --codec=h264 --crf=18 --concurrency=4 --log=error
echo "$VD/final.mp4"
