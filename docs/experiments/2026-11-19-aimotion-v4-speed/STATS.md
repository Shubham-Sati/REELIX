# Stats: AI motion V4, speed control ("late for school", 19 Nov 2026)

Read this first. It explains the problem, what was tested, every file, the numbers and the result.

## 1. The problem we are solving
Every AI motion clip plays at one speed, and Wan's fast 3-step model makes motion look slow (research:
`2026-11-19-speed-control-research`). A story needs different speeds: hurry, slowing down, normal, and changes inside one
shot. Test story (yours): the same boy (AI motion V3 hero) is late for school, runs past a bus and cars, a close-up of his
face while running with the background rushing backward, through the school gate, down the corridor where he slows down,
then walks into his class normally.

## 2. What was tested
| | OLD way (AI motion V3) | NEW way (AI motion V4) |
|---|---|---|
| Pictures | hero picture as reference (V3) | same |
| Wan prompts | calm words ("smooth", "slow camera") | **fast action words** for hurry shots ("sprints very fast", "rush past quickly", "strong motion blur in the background"); calm words for the last shot |
| Playback | every clip at real time (1.0x) | **speed plan per shot** with smooth ramps (`speed_ramp.py`) |
| Fast parts | plain frames | in-between frames blended into one (light **motion blur**) when faster than 1.3x |
| Wan internet | could hang on a Hugging Face check (it did, once, at clip 3) | **offline mode** (`HF_HUB_OFFLINE=1`), all models are local |

Speed plan used:
| Shot | Speed | Why |
|---|---|---|
| 1 street sprint, bus and cars | 1.6x | hurry |
| 2 face close-up while running | 1.5x | hurry, worried face |
| 3 through the school gate | 1.5x easing to 1.15x | still hurrying, starting to arrive |
| 4 corridor | 1.6x ramping down to 1.0x | runs, then slows to a walk near the door |
| 5 at the classroom door | 1.0x | normal, calm |

## 3. Every file in this folder
| File | What it is | Built with |
|---|---|---|
| `late-for-school-SPEED-V4.mp4` | **NEW:** 12.7 s with the speed plan, blur on hurry parts, music | `assemble.sh` + `speed_ramp.py` |
| `late-for-school-ONE-SPEED.mp4` | **OLD:** same clips at one speed, 16.8 s, music | `assemble.sh` (speed 1.0, no blur) |
| `speed-v4-contact.png` | 16 frames across the V4 video (1.3 per second) | ffmpeg |
| `shots-5.png`, `shots/*.png` | the 5 shot pictures (same boy, school bag) | klein edit mode, hero as reference, 576x1024 |
| `hero-front.png` | the hero picture (copied from AI motion V3) | klein |
| `clips/raw/*.mp4` | Wan clips (480x832, 81 frames, 3.4 s each) | `tools/wan_i2v.py --jobs clips/jobs.json` |
| `clips/up/*/out/` | Real-ESRGAN 3x frames | `make_all.sh` |
| `clips/one/`, `clips/v4/` | per-shot clips, one-speed and V4 | `speed_ramp.py` |
| `make_all.sh` | pictures -> Wan -> sharpen (re-runnable, skips finished files, offline) | written for this test |
| `speed_ramp.py` | **the new speed tool**: speed keys with smooth ramps, motion blur when fast | written for this test |
| `assemble.sh` | builds both videos | written for this test |
| `logs/` | run logs | — |

## 4. Numbers
| Step | Time |
|---|---|
| 5 shot pictures (klein edit) | 93-97 s each |
| Wan reading prompts | 1038 s (17 min, memory very full) first run; 4 min after restart |
| Wan clips | 13-23 min each (slower than 11 min before: memory full, laptop on battery) |
| Wan hang | ~8 min lost at clip 3 waiting on an internet check; fixed with offline mode |
| Real-ESRGAN sharpening | ~20-25 s per clip |
| Speed ramps + both videos | 333 s for 10 clips (CPU blending; can be made faster) |

| | OLD one speed | NEW V4 |
|---|---|---|
| Total length | 16.8 s | 12.7 s |
| Shot 1 / 2 / 3 / 4 / 5 | 3.4 / 3.4 / 3.4 / 3.4 / 3.4 s | 2.1 / 2.2 / 2.4 / 2.6 / 3.4 s |

## 5. What the eye sees
- Hurry shots now feel rushed: the bus, cars and street move fast, legs pump, and the blended frames give a speed blur.
- The face close-up shows the worried, out-of-breath face with the street streaking behind him.
- The corridor shot visibly decelerates to a walk; the door shot plays calm at real speed.
- Same boy in every shot (hero reference).

## 6. Honest limits
- In the close-up, the speed blur also softens his face on the fastest frames.
- Shot 5: Wan kept him standing at the door (smiling, relaxed) instead of walking in; it needs a stronger "walks in" prompt
  or the picture already half-way through the door.
- Only speed-UP and ramps down to normal were tested; real slow-motion (below 1.0x) would need RIFE in-between frames.
- Wan is slow when memory is full: close other apps and keep the charger in.

## 7. Conclusion
Pending your verdict. If approved, the storyboard gets a per-shot `speed` plan, `speed_ramp.py` goes into `tools/` and the
AI motion grade step uses it; Wan always runs offline.
