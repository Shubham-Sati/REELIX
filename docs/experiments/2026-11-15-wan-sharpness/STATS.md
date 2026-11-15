# Stats: sharper AI motion clips (15 Nov 2026)

Read this first. It explains the problem, what was tested, every file, the numbers and the decision.

## 1. The problem we are solving
In the first "3D animated (AI motion)" video (`videos/2026-11-15-the-smoke-idea-ai`), the shots where characters MOVE
(Wan clips) looked **slightly blurry**, while shots that used the **still picture with only a camera move** looked sharp.
Measured on two shots, the moving clips had about **16-21% less fine detail** than the still pictures.

Causes found:
1. Wan makes small frames (**480x832**); the still pictures are 576x1024. Wan frames are stretched more to reach 1080x1920.
2. Wan smooths small details (hair, fabric, edges) while animating.
3. Our own colour step added softness: a slight blur in the grade (`unsharp -0.15`) and **blended frames** when turning 24 fps into 30 fps (`minterpolate=mi_mode=blend`).

## 2. What we tested
| Version | What it is |
|---|---|
| **still** | The klein picture of the shot (the quality we want to match). |
| **current** | The clip as it is in the video today: Wan 480x832 -> balanced grade WITH the slight blur -> plain stretch to 1080x1920 -> blended 24->30 fps. |
| **A** | Same raw Wan clip, our two softening steps removed: no slight blur, and 24->30 fps by repeating frames (no blending). Plain stretch to 1080x1920. |
| **A+B** | Same raw Wan clip, first **AI-upscaled 3x** with Real-ESRGAN (model `realesr-animevideov3`, made for animation video) to 1440x2496, then version A, scaled to 1080x1920. |

Shots: **s1_0** (King Louis) and **s1_2** (Joseph), two different characters. The raw Wan clips were reused, so Wan did not run again.
Upscaler: Real-ESRGAN ncnn-vulkan, official macOS build v0.2.5.0 (xinntao/Real-ESRGAN), BSD-3 (commercial OK), runs on the Mac GPU,
installed at `AI Video Editor/Build/_tools/realesrgan/`.

