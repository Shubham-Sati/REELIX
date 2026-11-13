#!/usr/bin/env python3
"""Live trend evidence for `reelix viral-ideas` (free, no API keys): what is getting views on YouTube right now.
  tools/trends.py "<topic>" <out.json>
Videos: YouTube search sorted by views (this month, this year). Shorts: the topic's hashtag Shorts feeds.
The top results get their upload date looked up so each one has views per day (the real "viral right now" signal).
Prints progress lines "step N/4 ..." for the terminal."""
import json, os, re, subprocess, sys, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import date

topic, out = sys.argv[1].strip(), sys.argv[2]
def ytdlp(args, timeout=90):
    try: return subprocess.run(["yt-dlp", "--no-warnings", *args], capture_output=True, text=True, timeout=timeout).stdout
    except Exception: return ""
def flat(url, n):
    try: return json.loads(ytdlp(["--flat-playlist", "-J", "--playlist-end", str(n), url]) or "{}").get("entries") or []
    except Exception: return []
def row(e, kind, src):
    u = e.get("url") or ""; vid = e.get("id") or u.rsplit("/", 1)[-1].split("=")[-1]
    return {"id": vid, "kind": kind, "title": e.get("title") or "", "channel": e.get("channel") or e.get("uploader") or "",
            "views": e.get("view_count") or 0, "seconds": e.get("duration"), "url": f"https://www.youtube.com/{'shorts/' if kind == 'short' else 'watch?v='}{vid}", "found": src}

rows = {}; feeds = set(); allwords = []
topics = [t.strip() for t in topic.split(",") if t.strip()]   # "a, b" = several searches (used for the channel niche)
for t_ in topics:
    q = urllib.parse.quote_plus(t_)
    words = [w for w in re.sub(r"[^a-z0-9 ]", "", t_.lower()).split() if len(w) > 2]; allwords.append(words)
    tags = ["".join(words)] if len(words) > 1 else words[:1]   # #spacehistory, not #space + #history (too broad)
    feeds.update(f"#{t} Shorts feed" for t in tags)
    print(f"step 1/4 searching YouTube videos: {t_}", flush=True)
    for sp, src in [("CAMSAggE", "most viewed this month"), ("CAMSAggF", "most viewed this year")]:
        for e in flat(f"https://www.youtube.com/results?search_query={q}&sp={sp}", 25):
            r = row(e, "video" if (e.get("duration") or 999) > 75 else "short", src); rows.setdefault(r["id"], r)
    print(f"step 2/4 searching YouTube Shorts: {t_}", flush=True)
    for t in tags:
        for e in flat(f"https://www.youtube.com/hashtag/{t}/shorts", 25):
            r = row(e, "short", f"#{t} Shorts feed"); rows.setdefault(r["id"], r)
    for e in flat(f"ytsearch30:{t_} #shorts", 30):
        if (e.get("duration") or 999) <= 75: r = row(e, "short", "Shorts search"); rows.setdefault(r["id"], r)

print("step 3/4 checking upload dates of the top results", flush=True)
# keep only results about the topic (generic hashtag feeds like #history bring unrelated viral Shorts)
hits = lambda r: max(sum(w in r["title"].lower() for w in ws) >= min(2, len(ws)) for ws in allwords if ws) if any(allwords) else True
on = lambda r: r["kind"] == "video" or r["found"] in feeds or hits(r) or not r["title"]
top = sorted([r for r in rows.values() if on(r)], key=lambda r: -r["views"])
pick = [r for r in top if r["kind"] == "video"][:10] + [r for r in top if r["kind"] == "short"][:10]
def detail(r):
    o = ytdlp(["--skip-download", "--print", "%(upload_date)s|%(view_count)s|%(duration)s|%(channel)s|%(title)s", r["url"]], 40).strip().splitlines()
    if o:
        d, v, s, ch, t = (o[-1].split("|", 4) + [""] * 5)[:5]
        if d.isdigit():
            age = max(1, (date.today() - date(int(d[:4]), int(d[4:6]), int(d[6:]))).days)
            r.update(uploaded=f"{d[:4]}-{d[4:6]}-{d[6:]}", daysOld=age)
        if v.isdigit(): r["views"] = int(v)
        if s.isdigit(): r["seconds"] = int(s)
        r["channel"] = r["channel"] or ch; r["title"] = r["title"] or t
        if r.get("daysOld"): r["viewsPerDay"] = round(r["views"] / r["daysOld"])
    return r
with ThreadPoolExecutor(8) as ex: pick = list(ex.map(detail, pick))
pick = [r for r in pick if r["kind"] == "video" or r["found"] in feeds or hits(r)]   # videos: YouTube search already matched the topic

print("step 4/4 ranking", flush=True)
rank = lambda k: sorted([r for r in pick if r["kind"] == k], key=lambda r: -(r.get("viewsPerDay") or r["views"] / 365))
res = {"topic": topic, "date": date.today().isoformat(), "videos": rank("video"), "shorts": rank("short"),
       "note": "viewsPerDay = views / days since upload: the 'viral right now' signal. Ranked highest first."}
json.dump(res, open(out, "w"), indent=1, ensure_ascii=False)
print(f"found {len(res['videos'])} videos and {len(res['shorts'])} shorts", flush=True)
