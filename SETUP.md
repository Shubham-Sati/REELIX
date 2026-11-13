# Setting up REELIX on a new Mac

REELIX turns a title and a one-line description into a finished YouTube video or Short: script, pictures, voice, captions, music, sound effects, 2.5D/3D scenes, render, thumbnail and upload text. Everything runs free on your own Mac. Only the agents (Claude Code) need the internet.

This repository holds the **system**: agents, skills, agent memory, pipeline, video engine and the sound-effect library. The **models** (~10–21 GB) and your **videos** are not in git. Each laptop downloads its own models with one command.

## What you need

| Need | Why |
|---|---|
| Mac with Apple Silicon (M1 or newer) | the models run on Apple's MLX / Metal |
| 16 GB RAM or more | FLUX image generation; 8 GB works but is very slow |
| Free disk: ~25 GB (or ~13 GB without music) | models + packages |
| macOS 14 (Sonoma) or newer | the Apple Vision cut-out for 2.5D scenes |
| [Homebrew](https://brew.sh) | installs node, ffmpeg, uv, whisper-cpp |
| [Claude Code](https://claude.com/claude-code), signed in | the agents that write, plan, check and fix each video |
| Xcode Command Line Tools (`xcode-select --install`) | git and the Swift compiler for the cut-out tool |

## 1. Get REELIX
```bash
git clone <this-repo-url> REELIX
cd REELIX
```

## 2. Install everything (one command)
```bash
scripts/setup.sh
```
It runs these steps in order. Steps that are already done are skipped, so it's safe to run again after an error or a lost connection:

| Step | What it installs | Download |
|---|---|---|
| 1. This Mac | checks Apple Silicon, RAM and free disk | — |
| 2. Tools | node, ffmpeg, uv, whisper-cpp (Homebrew); checks the Node version and Claude Code | ~0.5 GB |
| 3. REELIX packages | terminal packages, the Remotion engine (Three.js, GSAP), the `reelix` command, the sound-effect library | ~0.7 GB |
| 5. Pictures | **FLUX.1 schnell 4-bit** + mflux | ~9.6 GB |
| 6. Voice | **Kokoro-82M** + mlx-audio | ~0.5 GB |
| 7. Captions | **whisper.cpp large-v3-turbo** | ~0.6 GB |
| 8. Music | **ACE-Step 1.5** (optional) | ~11.3 GB |
| Cut-out | **Apple Vision** cut-out tool, compiled on your Mac | none |
| 9. Check | every model found, with ok, MISSING or skip | — |

Expect 30–90 minutes, depending on your internet speed. Models go to `~/.reelix`, outside the repo, so deleting or re-cloning REELIX keeps them. To use a different folder, run `REELIX_MODELS=/path scripts/setup.sh`.

**Options**
```bash
scripts/setup.sh --no-music
```
Skips ACE-Step (saves 11 GB). Videos are made without background music.
```bash
scripts/setup.sh --use-existing "/path/to/AI Video Editor"
```
Downloads nothing. Use this if you already have the AI Video Editor studio installed.
```bash
scripts/setup.sh --check
```
Only shows what is installed and what is missing.

Once setup finishes, **open a new terminal** so the `reelix` command is found.

## 3. Make a video
```bash
reelix my-first-video
```
It asks 3 questions: what the video is about, Video or Short, and the style (Explainer / Tutorial or Animated / Motion Graphics). Then it asks "Start making this video?" and shows live progress with % and time left. A Short takes about 30 minutes on an M1 Pro with 16 GB.

You can also open Claude Code in this folder and type `/reelix my-first-video`.

Results go to `videos/<date>-<name>/`:
- `final.mp4`: the video
- `thumbnail.png`: the thumbnail
- `youtube.md`: title, description and tags for the upload

## What each model does

| Model | Job in the video | Licence |
|---|---|---|
| **FLUX.1 schnell 4-bit** (+ mflux, the Mac program that runs it) | Draws every scene picture and the thumbnail background from the storyboard's prompts. 4-bit keeps it small enough for a 16 GB Mac: about 75 s per picture. | Apache-2.0 |
| **Kokoro-82M** (via mlx-audio) | Speaks the script: narrator and character voices, with a speed set per emotion. | Apache-2.0 |
| **whisper.cpp large-v3-turbo** | Listens to the finished voiceover and finds when each word is spoken, so captions highlight word by word in sync. Scenes, labels and sound effects are also timed to these word times. | MIT |
| **ACE-Step 1.5** (optional) | Generates the background music from the storyboard's mood (genre, instruments, tempo), sized to the video's length. | Apache-2.0 |
| **Apple Vision cut-out** (built into macOS) | Cuts the main subject out of a picture for 2.5D parallax scenes, so the subject moves in front of its background. | part of macOS |

Not used, because they're not licensed for commercial use: FLUX Kontext and edge-tts.

## What is in git and what is not

| In git (the system) | Not in git (each laptop) |
|---|---|
| `.claude/` agents, skills, **agent memory** (`.claude/agent-memory/`) | models in `~/.reelix` and `~/.cache` |
| `cli/`, `tools/`, `scripts/`, `config/models.json` | `config/models.local.json` (this laptop's model paths) |
| `templates/remotion/` engine, `library/` (sfx, templates) | `node_modules/`, `videos/` |

Agent memory is the lessons the agents learn from every video. Commit it after making videos, so everyone who clones the repo starts with those lessons.

## Problems

| Problem | Fix |
|---|---|
| `reelix: command not found` | Open a new terminal, or run `./bin/reelix <name>` |
| A step failed during setup | Run `scripts/setup.sh` again; finished steps are skipped |
| `MISSING` in the check | Run the step again, or see its message |
| Video stops at a stage | Read `videos/<name>/logs/`, fix the cause, and run the same `reelix <name>` again: finished stages are kept |
| No music in the video | ACE-Step is not installed (`--no-music`) or failed; the video is still made |
| "Claude Code CLI not found" | Install Claude Code, sign in, or open the Claude desktop app once |
