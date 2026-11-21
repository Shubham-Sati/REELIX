# Research: speed changes (normal / hurry / slow-motion) for AI motion and Lego videos (19 Nov 2026)

Research only; nothing was built or changed yet.

## 1. The problem
Every clip plays at one speed. Wan clips also look slow-motion. A story needs different speeds: normal, fast "hurry"
moments, slow-motion for emotional or musical moments, and ramps inside one shot (fast then slow).

## 2. Findings
**Why Wan looks slow:** fast few-step versions of Wan (like our FastWan, 3 steps) are known to calm motion down (about half
the average motion in community tests). https://jarvislabs.ai/blog/wan-2-2-lightning-different-video
A "slow-mo fix" add-on exists only for the big 14B model, not our 5B. https://huggingface.co/rzgar/Wan2.2_I2V_LightX2V_Slow-Mo_Fix

**Cheapest fix for Wan:** play the clip faster (1.25-1.4x, ffmpeg `setpts`). Prompts with fast action words ("quickly",
"rushes", "sudden") help a little; results vary. https://discuss.huggingface.co/t/how-to-get-the-most-out-of-prompts-for-wan-models/170354

**Smooth slow-motion:** needs extra in-between frames (frame interpolation).
- RIFE: code MIT, runs on Apple Silicon (MLX port). Check the weights' terms before commercial use.
  https://github.com/hzwer/Pratical-RIFE , https://huggingface.co/mlx-community/RIFE-4.25 , https://huggingface.co/daydreamlive/RIFE/blob/main/README.md
- FILM (Google, Apache-2.0): the PyTorch port had errors on Mac. https://huggingface.co/jkawamoto/frame-interpolation-pytorch
- Fallback with no model: ffmpeg `minterpolate` (lower quality).

**Speed ramps:** ffmpeg (split into parts with different `setpts`, or one expression), or Remotion's official
"accelerated video" recipe (per-part playbackRate). https://www.remotion.dev/docs/videos/accelerated-video
Simplest for REELIX: make the ramped clip in the grade step and play it at normal speed in Remotion.

**Lego (code) videos:** a time-warp function: each shot's clock runs at a speed curve (e.g. 1.6x then 0.35x), and all
animation reads that clock. Fast moves can get motion blur (`@remotion/motion-blur`, costs extra render time).
https://www.remotion.dev/docs/motion-blur/camera-motion-blur

**Editing rules:** slow-mo on emotional peaks, reveals, impacts and music drops; speed-up on travel and "hurry" moments;
ramp points on music beats; Shorts mostly 1.0-1.3x with at most 1-2 short slow-mo hits, never in the first 2 s; the
voice always plays at normal speed (only the picture changes).

## 3. Skills found
No dedicated speed-ramp skill exists. General ffmpeg skills with speed recipes (licences not confirmed yet):
- digitalsamba claude-code-video-toolkit ffmpeg: https://skills.sh/digitalsamba/claude-code-video-toolkit/ffmpeg
- OpenMontage ffmpeg: https://skills.cat/skills/calesthio/openmontage/ffmpeg
- claude-video-edit: https://skillselion.com/skills/agricidaniel/claude-video/claude-video-edit
- openclaw ffmpeg-video-editor: https://smithery.ai/skills/openclaw/ffmpeg-video-editor

## 4. Recommended approach (not built yet)
1. A per-shot **speed** setting in the storyboard: e.g. `[{t:0, speed:1.6}, {t:1.2, speed:0.4}]`, times placed on music beats or words.
2. **AI motion:** all Wan clips 1.3x by default; "hurry" shots get fast prompt words + 1.5-2x; slow-mo shots get RIFE in-between frames, then the speed curve in `tools/grade.py`.
3. **Lego:** a `warp()` clock in the kit that follows the same speed setting, plus motion blur on fast shots.
4. A small in-house "speed-ramp" skill instead of a downloaded one (none fits well).
