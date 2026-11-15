# Wan 2.2 AI motion test (2026-11-15)

Test for the new 3D look "3D animated (AI motion)": one Pixar-like picture (FLUX.2 klein) animated by Wan 2.2 TI2V-5B
(FastWan DMD 3-step MLX, Apache-2.0) on a 16 GB Mac. Shot: Joseph Montgolfier turns to the fire, points at the smoke, smiles.

| File | What |
|---|---|
| start-picture-klein.png | start picture (klein, seed 101; the first try had 3 hands and was redrawn) |
| wan-test-joseph-fire.mp4 | first clip, upscaled to 1080x1920, no grade |
| wan-test-joseph-fire-soft.mp4 | softer grade: rejected, looked faded |
| wan-test-joseph-fire-balanced.mp4 | balanced grade: approved (now in tools/grade.py) |
| wan-old-one-by-one.mp4 | raw clip, text model loaded for this clip |
| wan-new-read-once.mp4 | raw clip, prompts read once first (tools/wan_i2v.py --jobs) |
| wan-old-vs-new.png | frames 0/20/40/60/80, top old, bottom new |

## Timing (480x832, 81 frames, 3.4 s)
| Step | Old | New |
|---|---|---|
| Text model (read prompt) | 97 s | 92 s (once per video) |
| Motion (3 steps) | 112 s | 116 s |
| Turn into frames (tiled decode) | ~10.5 min | ~10 min |
| Total | 835 s | 820 s |

## Findings
- Full (untiled) decode runs out of memory on 16 GB; `--tiling aggressive` works.
- Old and new clips show the same action and quality but are not frame-identical (SSIM ~0.65 after frame 1; camera a little closer in the new one). Cause not proven; likely the random part of the motion step.
- Read-once saves ~1.5 min per shot from the 2nd shot on.
- Balanced grade (measured on one frame): contrast 25.7 vs 26.6 original, brightness 27.8 vs 27.3; soft grade was 20.8 / 35.7 (too flat).
