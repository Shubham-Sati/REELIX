// reelix <video-name> : asks 5 questions (or continues a stopped video of the same name), creates the video folder, runs the whole pipeline.
// Flags skip the questions:  --about "..." --format short|video --style explainer|animated --look painted|cartoon|aimotion|toy3d --yes
import { spawn } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "node:fs"; import path from "node:path";
import { J, newVideo, slug, readJson, findVideo } from "./common.mjs";
const LOOKS = readJson(J("config", "looks.json"));

const a = process.argv.slice(2); const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const name = a.find((x, i) => !x.startsWith("--") && !(i > 0 && a[i - 1].startsWith("--") && a[i - 1] !== "--yes"));
if (!name) { console.log(`\n  ${pc.bold("usage:")} reelix <video-name>\n`); process.exit(1); }

const bail = (v) => { if (p.isCancel(v)) { p.cancel("Cancelled. Nothing was started."); process.exit(0); } return v; };
const step = (n, text) => p.log.step(`${pc.dim(`Question ${n} of 5`)}  ${pc.bold(text)}`);
const rec = (l) => `${l} ${pc.green("(recommended)")}`;
const BACK = "__back"; const back = { value: BACK, label: pc.yellow("← Back to the previous question"), hint: "change your last answer" };

// Same name again = continue that video (any day). Finished steps are kept; no questions.
const existing = findVideo(name);
if (existing && !a.includes("--new")) {
  const done = fs.existsSync(path.join(existing, "final.mp4")) && fs.existsSync(path.join(existing, "lessons.md"));
  p.intro(pc.bgCyan(pc.black(` reelix · ${done ? "already made" : "continuing"}: ${slug(name)} `)));
  if (done) { p.outro(`This video is finished: ${pc.dim(existing)}\n  To make it again under a new name: reelix ${slug(name)}-2`); process.exit(0); }
  p.outro(`Continuing from where it stopped. ${pc.dim(existing)}`);
  const run = spawn(process.execPath, [J("cli", "pipeline.mjs"), existing], { stdio: "inherit" });
  run.on("close", (c) => process.exit(c));
} else {
p.intro(pc.bgCyan(pc.black(` reelix · new video: ${slug(name)} `)));
p.log.message(pc.dim("Answer 5 questions. Use ↑ ↓ and Enter. Choose “← Back” (or type <) to fix an earlier answer. Ctrl-C cancels."));
const A = { about: get("--about"), format: get("--format"), style: get("--style"), look: get("--look") };
A.dim = A.look ? LOOKS[A.look]?.dim : undefined;
const Q = [
  async () => { step(1, "What should this video be about?"); const v = bail(await p.text({ message: " ", placeholder: "e.g. How the hot air balloon was invented", initialValue: A.about, validate: (x) => (String(x || "").trim().length < 5 ? "Write a sentence about the video" : undefined) })); A.about = v.trim(); },
  async () => { step(2, "Is this a video or a short?"); const v = bail(await p.select({ message: " ", initialValue: A.format || "video", options: [
    { value: "video", label: rec("Video"), hint: "16:9 landscape, minutes long (YouTube)" }, { value: "short", label: "Short", hint: "9:16 vertical, under 60 s (Shorts, Reels)" }, back] })); if (v === BACK) return BACK; A.format = v; },
  async () => { step(3, "What style?"); const v = bail(await p.select({ message: " ", initialValue: A.style || "explainer", options: [
    { value: "explainer", label: rec("Explainer / Tutorial"), hint: "narrator teaches with clear diagrams and labels" },
    { value: "animated", label: "Animated / Motion Graphics", hint: "cinematic animated scenes, kinetic text" }, back] })); if (v === BACK) return BACK; A.style = v; },
  async () => { step(4, "2D or 3D?"); const v = bail(await p.select({ message: " ", initialValue: A.dim || "2d", options: [
    ...Object.entries(LOOKS._dims).map(([k, d], i) => ({ value: k, label: i === 0 ? rec(d.label) : d.label, hint: d.hint })), back] })); if (v === BACK) return BACK;
    if (v !== A.dim) A.look = undefined; A.dim = v; },
  async () => { step(5, "Which look?"); const opts = Object.entries(LOOKS).filter(([k, l]) => !k.startsWith("_") && l.dim === A.dim);
    const v = bail(await p.select({ message: " ", initialValue: A.look || opts[0][0], options: [
    ...opts.map(([k, l], i) => ({ value: k, label: i === 0 ? rec(l.label) : l.label, hint: l.hint })), back] })); if (v === BACK) return BACK; A.look = v; },
];
if (!A.look && A.about && A.format && A.style && a.includes("--yes")) { A.look = "painted"; A.dim = "2d"; }   // old flag-only commands keep working
// ask only from the first unanswered question (e.g. a picked idea already has about/format/style: just ask the look)
const first = [A.about, A.format, A.style, A.dim, A.look].findIndex((x) => !x);
if (first >= 0) for (let i = first; i < Q.length;) { i = (await Q[i]()) === BACK ? Math.max(0, i - 1) : i + 1; }
else { p.log.step(`${pc.dim("Question 1 of 5")}  ${pc.bold("What should this video be about?")}\n${A.about}`); p.log.step(`${pc.dim("Question 2 of 5")}  ${pc.bold("Is this a video or a short?")}\n${A.format === "short" ? "Short · 9:16 vertical" : "Video · 16:9"}`); p.log.step(`${pc.dim("Question 3 of 5")}  ${pc.bold("What style?")}\n${A.style === "animated" ? "Animated / Motion Graphics" : "Explainer / Tutorial"}`); p.log.step(`${pc.dim("Question 4 of 5")}  ${pc.bold("2D or 3D?")}\n${LOOKS._dims[A.dim]?.label}`); p.log.step(`${pc.dim("Question 5 of 5")}  ${pc.bold("Which look?")}\n${LOOKS[A.look]?.label || A.look}`); }

const ok = a.includes("--yes") || bail(await p.confirm({ message: "Start making this video?", initialValue: true }));
if (!ok) { p.cancel("Not started."); process.exit(0); }
const dir = newVideo(name, A.about, A.format, A.style, A.look);
p.outro(`Started. You can leave this running. ${pc.dim(dir)}`);
const run = spawn(process.execPath, [J("cli", "pipeline.mjs"), dir], { stdio: "inherit" });
run.on("close", (c) => process.exit(c));
}
