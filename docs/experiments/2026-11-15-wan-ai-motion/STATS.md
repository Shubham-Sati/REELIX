# Stats: 3D AI motion experiment (15 Nov 2026)

Read this first. It explains what was tested in this folder, the old way and the new way, every file, and what we decided.

## 1. Why we tested
The "3D toy world" look (characters built from boxes in code) looked like Lego. A second try with ready-made rigged
3D characters (KayKit, CC0) looked like a video game and was rejected and deleted. Research showed that most 3D-looking
animated story channels make each shot as **one Pixar-style AI picture, then an AI image-to-video model brings it to life**.
So we tested that: FLUX.2 klein for the picture + **Wan 2.2** for the motion, on our 16 GB Mac.

## 2. What we tested
| # | Question | Result |
|---|---|---|
| 1 | Can Wan 2.2 run on a 16 GB Mac? | Yes, with the FastWan 3-step model and a "tiled" (small pieces) decode. The normal decode ran out of memory. |
| 2 | Does it look like a real 3D animated film? | Yes: Joseph turns, points at the smoke and smiles; fire flickers; face and clothes stay the same. |
| 3 | How long does one clip take? | About 14 minutes for 3.4 s (81 frames). |
| 4 | What colour grade? | Original was too harsh, "soft" was faded, **"balanced" was approved**. |
| 5 | Old way vs new way of reading prompts (speed-up)? | Same action and quality, not frame-identical; saves ~1.5 min per shot from the 2nd shot on. |

Model: Wan 2.2 TI2V-5B, FastWan DMD 3-step, MLX build `lBroth/FastWan2.2-TI2V-5B-MLX` (24 GB, Apache-2.0, OK for YouTube),
run with mlx-video (MIT) from AI Video Editor's `envs/video`. Picture model: FLUX.2 klein 4B (Apache-2.0).

## 3. Old way vs new way (reading the motion description)
Wan has a big text reader (11 GB) that turns the motion description into numbers, and a video maker.
- **Old way (one by one):** for every shot: load the text reader, read that one description, unload it, then make the video.
  With 10 shots the text reader is loaded 10 times (~1.5 min each).
- **New way (read once):** load the text reader once, read the descriptions of all shots, save the numbers, unload it.
  Then make every clip one after another with the saved numbers. Tool: `tools/wan_i2v.py --jobs jobs.json`.

## 4. Every file in this folder
| File | What it is | Built with |
|---|---|---|
| `start-picture-klein.png` | The start picture every clip was made from: Joseph by the fire, two hands. | FLUX.2 klein, seed 101, 576x992. (An earlier try had 3 hands and was redrawn, not kept.) |
| `wan-test-joseph-fire.mp4` | **First Wan test**, as it came out of Wan, upscaled for viewing. No colour grade. Judged: animation good, colours too harsh. | Old way (one by one), Wan 2.2 FastWan 3 steps, tiled decode, 480x832 upscaled to 1080x1920, 30 fps. |
| `wan-test-joseph-fire-soft.mp4` | Same clip with a **soft** grade (lower contrast and colour, lifted shadows). Judged: faded, **rejected**. | `wan-test-joseph-fire.mp4` source + FFmpeg grade: contrast 0.86, saturation 0.82, gamma 1.06, shadows lifted. |
| `wan-test-joseph-fire-balanced.mp4` | Same clip with the **balanced** grade. Judged: **approved, "perfect"**. This grade is now in `tools/grade.py`. | Same source + FFmpeg grade: contrast 0.94, saturation 0.90, gamma 1.02, blacks kept deep, highlights rolled off, light sharpening. |
| `wan-old-one-by-one.mp4` | Raw clip made the **OLD way** (text reader loaded for this clip). No grade, 480x832. | Old way: `tools/wan_i2v.py <model> <picture> "<prompt>" <out> 81 42`. Same picture, prompt, seed 42. |
| `wan-new-read-once.mp4` | Raw clip made the **NEW way** (descriptions read once first, then the clip). No grade, 480x832. | New way: `tools/wan_i2v.py --jobs jobs.json`. Same picture, prompt, seed 42. |
| `wan-old-vs-new.png` | Frames 0, 20, 40, 60 and 80 of both raw clips. **Top row = old way, bottom row = new way.** | ffmpeg frame grab of the two files above. |
| `README.md` | Short technical summary. | — |

Prompt used for every clip: "3D animated Pixar-style film shot. The stocky man slowly turns his head toward the fireplace,
raises his right hand and points at the grey smoke curling up from the crackling fire, his face lights up with a curious smile.
The flames flicker and the smoke rises and swirls upward. Gentle slow camera push-in, warm amber firelight, smooth natural motion."

## 5. Numbers
### Time for one 3.4 s clip (480x832, 81 frames)
| Step | Old way | New way |
|---|---|---|
| Read the description (text reader) | 97 s | 92 s, once for the whole video |
| Make the motion (3 steps) | 112 s | 116 s |
| Turn into frames (tiled decode) | ~10.5 min | ~10 min |
| **Total** | **835 s (13.9 min)** | **820 s (13.7 min)** |
| Saving on a 10-shot Short | — | ~14 min (the reading is skipped for shots 2-10) |

### Old vs new picture match (SSIM, 1.0 = identical)
| Frame | Match |
|---|---|
| first frame | 0.995 (same) |
| frames 20 / 40 / 60 / 81 | 0.66 / 0.64 / 0.67 / 0.63 |
| Look and action | same: turn, point, smile, fire flicker, two hands, same face |
| Differences | new clip's camera sits a little closer; smoke curls differently |
| Cause | not proven; most likely the random part of the motion step |

### Colour grades (one frame, measured)
| Version | Contrast | Brightness | Verdict |
|---|---|---|---|
| Original | 26.6 | 27.3 | too harsh |
| Soft | 20.8 | 35.7 | faded, rejected |
| Balanced | 25.7 | 27.8 | approved |

## 6. Conclusion: what we shifted to
1. **New 3D look "3D animated (AI motion)"** (look `aimotion`), first in the 3D menu; the old look is kept as "3D Lego / toy world".
   Each shot: klein draws a Pixar-style picture, Wan 2.2 animates it.
2. **New way (read once)** is used for every video: same quality, saves ~1.5 min per shot from the 2nd shot on.
3. **Tiled decode** is always on (16 GB Mac).
4. **Balanced grade** is applied to every clip by `tools/grade.py`, after **colour matching**: one correction per whole clip
   (never per frame, so fire glow and flicker stay), small limited nudges toward the scene's average, shots marked
   `keepLight` (story light changes) left alone. Colour guide skill: `ffmpeg-color-grading-chromakey` (MIT).
5. **Shorts:** every shot moves. **Long videos (10-12 min):** only the key shots move (about 1 in 4); the rest get slow
   camera moves (zoom, pan, tilt, 2.5D depth). About 8-10 hours for a 12-minute video, run overnight.
6. Expected time for a 30 s Short with this look: about 2-2.5 hours (~12-14 min per shot).
