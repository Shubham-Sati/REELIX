# REELIX rules
- Models are used from the AI Video Editor folder through config/models.json. Never copy them or that repo's structure here.
- Skills in .claude/skills are downloaded and used unmodified. If one does not work, replace it with a better one found online (record it in SOURCES.md); never edit it.
- One heavy model at a time (16 GB Mac): FLUX, Kokoro, ACE-Step run one after another.
- A video is made only by the pipeline (cli/pipeline.mjs); agents write their one output file and nothing else.
- Licences: FLUX schnell, Kokoro, ACE-Step are Apache-2.0. Never use flux-kontext-q4 or edge-tts (non-commercial).
- Agent memory lives in .claude/agent-memory/<agent>/MEMORY.md (committed). Agents read it first; the pipeline's last stage adds 1-3 lessons per video. Keep each file under 60 lines.
- Memory growth (automatic, no human step): when an agent's MEMORY.md nears 60 lines or 5+ lessons share one topic (e.g. FLUX prompts, captions, 3D), move them into a topic file in the same folder (e.g. .claude/agent-memory/storyboard-artist/flux-prompts.md), merge duplicates there, and leave one pointer line in MEMORY.md: `- FLUX prompt fixes: see flux-prompts.md (read when writing image prompts)`. Agents read MEMORY.md first and open a topic file when its pointer applies. This is enforced: after every video the pipeline runs tools/memory_check.py (too long, crowded topic, broken pointer, unlinked topic file) and, if it fails, cli/memory.mjs has the producer split/merge and checks again. Run it by hand any time: node cli/memory.mjs
- Shared assets live in library/ (sfx built by tools/make_sfx.sh, templates such as three-hero.tsx). Per-video 3D/motion code goes in <video>/project/custom/, never in the engine.
- `reelix viral-ideas`, `reelix list-ideas` (alias saved-ideas) and `reelix help` are commands, so a video can't be named viral-ideas, list-ideas, saved-ideas, ideas or help. Ideas lists go to ideas/ (not in git).
