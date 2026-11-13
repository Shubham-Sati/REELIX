# REELIX — simple AI video maker for YouTube

Give it a name and one sentence; it makes the whole video, thumbnail and upload text with free local models.

```bash
scripts/setup.sh           # once: installs tools + all models (see SETUP.md)
reelix the-smoke-idea      # asks: what about? video or short? explainer or animated? -> runs everything
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
