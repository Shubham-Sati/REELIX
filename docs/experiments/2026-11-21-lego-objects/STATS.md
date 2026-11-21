# Lego objects: our own code vs free 3D kits (21 Nov 2026)

**Status: DONE (experiment 1 of 2).** Experiment 2, the same objects made with the img2threejs skill, is in its own
folder: docs/experiments/2026-11-21-img2threejs-objects. Nothing here is in the kit or the pipeline yet (your rule:
experiment only until you approve).

## Why we tested
Videos need common objects (stones, mountains, trees, a bird nest, houses, bicycle, car, bus, train, motorbike, boat,
plane). The Lego kit only had a round Tree, Hill, small Town houses, Cloud, Balloon and Table.

## Round 1: our existing code only
Hand-built from the kit's shapes the way the set-builder does it today (project/custom/_objects.tsx, make.sh,
2-own-code/). Verdict: **too ugly** (your words and mine): wrong cottage roof, crude palm, boat and plane, faceted
mountain, blob motorbike, flat green hill, box house. Only pine, car and bus were passable.

## Research: is there a skill for all objects?
| Found | What it is | Verdict |
|---|---|---|
| img2threejs (Apache-2.0) | Rebuilds ANY object from one picture as code, 7 checked passes | The only real "any object" skill, very heavy: tested in experiment 2 |
| Kenney kits (CC0) | Car, Nature, City Suburban, Train, Watercraft kits | Downloaded (25 MB). 10 of our 16 objects |
| Quaternius (CC0, 84 packs, one artist) | Nature, buildings, cars, public transport, trains, ships | **Chosen**: 13 of 16 objects, the most of any free source |
| Poly Pizza, game-3d-assets, render, Snyk top 8, low-poly skills | | Mostly CC-BY (credit needed), paid APIs, CAD or advice only |

No free kit has everything: bus, bicycle, motorbike, plane and bird nest are missing from almost all of them.

## Coverage (what we asked for)
| Object | Quaternius (chosen) | Kenney | Round 1 code |
|---|---|---|---|
| Stones / rocks | yes (several) | yes (46) | ugly |
| Mountain | yes (3 kinds) | no (cliff tiles) | faceted |
| Trees: round, pine, palm, birch, dead | yes (about 40) | yes (about 60) | 1 round tree + crude pine/palm |
| Houses: cottage, town house, hut, fantasy | yes (about 40) | yes (21) | ugly |
| Car (+ police, sports, SUV, taxi) | yes | yes (25 vehicles) | ok |
| Bus, school bus | yes | no | ok |
| Train (steam, cargo, carriage) | yes | yes (41) | ok |
| Bicycle | yes | no | thin |
| Boat, sail boat, ships | yes | yes (33) | crude |
| Motorbike, plane, bird nest | **no** | no | blobs |

## How the kit models are used (experiment code only)
- `project/custom/_model.tsx`: loads a .glb or .obj(+.mtl), waits for it before the frame is drawn, sizes it to a real
  height in metres (a kit person is 1.75), stands it on the ground, and repaints every part in the Lego V5 satin
  plastic (roughness 0.55, no metal) keeping the kit's colours. Keeps leaf cut-outs. OBJ files that lost their colours
  (Quaternius' Public Transport pack) get colours by part name (windows blue, lights cream, wheels dark, body paint).
- `K_show.tsx` one object, `K_street.tsx` all together with a kit person for scale. `make-kits.sh <list> <out>` (out: 3-free-kits or 4-free-kit-varieties).

## Files
| File | What it is | Verdict |
|---|---|---|
| 2-own-code/sheet.png | Round 1, our code | ugly |
| 3-free-kits/sheet.png | The 17 kit objects for our list | far better (your words) |
| 3-free-kits/street.png | All of them in one street with a person for scale | sizes look right together |
| 4-free-kit-varieties/sheet.png | 18 more Quaternius varieties (birch, dead, pine and palm groves, fantasy house, police car, sports car, SUV, taxi, cargo train, sail ship, ship...) | the kit has real variety |
| 1-compare/round1-vs-kits.png | Round 1 and kit side by side, object by object | |
| kits.txt, kits-variety.txt | The object lists (file, height, length, colour) | |
| assets/models/q/SOURCES.txt | Every Quaternius model: title, author, licence (CC0), page | all CC0 |
| 5-kenney-backup-kits-unused/ (zips, kenney_*) | The five Kenney kits (backup source, 109 MB unpacked) | not used in the sheets |

## Numbers (speed)
| Step | Time |
|---|---|
| Rendering 17 objects + sheet + street | 42 s (about 2.5 s per object) |
| Downloading one model | 1-3 s (5 KB to 4 MB each) |
| Finding the right model per object (search, check title and licence) | about 1-2 min each, once |
| AI model use | none |

## Conclusion
- Free CC0 kits beat our own code by far, and are instant once downloaded.
- Quaternius covers 13 of 16 objects, with many varieties of each. Missing: motorbike, plane, bird nest.
- See experiment 2 for img2threejs, and the final comparison (quality and speed) there.
