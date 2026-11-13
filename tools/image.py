#!/usr/bin/env python3
"""FLUX.1 schnell: prompt -> PNG.  tools/image.py "<prompt>" out.png [width height seed]"""
import os, sys
from common import CFG, path, run
prompt, out = sys.argv[1], sys.argv[2]
w, h = (sys.argv[3], sys.argv[4]) if len(sys.argv) > 4 else ("576", "1024")
seed = sys.argv[5] if len(sys.argv) > 5 else "7"
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
if os.path.exists(out): os.remove(out)          # mflux never overwrites
c = CFG["image"]
run([path(c["bin"]), "--model", path(c["model"]), "--base-model", "schnell", "--prompt", prompt,
     "--width", w, "--height", h, "--steps", str(c["steps"]), "--seed", seed, "--output", out])
print(out)
