# Stats: smooth Lego / toy world look (19 Nov 2026)

Read this first. It explains the problem, what was tested, every file, the numbers and the decision.

## 1. The problem we are solving
In the "3D Lego / toy world" look (look `toy3d`) everything was built from sharp boxes and few-sided shapes with flat shading:
square heads, block bodies, block arms, dot eyes, faceted rocks, clouds, pots and balloons. Videos looked like Lego or
Minecraft, not like a soft 3D cartoon.

## 2. What we tested
Same two finished Shorts, re-rendered with **only the shapes changed**. Same script, voice, music, captions, timing, camera
and story; no agent ran again, so this is a fair old vs new.

| Version | What it is |
|---|---|
| **OLD (blocky)** | The video as made: toy kit with sharp boxes, flat shading, low-poly spheres and cones. |
| **NEW (smooth)** | New toy kit base + a smoothing pass over every shot file. |

What the NEW way changes:
1. **Characters:** round head, eyes with white + pupil + highlight, eyebrows, nose, ears, rounded mouth that still talks,
   rounded body with buttons, neck, capsule arms and legs, round shoulders, mitten hands with a thumb, rounded shoes,
   soft hair cap. Joints sit in the same places, so props held in hands still line up.
2. **All objects:** every box becomes a rounded box (`RoundedBoxGeometry`, part of three.js); cylinders, cones, spheres,
   rings and circles get 24-48 sides instead of 5-12; rocks, clouds and smoke become smooth balls; flat shading is off everywhere.
   Shapes that are meant to be pointed (4-sided roofs, tricorn hat) are kept.
3. **Light:** softer shadows (2048 map, blurred edges) and a cool rim light from behind so round edges read clearly.

Tools: no new skill needed and nothing downloaded. Used the skills we already have (`model-characters`, `threejs-geometry`,
`threejs-materials`) and three.js's own rounded box.

## 3. Every file in this folder
| File | What it is | Built with |
|---|---|---|
| `glass-from-sand-OLD-blocky.mp4` | Glass from sand Short as first made (OLD) | old toy kit (`videos/2026-11-19-glass-from-sand/final.mp4`) |
| `glass-from-sand-NEW-smooth.mp4` | Same Short, smooth (NEW) | new kit base + `smooth3d.py` on all 12 shot files |
| `smoke-idea-3d-OLD-blocky.mp4` | Hot air balloon Short as first made (OLD) | old toy kit (`videos/2026-11-14-the-smoke-idea-3d/final.mp4`) |
| `smoke-idea-3d-NEW-smooth.mp4` | Same Short, smooth (NEW) | new kit base + `smooth3d.py` on all 9 shot files (its own blocky sheep/duck `Ball` removed so the smooth one is used) |
| `g-compare.png` | Glass: 4 moments (1.5 / 12.5 / 19 / 27 s). **Top row OLD, bottom row NEW** | ffmpeg stills |
| `s-compare.png` | Balloon: 4 moments (3 / 10 / 18 / 26 s). **Top row OLD, bottom row NEW** | ffmpeg stills |
| `stills/` | The single frames used for the compare images (`g-` glass, `s-` smoke, `old`/`new`, seconds) | `tools/still.sh` |
| `toy3d-kit-smooth-base.tsx` | The new top half of the toy kit (stage, light, materials, Box/Ball/Pill, Toy figure) | written for this test |
| `smooth3d.py` | Smoothing pass for any toy3d video's shot files (rounded boxes, more sides, smooth rocks, no flat shading) | written for this test |

## 4. Numbers
| | Glass OLD | Glass NEW | Balloon OLD | Balloon NEW |
|---|---|---|---|---|
| Length | 32.1 s | 32.1 s (same) | 28.8 s | 28.8 s (same) |
| File size | 22 MB | 24 MB | 28 MB | 28 MB |
| Render time (962 / 863 frames) | crashed at 4 frames at once, passed at 2 | **34 s, 4 at once, no crash** | — | **34 s** |
| Sharp boxes in kit + shot code | 81 | 0 (all rounded) | 71 | 0 (all rounded) |
| Flat shading | everywhere | none | everywhere | none |

