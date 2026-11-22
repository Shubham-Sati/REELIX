// reelix <video-name> : asks 5 questions (or continues a stopped video of the same name), creates the video folder, runs the whole pipeline.
// Flags skip the questions:  --about "..." --format short|video --length <length> --style explainer|animated --look painted|cartoon|aimotion|toy3d --yes
//   --captions: draw word captions on the video (off by default; --no-captions says off on purpose). It is not a question.
//   --no-music: no background music (music is on by default; --music says on on purpose). It is not a question.
//   --length: a short takes 30, 60, 90 or 120 (seconds, only these); a video takes standard, long or deep (about 2.5, 5, 10 minutes)
//   or your own length in minutes (--length 7). The questions offer the presets (config/formats.json <format>.lengths).
import { spawn } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "node:fs"; import path from "node:path";
import { J, newVideo, slug, readJson, findVideo, lengthFor } from "./common.mjs";
const LOOKS = readJson(J("config", "looks.json"));
const FORMATS = readJson(J("config", "formats.json"));   // each format lists the lengths it offers

const a = process.argv.slice(2); const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const SWITCHES = ["--yes", "--new", "--captions", "--no-captions", "--music", "--no-music"];   // flags without a value
const name = a.find((x, i) => !x.startsWith("--") && !(i > 0 && a[i - 1].startsWith("--") && !SWITCHES.includes(a[i - 1])));
if (!name) { console.log(`\n  ${pc.bold("usage:")} reelix <video-name>\n`); process.exit(1); }

const bail = (v) => { if (p.isCancel(v)) { p.cancel("Cancelled. Nothing was started."); process.exit(0); } return v; };
/** The looks a style can use (a look lists its styles; "planned" looks are not offered yet). */
const looksFor = (style, dim) => Object.entries(LOOKS).filter(([k, l]) => !k.startsWith("_") && !l.planned && l.dim === dim && (l.styles || ["explainer", "animated"]).includes(style))
  .sort(([, x], [, y]) => (y.best === style ? 1 : 0) - (x.best === style ? 1 : 0));   // the look made for this style is offered first
const dimsFor = (style) => Object.entries(LOOKS._dims).filter(([k]) => looksFor(style, k).length);
let TOTAL = 5;
const step = (n, text) => p.log.step(`${pc.dim(`Question ${n} of ${TOTAL}`)}  ${pc.bold(text)}`);
const rec = (l) => `${l} ${pc.green("(recommended)")}`;
const BACK = "__back"; const back = { value: BACK, label: pc.yellow("← Back to the previous question"), hint: "change your last answer" };