## 3. Every file in this folder
| File | What it is | Built with |
|---|---|---|
| `s1_0-still-picture.png`, `s1_2-still-picture.png` | The still picture of each shot | FLUX.2 klein, 576x1024 (from the video's assets/images) |
| `s1_0-current.mp4`, `s1_2-current.mp4` | The clip as used in the video (OLD way) | Wan raw clip + old `tools/grade.py` (blur + blended fps) |
| `s1_0-A.mp4`, `s1_2-A.mp4` | Version A | Wan raw clip + balanced grade without blur + lanczos stretch + light sharpen + frame-repeat 30 fps |
| `s1_0-A+B.mp4`, `s1_2-A+B.mp4` | Version A+B (NEW way tested) | Wan raw clip -> Real-ESRGAN animevideov3 x3 per frame -> balanced grade without blur -> 1080x1920 -> frame-repeat 30 fps |
| `s1_0-compare-full.png`, `s1_2-compare-full.png` | Whole frame at 1.2 s, left to right: still, current, A, A+B | ffmpeg frame grab |
| `s1_0-compare-face.png`, `s1_2-compare-face.png` | Zoom on the face, same order | crop of the frames above |

## 4. Numbers
### Sharpness (fine-detail score, higher = sharper; clips averaged over frames at 0.5, 1.2 and 1.9 s)
| Shot | still | current | A | A+B |
|---|---|---|---|---|
| s1_0 King Louis | 8.03 | 6.22 | 9.31 | **16.79** |
| s1_2 Joseph | 4.80 | 5.47 | 6.78 | **12.03** |
| vs current | — | — | +23% to +50% | about 2.2-2.7x |

Note: the still picture and the clip frames are not the exact same framing (Wan moves the camera, and the still has more soft
background blur), so the score compares overall detail, not pixel for pixel.

### Time per clip (73 frames, ~3 s)
| Step | Time |
|---|---|
| Version A (grade only) | 1-3 s |
| AI upscale 3x (Real-ESRGAN) | ~22 s |
| Version A+B total | ~25 s |
| Per 8-clip Short | ~3.5 min extra (Wan itself takes ~12 min per clip) |

### What the eye sees (face zoom)
- current: soft edges on eyes, eyebrows and hair.
- A: clearly crisper than current; eyebrows and wig curls cleaner.
- A+B: sharpest; clean eye outlines, wig strands and coat detail; looks like the still picture's crispness. Skin stays smooth
  (the animation model cleans fine texture a little, which suits the Pixar look). No halos or artefacts seen.

## 5. Conclusion
- **A alone** removes our own softening at no cost and already beats the current clips.
- **A+B** gives the sharpest result (about 2.2-2.7x the current detail) for only ~25 s per clip.
- Recommended: make **A+B the default** for the AI motion look (change `tools/grade.py`: AI-upscale each raw clip, no blur, frame-repeat fps).
  **Decision (15 Nov 2026): approved. A+B is now the default** for the AI motion look: `tools/grade.py` AI-upscales every raw Wan
  clip (Real-ESRGAN, config `upscale`, cached in `assets/clips/up/`), no blur, frame-repeat 30 fps. Checked on s1_2 after the
  change: 28 s, sharpness 12.3 (the same as the A+B test).

## 6. Full video check: old vs new (whole hot air balloon Short)
Both videos live in `videos/2026-11-15-the-smoke-idea-ai/`:
| File | What it is | Built with |
|---|---|---|
| `final-old-soft.mp4` | The video as first made (OLD way) | Wan clips + old grade (slight blur, blended 30 fps, plain stretch). Old graded clips kept in `assets/clips/old-soft/` |
| `final-new-sharp.mp4` (= `final.mp4`) | Same video, clips re-graded the NEW way | Same raw Wan clips -> Real-ESRGAN 3x -> no-blur grade -> frame-repeat 30 fps. Same voice, music, captions, timing, reviewer fixes |
| `full-video-old-vs-new.png` (this folder) | Centre crops at 0.9 / 14.3 / 20.4 / 25.15 s: top row old, bottom row new | ffmpeg frame grabs |

Time: re-grade 8 clips 209 s (~26 s each), render 50 s.

Sharpness per shot in the finished video (whole frame incl. captions, so gaps look smaller than on the face zooms):
| Shot | Type | Old | New | Change |
|---|---|---|---|---|
| s1_0 King Louis | AI motion clip | 23.58 | 26.65 | +13% |
| s1_2 Joseph | AI motion clip | 26.33 | 28.15 | +7% |
| s2_0 silk bag | AI motion clip | 16.54 | 18.45 | +12% |
| s3_0 King Louis | AI motion clip | 15.32 | 20.92 | +37% |
| s3_1 Pilatre | AI motion clip | 19.91 | 22.40 | +13% |
| s3_2 two men | AI motion clip | 19.71 | 26.22 | +33% |
| s4_1 Marquis | AI motion clip | 18.51 | 23.66 | +28% |
| s4_2 two men | AI motion clip | 20.86 | 23.31 | +12% |
| s1_1, s4_0 | text cards | 25.1 / 32.5 | same | 0% (untouched, as expected) |
| s3_0, s4_1, s4_2 picture holds | still pictures | same | same | 0% (untouched, as expected) |
Length 30.76 s both; loudness -16.5 LUFS both (unchanged; still a little quiet, separate engine fix).

Seen in the frames: every moving shot is crisper (eyes, wig curls, gold embroidery, lace, balloon trim). Still pictures, text cards,
captions, timing and sound are identical. Not fixed by sharpening: the s4_1 Marquis clip still has Wan's face drift (eyes closing,
odd mouth) around 25 s; that needs the clip remade with a better motionPrompt (~10 min), not sharpening.
