#!/usr/bin/env python3
"""Picture from a prompt.  tools/image.py "<prompt>" out.png [width height seed [model [refs]]]
model: schnell (default, FLUX.1 schnell: realistic painting) | klein (FLUX.2 klein 4B: cartoon / Pixar-like).
The model can also come from the video's brief: REELIX_IMAGE_MODEL=klein.
refs (klein only): comma-separated reference pictures (e.g. characters/<name>-hero.png). klein's edit mode then keeps
those characters' faces, hair and clothes the same as in the references (AI motion V3/V4: same character in every shot)."""
import os, sys
from common import CFG, path, run
prompt, out = sys.argv[1], sys.argv[2]
w, h = (sys.argv[3], sys.argv[4]) if len(sys.argv) > 4 else ("576", "1024")
seed = sys.argv[5] if len(sys.argv) > 5 else "7"
model = sys.argv[6] if len(sys.argv) > 6 else os.environ.get("REELIX_IMAGE_MODEL", "schnell")
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
if os.path.exists(out): os.remove(out)          # mflux never overwrites
refs = [r for r in (sys.argv[7].split(",") if len(sys.argv) > 7 else []) if r and os.path.exists(r)]
if model == "klein" and refs:
    c = CFG["imageKlein"]; edit = path(c.get("editBin") or c["bin"].replace("mflux-generate-flux2", "mflux-generate-flux2-edit"))
    run([edit, "--model", path(c["model"]), "--base-model", "flux2-klein-4b", "-q", str(c.get("quantize", 4)), "--image-paths", *refs,
         "--prompt", prompt, "--width", w, "--height", h, "--steps", str(c["steps"]), "--seed", seed, "--output", out])
elif model == "klein":
    c = CFG["imageKlein"]
    run([path(c["bin"]), "--model", path(c["model"]), "--base-model", "flux2-klein-4b", "-q", str(c.get("quantize", 4)), "--prompt", prompt,
         "--width", w, "--height", h, "--steps", str(c["steps"]), "--seed", seed, "--output", out])
else:
    c = CFG["image"]
    run([path(c["bin"]), "--model", path(c["model"]), "--base-model", "schnell", "--prompt", prompt,
         "--width", w, "--height", h, "--steps", str(c["steps"]), "--seed", seed, "--output", out])
print(out)
