"""Shared helpers for the REELIX tools: config paths, running commands, durations."""
import json, os, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def _merge(a, b):
    for k, v in b.items():
        a[k] = _merge(a.get(k, {}), v) if isinstance(v, dict) and isinstance(a.get(k), dict) else v
    return a

# config/models.json (in git, default install paths) + config/models.local.json (this laptop only, optional)
CFG = json.load(open(os.path.join(ROOT, "config", "models.json")))
_local = os.path.join(ROOT, "config", "models.local.json")
if os.path.exists(_local): _merge(CFG, json.load(open(_local)))

def path(s):
    return os.path.expanduser(s.replace("{models}", os.path.expanduser(CFG["models"])))

def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        sys.stderr.write(r.stdout[-1500:] + r.stderr[-1500:])
        raise SystemExit(f"FAILED: {cmd[0]}")
    return r

def dur(f):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).stdout.strip())

if __name__ == "__main__":   # tools/common.py image.bin  -> prints the resolved path (used by shell scripts)
    v = CFG
    for k in sys.argv[1].split("."): v = v[k]
    print(path(v))
