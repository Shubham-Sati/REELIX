#!/usr/bin/env python3
"""Claude usage of one video, per helper (agent) run, from Claude Code's own session logs.
   python3 tools/usage_report.py <video-folder> [--json out.json] [--since 2026-11-22T08:40]   (UTC; skip runs that started earlier)
Reads ~/.claude/projects/<this repo>/*.jsonl, keeps the sessions whose task names this video ("Video folder: videos/<id>"),
and counts per run: agent, model, steps (turns), tokens (input, cache write, cache read, output), the biggest conversation size
(context = input + cache write + cache read of one turn), check pictures (still.sh / stills.sh calls), pictures opened, minutes.
Writes <video>/logs/usage.json and prints a table. Turns are counted once per message id (Claude Code logs a message in parts).
Part of the optimise plan, step 1.1 (todos/optimise_time_and_usage.md)."""
import collections, datetime, glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ = os.path.expanduser("~/.claude/projects/" + re.sub(r"[^A-Za-z0-9]", "-", ROOT))

def ts(s): return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))

def session(f):
    msgs, order, tools = {}, [], collections.Counter()
    stills = sheets = imgs = 0; agent = prompt = model = None; times = []
    for line in open(f, errors="ignore"):
        try: r = json.loads(line)
        except Exception: continue
        if r.get("timestamp"): times.append(r["timestamp"])
        if r.get("type") == "agent-setting" and not agent: agent = r.get("agentSetting")
        m = r.get("message") if isinstance(r.get("message"), dict) else None
        if not m: continue
        if r.get("type") == "user":
            c = m.get("content")
            if prompt is None and isinstance(c, str): prompt = c
            for it in c if isinstance(c, list) else []:
                if not isinstance(it, dict): continue
                if it.get("type") == "image": imgs += 1
                if it.get("type") == "tool_result" and isinstance(it.get("content"), list):
                    imgs += sum(1 for x in it["content"] if isinstance(x, dict) and x.get("type") == "image")
        if r.get("type") == "assistant":
            if m.get("id") and m.get("usage"):
                if m["id"] not in msgs: order.append(m["id"])
                msgs[m["id"]] = m["usage"]; model = m.get("model") or model
            for it in m.get("content") or []:
                if isinstance(it, dict) and it.get("type") == "tool_use":
                    tools[it["name"]] += 1; cmd = str((it.get("input") or {}).get("command", ""))
                    if it["name"] == "Bash" and "tools/stills.sh" in cmd: sheets += 1
                    elif it["name"] == "Bash" and ("still.sh" in cmd or "stills.sh" in cmd): stills += 1   # own loops (e.g. /tmp/stills.sh) count as single photos
    if not msgs or not prompt: return None
    u = lambda k: sum((x.get(k) or 0) for x in msgs.values())
    ctx = max((x.get("input_tokens") or 0) + (x.get("cache_creation_input_tokens") or 0) + (x.get("cache_read_input_tokens") or 0) for x in msgs.values())
    return dict(session=os.path.basename(f)[:8], agent=agent or "-", model=model or "-", prompt=prompt, start=min(times), end=max(times),
                minutes=round((ts(max(times)) - ts(min(times))).total_seconds() / 60, 1), turns=len(msgs),
                input=u("input_tokens"), cache_write=u("cache_creation_input_tokens"), cache_read=u("cache_read_input_tokens"), output=u("output_tokens"),
                max_context=ctx, stills=stills, sheets=sheets, pictures=imgs, tools=dict(tools))

def main():
    if len(sys.argv) < 2: print(__doc__); sys.exit(1)
    vd = os.path.abspath(sys.argv[1]); vid = os.path.basename(vd.rstrip("/"))
    out = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else os.path.join(vd, "logs", "usage.json")
    runs = []
    for f in glob.glob(PROJ + "/*.jsonl"):
        s = session(f)
        since = sys.argv[sys.argv.index("--since") + 1] if "--since" in sys.argv else ""
        if s and re.search(r"videos/" + re.escape(vid) + r"\b", s["prompt"]) and s["turns"] > 1 and s["start"] >= since: runs.append(s)
    runs.sort(key=lambda s: s["start"])
    for s in runs: s["tokens"] = s["input"] + s["cache_write"] + s["cache_read"] + s["output"]; s["prompt"] = s["prompt"][:200]
    by = collections.OrderedDict()
    for s in runs:
        a = by.setdefault(s["agent"], dict(runs=0, minutes=0, turns=0, tokens=0, output=0, max_context=0, stills=0, sheets=0, pictures=0))
        for k in ("minutes", "turns", "tokens", "output", "stills", "sheets", "pictures"): a[k] += s[k]
        a["runs"] += 1; a["max_context"] = max(a["max_context"], s["max_context"])
    total = sum(s["tokens"] for s in runs) or 1
    for a in by.values(): a["share"] = round(100 * a["tokens"] / total, 1); a["minutes"] = round(a["minutes"], 1)
    rep = dict(video=vid, made=datetime.datetime.now().isoformat(timespec="seconds"), total_tokens=total, agents=by, runs=runs)
    os.makedirs(os.path.dirname(out), exist_ok=True); json.dump(rep, open(out, "w"), indent=1)
    print(f"Claude usage for {vid}: {total / 1e6:.1f}M tokens in {len(runs)} helper runs\n")
    print(f"{'helper':20} {'runs':>4} {'min':>6} {'turns':>6} {'tokens':>8} {'share':>6} {'max ctx':>8} {'stills':>6} {'sheets':>6} {'pics':>5}")
    for n, a in by.items():
        print(f"{n:20} {a['runs']:>4} {a['minutes']:>6} {a['turns']:>6} {a['tokens'] / 1e6:>7.1f}M {a['share']:>5}% {a['max_context'] / 1e3:>7.0f}k {a['stills']:>6} {a['sheets']:>6} {a['pictures']:>5}")
    print(f"\nwritten: {os.path.relpath(out, ROOT)}")

if __name__ == "__main__": main()
