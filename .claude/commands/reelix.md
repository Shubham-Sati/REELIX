---
description: Make a REELIX video. Usage: /reelix <video-name>
argument-hint: <video-name>
---
Make a REELIX video named "$ARGUMENTS".
1. Ask the user these five questions with AskUserQuestion (one call): "What should this video be about?" (free text via Other), "Is this a video or a short?" (Video 16:9 / Short 9:16), "What style?" (Explainer / Tutorial, Animated / Motion Graphics), "2D or 3D?" (2D: AI pictures / 3D: built in code, characters move), then "Which look?" (2D: Realistic painting or Cartoon (Pixar-like pictures); 3D: 3D toy world).
2. Run `node cli/new.mjs "$ARGUMENTS" --about "<answer>" --format <video|short> --style <explainer|animated> --look <painted|cartoon|aimotion|toy3d>` - it creates the folder and brief.json and prints the folder.
3. Hand over to the producer agent to run `node cli/pipeline.mjs <folder>` and report the results.
