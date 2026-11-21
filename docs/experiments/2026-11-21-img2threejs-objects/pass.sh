#!/bin/bash
# One img2threejs pass for one object, using the skill's own tools:
#   bash pass.sh <name> <pass-id> [review "<fidelity>|<ai score>|<action>|<summary>"]
# 1) if a review is given, records it for the CURRENT pass (append_review.py, with the render + comparison sheet as evidence)
#    and syncs the pass pipeline (orchestrate_passes.py sync), which unlocks the next pass on "continue";
# 2) generates the Three.js code for <pass-id> (generate_threejs_factory.py, strict-quality gate first),
# 3) renders it in our engine (make.sh review) and builds the side-by-side sheet (make_comparison_sheet.py).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; SK="$HERE/img2threejs/forge"; N=$1; P=$2; W="$HERE/work/$N"; PY="python3 -E -s"
mkdir -p "$W/review"; cd "$W"
if [ "$3" = review ]; then
  IFS='|' read -r FID AI ACT SUM LAYERS FEATS <<< "$4"; CUR=$(cat "$W/review/current-pass" 2>/dev/null || echo blockout)
  # layer scores "silhouette,structure,form,material,lighting" (default: all = AI score); feature scores "id=score,..." (default: AI score)
  python3 - "$AI" "${LAYERS:-}" "${FEATS:-}" <<'PY'
import json, sys
ai, layers, feats = float(sys.argv[1]), sys.argv[2], sys.argv[3]
names = ["silhouetteProportion", "componentStructure", "formDetail", "materialSurface", "lightingCamera"]
vals = [float(x) for x in layers.split(",")] if layers else [ai] * 5
json.dump(dict(zip(names, vals)), open("review/layers.json", "w"))
over = dict(kv.split("=") for kv in feats.split(",") if "=" in kv) if feats else {}
spec = json.load(open("spec.json"))
json.dump([{"id": f["id"], "score": float(over.get(f["id"], ai)), "notes": "scored by eye on the comparison sheet"} for f in spec["featureReviewTargets"]], open("review/features.json", "w"))
PY
  $PY "$SK/stage4_review/append_review.py" spec.json --pass-id "$CUR" --fidelity "$FID" --ai-vision-score "$AI" --action "$ACT" --summary "$SUM" \
    --render-screenshot "review/$CUR.png" --comparison-image "review/$CUR-cmp.png" --reference-screenshot "$HERE/3-reference-pictures/$N.png" --map-stripped-render "review/$CUR-strip.png" --layer-scores-json review/layers.json --feature-reviews-json review/features.json --in-place > /dev/null
  $PY "$SK/stage3_build/orchestrate_passes.py" sync spec.json --in-place > /dev/null || true
fi
s=$(date +%s)
$PY "$SK/stage3_build/generate_threejs_factory.py" spec.json --out createObjectModel.ts --pass-id "$P" --force > review/gen.log 2>&1 || { tail -5 review/gen.log; exit 1; }
echo "$P" > review/current-pass
bash "$HERE/make.sh" review "$N" > /dev/null 2>&1; cp "$HERE/2-img2threejs/$N.png" "review/$P.png"; cp "$HERE/2-img2threejs/$N-strip.png" "review/$P-strip.png"
$PY "$SK/stage4_review/make_comparison_sheet.py" --reference "$HERE/3-reference-pictures/$N.png" --render "review/$P.png" --out "review/$P-cmp.png" --json > review/cmp.log 2>&1 || true
echo "$N $P $(( $(date +%s) - s )) s" >> "$HERE/times.txt"
echo "$W/review/$P-cmp.png"
