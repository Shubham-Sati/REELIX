# Lego objects with the img2threejs skill, and the final comparison with free kits (21 Nov 2026)

**Status: DONE (experiment 2 of 2).** Experiment 1 (our code, then free CC0 kits) is
docs/experiments/2026-11-21-lego-objects. Nothing here is in the kit or the pipeline (experiment only until you approve).

## Why we tested
Experiment 1 found that free kits look far better than our own code, but no kit has every object (no bird nest,
motorbike or plane). img2threejs (github.com/img2threejs/img2threejs, Apache-2.0, v2.0.1) is the only skill that says it
can build ANY object as code, so we ran the same 16 objects through it and compared.

## How img2threejs was run (the skill is untouched, in img2threejs/)
1. A reference picture per object, made locally with FLUX klein ("smooth glossy plastic toy figurine"): refs/, refs.sh.
2. A short parts list per object read off the picture (objects/*.json, written by objects/make_objects.py).
   build_spec.py expands it into the skill's full spec format (about 100 lines of JSON per part) and runs the skill's own
   strict-quality gate. Materials are declared "textureless" (the skill's own option for flat designer-toy plastic).
3. The skill's 8 locked passes per object (blockout, structural, form, material, surface, lighting, interaction,
   optimization): its code generator writes a Three.js file for the pass, we render it in our engine (make.sh, I_show.tsx,
   same camera and light as experiment 1), the skill makes a side-by-side sheet, Claude scores it by eye, and the skill's
   append_review.py records the score; a pass only unlocks the next one at 0.7 overall and 0.8 for every critical
   feature (pass.sh, finish.sh).
4. Two skill settings had to change from their defaults, both supported by the skill: quality priority "balanced"
   instead of "reference-fidelity" (that one demands 1024 px photo texture maps a flat toy does not have), and a
   "textureless" declaration per material. One inconsistency in the skill: its validator accepts "textureless", but
   its material-pass gate ignores it unless the priority is "balanced".

## Result per object
| Object | Parts | Passes | Score | Verdict |
|---|---|---|---|---|
| rocks | 7 | 8/8 | 0.80 | three rounded boulders and pebbles |
| mountain | 19 | 8/8 | 0.75 | dark cone, snow cap and tongues, base boulders (after 1 refine) |
| pine | 8 | 8/8 | 0.86 | very close to the reference |
| palm | 18 | 8/8 | 0.76 | curved trunk and fronds (after 1 refine) |
| tree | 16 | 8/8 | 0.78 | ball canopy on a trunk (after 1 refine) |
| nest | 12 | 8/8 | 0.74 | twig bowl with blue eggs, weave only suggested |
| cottage | 21 | 8/8 | 0.82 | close to the reference (the pilot) |
| townhouse | 28 | 8/8 | 0.80 | facade, window grid, roof (after 1 refine) |
| hut | 18 | 8/8 | 0.77 | round straw hut with doorway (after 1 refine) |
| car | 20 | **0/8** | 0.70 | **not passed**: boxy; the rounded hatchback needs a sculpted shell (3 refines) |
| bus | 25 | 8/8 | 0.78 | long red bus, more boxy than the reference |
| train | 25 | 8/8 | 0.82 | steam engine with boiler, cab, six wheels |
| bicycle | 27 | 8/8 | 0.85 | very close |
| motorbike | 15 | **0/8** | 0.75 | **not passed**: reads as a motorbike but blobby (3 refines) |
| sailboat | 9 | 8/8 | 0.78 | hull, rim, sails |
| plane | 17 | 8/8 | 0.78 | pink propeller plane |

14 of 16 passed every pass. The skill's code generator wrote 24,162 lines of Three.js for the 16 objects.
Limits seen: only basic shapes (box, ball, cylinder, cone, torus, extrude...); edges stay sharp (its only smoothing,
Catmull-Clark subdivision, turns a box into a pillow); smooth car bodies and detailed bikes are out of reach this way.

## Final comparison: free kits vs img2threejs
| | Free kits (Quaternius, CC0) | img2threejs |
|---|---|---|
| Objects covered (of 16) | 13 (no nest, motorbike, plane) | **16** (14 passed its gates) |
| Looks | **Better** where it has the object: professional detail (car, bus, train, town house, cottage, sail ship) | Simpler; matches a chosen toy look (mountain, hut, pine, tree), boxy for cars and bikes |
| Variety | **Many kinds** of each (about 40 trees, 40 houses, 47 vehicles) | One per spec; each new kind is new work |
| Time per object, machine | **about 2.5 s** render (+1-3 s download once) | 42 s FLUX picture + about 65 s for 8 passes = about 1.8 min |
| Time per object, Claude | about 1-2 min once (find and check the model) | about 3-6 min (write the parts list, 1-3 visual reviews, refines) and a lot of usage |
| One-time setup | 25-35 MB download, a loader (_model.tsx) | about 45 min (tooling around the skill, gate fixes) |
| Whole 16-object run | under 1 min to render | about 35 min after setup (+ 11 min of FLUX pictures) |
| Licence | CC0 (no credit needed) | Apache-2.0 skill; output is our own code |
| Animation | some kit models are one piece (wheels do not turn) | every part is separate, easy to animate |

Per object, which looks better:
| Kit better | Tie (both good) | img2threejs better | Only img2threejs |
|---|---|---|---|
| car, bus, train, town house, cottage | rocks, pine, palm, tree, bicycle, sailboat | mountain, hut (kit "hut" is an open shelter) | nest, motorbike (not passed), plane |

## Conclusion
- **Which is better:** the free kits, by a clear margin wherever they have the object, and they come in many varieties.
- **Which is faster:** the free kits, by far: seconds per object against minutes, and almost no Claude usage.
- img2threejs is useful only for what no kit has (nest, plane, and with more work a motorbike), and when an object must
  match one exact look.
- My recommendation, for you to decide: kits as the object library; img2threejs (or the same spec builder) only for
  missing objects. Nothing moves into the kit or pipeline until you approve.

## Files
| File | What it is |
|---|---|
| 1-compare/reference-kit-img2threejs.png | Every object: reference picture, free kit, img2threejs |
| 2-img2threejs/sheet.png, 2-img2threejs/<name>.png | The 16 img2threejs objects (2-img2threejs/<name>-strip.png: the unlit shape check) |
| 3-reference-pictures/ | The 16 FLUX reference pictures, refs-sheet.png, times.txt |
| 4-review-rounds/ | Blockout and refine sheets from the review rounds |
| objects/ | The parts lists (make_objects.py writes 14 of them) |
| work/<name>/ | The skill's spec, generated createObjectModel.ts, and review/ (every pass: render, unlit render, comparison sheet) |
| build_spec.py, pass.sh, finish.sh, make.sh, refs.sh | The scripts that re-run everything |
| times.txt | Every timing |
| img2threejs/ | The skill, copied unmodified (commit 0c0c49b) |
