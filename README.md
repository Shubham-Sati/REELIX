# REELIX — simple AI video maker for YouTube

Give it a name and one sentence; it makes the whole video, thumbnail and upload text with free local models.

```bash
scripts/setup.sh           # once: installs tools + all models (see SETUP.md)
reelix the-smoke-idea      # asks: what about? video or short? explainer or animated? -> runs everything
reelix viral-ideas 10 space history   # 10 viral YouTube Video/Shorts ideas backed by live view data; pick one to make it
reelix list-ideas 5        # saved ideas with no video yet (oldest first); pick one to make it
reelix help                # every command with examples
```
Inside Claude Code: `/reelix the-smoke-idea`.

## Pipeline
| Step | Who | Makes |
|---|---|---|
| Research & script | script-writer agent (yt-script / video-marketing skills) | research.md, script.json |
| Storyboard | storyboard-artist agent (create-video-storyboard) | storyboard.json |
| Pictures | FLUX.1 schnell, checked by visual-artist agent (create-image-campaign) | assets/images |
| Voice, captions, music | Kokoro, whisper.cpp, ACE-Step | assets/voice.wav, captions.json, music.wav |
| Render + self-check | Remotion engine, animator agent (remotion skills) | final.mp4, review.md |
| Thumbnail | thumbnail-designer agent (youtube-thumbnail) + FLUX | thumbnail.png, youtube.md |

Every step writes one file; re-running `reelix` / `node cli/pipeline.mjs <folder>` skips finished steps. Delete a file to redo that step.

## Folders
- `bin/reelix` – the command. `cli/` – questions, progress panel, pipeline.
- `.claude/agents/` – the 6 agents (+ producer). `.claude/skills/` – downloaded skills, unmodified (see SOURCES.md).
- `tools/` – one small script per model. `config/` – model paths (models stay in AI Video Editor), formats, channel voice.
- `templates/remotion/` – the shared render engine. `videos/<date>-<name>/` – everything for one video.

## Viral ideas
`reelix viral-ideas [count] [topic]`: the default is 5 ideas in the channel niche (`config/voice.md`).
1. `tools/trends.py` looks at YouTube (yt-dlp, free): the most-viewed Videos this month and year, plus the topic's Shorts, ranked by views per day.
2. The **idea-scout** agent adds web research and uses the youtube-shorts, youtube-long-form, trend-jacking, idea-generation, viral-reverse-engineering and hook-writer skills.
3. It prints each idea's title, hook, why it could go viral, proof, Short/Video and a score, and saves them to `ideas/`. Pick one and it starts `reelix` with the answers already filled in.
4. `reelix list-ideas [count]` shows saved ideas that have no finished video yet, oldest first (default 5), and starts one when you pick it.
5. Ideas you pick are remembered in `.claude/agent-memory/idea-scout/picks.md`.

## Looks (questions 4 and 5)
| 2D or 3D | Look | How it is made |
|---|---|---|
| 2D | Realistic painting | FLUX.1 schnell pictures, per-video characters, camera moves, 2.5D, kinetic text |
| 2D | Cartoon (Pixar-like pictures) | FLUX.2 klein 4B pictures, same pipeline |
| 3D | 3D animated (AI motion) | Pixar-like pictures (FLUX.2 klein) brought to life by Wan 2.2 TI2V-5B (FastWan, Apache-2.0): ~12-15 min per 3-4 s shot on a 16 GB Mac. Shorts: every shot moves; long videos: key shots move, the rest get camera moves. Clips are colour-matched per scene and given one balanced grade (tools/grade.py) |
| 3D | 3D Lego / toy world | No AI pictures: the set-builder agent builds low-poly characters and sets in Three.js (library/templates/toy3d-kit.tsx); characters walk, point, turn and talk |

## Agents and models
Each agent has a model list in `.claude/models.json`. The first model runs; if it hits a usage or rate limit or is overloaded, the same job re-runs on the next model. Effort and a turn cap keep simple jobs cheap.
| Agent | Models (in order) | Effort |
|---|---|---|
| script-writer | Fable 5.1 → Opus → Sonnet → Haiku | high |
| storyboard-artist, reviewer | Opus → Sonnet → Fable → Haiku | high |
| set-builder | Opus → Fable → Sonnet → Haiku | high |
| idea-scout | Opus → Sonnet → Fable → Haiku | medium |
| animator, visual-artist | Sonnet → Opus → Haiku → Fable | medium |
| producer, sound-designer, thumbnail-designer | Sonnet → Haiku → Opus → Fable | low |
