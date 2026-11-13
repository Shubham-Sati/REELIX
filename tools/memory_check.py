#!/usr/bin/env python3
"""Checks agent memory stays tidy.  tools/memory_check.py [memory_dir]   (default .claude/agent-memory)
Problems: MEMORY.md over 60 lines; 5+ lessons on one topic still inside MEMORY.md (by keyword);
a pointer to a topic file that does not exist; a topic file nothing points to; a topic file over 80 lines.
Prints one line per problem and exits 1 if there are any (the pipeline then runs a tidy job)."""
import os, re, sys
from collections import Counter
D = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", ".claude", "agent-memory")
TOPICS = {"flux": r"\bflux\b|prompt|redraw|redo", "captions": r"caption", "3d": r"\b3d\b|three|custom scene",
          "sfx": r"\bsfx\b|whoosh|impact|ambience", "timing": r"timing|seconds|\bpace\b|words/s|duration",
          "voice": r"kokoro|voice", "music": r"ace-step|music", "characters": r"character|drift"}
bad = []
for a in sorted(os.listdir(D)):
    d = os.path.join(D, a); m = os.path.join(d, "MEMORY.md")
    if not os.path.isfile(m): continue
    txt = open(m).read(); lines = [l for l in txt.splitlines() if l.strip()]
    if len(lines) > 60: bad.append(f"{a}: MEMORY.md has {len(lines)} lines (max 60): move a topic into its own file")
    lessons = [l for l in lines if l.lstrip().startswith("-") and not re.search(r"\.md\b", l)]
    c = Counter(t for l in lessons for t, rx in TOPICS.items() if re.search(rx, l, re.I))
    for t, n in c.items():
        if n >= 5: bad.append(f"{a}: {n} '{t}' lessons in MEMORY.md: move them to {t}.md and leave one pointer line")
    linked = set(re.findall(r"([\w.-]+\.md)\b", txt)) - {"MEMORY.md"}
    for f in linked:
        if not os.path.isfile(os.path.join(d, f)) and "/" not in f and f not in ("lessons.md", "review.md", "youtube.md"):
            bad.append(f"{a}: MEMORY.md points to {f}, which does not exist")
    for f in os.listdir(d):
        if f.endswith(".md") and f != "MEMORY.md":
            if f not in linked: bad.append(f"{a}: {f} is not linked from MEMORY.md: add a pointer line")
            n = sum(1 for l in open(os.path.join(d, f)) if l.strip())
            if n > 80: bad.append(f"{a}: {f} has {n} lines (max 80): merge or drop stale lessons")
print("\n".join(bad) if bad else "agent memory ok"); sys.exit(1 if bad else 0)
