# reviewer memory
Lessons from earlier videos. Add 1-3 short, specific lessons after each video; keep this file under 60 lines (merge or drop old ones).

- In video 1 the maker's own check missed merged caption words and a label shown seconds before its picture. Check caption spacing and label timing first.
- Merged caption words came back in video 2 ("LAUNDRYDRYING", "THEIRBALLOON"): the engine's active-word pop (scale 1.08) is the cause, not the spacing at rest. Check full-res crops of y=1200-1500 and flag it as an engine fix.
- Compare each shot's start time with when its key word is spoken in captions.json; in video 2 laundry and Joseph's face were each ~2.5 s off.
- Redone images are not re-checked before render, so check every redone shot for the same fault that caused the redo. Compare assets/images/*.png file times with the image-review*.json times to find redraws nobody checked (v4: s4_2 reached the render unchecked).
- Parallax shots: look behind the person's head in a mid-shot frame for a ghost second copy (v4: all 3 parallax shots ghosted, P0).
- 3D videos: compare project/custom/*.tsx dates with logs/still-*.png. A shot with no still was never checked (v5: S1_0, the hook, was skipped and its sheep hidden in the basket).
- Scene labels and kinetic place cards often name a place before it is spoken or shown (v5: VERSAILLES card at 3s and on a hilltop shot). Check each label's place against the picture and the spoken word.
- The 12 evenly spaced frames can miss short shots: pull an extra frame for every shot they skip, always for the 3D/custom shot at the moment its key word is spoken.
- v5 repeat: the 0.45s global crossfade double-exposes at key words and the animator can't fix it per video. Flag it as an engine fix (P1 if it covers a hook/payoff word). Also check captions don't sit on the hero subject (S4_0 animals).
- v6 (Wan look): compare start and end frames of every shot; if people never move, the clips are missing from the render (stale timeline.json). Also check Wan tails for squatting, extra heads, confetti and colour shifts. Loudness (-16.5 LUFS) can't be fixed per video: flag as an engine fix.
