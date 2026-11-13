# REELIX rules
- Models are used from the AI Video Editor folder through config/models.json. Never copy them or that repo's structure here.
- Skills in .claude/skills are downloaded and used unmodified. If one does not work, replace it with a better one found online (record it in SOURCES.md); never edit it.
- One heavy model at a time (16 GB Mac): FLUX, Kokoro, ACE-Step run one after another.
- A video is made only by the pipeline (cli/pipeline.mjs); agents write their one output file and nothing else.
- Licences: FLUX schnell, Kokoro, ACE-Step are Apache-2.0. Never use flux-kontext-q4 or edge-tts (non-commercial).