Making a video takes the same time; only the 3D code changes.

## 5. What the eye sees
- Faces now have expression (eyes, brows, highlights); characters look like toy figures or claymation, not blocks.
- Pots, rocks, clouds, balloon, rings and piles are round and soft; the town roofs stay pointed on purpose.
- Rooms look a little darker and warmer (softer shadows); characters stand out more.
- Small leftovers: the glassmaker's apron is still a flat sheet when seen from the side; glass panes are thick rounded slabs.

## 6. Round 2 (V2): human and animal proportions, rigid things stay rigid
**Your feedback on round 1:** rigid things (aprons as boards, glass panes, tables) looked ugly when rounded; humans were too
broad and looked like robots; the tops of the legs showed as round balls.

**Research:**
- Our `model-characters` skill (`references/style-presets.md`): cartoon figures are 3-5 heads tall, near-real 6-7; the head in
  round 1 was very big (about 4.4 heads).
- Human shape guides (fiveable anatomy guide, Tuts+ cartoon body guide): bodies read as human through taper: chest wider than
  waist, hips that hold the legs, sloping shoulders, limbs that get thinner toward hands and feet. Robots come from equal-width
  tubes and a box chest.
- three.js forum and the Codrops "3D characters in three.js" guide: build smooth bodies with a lathe (a side profile spun round,
  like a vase) and tapered cylinders, not boxes.
No new skill was needed; nothing was downloaded.

**What changed in V2:**
| Part | Round 1 (NEW-smooth) | V2 (human) |
|---|---|---|
| Body | wide rounded box | lathe torso: hips -> narrow waist -> chest -> sloping shoulders -> neck; slimmer (shoulders about 0.4 wide instead of 0.5) |
| Hips and legs | leg tops showed as round balls | a hip piece (trousers) covers the leg tops; tapered thigh, knee, tapered shin, shoe |
| Arms | straight capsule tubes | tapered upper arm, elbow with a slight natural bend, forearm, cuff, palm and thumb |
| Head | big rounded cube (about 1/4 of height) | smaller egg-shaped head with a jaw (about 1/5 of height, near 5 heads tall); eyes, brows, nose, ears and mouth scaled to fit |
| Apron (glass video) | flat board | cloth that wraps the front of the body (`Apron`), follows the body when he turns |
| Goggle strap | flat plank | ring around the head |
| Sheep | round ball + square face | oval woolly body made of many wool tufts, thin dark legs with hooves, long dark face with muzzle, nostrils and drooping ears, tail |
| Duck | ball + square bill | teardrop body with tipped-up tail, folded wings, curved neck, round head, flat wide bill, webbed feet |
| Rooster | ball + box tail | plump upright body with breast, neck ruff, row of comb lobes, wattle, small beak, arched tail feathers, thin legs with toes |
| Rigid objects (tables, walls, windows, glass, boards, signs) | strongly rounded | **back to their real shape**, only a tiny bevel on the edge (max 2 cm) so light catches it |
| Round objects (pots, rocks, balloon, clouds, rings) | smooth | smooth (kept); the balloon now has 48 sides instead of 14 |

**V2 files:**
| File | What it is | Built with |
|---|---|---|
| `glass-from-sand-V2-human.mp4` | Glass Short with V2 humans, apron, rigid objects | V2 kit base + `build_test_kit.py` + `smooth3d.py` |
| `smoke-idea-3d-V2-human.mp4` | Balloon Short with V2 humans and V2 animals | same, plus `toy3d-animals.tsx` replacing the video's own animals |
| `g-compare-3way.png` | Glass at 1.5 / 12.5 / 19 / 27 s. **Rows: top OLD, middle round 1, bottom V2** | stills |
| `s-compare-3way.png` | Balloon at 3 / 10 / 18 / 21 / 23.5 / 26 s (21 and 23.5 show the sheep, duck and rooster). Same row order | stills |
| `toy3d-kit-smooth-base.tsx` | **Now the V2 kit base** (round 1 version replaced) | written for this test |
| `toy3d-animals.tsx` | V2 sheep, duck, rooster | written for this test |
| `build_test_kit.py` | Builds a test copy's kit: V2 base + the video's own extra code, apron/goggles/glove patches | written for this test |
| `smooth3d.py` | Smoothing pass (now also lathe shapes; boxes only get a tiny bevel) | updated |
| stills `*-v2-*.png` | V2 frames | `tools/still.sh` |

