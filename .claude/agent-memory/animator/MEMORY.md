# animator memory
Lessons from earlier videos. Add 1-3 short, specific lessons after each video; keep this file under 60 lines (merge or drop old ones).

- 3D scenes: see 3d-scenes.md (read before building custom scenes)
- Captions: the active word scaled up and touched the next word ("WHYA SHEEP"). The engine now uses a wide gap and scales from the bottom; check merged words anyway.
- Render time: about 2 min for a 33 s short at concurrency 4.
- Parallax ghost head (person still in the background plate): quick fix is engine "image" in timeline.json and delete the shot's "fg" field (v4: s1_1, s2_1, s3_3).
- Fix job: run tools/facematch.sh on every redraw and look at it before re-rendering; v4's fix redraws came back with a grey beard (s4_2) and a goatee (s3_2) and were rendered anyway.
- Always check the tail of render output: a failed render leaves the OLD final.mp4 in place, so check its timestamp and duration.
- Engine crossfade is a global 0.45s FADE, so it can't be changed per video; it leaves double exposures on key words (v5: 14.6s, 19.8s). Plan hard cuts or ask for an engine fix.
- Wan looks: if timeline.json predates assets/clips/*.mp4, no clips are rendered. Edit scenes to engine "clip" + clip path. A bad Wan clip tail: play only the good first part as a clip shot, then an "image" shot of the same picture (clips can't hold their last frame).
- Fix job v5: a short kinetic card plus a label can ghost; end scene labels before the scene cut. After a re-render, look at the frames at every changed shot, not only 3 of 8.
- v6 Wan clips drift from their motionPrompt (s4_1 squatted and pushed the pole down, grew a stray second head; s4_2 got confetti and the coat turned olive). Always view the clip's frames at 1 s, mid and end; trim to the good first 1-1.5 s then hold the picture as an "image" shot. Re-make prompts: add "stays standing, no other people, no confetti, colours unchanged".
