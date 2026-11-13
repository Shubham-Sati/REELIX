#!/usr/bin/env python3
"""Word timings with whisper.cpp, snapped back to the script's own spelling.  tools/captions.py <video_dir>"""
import json, os, re, sys, tempfile
from common import CFG, path, run
vd = sys.argv[1]; wav = os.path.join(vd, "assets", "voice.wav"); tmp = tempfile.mkdtemp()
w16 = os.path.join(tmp, "a.wav")
run(["ffmpeg", "-y", "-v", "error", "-i", wav, "-ar", "16000", "-ac", "1", w16])
run([CFG["captions"]["bin"], "-m", path(CFG["captions"]["model"]), "-f", w16, "-l", "en", "-ml", "1", "-sow", "-ojf", "-of", os.path.join(tmp, "w")])
heard = []
for s in json.load(open(os.path.join(tmp, "w.json")))["transcription"]:
    w = s["text"].strip()
    if re.search(r"\w", w): heard.append({"text": w, "start": s["offsets"]["from"] / 1000, "end": s["offsets"]["to"] / 1000})
# Use the script words (correct spelling) with whisper times, per line, so "1783" never becomes "seventeen eighty".
lines = json.load(open(os.path.join(vd, "assets", "lines.json")))["lines"]
words = []
for ln in lines:
    sw = ln["text"].split()
    hw = [h for h in heard if h["start"] >= ln["start"] - 0.25 and h["start"] < ln["end"]]
    if not hw: hw = [{"start": ln["start"], "end": ln["end"]}]
    a, b = hw[0]["start"], max(hw[-1]["end"], hw[0]["start"] + 0.2)
    if len(hw) == len(sw):
        words += [{"text": t, "start": h["start"], "end": h["end"]} for t, h in zip(sw, hw)]
    else:  # spread by word length across the heard span
        tot = sum(len(t) + 2 for t in sw); x = a
        for t in sw:
            d = (b - a) * (len(t) + 2) / tot; words.append({"text": t, "start": round(x, 3), "end": round(x + d, 3)}); x += d
json.dump(words, open(os.path.join(vd, "assets", "captions.json"), "w"), indent=1)
print(len(words), "words")
