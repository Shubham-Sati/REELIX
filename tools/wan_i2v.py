#!/usr/bin/env python3
"""Animate pictures into short clips with Wan 2.2 TI2V-5B (FastWan, DMD 3-step, Apache-2.0) on Apple Silicon.

  One clip:   <video env python> tools/wan_i2v.py <model_dir> <image.png> "<motion prompt>" <out.mp4> [frames=81] [seed=42] [w=480 h=832]
  Many clips: <video env python> tools/wan_i2v.py --jobs jobs.json
              jobs.json = {"model_dir": "...", "w": 480, "h": 832, "jobs": [{"image", "prompt", "out", "frames", "seed"}, ...]}

Speed-up for many clips: the 11 GB text model is loaded ONCE, reads every prompt, and is freed before any video is made
(the same prompt always gives the same numbers, so the clips are identical to one-by-one runs).
Uses mlx-video's Wan generator unchanged, with the 3-step DMD sampler the FastWan model was trained for
(sigmas from config.json "fastwan_dmd": x0 = x - s*v, then renoise to the next sigma), and a tiled decode so 16 GB is enough.
Clips that already exist are skipped (re-runs continue). Prints "clip i/n" for progress.
Heavy (~10-12 GB): run it alone, never next to FLUX, Kokoro, ACE-Step or a render.
"""
import gc, json, os, sys, time
import mlx.core as mx
import mlx_video.models.wan_2.scheduler as S

if sys.argv[1] == "--jobs":
    spec = json.load(open(sys.argv[2]))
else:
    a = sys.argv[1:]
    spec = {"model_dir": a[0], "w": int(a[6]) if len(a) > 7 else 480, "h": int(a[7]) if len(a) > 7 else 832,
            "jobs": [{"image": a[1], "prompt": a[2], "out": a[3], "frames": int(a[4]) if len(a) > 4 else 81, "seed": int(a[5]) if len(a) > 5 else 42}]}
model_dir = spec["model_dir"]
jobs = [j for j in spec["jobs"] if not os.path.exists(j["out"])]
if not jobs:
    print("all clips exist"); sys.exit(0)
dmd = json.load(open(os.path.join(model_dir, "config.json"))).get("fastwan_dmd")


class DMDScheduler:
    """FastWan DMD sampler: predict the clean latent, then add fresh noise for the next (lower) sigma."""
    def __init__(self, num_train_timesteps: int = 1000):
        self.n = num_train_timesteps

    def set_timesteps(self, num_steps: int, shift: float = 1.0):
        self._s = list(dmd["sigmas"])
        self.sigmas = mx.array(self._s)
        self.timesteps = mx.array([s * self.n for s in self._s[:-1]])
        self._i = 0

    def step(self, model_output, timestep, sample):
        s, s_next = self._s[self._i], self._s[self._i + 1]
        x0 = sample - s * model_output
        self._i += 1
        if s_next <= 0:
            return x0
        noise = mx.random.normal(sample.shape) if dmd.get("renoise", True) else (sample - (1 - s) * x0) / s
        return (1 - s_next) * x0 + s_next * noise

    def reset(self):
        self._i = 0


if dmd:
    S.FlowMatchEulerScheduler = DMDScheduler   # generate.py imports it from this module at call time
from mlx_video.models.wan_2 import generate as G
from mlx_video.models.wan_2.config import WanModelConfig

# ---- 1. read every prompt once (text model loaded a single time)
t0 = time.time()
print(f"reading {len(jobs)} prompt(s) with the text model", flush=True)
from pathlib import Path
from transformers import AutoTokenizer
cfg_json = json.load(open(os.path.join(model_dir, "config.json")))
cfg_json.pop("quantization", None)
for k in ("patch_size", "vae_stride", "window_size", "sample_guide_scale"):
    if isinstance(cfg_json.get(k), list): cfg_json[k] = tuple(cfg_json[k])
real_load, real_encode = G.load_t5_encoder, G.encode_text
config = WanModelConfig(**{k: v for k, v in cfg_json.items() if k in WanModelConfig.__dataclass_fields__})   # same as generate.py
enc = real_load(Path(model_dir) / "t5_encoder.safetensors", config)
tok = AutoTokenizer.from_pretrained("google/umt5-xxl")
cache = {}
for j in jobs:
    if j["prompt"] not in cache:
        cache[j["prompt"]] = real_encode(enc, tok, j["prompt"], cfg_json["text_len"]); mx.eval(cache[j["prompt"]])
del enc; gc.collect(); mx.clear_cache()
print(f"prompts read in {time.time() - t0:.0f}s", flush=True)

# ---- 2. make each clip, reusing the saved prompt numbers
G.load_t5_encoder = lambda path, config: None
G.encode_text = lambda encoder, tokenizer, prompt, text_len: cache[prompt]
tiling = os.environ.get("WAN_TILING", "aggressive")   # small decode tiles: the full decode runs out of memory on 16 GB
for i, j in enumerate(jobs, 1):
    print(f"clip {i}/{len(jobs)} {os.path.basename(j['out'])}", flush=True)
    os.makedirs(os.path.dirname(os.path.abspath(j["out"])), exist_ok=True)
    G.generate_video(model_dir=model_dir, prompt=j["prompt"], image=j["image"], width=spec.get("w", 480), height=spec.get("h", 832),
                     num_frames=j.get("frames", 81), seed=j.get("seed", 42), output_path=j["out"], tiling=tiling,
                     **({"steps": len(dmd["sigmas"]) - 1, "scheduler": "euler", "guide_scale": 1.0} if dmd else {}))
    gc.collect(); mx.clear_cache()
print(f"done {len(jobs)} clip(s) in {time.time() - t0:.0f}s", flush=True)
