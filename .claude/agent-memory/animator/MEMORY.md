# animator memory
Lessons from earlier videos. Add 1-3 short, specific lessons after each video; keep this file under 60 lines (merge or drop old ones).

- 3D scenes: see 3d-scenes.md (read before building custom scenes)
- Captions: the active word scaled up and touched the next word ("WHYA SHEEP"). The engine now uses a wide gap and scales from the bottom; check merged words anyway.
- Render time: about 2 min for a 33 s short at concurrency 4.
- Parallax ghost head (person still in the background plate): quick fix is engine "image" in timeline.json and delete the shot's "fg" field (v4: s1_1, s2_1, s3_3).
- Fix job: run tools/facematch.sh on every redraw and look at it before re-rendering; v4's fix redraws came back with a grey beard (s4_2) and a goatee (s3_2) and were rendered anyway.
- Always check the tail of render output: a failed render leaves the OLD final.mp4 in place, so check its timestamp and duration.
