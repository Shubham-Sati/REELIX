# producer memory
Lessons from earlier videos. Add 1-3 short, specific lessons after each video; keep this file under 60 lines (merge or drop old ones).

- Run time: FLUX takes ~65-75 s per 576x1024 picture on this Mac; a short (11-13 shots + 4 redos) takes ~30 min, of which pictures are ~20 min.
- One heavy model at a time: never start FLUX while ACE-Step or Kokoro runs.
- Redone images are NOT re-checked by the pipeline. v2: s3_1/s4_2 came back as basket balloons again. v4: s4_2 was redrawn a third time after image-review-2, nobody looked, and Pixar-style child "brothers" reached the render (score 4/10). After every redo, open the new PNGs (and run tools/facematch.sh on people) before letting the pipeline go on; if a hero object fails twice, ask the animator for a custom 3D shot.
- Blocked from their own MEMORY.md (lessons only in logs/, the memory stage must copy them): reviewer, sound-designer, animator, visual-artist. The cast stage (4c) also had no Bash, so cast.json refs point at characters/_cuts/... instead of characters/<name>.png.
- Parallax always ghosts on people: the layers stage (4b) writes only s*_fg.png and the background is the untouched original, so the person shows twice when the cut-out moves (v4: all 3 parallax shots, P0). Until a background-inpaint step exists, have person shots use engine "image".
