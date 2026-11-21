#!/usr/bin/env python3
"""Speed plan for one AI motion clip (AI motion V4, docs/experiments/2026-11-19-aimotion-v4-speed).

  <video env python> tools/speed_ramp.py <in.mp4 | frames_dir> <out.mp4> '<speed keys JSON>' [out_fps=30] [blur=1]

speed keys: [[seconds into the OUTPUT clip, speed], ...]   e.g. [[0, 1.6], [0.8, 1.6], [1.7, 1.0]]
  1 = real time, 1.6 = hurry, 0.6 = slow motion. Between keys the speed changes smoothly (smoothstep), so ramps never jump.
For every output frame the speed curve is integrated to find the source time and the nearest source frame is used.
When faster than 1.3x the source frames the output frame "passes over" are blended into one (a light motion blur), so hurry
reads as speed instead of choppiness. Slower than 1x repeats frames. Output is plain (no grade, no resize): tools/grade.py
grades and scales it. The clip ends when the source runs out; grade.py holds the last frame if the shot is longer.
Needs numpy + Pillow: run it with the AI Video Editor video env python (config videoWan.python).
"""
import json, os, shutil, subprocess, sys, tempfile
import numpy as np
from PIL import Image

src, out, keys = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
ofps = float(sys.argv[4]) if len(sys.argv) > 4 else 30.0
blur = (sys.argv[5] if len(sys.argv) > 5 else "1") == "1"
tmp = tempfile.mkdtemp(prefix="ramp_")
try:
    if os.path.isdir(src):
        fdir, sfps = src, 24.0
    else:
        fdir = os.path.join(tmp, "src"); os.makedirs(fdir)
        r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", src], capture_output=True, text=True).stdout.strip() or "24"
        a, _, b = r.partition("/"); sfps = float(a) / float(b or 1)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, os.path.join(fdir, "%05d.png")], check=True)
    files = sorted(f for f in os.listdir(fdir) if f.endswith(".png")); n = len(files)

    def speed(t):
        if t <= keys[0][0]: return keys[0][1]
        for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
            if t <= t1:
                u = (t - t0) / max(1e-6, t1 - t0); u = u * u * (3 - 2 * u)
                return v0 + (v1 - v0) * u
        return keys[-1][1]

    frames, st, j = [], 0.0, 0
    while st * sfps <= n - 1:
        sp = speed(j / ofps); frames.append((st * sfps, sp)); st += sp / ofps; j += 1
    cache = {}
    def img(k):
        if k not in cache:
            if len(cache) > 16: cache.pop(next(iter(cache)))
            cache[k] = np.asarray(Image.open(os.path.join(fdir, files[k])).convert("RGB"), dtype=np.float32)
        return cache[k]
    odir = os.path.join(tmp, "out"); os.makedirs(odir)
    for j, (i, sp) in enumerate(frames):
        if blur and sp > 1.3:
            span = sp * sfps / ofps; lo, hi = int(i - span / 2 + 0.5), int(i + span / 2 + 0.5)
            ks = [min(n - 1, max(0, k)) for k in range(lo, max(lo + 1, hi + 1))]
            pix = sum(img(k) for k in ks) / len(ks)
        else:
            pix = img(min(n - 1, int(round(i))))
        Image.fromarray(pix.clip(0, 255).astype(np.uint8)).save(os.path.join(odir, f"{j:05d}.png"))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(ofps), "-i", os.path.join(odir, "%05d.png"),
                    "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", out], check=True)
    print(f"{out}: {len(frames)} frames = {len(frames) / ofps:.2f} s from {n} source frames ({n / sfps:.2f} s)", flush=True)
finally:
    shutil.rmtree(tmp, ignore_errors=True)
