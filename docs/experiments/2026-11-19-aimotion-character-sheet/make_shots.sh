#!/bin/bash
# 3 story shots of the same boy, made two ways at the pipeline's picture size (576x1024):
#   shots-ref/       NEW: klein edit mode with the hero picture as reference (continuity)
#   shots-textonly/  OLD: klein from the text description only (how the pipeline works today)
E="$(cd "$(dirname "$0")" && pwd)"; B="/Users/shubhamsati/All Content/Claude/AI Video Editor/Build/_tools/venv/bin"; M="/Users/shubhamsati/All Content/Claude/AI Video Editor/Build/_tools/models/flux2-klein-4b"
REF="$E/sheet/hero-front.png"
DESC="a cheerful 9 year old boy with spiky short black hair, big round brown eyes, round face, warm tan skin, rosy cheeks, white polo shirt with maroon striped collar, dark green rolled trousers, maroon sneakers, brown wristwatch, exactly two hands"
STYLE="3D animated feature film shot, Pixar style, high detail CG render, cinematic lighting, sharp focus on his face."
declare -a N=(A-park-puppy B-kitchen-surprise C-playground-run)
declare -a S=("in a sunny green park, kneeling on the grass and laughing with eyes shut as a small brown puppy jumps up to lick his face, medium shot"
              "in a cosy warm kitchen, close-up from the chest up, surprised face with wide eyes and open mouth as flour puffs up from a bowl in front of him"
              "running across a sunny school playground toward the camera, joyful big smile, waving one hand, full body, trees behind")
for i in 0 1 2; do
  n=${N[$i]}; seed=$((60 + i))
  if [ ! -f "$E/shots-ref/$n.png" ]; then s=$(date +%s)
    "$B/mflux-generate-flux2-edit" --model "$M" --base-model flux2-klein-4b -q 4 --image-paths "$REF" --width 576 --height 1024 --steps 4 --seed $seed \
      --prompt "The same boy as the reference image (same face, hair, clothes, wristwatch) ${S[$i]}. $STYLE" --output "$E/shots-ref/$n.png" >> "$E/logs/shots.log" 2>&1
    echo "done ref $n $(( $(date +%s)-s ))s"; fi
  if [ "$1" = "text" ] && [ ! -f "$E/shots-textonly/$n.png" ]; then s=$(date +%s)
    "$B/mflux-generate-flux2" --model "$M" --base-model flux2-klein-4b -q 4 --width 576 --height 1024 --steps 4 --seed $seed \
      --prompt "$STYLE A shot of $DESC, ${S[$i]}." --output "$E/shots-textonly/$n.png" >> "$E/logs/shots.log" 2>&1
    echo "done text $n $(( $(date +%s)-s ))s"; fi
done
echo "SHOTS DONE $1"
