#!/bin/bash
# Character sheet from one hero picture with FLUX.2 klein 4B edit mode (reference image keeps face, hair, clothes the same).
E="$(cd "$(dirname "$0")" && pwd)"; B="/Users/shubhamsati/All Content/Claude/AI Video Editor/Build/_tools/venv/bin"; M="/Users/shubhamsati/All Content/Claude/AI Video Editor/Build/_tools/models/flux2-klein-4b"
REF="$E/sheet/hero-front.png"
KEEP="Same boy as the reference image: same face, spiky black hair, brown eyes, skin, white polo shirt with maroon striped collar, dark green rolled trousers, maroon sneakers, brown wristwatch on the left wrist. 3D animated feature film, Pixar style, high detail CG render, plain light grey studio background, soft studio light, sharp focus."
gen() { # name w h seed prompt
  [ -f "$E/sheet/$1.png" ] && { echo "skip $1"; return; }
  s=$(date +%s); "$B/mflux-generate-flux2-edit" --model "$M" --base-model flux2-klein-4b -q 4 --image-paths "$REF" --prompt "$5 $KEEP" \
    --width $2 --height $3 --steps 4 --seed $4 --output "$E/sheet/$1.png" >> "$E/logs/sheet.log" 2>&1
  echo "done $1 $(( $(date +%s)-s ))s"; }
gen profile 768 1024 21 "Full body side profile view of the boy facing left, standing straight, arms relaxed."
gen back 768 1024 22 "Full body back view of the boy seen from behind, standing straight, arms relaxed, back of his head visible."
gen face-neutral 768 768 31 "Close-up portrait of the boy's head and shoulders, calm neutral expression, mouth closed, looking at the camera."
gen face-joyful 768 768 32 "Close-up portrait of the boy's head and shoulders, joyful expression, big open smile showing teeth, eyes bright."
gen face-sad 768 768 33 "Close-up portrait of the boy's head and shoulders, sad expression, eyebrows raised in the middle, mouth turned down, tears on his cheeks."
gen face-angry 768 768 34 "Close-up portrait of the boy's head and shoulders, angry expression, eyebrows pulled down and together, frowning mouth."
gen face-surprised 768 768 35 "Close-up portrait of the boy's head and shoulders, surprised expression, eyebrows raised high, eyes wide open, mouth open in an O."
gen face-fearful 768 768 36 "Close-up portrait of the boy's head and shoulders, fearful expression, worried raised eyebrows, wide eyes, mouth slightly open."
gen pose-running 768 1024 41 "Full body, the boy running fast to the right, one leg forward, arms pumping, happy smile."
gen pose-jumping 768 1024 42 "Full body, the boy jumping mid-air with both arms raised high, legs bent, laughing with joy."
gen pose-laughing 768 1024 43 "Full body, the boy laughing hard, bending forward a little, eyes shut, one hand on his belly."
gen pose-crying 768 1024 44 "Full body, the boy squatting down crying, covering his face with both hands."
echo "SHEET DONE"
