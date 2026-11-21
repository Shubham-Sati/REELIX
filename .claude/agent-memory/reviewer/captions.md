# reviewer: captions
- Check caption spacing and label timing first: video 1's own check missed merged caption words and a label shown seconds before its picture.
- Merged caption words ("LAUNDRYDRYING", "THEIRBALLOON", v2) come from the engine's active-word pop (scale 1.08), not the resting spacing. Check full-res crops of y=1200-1500 and flag as an engine fix.
- Compare each shot's start time with when its key word is spoken in captions.json (v2: laundry and Joseph's face were each ~2.5 s off).
- Scene labels and kinetic place cards often name a place before it is spoken or shown (v5: VERSAILLES card at 3s on a hilltop shot). Check each label's place against the picture and the spoken word.
- Kinetic number cards: compare each card's window with word times in captions.json (v7: a card ran 1.4 s before the number was spoken).
- Check captions don't sit on the hero subject (v5: S4_0 animals).
