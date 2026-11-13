"""Shared helpers for the REELIX tools: config paths, running commands, durations."""
import json, os, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, "config", "models.json")))

def path(s):
    return os.path.expanduser(s.replace("{aveRoot}", CFG["aveRoot"]))

def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        sys.stderr.write(r.stdout[-1500:] + r.stderr[-1500:])
        raise SystemExit(f"FAILED: {cmd[0]}")
    return r

def dur(f):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).stdout.strip())
