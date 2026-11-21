# Stats: crowd test for the V3 Lego look (19 Nov 2026)

Read this first. It explains why we tested, what was tested, every file, the numbers and the result.

## 1. Why we tested
The V3 look (docs/experiments/2026-11-19-lego-smooth) was approved as better, but it was only tried on two existing videos.
Question: does V3 work for **any** new video, with **many characters in one frame, all moving**, or only for those two?
The V3 folder is left untouched; this is a new experiment.

## 2. What was tested
A brand-new 11 s shot, written from scratch, using only the V3 kit (no code from the two test videos' shots):
**Farm picnic.** Grandpa, Dad, Mum and a Kid stand round a campfire. Dad talks, then Mum. A sheep wanders in from the left,
a duck waddles in from the right (Mum points at it), a rooster hops onto a log and crows (everyone turns to look, Grandpa leans
back laughing). The Kid runs after the duck, Dad throws his arms up, the sheep follows. The camera slowly circles the group.
- 4 new people (different height, build, skin, hair, clothes; a child, a woman with long hair, an old man with a beard, a man with a cap)
- 3 animals (sheep, duck, rooster)
- moving all at once: walking, running, talking, pointing, waving, laughing (hip lean), hopping, flapping, crowing
- V3 fire (campfire), smooth rocks and logs, rigid shapes kept rigid
- No voice or captions (music only), because this is a look test, not a finished Short.

## 3. Every file in this folder
| File | What it is | Built with |
|---|---|---|
| `crowd-test-V3.mp4` | The 11 s test video (1080x1920, 30 fps, music only) | V3 kit + `video/project/custom/S1_0.tsx`, `tools/render.sh` |
| `crowd-stills.png` | 4 moments: 1 s (family talking), 4.5 s (sheep and duck arrive), 6.3 s (rooster crows, Grandpa laughs), 9.5 s (Kid chases duck) | `tools/still.sh` |
| `stills/` | The single frames used above | `tools/still.sh` |
| `video/project/custom/_kit.tsx` | V3 kit, built with the V3 folder's `build_test_kit.py` + `smooth3d.py` (unchanged) | V3 |
| `video/project/custom/S1_0.tsx` | The new shot: the 7 characters, their paths and actions, camera orbit | written for this test |
| `video/project/timeline.json` | One 11 s scene, music only | written for this test |
| `video/assets/music.wav` | Background music (copied from the balloon Short) | ACE-Step, from that video |
| `render.log` | Render output | — |

## 4. Numbers
| | |
|---|---|
| Characters in one frame | 7 (4 people + 3 animals), all moving |
| Length | 11 s, 330 frames |
| Render time | 12 s, 4 frames at once, no out-of-memory retry |

## 5. Result
- **V3 works for new characters, not just the two test videos:** every new person came out with human proportions, faces,
  hair and clothes from their spec alone; the animals walk, hop, flap and crow; fire and props match the V3 look.
- Bodies stay on one line when leaning (Grandpa's laugh, the Kid running).
- To improve later: the Kid's head is the same size as the adults' (children should have a slightly bigger head for their body
  but a smaller head overall); the white shirt front is the same shape for everyone.

## 6. Conclusion
Pending your verdict. If approved, V3 can become the default Lego look for all new videos (kit into
`library/templates/toy3d-kit.tsx`, smoothing pass and set-builder rules), as listed in the V3 STATS.md.
