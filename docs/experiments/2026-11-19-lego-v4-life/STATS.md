# Stats: Lego V4 "life in motion" (19 Nov 2026)

Read this first. It explains the problem, what was tested, every file, the numbers and the result.
V3 (`2026-11-19-lego-smooth`) and the crowd test (`2026-11-19-lego-crowd-test`) are untouched; this is a new folder.

## 1. The problem we are solving
V3 fixed the SHAPES (rounded, human proportions). The ChatGPT research chat ("Research Animation Skills", shared link) pointed
out what still makes characters feel robotic: no breathing, no blinking, the whole body turns at once, no weight shift, moves
start with no anticipation, flat clothes, and no character sheet to keep each character consistent.

## 2. What we tested (checklist)
| # | Item | Done? | How it works | How we checked |
|---|---|---|---|---|
| 1 | Breathing | Yes | chest widens and rises slightly, shoulders and head lift a little (each person on their own rhythm) | crowd video, idle people |
| 2 | Blinking | Yes | quick close-open every 2.8-4.4 s, timing different per person (from their name), same every render | crowd video, faces |
| 3 | Head-first turns | Yes | `turn()` helper: head reaches the new direction first, body follows 0.22 s later | `check-turn-and-jump-slow.mp4` (Dad turns to the rooster at 5.2 s) |
| 4 | Weight shift | Yes | walking: hips roll over the standing leg, coat hem swings; standing: slow side-to-side shift | crowd video (Kid running, everyone idle) |
| 5 | Anticipation | Yes | `kfA()` (moves a little back first, overshoots and settles) for arm raises and points; `jump()` crouches before take-off and absorbs the landing | slow clip (Kid's jump at 6.1 s), Mum's point at 3.4 s, Dad's arms at 7.8 s |
| 6 | Expressions | Yes, new | 8 expressions: neutral, joy, laugh, sad, cry (tears), angry, surprised, fear: brow height and tilt, eye size, closed laughing eyes, smile/frown curve, open mouth, teeth | `boy-character-sheet-V4.png` section 2 |
| 7 | Soft clothing folds | **Partly** | collar, sleeve cuffs, rolled trouser cuffs, coat hem that swings, a few fold lines at the waist. No real cloth simulation (too heavy for this kit) | sheet section 1 |
| 8 | Hands | Yes | palm + 3 fingers + thumb (were mittens) | sheet, close crops |
| 9 | Contact shadows | Yes | soft dark patch under every person that fades when they jump | crowd stills |
| 10 | Character sheet + continuity | Yes (Lego style) | one character rendered as front / profile / back, 8 expressions and 4 poses, from the same spec | `boy-character-sheet-V4.png` |
| 11 | Child proportions | Yes | `child: true`: shorter legs, slightly bigger head | sheet (boy), crowd (Kid) |

## 3. Every file in this folder
| File | What it is | Built with |
|---|---|---|
| `boy-character-sheet-V4.png` | Character sheet of a test boy (white top, green trousers, maroon shoes, like your reference sheet): 1 turnaround, 2 expressions (2 rows of 4), 3 poses | V4 kit, `sheet/` scenes `Turn`, `Faces`, `Poses`, `tools/still.sh`, ffmpeg labels |
| `crowd-test-V4.mp4` | The farm picnic (4 people + 3 animals, 11 s) with all V4 features | V4 kit + `crowd/project/custom/S1_0.tsx` (same story as V3 crowd test, plus expressions, `turn`, `kfA`, `jump`) |
| `crowd-test-V3-before.mp4` | The same story in V3, copied here for side-by-side viewing | from `2026-11-19-lego-crowd-test` |
| `crowd-v3-vs-v4.png` | Zoomed crops at 2 / 4 / 6.3 / 9.5 s. **Top row V3, bottom row V4** | stills |
| `check-turn-and-jump-slow.mp4` | 5.0-7.0 s of V4 at 1/3 speed: Dad's head-first turn, Kid's crouch-jump-land | ffmpeg |
| `stills/` | sheet panels and crowd frames | `tools/still.sh` |
| `kit/base-v3.tsx` | V3 kit base (copy, for reference) | V3 |
| `kit/toy-v4.tsx` | The new V4 figure code on its own (Toy, face, hands, helpers) | written for this test |
| `kit/v4/base.tsx` | **V4 kit base** (V3 base with the V4 figure) | written for this test |
| `kit/animals.tsx`, `kit/build.py`, `kit/smooth3d.py` | V3 animals and build tools, unchanged | V3 |
| `crowd/`, `sheet/` | The two test "videos" (kit, shot files, timeline) | — |

## 4. Numbers
| | V3 crowd | V4 crowd |
|---|---|---|
| Length | 11 s | 11 s |
| Render time | 12 s | 12 s |
| Expressions used | none (mouth only) | 6 (neutral, joy, laugh, surprised + Grandpa laugh, Kid jump joy) |
| Memory problems | none | none |

## 5. What the eye sees
- Characters now look alive even when standing (breath, blinks, small weight shifts).
- Faces read from the wide shot: laughing closed eyes, surprised O mouth, big smiles.
- The Kid's jump reads as a real jump (crouch, take-off, land) and Dad's arms swing up with a little wind-up.

## 6. Honest limits
- **Sad and fear** are weaker than joy/angry/surprised/laugh/cry in the sheet; brows need a stronger tilt.
- **Crying pose:** hands do not quite reach the face.
- **Clothing folds** are suggested (cuffs, collar, hem, a few lines), not simulated cloth.
- Faces are still simple toy faces; they will never match a Pixar render (that is the AI motion look's job).

## 7. Conclusion
Pending your verdict. If approved, V4 can become the default Lego kit for new videos (and the set-builder agent learns
`turn`, `kfA`, `jump`, `expr`, `child`).
