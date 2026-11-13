// reelix <video-name> : asks 3 questions, creates the video folder, runs the whole pipeline.
// Flags skip the questions:  --about "..." --format short|video --style explainer|animated --yes
import { spawn } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { J, newVideo, slug } from "./common.mjs";

const a = process.argv.slice(2); const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const name = a.find((x, i) => !x.startsWith("--") && !(i > 0 && a[i - 1].startsWith("--") && a[i - 1] !== "--yes"));
if (!name) { console.log(`\n  ${pc.bold("usage:")} reelix <video-name>\n`); process.exit(1); }

const bail = (v) => { if (p.isCancel(v)) { p.cancel("Cancelled. Nothing was started."); process.exit(0); } return v; };
const step = (n, text) => p.log.step(`${pc.dim(`Question ${n} of 3`)}  ${pc.bold(text)}`);
const rec = (l) => `${l} ${pc.green("(recommended)")}`;
const BACK = "__back"; const back = { value: BACK, label: pc.yellow("← Back to the previous question"), hint: "change your last answer" };

p.intro(pc.bgCyan(pc.black(` reelix · new video: ${slug(name)} `)));
p.log.message(pc.dim("Answer 3 questions. Use ↑ ↓ and Enter. Choose “← Back” (or type <) to fix an earlier answer. Ctrl-C cancels."));
const A = { about: get("--about"), format: get("--format"), style: get("--style") };
const Q = [
  async () => { step(1, "What should this video be about?"); const v = bail(await p.text({ message: " ", placeholder: "e.g. How the hot air balloon was invented", initialValue: A.about, validate: (x) => (String(x || "").trim().length < 5 ? "Write a sentence about the video" : undefined) })); A.about = v.trim(); },
  async () => { step(2, "Is this a video or a short?"); const v = bail(await p.select({ message: " ", initialValue: A.format || "video", options: [
    { value: "video", label: rec("Video"), hint: "16:9 landscape, minutes long (YouTube)" }, { value: "short", label: "Short", hint: "9:16 vertical, under 60 s (Shorts, Reels)" }, back] })); if (v === BACK) return BACK; A.format = v; },
  async () => { step(3, "What style?"); const v = bail(await p.select({ message: " ", initialValue: A.style || "explainer", options: [
    { value: "explainer", label: rec("Explainer / Tutorial"), hint: "narrator teaches with clear diagrams and labels" },
    { value: "animated", label: "Animated / Motion Graphics", hint: "cinematic animated scenes, kinetic text" }, back] })); if (v === BACK) return BACK; A.style = v; },
];
if (!(A.about && A.format && A.style)) for (let i = 0; i < Q.length;) { i = (await Q[i]()) === BACK ? Math.max(0, i - 1) : i + 1; }
else { p.log.step(`${pc.dim("Question 1 of 3")}  ${pc.bold("What should this video be about?")}\n${A.about}`); p.log.step(`${pc.dim("Question 2 of 3")}  ${pc.bold("Is this a video or a short?")}\n${A.format === "short" ? "Short · 9:16 vertical" : "Video · 16:9"}`); p.log.step(`${pc.dim("Question 3 of 3")}  ${pc.bold("What style?")}\n${A.style === "animated" ? "Animated / Motion Graphics" : "Explainer / Tutorial"}`); }

const ok = a.includes("--yes") || bail(await p.confirm({ message: "Start making this video?", initialValue: true }));
if (!ok) { p.cancel("Not started."); process.exit(0); }
const dir = newVideo(name, A.about, A.format, A.style);
p.outro(`Started. You can leave this running. ${pc.dim(dir)}`);
const run = spawn(process.execPath, [J("cli", "pipeline.mjs"), dir], { stdio: "inherit" });
run.on("close", (c) => process.exit(c));
