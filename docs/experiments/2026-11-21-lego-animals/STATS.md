# Lego animals by body plan (21 Nov 2026)

## Why we tested
The Lego look (toy3d, Lego V5) only had three animals in the kit (Sheep, Duck, Rooster). Any other animal was hand-built
by the set-builder inside one video, and it often came out wrong (the rock salt horse: neck leaning backwards, face on
the underside). We wanted a way to draw MANY different animals that all look right and match the Lego V5 look.

## Research first (online, 21 Nov 2026)
Looked for a ready skill that builds animals in code for a React Three Fiber / WebGL engine like ours.

| Found | What it is | Verdict |
|---|---|---|
| img2threejs (github.com/img2threejs/img2threejs, Apache-2.0) | Rebuilds an object from one reference image as procedural Three.js. Its README names a "creature generator" (quadruped / avian / dragon / serpent body plans) | Not usable: the creature code is not in the repo (0c0c49b); it is an image-matching pipeline with Python gates, not a way to make animals from a text idea |
| linegel/threejs-procedural-creatures | Procedural creature "compiler" | Not usable: WebGPU + TSL only (our engine is WebGL), no licence shown (already rejected 14 Nov) |
| markkampstra/fp-survival modeling-3d | Box + cylinder recipes for quadruped, bird, fish | Not usable: no licence in the repo; recipes are blocky game props |
| jaybmcv/3d-workflow-skill, Priyanshu-dev525/LowPolySkill, IAmTheParsifal/Low-Poly-Modeling-Skill, jasonkneen threejs-primitive-reconstructor | General 3D / low-poly workflow skills | No animal guidance (or Blender only, or no licence) |
| Our own model-characters skill (codepawl, already installed) | Section 8 "creature and animal notes" | Used for the method: reference real animals, many small proportion changes, detail passes |
| Cute / toy character design guides (tutsplus, Clip Studio, Cartoon Brew on Preston Blair) | Design rules | Used: big head and eyes, shorter muzzle, short plump legs for small animals, a silhouette that reads as a flat shape |
| LEGO animal building guides (Brothers Brick, Studded Plate, Unofficial LEGO Builder's Guide) | How brick builders do animals | Used: slopes and arches for a distinctive silhouette, keep animals in scale with each other |

Result of the research: no ready skill fits, so nothing was added to .claude/skills (checked list is in SOURCES.md).
We built the method into code instead, first here, then (same day) into the shared kit `library/templates/toy3d-kit.tsx`.

## The method (now in the kit: Quad, Bird, Fish, Turtle, ANIMALS)
1. **Pick the body plan**, not the animal: `Quad` (4 legs), `Bird` (2 legs + wings), `Fish`, `Turtle`.
2. **A new animal is a spec, not new code**: body length and girth, leg length, neck length and tilt, head size, muzzle,
   then 1-3 **signature features** (trunk + big ears, long neck + spots, mane, horns, curly tail, long ears, face mask).
3. **Silhouette check**: every animal is also rendered as a black shape. If the shape does not say the animal, the
   shape is fixed, not the colours.
4. **Toy rules**: head and eyes a little bigger, muzzle a little shorter than real; legs keep their real length class.

## Rounds (what was wrong and what fixed it)
| Round | Problem seen | Fix |
|---|---|---|
| 1 | Horse read like a dog or llama (small round head, thin snout) | Long deep head, thick muzzle, thicker neck and legs, bushy tail |
| 1 | Cat lumpy (patches stuck out), droopy tail | Patches sunk into the body (flat caps); tail curves UP |
| 1 | Beaded tails and trunks (rows of balls showed) | Ball spacing tied to thickness, so tubes read smooth |
| 2 | Parrot beak looked like a tusk | Round upper beak + hooked tip + dark lower beak |
| 2-3 | Owl and parrot face discs stuck out of the side, then striped | One face mask in front of the head (clean edge, no flicker) |
| 3 | Ragged belly edges | Bodies and bellies use a finer ball (64 x 48) |
| 4 (your note) | **Leg tops flat and sticking out of the body** | Tried ball shoulders (too puffy) and wide thighs (stuck out of the narrow chest); final: **each leg is ONE smooth turned shape** with a round dome top hidden inside the body, sized from the body's real width at that leg, tapering to the knee and ankle, ending inside the hoof |
| 4 | Leg looked see-through (hoof top showed through) | The turned shape's profile must run bottom to top, or the faces point inward |

## Files
| File | What it is | Made with | Verdict |
|---|---|---|---|
| library/templates/toy3d-kit.tsx (end of file) | The body plan builders (Quad, Bird, Fish, Turtle) and the 15 preset specs (ANIMALS), moved there from this folder | code, uses the kit's Ball / Pill / Lathe / mat | in the kit |
| project/custom/_kit.tsx | Copy of the kit (as the set-builder does); make.sh renders from it | copied | the kit render is pixel-identical to the experiment render (PSNR infinite) |
| project/custom/A_show.tsx | One animal, 3/4 view, or on green for the silhouette | code | test shot |
| project/custom/Z_zoo.tsx | All 15 animals together at relative size, with the kit's Sheep, Duck, Rooster | code | test shot |
| make.sh | Re-makes every picture: 15 stills, 15 silhouettes, the group shot, two contact sheets | Remotion still + ffmpeg | about 66 s, no AI model |
| out/sheet.png | All 15 animals | make.sh | all recognisable |
| out/silhouettes.png | The same as black shapes | make.sh | all recognisable as shapes |
| out/zoo.png | Group shot | make.sh | sizes read right next to each other |
| out/legs-before-after.png | Leg tops: before, try 2, now | ffmpeg | the leg fix |
| out/<animal>.png, out/sil/<animal>.png | Single stills and silhouettes | make.sh | |

## Numbers
- 15 new animals from 4 body plans: dog, cat, horse, cow, pig, elephant, giraffe, lion, bear, rabbit (Quad); penguin, owl,
  parrot (Bird); fish; turtle.
- 1 new animal = one spec of about 3 lines. The builders are about 230 lines in all.
- A full set of 31 stills renders in about 66 s on the M1 Pro.
- 4 rounds of fixes plus the leg rework.

## Conclusion
- There is no ready animal skill for our engine; building animals by body plan + spec works and covers far more animals
  than hand-building per video.
- Done (21 Nov, after your OK): `Quad`, `Bird`, `Fish`, `Turtle` and `ANIMALS` are in library/templates/toy3d-kit.tsx;
  the set-builder must use a preset or a spec, never loose shapes (an unknown animal = nearest body plan + its features).
  Old videos keep their own _kit.tsx copy, so nothing changes for them. The kit's old Sheep keeps its straight legs
  (the tops are hidden in the wool).
- Not tested yet: walking (the walk swing is in the code but only stills were checked).
