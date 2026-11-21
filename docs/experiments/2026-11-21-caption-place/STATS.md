# Caption place (21 Nov 2026)

## Why we tested
In the 10-minute rock salt video the word captions sat in the middle of the frame, on top of the animation (the chemist
and the dish at 113 s). Shorts had the same problem, only less noticed because they are 30-60 s. Cause: the caption box
in `templates/remotion/src/Main.tsx` was fixed at `bottom: 430` px with 92 px words for BOTH formats. In a 1080 px tall
video that is about 55% of the height, the middle.

## What changed (old way vs new way)
| | Old | New |
|---|---|---|
| Video 16:9 | bottom 430 px, 92 px words (middle of the frame) | bottom 56 px, 60 px words, 160 px side margin (bottom ~18%, subtitle size) |
| Short 9:16 | bottom 430 px, 92 px words (about 66-78% down, over the lower part of the action) | bottom 340 px, 84 px words (bottom ~28%, the band the shots keep free, above the Shorts buttons) |
| On or off | always drawn | drawn only when brief.json `captions` is true (`reelix --captions`, or Captions On in FE-Reelix); **off by default** |

The whisper captions step still runs either way: its word times (`assets/captions.json`) are used for timing.

## Files
| File | What it is | Made with | Verdict |
|---|---|---|---|
| make.sh | Re-makes every picture below from the finished videos (captions forced on), no pipeline run | Remotion still + ffmpeg | keep |
| before-video-16x9.png | Rock salt video at 113 s, old render: "THE LAB." in the middle over the chemist | ffmpeg from final.mp4 | the problem |
| video-16x9.png | Same frame, new engine: captions at the bottom, smaller | Remotion still | clear, nothing covered |
| before-short-9x16.png | Glass from sand Short at 8 s, old render | ffmpeg from final.mp4 | just under the action |
| short-9x16.png | Same frame, new engine: captions lower, in the free band | Remotion still | clear |

## Numbers
- Each still takes about 7 s to make; the whole script runs in about 15 s.
- Video: captions moved from ~55% to ~85-95% of the height. Short: from ~70-78% to ~78-82%.

## Conclusion
Captions now sit in the bottom band in both formats and are off unless asked for. The labels were also in the middle;
that is fixed in part 2 below.

## Part 2: labels (same day)
After the caption fix the label "1800s LAB" still sat on the chemist's head. Two labels were in the middle:
- the engine's scene label at `top: 230` px (fine in 9:16, but about 25% down in a 1080 px tall video);
- the shot labels the rock salt fix job added with `withLabel()` in that video's `_kit.tsx`, at 33% of the height.

| | Old | New |
|---|---|---|
| Scene label, 16:9 | top 230 px, 46 px text | top 28 px, 34 px text (row 1 of the top band) |
| Scene label, 9:16 | top 230 px | top 150 px (row 1, under the Shorts top buttons) |
| Shot label (storyboard shot "label") | not drawn by the engine; one video drew it at 33% height | drawn by the engine (`TopTags`, timeline `note`) in row 2 of the top band |
| Rock salt `withLabel()` | 33% height, 60 px | top band row 2 (y 100 px in 16:9), 38 px |

Rule now (CLAUDE.md, kit, set-builder, animator, reviewer): no text over the animation. Labels top band, captions bottom
band, cast and action in the middle band.

| File | What it is | Verdict |
|---|---|---|
| before-labels-video-16x9.png | Rock salt at 106.5 s, old render: scene label, shot label and caption all mid-frame | the problem |
| labels-video-16x9.png | Same frame, new: both labels at the top, caption at the bottom | clear |
| before-labels-short-9x16.png | Glass from sand at 1.5 s, old render | label a little low |
| labels-short-9x16.png | Same frame, new, with a test shot label "≈ 1,700 °C" | both rows in the top band |

Still seen: in some rock salt shots an object reaches into the top band (the falling layer at 106.5 s), so a label can
touch it. New videos are told to keep the top band free; old shots keep their camera.
