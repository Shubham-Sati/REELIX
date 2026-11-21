#!/usr/bin/env python3
"""Speed ramps for AI motion clips (AI motion V4 test).

  speed_ramp.py <frames_dir> <out.mp4> <speed keys JSON> [src_fps=24] [out_fps=30] [blur=1]

speed keys: [[t_out_seconds, speed], ...]  e.g. [[0, 1.6], [1.2, 1.6], [1.8, 1.0]]
  speed 1 = real time, 1.6 = 60% faster (hurry), 0.5 = slow motion. Between keys the speed changes smoothly (ease),
  so a ramp never jumps. The clip ends when the source frames run out.
For each output frame we integrate the speed curve to find the source time, then take the nearest source frame.
Fast parts (speed > 1.3) blend the in-between source frames into one frame (a light motion blur), so hurry shots read as
fast instead of choppy. Slow parts repeat frames (smooth slow-mo would need RIFE in-between frames; not used in this test).
"""
import json, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image

src, out, keys = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
sfps = float(sys.argv[4]) if len(sys.argv) > 4 else 24.0
ofps = float(sys.argv[5]) if len(sys.argv) > 5 else 30.0
blur = (sys.argv[6] if len(sys.argv) > 6 else "1") == "1"
files = sorted(f for f in os.listdir(src) if f.endswith(".png"))
n = len(files)

def speed(t):
    if t <= keys[0][0]: return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t <= t1:
            u = (t - t0) / max(1e-6, t1 - t0); u = u * u * (3 - 2 * u)      # smoothstep ease
            return v0 + (v1 - v0) * u
    return keys[-1][1]

dt, st, frames = 1 / ofps, 0.0, []
while True:
    i = st * sfps
    if i > n - 1: break
    frames.append((i, speed(len(frames) * dt)))
    st += speed(len(frames) * dt) * dt
cache = {}
def img(k):
    if k not in cache: cache[k] = np.asarray(Image.open(os.path.join(src, files[k])).convert("RGB"), dtype=np.float32)
    return cache[k]
with tempfile.TemporaryDirectory() as tmp:
    for j, (i, sp) in enumerate(frames):
        a = int(round(i))
        if blur and sp > 1.3:                           # blend the source frames this output frame "passes over"
            span = sp * sfps / ofps; lo, hi = int(i - span / 2 + 0.5), int(i + span / 2 + 0.5)
            ks = [min(n - 1, max(0, k)) for k in range(lo, max(lo + 1, hi + 1))]
            pix = sum(img(k) for k in ks) / len(ks)
        else:
            pix = img(min(n - 1, a))
        Image.fromarray(pix.clip(0, 255).astype(np.uint8)).save(os.path.join(tmp, f"{j:05d}.png"))
        if len(cache) > 12: cache.pop(next(iter(cache)))
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", str(ofps), "-i", os.path.join(tmp, "%05d.png"),
                    "-vf", "eq=contrast=0.94:saturation=0.9:gamma=1.02,curves=all='0/0 0.06/0.045 0.5/0.51 0.92/0.9 1/0.96',scale=1080:1920:flags=lanczos",
                    "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", out], check=True)
print(f"{out}: {len(frames)} frames = {len(frames) / ofps:.2f} s from {n} source frames ({n / sfps:.2f} s)")
