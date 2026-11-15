#!/usr/bin/env python3
"""Colour-match and grade AI motion clips so a whole video looks like one film.  tools/grade.py <video_dir>

Reads <video_dir>/assets/clips/raw/*.mp4 (Wan output) and <video_dir>/assets/clips/grade.json:
  {"width": 1080, "height": 1920, "fps": 30,
   "clips": [{"name": "s1_0", "scene": 1, "duration": 3.4, "keepLight": false}, ...]}
Writes <video_dir>/assets/clips/<name>.mp4 (finished clips, skipped if they exist).

Rules (agreed with the user):
  1. ONE correction per clip, never per frame: the whole clip is measured on average and every frame gets the same
     adjustment, so light that changes inside a clip (fire growing or dying) stays.
  2. Clips of the same scene are nudged toward that scene's middle brightness/contrast/colour strength; the nudge is
     limited (small AI differences only). Shots marked keepLight (a story light change) are not matched.
  3. Then the approved "balanced" grade: deep blacks kept, harsh highlights and over-strong colour toned down.
  4. AI-upscale (Real-ESRGAN 3x, config "upscale"), scale to the video size, retime to the shot length (+ the cross-fade),
     30 fps by repeating frames (no blending, no blur: docs/experiments/2026-11-15-wan-sharpness).
"""
import json, os, shutil, statistics, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import CFG, path

VD = os.path.abspath(sys.argv[1])
C = os.path.join(VD, "assets", "clips"); RAW = os.path.join(C, "raw")
spec = json.load(open(os.path.join(C, "grade.json")))
FADE = 0.45   # same cross-fade as the engine (Main.tsx)
BALANCED = "eq=contrast=0.94:saturation=0.9:gamma=1.02,curves=all='0/0 0.06/0.045 0.5/0.51 0.92/0.9 1/0.96'"   # no blur (sharpness test 2026-11-15)


def measure(path):
    """Average brightness (Y mean), contrast (Y spread) and colour strength (saturation) over ~8 frames."""
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-vf", "fps=2.5,scale=160:-2,signalstats,metadata=print:file=-", "-f", "null", "-"]
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    vals = {"YAVG": [], "YLOW": [], "YHIGH": [], "SATAVG": []}
    for line in out.splitlines():
        for k in vals:
            if f"signalstats.{k}=" in line: vals[k].append(float(line.split("=")[1]))
    avg = lambda k: statistics.mean(vals[k]) if vals[k] else 0.0
    return {"y": avg("YAVG"), "spread": max(1.0, avg("YHIGH") - avg("YLOW")), "sat": max(1.0, avg("SATAVG"))}


UP = os.path.join(C, "up")


def upscale(name):
    """AI-upscale a raw Wan clip 3x with Real-ESRGAN (animevideov3, BSD-3) -> clips/up/<name>.mp4 (cached).
    Wan makes 480x832 frames; a plain stretch to 1080x1920 looks soft (docs/experiments/2026-11-15-wan-sharpness)."""
    out = os.path.join(UP, name + ".mp4"); src = os.path.join(RAW, name + ".mp4")
    u = CFG.get("upscale", {}); binp = path(u.get("bin", ""))
    if os.path.exists(out): return out
    if not binp or not os.path.exists(binp): print(f"upscaler not found, plain stretch for {name}", flush=True); return src
    os.makedirs(UP, exist_ok=True); tmp = tempfile.mkdtemp(prefix="up_")
    try:
        os.makedirs(os.path.join(tmp, "in")); os.makedirs(os.path.join(tmp, "out"))
        fps = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", src], capture_output=True, text=True).stdout.strip() or "24"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, os.path.join(tmp, "in", "%04d.png")], check=True)
        subprocess.run([binp, "-i", os.path.join(tmp, "in"), "-o", os.path.join(tmp, "out"), "-n", u.get("model", "realesr-animevideov3"), "-s", str(u.get("scale", 3)), "-f", "png",
                        "-m", os.path.join(os.path.dirname(binp), "models")],   # it finds its models relative to the folder it runs from
                       check=True, capture_output=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", fps, "-i", os.path.join(tmp, "out", "%04d.png"), "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", out], check=True)
        print(f"upscaled {name}", flush=True); return out
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


clips = [c for c in spec["clips"] if os.path.exists(os.path.join(RAW, c["name"] + ".mp4"))]
stats = {c["name"]: measure(os.path.join(RAW, c["name"] + ".mp4")) for c in clips}
by_scene = {}
for c in clips:
    if not c.get("keepLight"): by_scene.setdefault(c["scene"], []).append(stats[c["name"]])
target = {s: {k: statistics.median(m[k] for m in ms) for k in ("y", "spread", "sat")} for s, ms in by_scene.items()}
clamp = lambda v, lo, hi: max(lo, min(hi, v))
report = {}
for c in clips:
    out = os.path.join(C, c["name"] + ".mp4")
    m, t = stats[c["name"]], target.get(c["scene"])
    if c.get("keepLight") or not t:
        b, ct, sa = 0.0, 1.0, 1.0
    else:   # limited nudges toward the scene's middle look
        ct = clamp(t["spread"] / m["spread"], 0.9, 1.1)
        b = clamp((t["y"] - m["y"]) / 255.0, -0.06, 0.06)
        sa = clamp(t["sat"] / m["sat"], 0.88, 1.12)
    report[c["name"]] = {"measured": {k: round(v, 1) for k, v in m.items()}, "brightness": round(b, 3), "contrast": round(ct, 3), "saturation": round(sa, 3), "keepLight": bool(c.get("keepLight"))}
    if os.path.exists(out): continue
    src_dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", os.path.join(RAW, c["name"] + ".mp4")], capture_output=True, text=True).stdout or 3.4)
    need = c["duration"] + FADE
    speed = need / src_dur   # >1 = slow down to fill the shot; capped so motion never looks syrupy
    vf = (f"eq=brightness={b:.3f}:contrast={ct:.3f}:saturation={sa:.3f},{BALANCED},"
          f"scale={spec['width']}:{spec['height']}:flags=lanczos:force_original_aspect_ratio=increase,crop={spec['width']}:{spec['height']},"
          f"setpts={min(speed, 1.6):.4f}*PTS,fps={spec.get('fps', 30)},tpad=stop_mode=clone:stop_duration={max(0.0, need - src_dur * min(speed, 1.6)) + 0.1:.2f}")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", upscale(c["name"]), "-vf", vf, "-t", f"{need:.3f}", "-an",
                    "-c:v", "libx264", "-crf", "17", "-pix_fmt", "yuv420p", out], check=True)
    print(f"graded {c['name']}", flush=True)
json.dump(report, open(os.path.join(C, "grade-report.json"), "w"), indent=1)
print("grade done")
