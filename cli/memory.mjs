// Keeps agent memory tidy without a human: runs tools/memory_check.py and, if it finds problems,
// asks the producer agent to split/merge (topic files + one pointer line in MEMORY.md), then checks again.
//   node cli/memory.mjs            (also run automatically at the end of every video)
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ROOT, J, findClaude } from "./common.mjs";

const check = () => { const r = spawnSync("python3", [J("tools", "memory_check.py")], { encoding: "utf8" }); return { ok: r.status === 0, out: r.stdout.trim() }; };

export function tidyMemory(log = console.log) {
  for (let round = 1; round <= 2; round++) {
    const c = check(); if (c.ok) { log(c.out); return true; }
    log(`memory needs tidying (round ${round}):\n${c.out}`);
    const task = `Memory tidy job. tools/memory_check.py found these problems in .claude/agent-memory:\n${c.out}\n` +
      `Fix them following the 'Memory growth' rule in CLAUDE.md: move the crowded topic's lessons out of MEMORY.md into a topic file in the same agent folder ` +
      `(short kebab-case name, e.g. 3d-scenes.md; start it with "# <agent>: <topic>" and keep each lesson one line), merge duplicates, drop lessons that are out of date, ` +
      `and leave exactly one pointer line in MEMORY.md like "- 3D scenes: see 3d-scenes.md (read before building custom scenes)". Never lose a still-useful lesson. ` +
      `Then run python3 tools/memory_check.py and repeat until it prints "agent memory ok".`;
    const r = spawnSync(findClaude(), ["-p", task, "--agent", "producer", "--allowedTools", "Read", "Write", "Edit", "Bash", "Glob", "Grep", "--permission-mode", "acceptEdits"], { cwd: ROOT, encoding: "utf8" });
    log(r.stdout?.trim().split("\n").slice(-3).join("\n"));
  }
  const c = check(); log(c.out); return c.ok;
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(tidyMemory() ? 0 : 1);
