---
name: rock-salt-v12-kit
description: Reusable set pieces built for the 16:9 rock-salt explainer (v12, batches 4-8) and where they live in its _kit.tsx
metadata:
  type: reference
---

All in videos/2026-11-20-how-rock-salt-is-formed-the-sea-that-dried-up-and-left-salt-up-to-3-km-thick/project/custom/_kit.tsx.
See also [[set-builder-memory]] (the 16:9 caption band, cutaway lessons).

- v12 batch 4 (rock-salt, S6_2-S8_1): reuse CoastTrace, Gateways (two channels + uplift), Inflow (fromGap), SaltRim, MapRivers, MiniColumn rows, TimeRibbon, ModernLab, SaltCore, ClAtom from that video's _kit.tsx. Salt layers under water in a whole bowl were invisible: use the BasinCut cutaway. A thick ribbon over a narrow strait hid the channels: start it past the gap.
- v12 batch 6 (rock-salt S9_5-S11_3): reuse NileBlock (buried V-canyon cutaway + coral trace), GibGap (cliffs, crumbling barrier, torrent sheet, spray), TankGauge/TankWater, SaltFlat from that video's _kit.tsx. A gap between cliffs reads only when the camera looks along the gap from high up (y ~9, 14 m back); from the side or low, the cliff faces fill the frame.
- v12 batch 7 (rock-salt S11_4-S13_1): reuse BuriedBasin (BasinTank + salt bed whose top is a function: wobble/ripple/bulge, strata that follow it, Veil of falling grains), ProfileSlab, ShoreSet (rising water + ring post), Sicily, Fish from that video's _kit.tsx. 16:9 captions sit ON the middle (y 550-650): aim the camera so the key detail (salt top, pans, island) is above 500 or below 680 px.
- v12 batch 8 (S13_2-S15_0): reuse domeSalt/domeLayers/DomeCap (salt dome rising out of the BuriedBasin stack, mushroom head on the cut face), GulfMap (Gulf Coast relief + popping dome bumps, FlatSlab/lineZ helpers), SaltLake (Great Salt Lake split by a causeway, toy train, rivers drawn in), LakeCut (north-arm brine cutaway with growing crusts), Badwater (hex crust that dissolves/regrows, flood, sea-level line on a cliff). Mine shaft + lift cage on the cut face is in S15_0.tsx.
- Dome lessons: a mushroom cap overlaid on the cut face must sit ABOVE the stem tip and the layers over the dome must thin ~90%, or the cap reads as a disc under a hump. Oil traps as thin slabs along steep strata vanish; use flat lenses (black oil, pale gas on top) tilted along the flank.
- v12 batch 9 (S15_1-S16_7, mining + Khewra): reuse ArchTunnel (banded pink salt tunnel, vertex colours, `dim`), BandWall, Rails, MineCart, PinkBlock, PinkRock, WallLamp, RangeHill/RangeSet (Salt Range hills + Portal, `portal` toggle), TX/Pin (600 Ma time ribbon pins) from that video's _kit.tsx. Room-and-pillar grid (tiles that sink away, coral pillar tops) is in S15_1.tsx; solution-mining wells + cavern on the BuriedBasin face in S15_3.tsx; 19-level hill cutaway in S16_3.tsx.
- v12 batch 10 (S16_8): hand Lantern that stays upright while the arm rises (AtHand child rotated by +(armR*1.05+elbowR+0.12+lean)) and a wall that glows where the lamp points (Glow + pointLight at the hand projected onto the wall plane) are in S16_8.tsx. Keep that glow above y 500 px (raise armR to ~1.5) so the caption doesn't cover it.
