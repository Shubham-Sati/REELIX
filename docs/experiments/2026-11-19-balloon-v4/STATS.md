# Stats: hot air balloon Short re-made with Lego V4 (19 Nov 2026)

Read this first. It explains what was tested, every file, the numbers and the result.

## 1. Why we tested
Lego V4 (`2026-11-19-lego-v4-life`) was only tried on a short crowd scene. Question: does V4 work on a **complete real
Short**? Test: the hot air balloon Short (`videos/2026-11-14-the-smoke-idea-3d`), **same script, voice, music, captions
and timing**, but every character animated with V4.

## 2. What changed (old -> V4)
| Shot | Old | V4 animation |
|---|---|---|
| S1_0 Versailles lift-off | blocky King, mouth only | rounded King, head-first turn to the balloon, surprised then joyful, arm raise with wind-up |
| S1_2 Joseph by the fire | blocky man on block legs | V4 Joseph really **sitting** on the stool, curious -> surprised -> joy as the idea lands |
| S2_0 lighting the silk box | flat face | focused face, then a growing smile as the silk puffs |
| S2_1 box hits the ceiling | arms up | surprised, then steps back **laughing with a little hop** (crouch, jump, land) |
| S2_2 balloon over the town | arms up | brothers let go, surprise -> laugh/joy, both **jump for joy** at different moments |
| S3_0 "could anything breathe up there?" | head scratch | Joseph surprised then fearful, Etienne sad/worried while scratching his head |
| S3_1 animals go first | King claps | King surprised then **laughing** while clapping |
| S4_0 landing | animals | V4 sheep, duck and rooster (unchanged choreography) |
| S4_1 people flew | passengers wave | passengers laugh/joy, waves with anticipation |
| Everyone, every shot | still between moves | **breathing, blinking, weight shift**, contact shadows, fingers, collar and cuffs (automatic in V4) |

Kit fixes found while doing this (only in this folder's kit, `kit/v4b/base.tsx`; the V4 folder is untouched):
- **Knees bent the wrong way** in V4's crouch (it barely showed in the crowd test). Fixed: thighs go forward, shins back.
- **New `sit` pose** for sitting characters; the old `Seated` helper (block legs) now uses it.

## 3. Every file in this folder
| File | What it is | Built with |
|---|---|---|
| `balloon-OLD-original.mp4` | The Short as first made (blocky Lego look) | original pipeline |
| `balloon-V4.mp4` | Same Short re-animated with V4 | V4 kit (`kit/v4b`) + edited shot files in `video/project/custom/` + `tools/render.sh` |
| `balloon-old-vs-v4.png` | 5 moments (7.3 / 13.3 / 18.4 / 21 / 27.2 s). **Top row OLD, bottom row V4** | stills |
| `stills/before/` | First V4 check (V4 kit, old animations) | `tools/still.sh` |
| `stills/v4/`, `stills/old/` | One frame per shot, V4 and old | `tools/still.sh` |
| `kit/v4b/base.tsx` | V4 kit with the knee fix and the sit pose | written for this test |
| `kit/build.py`, `kit/smooth3d.py` | build tools (build.py now also swaps in the V4 Seated) | V3/V4 + this test |
| `video/` | The full working copy (script, voice, music, captions, timeline, shots) | copied from the original video |

## 4. Numbers
| | Old | V4 |
|---|---|---|
| Length | 28.7 s | 28.7 s (same) |
| Render time | — | 34 s, no memory retry |
| Expressions used | 0 | 7 kinds across 8 shots |
| Script, voice, music, captions | — | unchanged |

## 5. Result
V4 works on a complete Short with no story changes: every character breathes, blinks, shows the feeling of the line and
moves with anticipation. Shot files only needed a few lines each (expressions, `turn`, `kfA`, `jump`).

## 6. Honest limits
- Expressions are small in wide shots (S2_2, S3_1 King on the balcony, S4_1 passengers).
- The crowd figures (`Crowd`) are still simple background figures (not V4 faces).
- The knee fix and sit pose live only here; if approved they must be copied into the main V4 kit.

## 7. Conclusion
Pending your verdict.
