# Stats: Lego V5 (19 Nov 2026)

Read this first. It explains the problem, what was tested, every file, the numbers and the result.
V4 folders are untouched; V5 starts from the balloon V4 kit (`2026-11-19-balloon-v4/kit/v4b`: V4 + knee fix + sit pose).

## 1. The problem we are solving (your notes, `LEGO-V5-TODO.md`)
1. Human characters still not right.
2. Hair floats above the head (gap, seen on Joseph's white hair).
3. Arms look like plain cylindrical pipes.
Keep exactly: expressions and animations (jump, walk, turns, anticipation, breathing, blinking).

## 2. What changed (V4 -> V5)
| Part | V4 | V5 |
|---|---|---|
| Hair | a cap shell set 3 cm above the head + a ball (gap at the top) | two shells **fitted to the head shape** (top and back), only 3.5% larger than the head, so the hair always touches the scalp |
| Arms | straight tapered tubes + separate balls at shoulder/elbow | **one smooth shaped arm**: rounded shoulder cap that flows into a fuller upper arm, narrows at the elbow, forearm fuller below the elbow and tapering to a real wrist; sleeve opens slightly at the cuff |
| Coat front | white oval "shirt" patch | clean coat front with a soft placket line and buttons |
| Shoulders/chest | narrow sloping top | rounder shoulders and fuller chest in the body profile |
| Expressions, walk, jump, turns, breathing, blinking | approved | **unchanged** (same code) |

Tried and dropped during the test (looked worse): separate shoulder/elbow balls (looked like stacked balls), coat lapels with a
V shirt (looked like a bow tie), a hair fringe made of small lumps (looked like worms).

## 3. Every file in this folder
| File | What it is | Built with |
|---|---|---|
| `balloon-V5.mp4` | Hot air balloon Short with V5 characters (same script, voice, music, animations as V4) | V5 kit + balloon V4 shot files, `tools/render.sh` |
| `balloon-V4-before.mp4` | The V4 version, copied here for side-by-side viewing | from `2026-11-19-balloon-v4` |
| `balloon-V4-vs-V5.png` | Crops at 7.3 / 10.9 / 13.3 / 15.8 / 18.4 s. **Top row V4, bottom row V5** | stills |
| `boy-character-sheet-V5.png` | Test boy in V5: turnaround, expressions (2 rows), poses | V4 sheet scenes on the V5 kit |
| `kit/v5/base.tsx` | **V5 kit base** | written for this test |
| `kit/v4b-base.tsx` | the starting kit (balloon V4), for reference | — |
| `kit/build.py`, `kit/smooth3d.py`, `kit/v5/animals.tsx` | build tools and animals (unchanged) | — |
| `balloon/`, `sheet/` | working copies (shots, timeline, audio) | — |
| `stills/` | frames used above | `tools/still.sh` |

## 4. Numbers
| | V4 | V5 |
|---|---|---|
| Balloon Short length | 28.7 s | 28.7 s |
| Render time | 34 s | 50 s (smoother arm and hair shapes have more detail) |
| Memory problems | none | none |

## 5. Honest limits
- The bodies are still toy-like (coat as one smooth shape); a real "human" look would need sculpted models, which code
  shapes cannot fully reach.
- The boy's short hair is a smooth cap (no spiky strands); spikes would need extra hair pieces.
- Render is about 1.5x slower.

## 6. Round 2 fix (your review of V5 round 1)
**Your notes:** hands look hollow; circles at the joints.
**Causes:** the sleeve flared open at the cuff like a cup (you could see inside it); the elbow and knee were separate balls
between two tubes, so a circle showed when the arm or leg bent.
**Research:** the three.js community builds bendable limbs as ONE tube along a curve through the joints, with the thickness
changing along it (forum "Tube geometry with varying radius", "Extended TubeGeometry", "pipe bending" threads); stylized
cartoon hands are solid, chubby, rounded shapes.
**What changed (V5 only; round 1 kept as `kit/v5/base-round1.tsx`):**
| Part | V5 round 1 | V5 round 2 |
|---|---|---|
| Arm | shaped upper arm + elbow ball + forearm + flared sleeve | **one continuous sleeve** from shoulder through elbow to wrist (`Sweep`), bends smoothly, closed at the wrist |
| Leg | thigh tube + knee ball + shin tube | **one continuous trouser leg** from hip through knee to ankle |
| Hand | palm + 3 thin fingers + thumb | **solid chubby mitten hand** (palm and fingers as one rounded shape) + thumb |
Same expressions and animations (approved V4 code untouched).
Render: balloon Short 25 s (round 1: 50 s).
Files updated: `balloon-V5.mp4`, `balloon-V4-vs-V5.png` (top V4, bottom V5), `boy-character-sheet-V5.png`.
Still to improve: the crying pose's hands do not reach the face; the boy's hair is a smooth cap (no spikes).

## 7. Conclusion
Pending your verdict.
