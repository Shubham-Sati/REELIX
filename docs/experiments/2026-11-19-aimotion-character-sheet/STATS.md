# Stats: AI motion character sheet + continuity (19 Nov 2026)

Read this first. It explains the problem, what was tested, every file, the numbers and the result.

## 1. The problem we are solving
For the "3D animated (AI motion)" look you want characters like your reference "Character Consistency Design Sheet":
Pixar-quality, high definition, every expression clear (not blurry), and **the same character in every shot**
(face, hair, clothes). Today the pipeline draws every shot's picture from the text description only, so small details can
change from shot to shot.

## 2. What we tested
| Step | Old way (today) | New way (tested) |
|---|---|---|
| Character look | described in text in every shot prompt | **one hero picture** drawn first (klein, 768x1024) |
| Character sheet | none | front / profile / back + 6 expressions + 4 poses, all drawn from the hero with **klein edit mode** (`mflux-generate-flux2-edit --image-paths hero`) |
| Shot pictures | klein from text only | klein edit mode **with the hero as reference** + the scene description |
| Motion | Wan 2.2 FastWan (read-once, tiled decode) | same |
| Sharpness | Real-ESRGAN 3x + balanced grade | same |

Test character: a 9-year-old boy like your sheet (spiky black hair, white polo with maroon striped collar, green rolled
trousers, maroon sneakers, brown wristwatch). Three shots: **A** park, laughing as a puppy licks him (medium shot);
**B** kitchen, close-up, flour puffs up, surprise then laugh; **C** playground, running toward camera waving (full body).
Everything ran locally on the 16 GB Mac; nothing downloaded (klein edit mode was already installed with mflux).

## 3. Every file in this folder
| File | What it is | Built with |
|---|---|---|
| `sheet/hero-front.png` | The hero picture (scored 100/100 by you) | klein 4B text-to-image, 768x1024, seed 11, 4 steps |
| `sheet/profile.png`, `back.png` | Turnaround views | klein edit, hero as reference |
| `sheet/face-*.png` (6) | neutral, joyful, sad (tears), angry, surprised, fearful close-ups, 768x768 | klein edit, hero as reference |
| `sheet/pose-*.png` (4) | running, jumping mid-air, laughing, crying (hands on face) | klein edit, hero as reference |
| `boy-character-sheet-AI.png` | All 13 pictures as one sheet (like your reference) | ffmpeg |
| `shots-ref/*.png` | **NEW:** the 3 story shots drawn with the hero as reference, 576x1024 | klein edit + `make_shots.sh` |
| `shots-textonly/*.png` | **OLD:** the same 3 shots from text only (same seeds) | klein text-to-image + `make_shots.sh text` |
| `shots-textonly-vs-ref.png` | Left: hero. **Top row OLD (text only), bottom row NEW (with reference)** | ffmpeg |
| `clips/raw/*.mp4` | Wan clips straight out (480x832, 81 frames, 3.4 s each) | `tools/wan_i2v.py --jobs clips/jobs.json` |
| `clips/*-HD.mp4` | Same clips sharpened: Real-ESRGAN 3x + balanced grade, 1080x1920, 30 fps | `make_clips.sh` |
| `boy-test-video-HD.mp4` | The 3 HD clips joined, 10.1 s, with music | ffmpeg |
| `face-raw-vs-HD.png` | Face zoom in clip B at 1.7 s: left raw Wan, right HD | ffmpeg |
| `make_sheet.sh`, `make_shots.sh`, `make_clips.sh` | The scripts that made everything (re-runnable, skip finished files) | written for this test |
| `logs/` | Run logs | — |

## 4. Numbers
| Step | Time |
|---|---|
| Hero picture | 51 s |
| Each sheet picture (edit mode, reference) | 88-102 s (12 pictures = 19 min) |
| Each story shot WITH reference (576x1024) | 86-88 s |
| Each story shot text only (576x1024) | 39-41 s |
| Wan: read 3 prompts | 239 s |
| Wan: 3 clips (81 frames each) | 2365 s total, about 11 min per clip (faster than the 13.7 min measured on 15 Nov) |
| Real-ESRGAN sharpening | 24-25 s per clip |
| Peak klein memory | 3.6 GB |

## 5. What the eye sees
**Character sheet:** very close to your reference sheet. Same face, hair, polo (with its small star logo), watch and shoes in
all 13 pictures; all 6 expressions are sharp and clearly different; poses are natural (the crying pose covers the face with
both hands, the laughing pose holds the belly).

**Continuity, OLD vs NEW (`shots-textonly-vs-ref.png`):** text-only is already close because the description is detailed,
but small things change: the logo becomes a dash, the collar stripes and hair shape vary, the face is a bit different in
each shot. With the hero as reference the logo, collar, watch, hair spikes and face stay the same in all 3 shots.
Cost: about 2x slower per picture (88 s vs 40 s).

**Animation (Wan):** the motion matches the prompts: he laughs and hugs the puppy (A), his eyes go wide then he laughs (B),
he runs and waves (C). Face and clothes stay recognisable through each clip. After Real-ESRGAN the eyes, brows and teeth
are crisp at 1080x1920 (`face-raw-vs-HD.png`).

## 6. Honest limits
- **Moving clips are softer than the still sheet.** Wan works at 480x832; the 3x sharpening brings back edges but not all
  fine texture (hair strands, skin detail). Close-ups look closest to your reference; full-body running is softer.
- **Wan drift in clip B:** as the flour puffs, the warm light gets very strong and the hair tips go lighter. A calmer
  motion prompt or a shorter clip would reduce it.
- Expressions **change during a clip** only as far as the motion prompt asks (surprise to laugh worked in B); for a clear
  expression, the shot picture should already show it (the sheet faces can be used as references for that).

## 7. Conclusion
Yes, our system can do it, with no new downloads: **hero picture -> character sheet -> every shot drawn with the hero
as reference -> Wan -> Real-ESRGAN**. Stills match your reference closely; moving clips keep the same character and clear
expressions, a little softer than the stills.
Pending your verdict. If approved, the AI motion look would gain a "character sheet" step (one hero and sheet per
character, saved in the video's `characters/` folder) and the storyboard would draw each shot with its characters' heroes
as references. Cost: about +1.5 min per shot picture and about +20 min per character sheet.
