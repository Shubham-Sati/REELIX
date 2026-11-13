#!/usr/bin/env python3
"""Kokoro voiceover for a whole script.  tools/voice.py <video_dir>
Reads script.json (lines: speaker, emotion, text) + voices map, makes one clean WAV per line,
joins them with natural pauses into assets/voice.wav and writes assets/lines.json (start/end per line)."""
import json, os, re, sys, shutil, tempfile
from common import CFG, path, run, dur
vd = sys.argv[1]; S = json.load(open(os.path.join(vd, "script.json")))
V = CFG["voice"]; out_dir = os.path.join(vd, "assets", "voice"); os.makedirs(out_dir, exist_ok=True)
SPEED = {"warm": 0.95, "dramatic": 0.88, "excited": 1.08, "curious": 0.97, "calm": 0.93, "neutral": 1.0}
POLISH = "highpass=f=70,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,loudnorm=I=-16:TP=-1.5:LRA=7"
files, meta, t = [], [], 0.0
for i, ln in enumerate(S["lines"]):
    role = S["voices"].get(ln["speaker"], "narrator-male")
    voice = V["voices"].get(role, role)
    text = re.sub(r"\[[^\]]*\]", "", ln["text"]).strip()
    tmp = tempfile.mkdtemp()
    run([path(V["bin"]), "--model", V["model"], "--text", text, "--voice", voice, "--lang_code", voice[0],
         "--speed", str(SPEED.get(ln.get("emotion", "neutral"), 1.0)), "--output_path", tmp, "--file_prefix", "l", "--join_audio"])
    raw = os.path.join(tmp, [f for f in os.listdir(tmp) if f.endswith(".wav")][0])
    wav = os.path.join(out_dir, f"line{i+1:02d}.wav")
    run(["ffmpeg", "-y", "-v", "error", "-i", raw, "-af",
         "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse," + POLISH,
         "-ar", "48000", "-ac", "1", wav])
    shutil.rmtree(tmp)
    d = dur(wav)
    nxt = S["lines"][i + 1] if i + 1 < len(S["lines"]) else None
    gap = 0.0 if nxt is None else (0.55 if nxt["speaker"] != ln["speaker"] else 0.35)
    meta.append({"i": i, "speaker": ln["speaker"], "voice": voice, "text": text, "start": round(t, 3), "end": round(t + d, 3), "scene": ln.get("scene")})
    files.append((wav, gap)); t += d + gap
    print(f"line {i+1}/{len(S['lines'])} {voice} {d:.1f}s", flush=True)
lead = 0.3   # breath before the first word
lst = os.path.join(out_dir, "concat.txt")
sil = os.path.join(out_dir, "sil.wav")
with open(lst, "w") as f:
    run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", str(lead), sil])
    f.write(f"file '{sil}'\n")
    for wav, gap in files:
        f.write(f"file '{wav}'\n")
        if gap:
            g = wav.replace(".wav", "_gap.wav")
            run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", str(gap), g]); f.write(f"file '{g}'\n")
run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-ar", "48000", "-ac", "1", os.path.join(vd, "assets", "voice.wav")])
for m in meta: m["start"] += lead; m["end"] += lead
json.dump({"durationSec": round(dur(os.path.join(vd, "assets", "voice.wav")), 3), "lines": meta}, open(os.path.join(vd, "assets", "lines.json"), "w"), indent=1)
print("voice.wav", round(t + lead, 2), "s")
