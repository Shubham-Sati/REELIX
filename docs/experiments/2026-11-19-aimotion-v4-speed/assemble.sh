#!/bin/bash
# Build the two test videos from the same sharpened Wan frames:
#   late-for-school-ONE-SPEED.mp4   OLD way (AI motion V3): every clip at normal speed, no ramps
#   late-for-school-SPEED-V4.mp4    NEW way (AI motion V4): speed plan per shot (hurry, ramp down, normal)
E="$(cd "$(dirname "$0")" && pwd)"; PY="/Users/shubhamsati/All Content/Claude/AI Video Editor/Build/_tools/envs/video/bin/python"
M="/Users/shubhamsati/All Content/Claude/REELIX/docs/experiments/2026-11-19-lego-crowd-test/video/assets/music.wav"
mkdir -p "$E/clips/one" "$E/clips/v4"
N=(1-street-sprint 2-face-closeup 3-school-gate 4-corridor-slowdown 5-enter-class)
# speed plan [[seconds into the OUTPUT clip, speed], ...]; speed 1 = real time
P=('[[0,1.6],[3,1.6]]'                       # hurry: sprinting past the bus
   '[[0,1.5],[3,1.5]]'                       # hurry: face close-up while running
   '[[0,1.5],[1.2,1.5],[2.0,1.15]]'          # hurry through the gate, easing a little at the end
   '[[0,1.6],[0.8,1.6],[1.7,1.0],[3,1.0]]'   # ramp: runs, then slows to a walk near the door
   '[[0,1.0],[4,1.0]]')                      # normal: catches breath, walks in calmly
for i in 0 1 2 3 4; do n=${N[$i]}
  "$PY" "$E/speed_ramp.py" "$E/clips/up/$n/out" "$E/clips/one/$n.mp4" '[[0,1.0]]' 24 30 0
  "$PY" "$E/speed_ramp.py" "$E/clips/up/$n/out" "$E/clips/v4/$n.mp4" "${P[$i]}" 24 30 1
done
join() { # dir out
  ls "$1"/*.mp4 | sort | sed "s#^#file '#;s#\$#'#" > "$1/list.txt"
  ffmpeg -loglevel error -y -f concat -safe 0 -i "$1/list.txt" -c copy "$1/joined.mp4"
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1/joined.mp4")
  ffmpeg -loglevel error -y -i "$1/joined.mp4" -i "$M" -filter_complex "[1:a]volume=0.5,afade=t=out:st=$(python3 -c "print(max(0,$d-1.2))"):d=1.2[a]" \
    -map 0:v -map "[a]" -shortest -c:v copy -c:a aac "$2"
  echo "$2 $d s"; }
join "$E/clips/one" "$E/late-for-school-ONE-SPEED.mp4"
join "$E/clips/v4" "$E/late-for-school-SPEED-V4.mp4"
