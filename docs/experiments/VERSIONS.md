# REELIX look versions (one page to remember them)

"In pipeline" = what `reelix <name>` uses today. "Experiment only" = lives in its experiment folder, not used by new videos yet.

## 3D Lego / toy world look (`toy3d`)
| Version | What it added | Where | Status |
|---|---|---|---|
| **Lego V1** | First toy world: characters and sets built from boxes in code (blocky) | kept at `docs/experiments/2026-11-19-lego-v5/kit/toy3d-kit-V1-pipeline-before.tsx` | Replaced |
| **Lego V2** | Everything rounded: round heads, capsule limbs, smooth objects (round 1, "NEW-smooth") | `2026-11-19-lego-smooth` (files `*-NEW-smooth.*`) | Experiment only |
| **Lego V3** | Human proportions (lathe body, knees, elbows, egg head), real-looking animals, rigid things kept sharp, apron as cloth, hips-lean fix, glowing fire, molten glass | `2026-11-19-lego-smooth` (files `*-V2-human.*`, `*-V3-fire-*`); crowd test `2026-11-19-lego-crowd-test` | Experiment only |
| **Lego V4** | Life in motion: breathing, blinking, 8 expressions, head-first turns, anticipation, jumps, weight shift, fingers, collar and cuffs, contact shadows, character sheet | `2026-11-19-lego-v4-life`; full Short `2026-11-19-balloon-v4` (adds knee fix + sit pose) | Experiment only (approved: expressions and motion) |
| **Lego V5** | Body rework: hair fitted to the head, one continuous arm and leg (no joint circles), solid chubby hands, clean coat front; V4 expressions and motion kept | `2026-11-19-lego-v5`; shared kit `library/templates/toy3d-kit.tsx` | **In pipeline** (default today) |

## 3D animated (AI motion) look (`aimotion`)
| Version | What it added | Where | Status |
|---|---|---|---|
| **AI motion V1** | klein Pixar-style picture per shot, Wan 2.2 FastWan animates it, read-once prompts, tiled decode, colour match + balanced grade | `2026-11-15-wan-ai-motion` | In pipeline |
| **AI motion V2** | Sharper clips: Real-ESRGAN 3x upscale, no blur, frame-repeat 30 fps (about 2-2.7x more detail) | `2026-11-15-wan-sharpness` | In pipeline |
| **AI motion V3** | Character continuity: one hero picture per character -> character sheet (turnaround, 6 expressions, 4 poses) -> every shot drawn with the hero as reference (klein edit mode) | `2026-11-19-aimotion-character-sheet` | **In pipeline** (hero picture per character, shots drawn with it as reference) |
| **AI motion V4** | Speed control: per-shot speed plan with smooth ramps (hurry 1.5-1.6x, ramp down to 1.0x, normal), motion blur on fast parts, fast-action Wan prompts, Wan offline; test "late for school" | `2026-11-19-aimotion-v4-speed`; `tools/speed_ramp.py` | **In pipeline** (default today) |

## Shared (both looks)
| Item | Where | Status |
|---|---|---|
| Speed control research (Film Motion Director, speed ramps, beat sync, skills found) | `2026-11-19-speed-control-research` | Research done, experiment next |

## Planned
| Look | What it is | Where | Status |
|---|---|---|---|
| **Chalkboard (diagrams)** | Manim diagrams, arrows, labels and equations that draw themselves; each shot picks flat or 3D itself; offered only for the Explainer style; no API key | plan: `CHALKBOARD-PLAN.md`; already in `config/looks.json` as `"planned": true` | Planned (Phase 4) |
