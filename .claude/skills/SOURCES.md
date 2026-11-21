# Where each skill came from (copied unmodified)
| Skill | Source | Licence | Used by |
|---|---|---|---|
| yt-script | github.com/jakeschincariol/youtube-agent-skill | MIT | script-writer (videos) |
| video-marketing | github.com/kostja94/marketing-skills (skills/content/video) | MIT | script-writer (shorts). Replaces charlie947 reels-scripting, which needs Apify + a reference Reel URL |
| youtube-thumbnail | github.com/charlie947/social-media-skills | see repo | thumbnail-designer |
| hyperframes | github.com/nexu-io/open-design (plugins/_official/examples) | see repo | animator |
| create-video-storyboard | github.com/nexu-io/open-design (plugins/spec/examples) | MIT | storyboard-artist |
| create-image-campaign | github.com/nexu-io/open-design (plugins/spec/examples) | MIT | visual-artist |
| after-hours-editorial-template | github.com/nexu-io/open-design (skills) | see repo | storyboard-artist (look) |
| youtube-clipper | github.com/nexu-io/open-design (skills) | see repo | animator (cut shorts) |
| remotion-markup, remotion-best-practices | github.com/remotion-dev/skills (official) | see repo | animator |
| video | github.com/nexus-jpf/note-companion (.agents/skills/video) | see repo | producer, animator |

## Added 2026-11-13 (improvement round), copied unmodified
| Skill | Source (commit) | Licence | Used by |
|---|---|---|---|
| threejs-fundamentals, -lighting, -materials, -animation, -geometry, -loaders, -react-three-fiber | github.com/cloudai-x/threejs-skills (0e18186) | MIT | animator (3D scenes) |
| gsap-core, gsap-timeline, gsap-plugins, gsap-react, gsap-utils | github.com/greensock/gsap-skills (aed9cfd), official GreenSock | MIT | animator (kinetic scenes) |
| video-content-strategist | github.com/alirezarezvani/claude-skills (08cd8a9), marketing-skill; top YouTube skill on skillsmp.com (29.7k stars) | MIT | script-writer |

## Added 2026-11-14 (viral ideas), copied unmodified
| Skill | Source (commit) | Licence | Used by |
|---|---|---|---|
| youtube-shorts, youtube-long-form, trend-jacking, idea-generation-and-ideation, viral-reverse-engineering, hook-writer | github.com/social-media-skills/skills (f28cef2), found on skillsmp.com | MIT | idea-scout (`reelix viral-ideas`) |
Note: these skills mention WoopSocial (their publishing app) and brand-profile/voice skills; REELIX ignores the publishing parts and uses config/voice.md as the brand profile.

## Added 2026-11-14 (per-video characters), copied unmodified
| Skill | Source (commit) | Licence | Used by |
|---|---|---|---|
| long-form-continuity-bible | github.com/nolanx-ai/nolanx.ai (595d863), found on skillsmp.com | MIT | storyboard-artist, visual-artist, reviewer |
| scenario-consistency | github.com/scenario-labs/skills (94cab3f), found on skillsmp.com | MIT | storyboard-artist, visual-artist (method only: reference anchors, change one variable; its Scenario platform calls are not used) |
Not used: MiniMax-AI 3d-animation-short-generator (no licence), Seedance/Higgsfield character skills (paid video services).

## Added 2026-11-14 (3D toy world look), copied unmodified
| Skill | Source (commit) | Licence | Used by |
|---|---|---|---|
| 3d-generalist, model-characters, rig-characters, animate-characters | github.com/codepawl/creator-generalist (7235f50), plugins/3d-generalist, found on skillsmp.com | MIT | set-builder (3D toy world), animator; animate-characters also covers 2D cut-out animation (Phase 2) |
Checked and not used: linegel/threejs-complete-set-of-skill (ISC, but written for WebGPU/TSL; our engine renders through React Three Fiber on WebGL), Tripo-based threejs-3d-generator skills (paid API), namuan image-to-threejs (no licence).
Notes: 3d-generalist also covers Blender/67js and asset kitbashing; REELIX uses only its Three.js + character-acting parts and builds everything in code (no downloads).

## Added 2026-11-15 (3D AI motion look), copied unmodified
| Skill | Source (commit) | Licence | Used by |
|---|---|---|---|
| ffmpeg-color-grading-chromakey | github.com/josiahsiegel/claude-plugin-marketplace (5a1b112), plugins/ffmpeg-effects/skills/ffmpeg-color-grading-chromakey | MIT | colour guide for the animator and reviewer (grade and match AI motion clips); REELIX's tools/grade.py does the automatic per-clip matching |
Checked and not used: travisjneuman video-production (shot matching only named, no steps), awesome-omni-skill color-grade (DaVinci/Premiere LUTs, licence unclear), kajisho5 color-grading-skill (needs another tool, very new).

## Checked 2026-11-21 (Lego animals), nothing added
Looked for a skill that builds many different animals in code for our React Three Fiber / WebGL engine.
Checked and not used: img2threejs (Apache-2.0, but its creature generator is not in the repo at 0c0c49b and it is an image-matching pipeline), linegel threejs-procedural-creatures (WebGPU/TSL, no licence), markkampstra/fp-survival modeling-3d (no licence, blocky box recipes), jaybmcv/3d-workflow-skill, Priyanshu-dev525/LowPolySkill, IAmTheParsifal/Low-Poly-Modeling-Skill, jasonkneen threejs-primitive-reconstructor (no animal guidance, Blender only or no licence).
Instead the method (body plan + spec + silhouette check) was built as code: docs/experiments/2026-11-21-lego-animals.
