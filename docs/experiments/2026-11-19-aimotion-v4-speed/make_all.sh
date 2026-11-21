#!/bin/bash
# AI motion V4 test "late for school": 5 shot pictures (klein edit, hero as reference) -> Wan -> Real-ESRGAN x3 frames.
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1   # all models are local: never wait on the internet
E="$(cd "$(dirname "$0")" && pwd)"; R="/Users/shubhamsati/All Content/Claude/REELIX"; T="/Users/shubhamsati/All Content/Claude/AI Video Editor/Build/_tools"
B="$T/venv/bin"; M="$T/models/flux2-klein-4b"; REF="$E/hero-front.png"
KEEP="The same boy as the reference image (same face, spiky black hair, white polo shirt with maroon striped collar and star logo, dark green rolled trousers, maroon sneakers, brown wristwatch), now wearing a navy blue school backpack. 3D animated feature film shot, Pixar style, high detail CG render, cinematic morning light, sharp focus on the boy."
N=(1-street-sprint 2-face-closeup 3-school-gate 4-corridor-slowdown 5-enter-class)
S=("Wide shot on a busy town street in the morning: the boy sprints along the pavement toward the camera, worried face, a yellow school bus and two cars driving on the road beside him, full body."
   "Tight close-up of the boy's face and shoulders while he runs fast, side tracking view, worried wide eyes, cheeks puffed, hair bouncing, the street behind him blurred with speed."
   "The boy running through an open green iron school gate with a SCHOOL sign above, school building behind, full body, mid-stride, backpack bouncing."
   "Inside a bright school corridor with lockers, the boy running toward a classroom door at the end of the corridor, full body, seen from behind and slightly to the side."
   "At an open classroom door, the boy stands upright catching his breath, one hand on the door frame, relieved small smile, classroom with desks behind the door, medium shot.")
for i in 0 1 2 3 4; do n=${N[$i]}; [ -f "$E/shots/$n.png" ] && continue; s=$(date +%s)
  "$B/mflux-generate-flux2-edit" --model "$M" --base-model flux2-klein-4b -q 4 --image-paths "$REF" --width 576 --height 1024 --steps 4 --seed $((80 + i)) \
    --prompt "${S[$i]} $KEEP" --output "$E/shots/$n.png" >> "$E/logs/klein.log" 2>&1
  echo "picture $((i+1))/5 $n $(( $(date +%s)-s ))s"; done
echo "PICTURES DONE"
for n in "${N[@]}"; do ffmpeg -loglevel error -y -i "$E/shots/$n.png" -vf "scale=480:832:force_original_aspect_ratio=increase,crop=480:832" "$E/clips/in/$n.png"; done
P="3D animated feature film shot, Pixar style, the boy's face stays the same."
cat > "$E/clips/jobs.json" <<JSON
{"model_dir": "$T/models/fastwan2.2-ti2v-5b-mlx", "w": 480, "h": 832, "jobs": [
 {"image": "$E/clips/in/1-street-sprint.png", "out": "$E/clips/raw/1-street-sprint.mp4", "frames": 81, "seed": 42,
  "prompt": "$P The boy sprints very fast toward the camera, legs pumping quickly, arms swinging hard, backpack bouncing; the yellow school bus and cars rush past quickly on the road; fast energetic running, camera tracking backward quickly."},
 {"image": "$E/clips/in/2-face-closeup.png", "out": "$E/clips/raw/2-face-closeup.mp4", "frames": 81, "seed": 42,
  "prompt": "$P Fast side tracking shot keeping the running boy's face in close-up, he breathes hard with a worried face, head bobbing with each quick step, hair bouncing; the street, trees and houses behind him rush backward quickly, strong motion blur in the background."},
 {"image": "$E/clips/in/3-school-gate.png", "out": "$E/clips/raw/3-school-gate.mp4", "frames": 81, "seed": 42,
  "prompt": "$P The boy dashes quickly through the open school gate, running fast with big strides, backpack bouncing, camera follows him quickly toward the school building."},
 {"image": "$E/clips/in/4-corridor-slowdown.png", "out": "$E/clips/raw/4-corridor-slowdown.mp4", "frames": 81, "seed": 42,
  "prompt": "$P The boy runs quickly down the school corridor toward the classroom door, then slows down, takes smaller steps and finally walks calmly the last few steps near the door, camera following him."},
 {"image": "$E/clips/in/5-enter-class.png", "out": "$E/clips/raw/5-enter-class.mp4", "frames": 81, "seed": 42,
  "prompt": "$P The boy takes a deep breath, straightens his shirt, smiles politely and walks calmly in through the classroom door at a normal pace, natural relaxed movement."}]}
JSON
s=$(date +%s); "$T/envs/video/bin/python" "$R/tools/wan_i2v.py" --jobs "$E/clips/jobs.json" 2>&1 | grep --line-buffered -E "clip |prompts read|done |rror|Killed"
echo "WAN DONE $(( $(date +%s)-s ))s"
for n in "${N[@]}"; do s=$(date +%s); mkdir -p "$E/clips/up/$n/in" "$E/clips/up/$n/out"
  ffmpeg -loglevel error -y -i "$E/clips/raw/$n.mp4" "$E/clips/up/$n/in/%04d.png"
  "$T/realesrgan/realesrgan-ncnn-vulkan" -i "$E/clips/up/$n/in" -o "$E/clips/up/$n/out" -n realesr-animevideov3 -s 3 -m "$T/realesrgan/models" >/dev/null 2>&1
  echo "sharpened $n $(( $(date +%s)-s ))s"; done
echo "ALL DONE"
