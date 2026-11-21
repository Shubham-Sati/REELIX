#!/usr/bin/env python3
"""ACE-Step background music.  tools/music.py <video_dir> "<prompt>" <seconds>
Starts the local server if needed, makes one instrumental take, trims + fades it, stops the server (frees ~7 GB).
A video longer than ~4 minutes gets one 3-minute take repeated with crossfades (one very long take is slow and drifts)."""
import json, os, subprocess, sys, time, urllib.request
from common import CFG, path, run
vd, prompt, secs = sys.argv[1], sys.argv[2], float(sys.argv[3])
gen = secs if secs <= 230 else 180.0   # seconds of music to generate; longer videos loop this take
API = CFG["music"]["api"]; D = path(CFG["music"]["dir"])
def up():
    try: urllib.request.urlopen(API + "/health", timeout=3); return True
    except Exception: return False
def post(p, b):
    return json.load(urllib.request.urlopen(urllib.request.Request(API + p, data=json.dumps(b).encode(), headers={"Content-Type": "application/json"}), timeout=60))
started = False
if not up():
    env = dict(os.environ, ACESTEP_LM_BACKEND="mlx", TOKENIZERS_PARALLELISM="false", ACESTEP_INIT_LLM="auto")
    subprocess.Popen(["uv", "run", "acestep-api", "--host", "127.0.0.1", "--port", "8001"], cwd=D, env=env,
                     stdout=open(os.path.join(D, "server.log"), "w"), stderr=subprocess.STDOUT)
    started = True
    for _ in range(60):
        time.sleep(5)
        if up(): break
    else: raise SystemExit("music server did not start")
try:
    body = {"prompt": prompt, "lyrics": "[Instrumental]", "instrumental": True, "thinking": True, "audio_duration": max(15.0, gen + 3),
            "audio_format": "wav", "batch_size": 1, "inference_steps": 8, "use_random_seed": True}
    task = post("/release_task", body)["data"]["task_id"]
    while True:
        time.sleep(3); d = post("/query_result", {"task_id_list": [task]})["data"][0]
        if d["status"] == 2: raise SystemExit(f"music failed: {d}")
        if d["status"] == 1: break
    it = json.loads(d["result"])[0]
    raw = os.path.join(vd, "assets", "music.raw.wav"); urllib.request.urlretrieve(API + it["file"], raw)
    if secs > gen:   # long video: repeat the take with 4 s crossfades until it covers the whole video
        n = int(secs // (gen - 4)) + 1
        loop = os.path.join(vd, "assets", "music.loop.wav"); cmd = ["ffmpeg", "-y", "-v", "error"]; chain = []; last = "0:a"
        for _ in range(n): cmd += ["-i", raw]
        for k in range(1, n): chain.append(f"[{last}][{k}:a]acrossfade=d=4:c1=tri:c2=tri[a{k}]"); last = f"a{k}"
        run(cmd + ["-filter_complex", ";".join(chain), "-map", f"[{last}]", loop]); os.remove(raw); raw = loop
    run(["ffmpeg", "-y", "-v", "error", "-i", raw, "-t", str(secs), "-af", f"afade=t=in:d=0.5,afade=t=out:st={max(0, secs-2.5):.2f}:d=2.5,loudnorm=I=-20",
         "-ar", "48000", "-ac", "2", os.path.join(vd, "assets", "music.wav")]); os.remove(raw)
    print("music.wav")
finally:
    if started: subprocess.run("lsof -ti tcp:8001 | xargs kill", shell=True)
