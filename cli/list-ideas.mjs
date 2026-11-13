// reelix list-ideas [count]   (alias: saved-ideas)
// Lists saved ideas (from earlier `reelix viral-ideas` runs) that have no finished video yet, oldest first,
// and can start a video from one. Default 5.
import fs from "node:fs"; import path from "node:path";
import * as p from "@clack/prompts"; import pc from "picocolors";
import { J, readJson } from "./common.mjs";
import { printIdeas, pickAndStart, videoMade, videoStarted } from "./ideas-common.mjs";

const a = process.argv.slice(2).filter((x) => x !== "list-ideas" && x !== "saved-ideas");
const N = Math.min(50, Math.max(1, Number(a.find((x) => /^\d+$/.test(x)) || 5)));
const D = J("ideas");
const files = fs.existsSync(D) ? fs.readdirSync(D).filter((f) => f.endsWith(".json") && !f.endsWith(".evidence.json"))
  .map((f) => ({ f, t: fs.statSync(path.join(D, f)).mtimeMs })).sort((x, y) => x.t - y.t) : [];   // oldest list first

// the same story can come back from two runs under different names: treat titles sharing most of their words as one idea
const words = (t) => new Set(String(t).toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter((w) => w.length > 3));
const same = (a, b) => { const A = words(a), B = words(b); const n = [...A].filter((w) => B.has(w)).length; return n >= 3 && n / Math.min(A.size, B.size) >= 0.6; };
const seen = new Set(), all = [];
for (const { f } of files) {
  const R = readJson(path.join(D, f)); if (!R?.ideas) continue;
  const topic = R.topic && !/^none/i.test(R.topic) ? R.topic : "channel niche";
  for (const d of R.ideas) {
    if (!d?.name || seen.has(d.name) || all.some((x) => same(x.title + " " + x.about, d.title + " " + d.about))) continue; seen.add(d.name);
    all.push({ ...d, topic, saved: R.made || f.slice(0, 10), file: f });
  }
}
const waiting = all.filter((d) => !videoMade(d.name));

p.intro(pc.bgMagenta(pc.black(" reelix · saved ideas ")));
if (!waiting.length) {
  p.outro(all.length ? "Every saved idea already has a video. Find new ones: reelix viral-ideas" : "No saved ideas yet. Find some: reelix viral-ideas");
  process.exit(0);
}
const show = waiting.slice(0, N);
p.log.message(`Showing ${pc.bold(String(show.length))} of ${pc.bold(String(waiting.length))} idea${waiting.length > 1 ? "s" : ""} without a video yet ${pc.dim("(oldest first)")}` +
  (waiting.length > show.length ? pc.dim(`  ·  more: reelix list-ideas ${waiting.length}`) : ""));
printIdeas(show, (d) => `Saved ${d.saved} · ${d.topic}${videoStarted(d.name) ? " · video started, not finished (picking it continues it)" : ""}`);
await pickAndStart(show);
