# producer memory
Lessons from earlier videos. Add 1-3 short, specific lessons after each video; keep this file under 60 lines (merge or drop old ones).

- FLUX takes about 75 s per 576x1024 picture on this Mac; the whole short took 29 min, of which pictures were about 20 min.
- One heavy model at a time: never start FLUX while ACE-Step or Kokoro runs.
- Smoke-idea-2 (short, 11 shots + 4 redos): whole run ~30 min; first FLUX pass 11 images in ~12 min (~65 s each), redos ~5 min.
- Redone images are NOT re-checked by the pipeline: s3_1/s4_2 came back as modern basket balloons again and reached the render. After a redo, look at the new PNGs before moving on; if a hero object fails twice, ask the animator for a custom 3D shot.
- Some agents (reviewer, sound-designer) are blocked from writing their MEMORY.md; their proposed lessons are only in their logs. The memory stage must copy them from logs/.
