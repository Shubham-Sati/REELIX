#!/bin/bash
# Animate the 3 reference shots with Wan 2.2 FastWan (REELIX tools/wan_i2v.py, read-once), then sharpen with Real-ESRGAN x3.
E="$(cd "$(dirname "$0")" && pwd)"; R="/Users/shubhamsati/All Content/Claude/REELIX"; T="/Users/shubhamsati/All Content/Claude/AI Video Editor/Build/_tools"
mkdir -p "$E/clips/in" "$E/clips/raw" "$E/clips/up"
for n in A-park-puppy B-kitchen-surprise C-playground-run; do ffmpeg -loglevel error -y -i "$E/shots-ref/$n.png" -vf "scale=480:832:force_original_aspect_ratio=increase,crop=480:832" "$E/clips/in/$n.png"; done
P="3D animated feature film shot, Pixar style, smooth natural motion, the boy's face stays the same."
cat > "$E/clips/jobs.json" <<JSON
{"model_dir": "$T/models/fastwan2.2-ti2v-5b-mlx", "w": 480, "h": 832, "jobs": [
 {"image": "$E/clips/in/A-park-puppy.png", "out": "$E/clips/raw/A-park-puppy.mp4", "frames": 81, "seed": 42,
  "prompt": "$P The boy kneels on the grass laughing happily with his eyes shut while the small brown puppy wags its tail and jumps up to lick his cheek; he hugs the puppy, gentle slow camera push-in, warm sunlight."},
 {"image": "$E/clips/in/B-kitchen-surprise.png", "out": "$E/clips/raw/B-kitchen-surprise.mp4", "frames": 81, "seed": 42,
  "prompt": "$P A puff of white flour bursts up from the bowl, the boy's eyes go wide and his mouth opens in surprise, he leans back and then starts to laugh, flour drifting in the warm kitchen light, slight camera shake."},
 {"image": "$E/clips/in/C-playground-run.png", "out": "$E/clips/raw/C-playground-run.mp4", "frames": 81, "seed": 42,
  "prompt": "$P The boy runs toward the camera across the sunny playground with a big joyful smile, waving his hand, arms and legs moving naturally, camera slowly tracking backward, leaves moving in the breeze."}]}
JSON
s=$(date +%s); "$T/envs/video/bin/python" "$R/tools/wan_i2v.py" --jobs "$E/clips/jobs.json" 2>&1 | grep --line-buffered -E "clip |prompts read|done |rror|Killed"
echo "WAN DONE $(( $(date +%s)-s ))s"
for n in A-park-puppy B-kitchen-surprise C-playground-run; do s=$(date +%s); rm -rf "$E/clips/up/$n"; mkdir -p "$E/clips/up/$n/in" "$E/clips/up/$n/out"
  ffmpeg -loglevel error -i "$E/clips/raw/$n.mp4" "$E/clips/up/$n/in/%04d.png"
  "$T/realesrgan/realesrgan-ncnn-vulkan" -i "$E/clips/up/$n/in" -o "$E/clips/up/$n/out" -n realesr-animevideov3 -s 3 -m "$T/realesrgan/models" >/dev/null 2>&1
  ffmpeg -loglevel error -y -framerate 24 -i "$E/clips/up/$n/out/%04d.png" -vf "eq=contrast=0.94:saturation=0.9:gamma=1.02,curves=all='0/0 0.06/0.045 0.5/0.51 0.92/0.9 1/0.96',scale=1080:1920:flags=lanczos,fps=30" -c:v libx264 -crf 16 -pix_fmt yuv420p "$E/clips/$n-HD.mp4"
  echo "sharpened $n $(( $(date +%s)-s ))s"; done
echo "CLIPS DONE"
