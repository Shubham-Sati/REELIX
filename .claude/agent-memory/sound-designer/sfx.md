# sound-designer: sfx placement

- Video 1 had no sound effects at all; reviewers found it flat. Whooshes on cuts and one hit on the reveal are the minimum.
- Read word times in captions.json before placing loud effects; put hits/impacts in the pause before a stressed word, not on it.
- Storyboard has no shot times; only scene cuts are known (first line start of each scene in lines.json). Anchor whooshes there and kinetic-text hits at the shot's start (a hit at t=0.05 before the first word works).
- Ambience files (fire, crowd, wind) are ~3 s long: one per scene, starting more than 0.2 s from any whoosh or hit.
- Density that worked: 10 effects in a 25 s short and 12 in a 29 s short (3 whoosh, 2 hit, riser, heartbeat, fire/wind/wind/crowd ambience) stayed under the voice, not cluttered. The riser fits the line before the final scene's cut.