// Same name again = continue that video (any day). Finished steps are kept; no questions.
const existing = findVideo(name);
if (existing && !a.includes("--new")) {
  const done = fs.existsSync(path.join(existing, "final.mp4")) && fs.existsSync(path.join(existing, "lessons.md"));
  p.intro(pc.bgCyan(pc.black(` reelix · ${done ? "already made" : "continuing"}: ${slug(name)} `)));
  // deleted in FE-Reelix (deleted.json in the folder): the folder is kept, but it is not continued by accident
  if (fs.existsSync(path.join(existing, "deleted.json"))) { p.outro(`This video was deleted in FE-Reelix (its folder is kept: ${pc.dim(existing)}).\n  To use it again, delete its deleted.json. For a new video, pick a new name: reelix ${slug(name)}-2`); process.exit(0); }
  if (done) { p.outro(`This video is finished: ${pc.dim(existing)}\n  To make it again under a new name: reelix ${slug(name)}-2`); process.exit(0); }
  p.outro(`Continuing from where it stopped. ${pc.dim(existing)}`);
  const run = spawn(process.execPath, [J("cli", "pipeline.mjs"), existing], { stdio: "inherit" });
  run.on("close", (c) => process.exit(c));
} else {
p.intro(pc.bgCyan(pc.black(` reelix · new video: ${slug(name)} `)));
p.log.message(pc.dim("Answer a few questions. Use ↑ ↓ and Enter. Choose “← Back” (or type <) to fix an earlier answer. Ctrl-C cancels."));
const A = { about: get("--about"), format: get("--format"), style: get("--style"), look: get("--look"), length: get("--length"),
  captions: a.includes("--captions") && !a.includes("--no-captions"),   // captions on the video: off unless asked for
  music: !a.includes("--no-music") };   // background music: on unless switched off
if (A.length && A.format && !lengthFor(A.format, A.length)) {
  const [lo, hi] = FORMATS[A.format]?.targetSec || [];
  p.cancel(`--length for a ${A.format} must be ${Object.keys(FORMATS[A.format]?.lengths || {}).join(", ")}${A.format === "video" ? ` or your own length from ${lo / 60} to ${hi / 60} minutes (for example 7)` : " (seconds)"}`); process.exit(1); }
A.dim = A.look ? LOOKS[A.look]?.dim : undefined;
const Q = [
  async () => { step(1, "What should this video be about?"); const v = bail(await p.text({ message: " ", placeholder: "e.g. How the hot air balloon was invented", initialValue: A.about, validate: (x) => (String(x || "").trim().length < 5 ? "Write a sentence about the video" : undefined) })); A.about = v.trim(); },
  async () => { step(2, "Is this a video or a short?"); const v = bail(await p.select({ message: " ", initialValue: A.format || "video", options: [
    { value: "video", label: rec("Video"), hint: "16:9 landscape, minutes long (YouTube)" }, { value: "short", label: "Short", hint: "9:16 vertical, under 60 s (Shorts, Reels)" }, back] })); if (v === BACK) return BACK; A.format = v;
    // then how long it should be: a short picks seconds, a video picks minutes. Back here returns to "video or short?"
    const LS = FORMATS[v]?.lengths || {};
    if (!Object.keys(LS).length) { A.length = undefined; return; }
    p.log.step(`${pc.dim(`Question 2 of ${TOTAL}, part 2`)}  ${pc.bold(`How long should the ${v} be?`)}`);
    const L = bail(await p.select({ message: " ", initialValue: lengthFor(v, A.length)?.key in LS ? lengthFor(v, A.length).key : Object.keys(LS)[0], options: [
      ...Object.entries(LS).map(([k, l], i) => ({ value: k, label: i === 0 ? rec(l.label) : l.label, hint: l.hint })), back] }));
    if (L === BACK) return Q[1]();
    A.length = L; },
  async () => { step(3, "What style?"); const v = bail(await p.select({ message: " ", initialValue: A.style || "explainer", options: [
    { value: "explainer", label: rec("Explainer / Tutorial"), hint: "narrator teaches with clear diagrams and labels" },
    { value: "animated", label: "Animated / Motion Graphics", hint: "cinematic animated scenes, kinetic text" }, back] })); if (v === BACK) return BACK; A.style = v; },
  async () => {   // only the dimensions this style can use; if it has just one, take it and move on
    const dims = dimsFor(A.style); TOTAL = dims.length > 1 ? 5 : 4;
    if (dims.length < 2) { if (A.dim !== dims[0][0]) A.look = undefined; A.dim = dims[0][0]; return; }
    step(4, "2D or 3D?"); const v = bail(await p.select({ message: " ", initialValue: dims.some(([k]) => k === A.dim) ? A.dim : dims[0][0], options: [
      ...dims.map(([k, d], i) => ({ value: k, label: i === 0 ? rec(d.label) : d.label, hint: d.hint })), back] })); if (v === BACK) return BACK;
    if (v !== A.dim) A.look = undefined; A.dim = v; },
  async () => { const opts = looksFor(A.style, A.dim); step(TOTAL, "Which look?");
    const v = bail(await p.select({ message: " ", initialValue: opts.some(([k]) => k === A.look) ? A.look : opts[0][0], options: [
    ...opts.map(([k, l], i) => ({ value: k, label: i === 0 ? rec(l.label) : l.label, hint: l.hint })), back] })); if (v === BACK) return BACK; A.look = v; },
];
if (!A.look && A.about && A.format && A.style && a.includes("--yes")) { A.look = looksFor(A.style, dimsFor(A.style)[0][0])[0][0]; A.dim = LOOKS[A.look].dim; }   // flag-only commands: the first look this style can use
// ask only from the first unanswered question (e.g. a picked idea already has about/format/style: just ask the look)
if (A.style) TOTAL = dimsFor(A.style).length > 1 ? 5 : 4;   // flag-only runs: show the right question count
const first = [A.about, A.format, A.style, A.dim, A.look].findIndex((x) => !x);
if (first >= 0) for (let i = first; i < Q.length;) { i = (await Q[i]()) === BACK ? Math.max(0, i - 1) : i + 1; }
else { const Ls = [["What should this video be about?", A.about], ["Is this a video or a short?", `${A.format === "short" ? "Short · 9:16 vertical" : "Video · 16:9"} · ${(lengthFor(A.format, A.length) || lengthFor(A.format)).label}`], ["What style?", A.style === "animated" ? "Animated / Motion Graphics" : "Explainer / Tutorial"], ...(TOTAL > 4 ? [["2D or 3D?", LOOKS._dims[A.dim]?.label]] : []), ["Which look?", LOOKS[A.look]?.label || A.look]];
  p.log.message(pc.dim(`Captions on the video: ${A.captions ? "on" : "off"}${A.captions ? "" : " (add --captions to show them)"}`));
  p.log.message(pc.dim(`Background music: ${A.music ? "on (add --no-music to leave it out)" : "off"}`));
  Ls.forEach(([q, v], i) => p.log.step(`${pc.dim(`Question ${i + 1} of ${Ls.length}`)}  ${pc.bold(q)}\n${v}`)); }

const ok = a.includes("--yes") || bail(await p.confirm({ message: "Start making this video?", initialValue: true }));
if (!ok) { p.cancel("Not started."); process.exit(0); }
const dir = newVideo(name, A.about, A.format, A.style, A.look, A.length, A.captions, A.music);
p.outro(`Started. You can leave this running. ${pc.dim(dir)}`);
const run = spawn(process.execPath, [J("cli", "pipeline.mjs"), dir], { stdio: "inherit" });
run.on("close", (c) => process.exit(c));
}
