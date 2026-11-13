// reelix viral-ideas [count] [topic words...]
// Finds viral YouTube Video/Shorts ideas backed by live view data, prints them, and can start a video from one.
//   reelix viral-ideas                    5 ideas in the channel niche (config/voice.md)
//   reelix viral-ideas 10                 10 ideas
//   reelix viral-ideas 10 space history   10 ideas about space history
import fs from "node:fs"; import path from "node:path"; import { spawn } from "node:child_process";
import * as p from "@clack/prompts"; import pc from "picocolors";
import { ROOT, J, slug, today, readJson, findClaude, fmtDur } from "./common.mjs";
import { printIdeas, ideasMd, pickAndStart } from "./ideas-common.mjs";

const a = process.argv.slice(2).filter((x) => x !== "viral-ideas");
const ti = a.indexOf("--topic"); let topicArg = ti >= 0 ? a.splice(ti, 2)[1] : "";
const num = a.find((x) => /^\d+$/.test(x)); const N = Math.min(25, Math.max(1, Number(num || 5)));
const topic = (topicArg || a.filter((x) => x !== num && !x.startsWith("--")).join(" ")).trim();
const TTY = process.stdout.isTTY;
const DIR = J("ideas"); fs.mkdirSync(DIR, { recursive: true });
const base = path.join(DIR, `${today()}-${slug(topic || "channel-niche")}-${N}`);
const evidence = `${base}.evidence.json`, out = `${base}.json`;
const LOG = `${base}.log`;

p.intro(pc.bgMagenta(pc.black(` reelix · viral ideas `)));
p.log.message(`${pc.bold(String(N))} idea${N > 1 ? "s" : ""} ${topic ? `about ${pc.bold(topic)}` : `in your channel niche ${pc.dim("(config/voice.md)")}`} · YouTube Videos + Shorts`);

/* progress: two stages with estimates, shown as % and time left */
const stages = [{ label: "Searching YouTube for what gets views now", est: 40 }, { label: "Finding angles and writing ideas", est: 150 + N * 8 }];
let si = 0, sub = "", t0 = Date.now(), st0 = Date.now();
const status = () => { const total = stages.reduce((s, x) => s + x.est, 0); const done = stages.slice(0, si).reduce((s, x) => s + x.est, 0) + Math.min(stages[si].est * 0.95, (Date.now() - st0) / 1000);
  const left = Math.max(5, total - done); return `${stages[si].label}${sub ? pc.dim(` · ${sub}`) : ""}  ${pc.cyan(`${Math.min(99, Math.round((done / total) * 100))}%`)}  ${pc.dim(`~${fmtDur(left)} left`)}`; };
const sp = TTY ? p.spinner() : null; let lastLog = 0;
const show = () => { if (sp) sp.message(status()); else if (Date.now() - lastLog > 30000) { lastLog = Date.now(); console.log(`  ${status().replace(/\x1b\[[0-9;]*m/g, "")}`); } };
const run = (cmd, args, onLine) => new Promise((res, rej) => { const log = fs.createWriteStream(LOG, { flags: "a" });
  const c = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, PYTHONUNBUFFERED: "1" } });
  const feed = (d) => { log.write(d); String(d).split("\n").filter(Boolean).forEach((l) => onLine && onLine(l)); };
  c.stdout.on("data", feed); c.stderr.on("data", feed); c.on("close", (code) => (code === 0 ? res() : rej(new Error(`${path.basename(cmd)} exited ${code} (log: ${path.relative(ROOT, LOG)})`)))); });

if (sp) sp.start(status()); else console.log(`  ${status().replace(/\x1b\[[0-9;]*m/g, "")}`);
const timer = setInterval(show, 1000);
try {
  const niche = (fs.readFileSync(J("config", "voice.md"), "utf8").match(/Niche search words[^:]*:\s*(.+)/) || [])[1] || "history, science";
  stages[0].est = 35 * (topic || niche).split(",").length;
  if (!fs.existsSync(evidence)) await run("python3", [J("tools", "trends.py"), topic || niche, evidence], (l) => { const m = /^step \d\/4 (.*)/.exec(l); if (m) sub = m[1]; });
  si = 1; st0 = Date.now(); sub = "";
  const claude = findClaude(); if (!claude) throw new Error("Claude Code not found: install it or open the Claude desktop app once.");
  const task = `Ideas job. Topic: ${topic ? JSON.stringify(topic) : "none (use the niche in config/voice.md)"}. N = ${N}. Evidence file: ${path.relative(ROOT, evidence)}. Write the ideas JSON to ${path.relative(ROOT, out)}. Do not repeat ideas already saved in ideas/*.json (other files) or already made in videos/: every idea must be new.`;
  await run(claude, ["-p", task, "--agent", "idea-scout", "--allowedTools", "Read", "Write", "Glob", "Bash", "WebSearch", "WebFetch", "--permission-mode", "acceptEdits", "--output-format", "text"],
    (l) => { if (/search/i.test(l) && l.length < 120) sub = l.trim().slice(0, 60); });
} catch (e) { clearInterval(timer); sp ? sp.stop(pc.red(e.message), 1) : console.log(e.message); process.exit(1); }
clearInterval(timer);
const R = readJson(out);
if (!R?.ideas?.length) { sp ? sp.stop(pc.red("No ideas came back."), 1) : console.log("No ideas came back."); console.log(`  See ${path.relative(ROOT, LOG)}`); process.exit(1); }
const ideas = R.ideas.slice(0, N);
if (!R.topic || /^none/i.test(R.topic)) { R.topic = topic || "channel niche"; fs.writeFileSync(out, JSON.stringify(R, null, 1)); }
sp ? sp.stop(`${pc.green("Done")} in ${fmtDur((Date.now() - t0) / 1000)}`) : console.log(`  Done in ${fmtDur((Date.now() - t0) / 1000)}`);

/* print, save, pick */
printIdeas(ideas);
fs.writeFileSync(`${base}.md`, ideasMd(ideas, `Viral ideas: ${topic || "channel niche"} (${today()})`));
p.log.info(`Saved: ${pc.dim(path.relative(ROOT, `${base}.md`))}`);
await pickAndStart(ideas, topic);
