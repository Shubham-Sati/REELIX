# Chalkboard look: decided plan (19 Nov 2026)

Phase 4 of the REELIX plan. Not built yet; this is what we agreed.

## Where it sits (DONE in config, 2026-11-19)
Each look now lists the styles it is offered for (`config/looks.json`: "styles", "best", "planned"), so the questions only
show looks made for the chosen style:

- **Explainer / Tutorial** -> Diagrams (**Chalkboard**) | 3D (Lego world, AI motion)
- **Animated / Motion** -> 2D (Realistic painting, Cartoon) | 3D (AI motion, Lego world)

Chalkboard is already in the config with `"planned": true`, so it is hidden until it is built. **Switching it on is one
line**: remove that flag. Until then Explainer has only the 3D dimension, so the "2D or 3D" question is skipped and
Explainer asks 4 questions instead of 5.

Why 2D was dropped from Explainer: a flat picture with labels explains less than diagrams that draw themselves, and
Chalkboard covers that format better. Why Chalkboard is not under Animated: diagrams that build step by step explain a
thing, they do not tell a story.

**Still missing (the bigger half):** the agents do not branch on style yet. Explainer + Lego runs the same storyboard,
set-builder and reviewer as Animated + Lego; only the script tone differs. For Chalkboard to be worth it, the storyboard
agent must plan claims and things to point at, the builder must make diagrams, and the reviewer must ask "did I
understand it" instead of "did I feel it".

## What it is
- **Manim CE** (the engine under chalkboard.studio) renders each shot: diagrams, arrows, labels, graphs and equations
  that draw themselves in time with the voice. LaTeX for equations.
- **No API key**: we rebuild the approach inside REELIX with our own agent, as we did for every other look. The
  Chalkboard project itself (github.com/nicglazkov/Chalkboard, MIT) needs an ANTHROPIC_API_KEY, so we do not run it.
- **Both flat and 3D diagrams, chosen per shot** (decided 2026-11-19): Manim has ThreeDScene / ThreeDAxes and a camera you
  can set and rotate (set_camera_orientation(phi, theta), ambient rotation). The storyboard agent writes `view: "3d"` on the
  shots that need depth, like it already writes move, keepLight and speed. It is NOT a question for the user.
  **Flat is the default. Use 3D only when the flat version would lose something** (3D renders slower and reads harder).
  | Flat (2D) | 3D |
  |---|---|
  | graphs, equations, timelines | objects with real shape: a balloon, a planet, a molecule |
  | arrows, labels, flowcharts | orbits, rotation, anything that spins |
  | comparisons, before and after | depth, layers, a cutaway |
  | anything a side view explains | where the viewer must walk around it |
  Example, "Why does hot air rise?": flat thermometer with a label -> 3D balloon with particles inside, rotating ->
  flat graph of temperature against density -> 3D balloon lifting off, camera tilting up.
- **Shorts and long videos**: Manim takes any size (pixel_width 1080, pixel_height 1920 plus one frame dimension, and it
  works out the rest), so 9:16 and 16:9 both work.
- Our usual voice, captions, music, sound effects, review and thumbnail steps are reused unchanged.

## Build steps (when we start)
1. Ask before installing: Manim CE and LaTeX (LaTeX is about 1-4 GB).
2. A 30 s experiment in docs/experiments/<date>-chalkboard-explainer/ with a STATS.md, test topic "Why does hot air rise?".
3. If approved: new look "chalkboard" in config/looks.json (shown only for style explainer), a new agent that writes the
   Manim scene per shot, a tools/manim.py render step, and the scenes joined by the engine like any other shot.

## Research notes
- Chalkboard: github.com/nicglazkov/Chalkboard (MIT, Manim CE 0.21.0, needs ANTHROPIC_API_KEY, its own components are 2D only).
- Manim 3D: docs.manim.community ThreeDScene, ThreeDAxes.
- Vertical video: set pixel_width/pixel_height and one of frame_width/frame_height; Manim computes the other.
