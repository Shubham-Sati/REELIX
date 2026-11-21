#!/bin/bash
# Records the same review for every remaining pass of one object and runs each pass (the geometry no longer changes after
# form refinement for a textureless toy), then the final review.   bash finish.sh <name> "<pass.sh review string>"
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; N=$1; R=$2; W="$HERE/work/$N"; SK="$HERE/img2threejs/forge"
order="blockout structural-pass form-refinement material-pass surface-pass lighting-pass interaction-pass optimization-pass"
cur=$(cat "$W/review/current-pass"); go=0
for p in $order; do if [ $go = 1 ]; then bash "$HERE/pass.sh" "$N" "$p" review "$R" > /dev/null; fi; [ "$p" = "$cur" ] && go=1; done
cd "$W"; IFS='|' read -r FID AI ACT SUM LAYERS FEATS <<< "$R"
python3 -E -s "$SK/stage4_review/append_review.py" spec.json --pass-id optimization-pass --fidelity "$FID" --ai-vision-score "$AI" --action continue --summary "$SUM" \
  --render-screenshot review/optimization-pass.png --comparison-image review/optimization-pass-cmp.png --reference-screenshot "$HERE/3-reference-pictures/$N.png" \
  --map-stripped-render review/optimization-pass-strip.png --layer-scores-json review/layers.json --feature-reviews-json review/features.json --in-place > /dev/null
python3 -E -s "$SK/stage3_build/orchestrate_passes.py" sync spec.json --in-place > /dev/null
python3 -E -s "$SK/stage3_build/orchestrate_passes.py" status spec.json 2>&1 | head -1
S=$(grep "^$N START" "$HERE/times.txt" | tail -1 | awk '{print $3}'); E=$(date +%s); echo "$N END $E total $(( (E-S)/60 )) min $(( (E-S)%60 )) s" | tee -a "$HERE/times.txt"
