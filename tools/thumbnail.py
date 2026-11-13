#!/usr/bin/env python3
"""Thumbnail = FLUX picture + big headline.  tools/thumbnail.py <video_dir>  (reads thumbnail.json, brief.json)"""
import json, os, subprocess, sys, textwrap
from common import run
vd = sys.argv[1]; T = json.load(open(os.path.join(vd, "thumbnail.json"))); B = json.load(open(os.path.join(vd, "brief.json")))
short = B["format"] == "short"
w, h, W, H = (576, 1024, 1080, 1920) if short else (1024, 576, 1280, 720)
raw = os.path.join(vd, "assets", "thumb_raw.png")
here = os.path.dirname(os.path.abspath(__file__))
subprocess.run([sys.executable, os.path.join(here, "image.py"), T["imagePrompt"], raw, str(w), str(h), str(T.get("seed", 5))], check=True)
lines = textwrap.wrap(T["headline"].upper(), 12 if short else 16)
size = 150 if short else 110
font = "/System/Library/Fonts/Supplemental/Impact.ttf"
y0 = int(H * (0.62 if short else 0.08))
dt = ",".join(f"drawtext=fontfile='{font}':text='{l.replace(chr(39), '')}':fontsize={size}:fontcolor=#FFD60A:borderw=10:bordercolor=black:x=(w-text_w)/2:y={y0 + i*int(size*1.1)}" for i, l in enumerate(lines))
run(["ffmpeg", "-y", "-v", "error", "-i", raw, "-vf", f"scale={W}:{H}:flags=lanczos,eq=contrast=1.08:saturation=1.15,{dt}", os.path.join(vd, "thumbnail.png")])
print("thumbnail.png")