**V2 numbers:** both Shorts render in **23 s** each (round 1: 34 s), 4 frames at once, no out-of-memory error. Same length,
voice, captions and timing as the originals.

**Still to watch:** faces are smaller, so in wide shots they show less expression; held props (glass video) sit a few cm off
the hand when the elbow bends.

## 7. Round 3 (V3): straight body line, real-looking fire, molten glass
**Your feedback on V2:** the legs and upper body sometimes did not stay on one vertical line; fire looked like cones; the molten
glass on the tin bath did not look like molten glass.

**Causes found:**
- Body line: when a character leaned, the body bent from the FEET, so the hips slid forward off the legs. Fix: the lean now bends
  from the HIPS (`leanPos`), in the figure, the apron, and the hand/head helpers that hold props.
- Fire: 3 flat-shaded cones with 5 sides.
- Molten glass: a row of separate boxes (0.12 wide each) with flat colours, so it looked like stacked tiles.

**Research (how stylized game fire and lava are made):**
- Stylized fire = teardrop flame shapes + scrolling noise that eats away the top (ragged licking tips) + bright colours with
  additive glow; keep colour bright and let noise drive only the see-through amount, so overlapping flames do not wash out
  (Godot stylized-fire shader after MinionsArt, papaya-games devlog, dev.to elemental shaders article, three.js magma article).
- Lava / molten look = noise remapped to a hot colour gradient, inner glow from the noise, brighter edge glow (Fresnel),
  plus a glossy highlight (Godot lava shader, three.js forum on emissive + Fresnel, Codrops glass article).
No new skill or download; written as small shaders inside the kit.

**What changed in V3:**
| Part | V2 | V3 |
|---|---|---|
| Lean | bends from the feet, hips slide off legs | bends from the hips, legs and body stay on one line |
| Fire (`FireFX`, used by Fire, Flames, Furnace, PotOnFire, Fireplace) | 3 orange cones | 5 flame tongues, each 3 layers (red outer, orange middle, white-yellow core), ragged tips from moving noise, sway, additive glow halo, rising embers, flickering light |
| Molten glass (`MoltenRibbon`, tin bath shot S4_1) | stacked boxes | one continuous glowing sheet with a rounded spreading edge: white-hot at the furnace -> orange -> amber -> clear teal glass; hot streaks flow along it, wet shine, edge glow |

**V3 files:**
| File | What it is | Built with |
|---|---|---|
| `glass-from-sand-V3-fire-glass.mp4` | Glass Short with V3 (hip lean, new fire, molten glass ribbon) | V3 kit base + `build_test_kit.py` + `smooth3d.py`; shot S4_1 uses `MoltenRibbon` |
| `smoke-idea-3d-V3-fire.mp4` | Balloon Short with V3 (hip lean, new fireplace fire) | same |
| `v3-fire-glass-compare.png` | **Top row OLD (original video), bottom row V3**: glass 18.5 / 21.8 / 24.5 / 25.8 s, balloon 6 / 12 s | stills |
| `toy3d-kit-smooth-base.tsx` | **Now the V3 kit base** (adds `leanPos`, `FireFX`, `Glow`, `MoltenRibbon`) | written for this test |

**V3 numbers:** glass render 65 s (shaders cost more), balloon 32 s; the balloon render ran out of memory at 4 frames at once and
passed on the automatic retry with 2. Length, voice, captions and timing unchanged.

**Still to watch:** the cooled end of the glass sheet reads light blue-white rather than clearly teal; flames are a bit small in
wide shots.

## 8. Conclusion
Pending your verdict. If approved: the new base goes into `library/templates/toy3d-kit.tsx`, the set-builder agent is told to
use Box / Ball / Pill / RoundGeo (never raw boxGeometry or flatShading), and `smooth3d.py` moves to `tools/` and runs on every
toy3d video before render as a safety net.
