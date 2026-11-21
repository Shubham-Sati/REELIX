#!/bin/bash
# AI motion: a reference picture of a model-library object, so FLUX klein keeps its shape in every shot it appears in
# (docs/experiments/2026-11-21-kit-ai-references: same shape, parts, colours and angle; ~110 s per picture instead of ~42 s).
#   tools/object_ref.sh <video_dir> <models/... file from library/models/catalog.txt> <out.png>
# Renders the model alone (Lego satin plastic, 3/4 view, plain light background) with tools/still.sh in <video>/characters/_objref.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; VD="$(cd "$1" && pwd)"; FILE="$2"; OUT="$3"; W="$VD/characters/_objref"
rm -rf "$W"; mkdir -p "$W/project/custom" "$W/assets"
read H L < <(python3 -c "
import json, sys; m = {x['file']: x for x in json.load(open('$ROOT/library/models/index.json'))['models']}.get('$FILE')
print(m['h'], m.get('l', m['h'])) if m else sys.exit('not in the catalog: $FILE')")
cp "$ROOT/library/templates/toy3d-kit.tsx" "$W/project/custom/_kit.tsx"
cat > "$W/project/custom/S1_0.tsx" <<TSX
import React from "react";
import { Stage, KitModel } from "./_kit";
export default function S1_0() {
  const h = $H, l = $L, d = Math.max(h, l * 0.8) * 2.3;
  return <Stage bg="#e9edf0" camera={{ pos: [d * 0.62, h * 0.55 + d * 0.22, d * 0.92], look: [0, h * 0.45, 0], fov: 30 }}>
    <mesh position={[0, -0.005, 0]} receiveShadow><cylinderGeometry args={[Math.max(h, l) * 1.4, Math.max(h, l) * 1.4, 0.01, 64]} /><meshStandardMaterial color="#dfe3e6" roughness={0.9} /></mesh>
    <KitModel file="$FILE" h={h} rotY={-0.5} />
  </Stage>;
}
TSX
echo '{"width":1024,"height":576,"fps":30,"title":"ref","accent":"#FFB703","voice":"","music":null,"captions":[],"durationSec":1,"scenes":[{"image":"","start":0,"duration":1,"motion":"zoom-in","engine":"custom","component":"S1_0"}]}' > "$W/project/timeline.json"
bash "$ROOT/tools/still.sh" "$W" 0.5 "$OUT" >/dev/null
magick "$OUT" -gravity south -crop 1024x560+0+0 +repage -resize 1024x576! "$OUT"   # trim the engine's progress bar off the top
rm -rf "$W"; echo "$OUT"
