// The REELIX pipeline: brief.json -> final.mp4 + thumbnail.png + youtube.md.
//   node cli/pipeline.mjs <video-folder>
// Each stage writes one file; a stage whose file already exists is skipped, so a re-run continues where it stopped.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import pc from "picocolors";
import { ROOT, J, readJson, findClaude, fmtDur } from "./common.mjs";
import { panel, draw } from "./ui.mjs";
import { tidyMemory } from "./memory.mjs";

const VD = path.resolve(process.argv[2] || "");
if (!fs.existsSync(path.join(VD, "brief.json"))) { console.error("usage: node cli/pipeline.mjs <video-folder with brief.json>"); process.exit(1); }
const B = readJson(path.join(VD, "brief.json"));
const V = (...p) => path.join(VD, ...p);
const LOG = V("logs"); fs.mkdirSync(LOG, { recursive: true });
fs.mkdirSync(V("assets", "images"), { recursive: true }); fs.mkdirSync(V("project"), { recursive: true });
const PY = "python3", T = (f) => J("tools", f);
const CLAUDE = findClaude();
const rel = (p) => path.relative(ROOT, p);

/* ---------------------------------------------------------------- running things */
function sh(cmd, args, logName, onLine) {
  return new Promise((res, rej) => {
    const log = fs.createWriteStream(path.join(LOG, logName), { flags: "a" });
    const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    const feed = (d) => { log.write(d); if (onLine) String(d).split("\n").filter(Boolean).forEach(onLine); };
    p.stdout.on("data", feed); p.stderr.on("data", feed);
    p.on("close", (c) => { log.end(); c === 0 ? res() : rej(new Error(`${path.basename(cmd)} exited ${c} (see ${rel(path.join(LOG, logName))})`)); });
  });
}
/** Run one Claude Code agent headless in the REELIX folder. */
function agent(name, task, logName) {
  if (!CLAUDE) throw new Error("Claude Code CLI not found. Install it or open the Claude desktop app once.");
  const tools = "Read Write Edit Glob Grep Bash WebSearch WebFetch";
  return sh(CLAUDE, ["-p", task, "--agent", name, "--allowedTools", ...tools.split(" "), "--permission-mode", "acceptEdits", "--output-format", "text"], logName);
}

/* ---------------------------------------------------------------- stages */
const shots = () => (readJson(V("storyboard.json"))?.scenes || []).flatMap((s) => s.shots.map((sh, k) => ({ scene: s.id, k, ...sh })));
const shotFile = (s) => V("assets", "images", `s${s.scene}_${s.k}.png`);
const sb = () => readJson(V("storyboard.json"));
const prompt = (s) => {
  const S = sb(); const chars = Object.entries(S.characters || {}).filter(([n]) => s.imagePrompt.includes(n)).map(([n, d]) => `${n}: ${d}`).join("; ");
  return `${s.imagePrompt}${chars ? `. ${chars}` : ""}. ${S.styleLine}`;
};

const STEPS = ["Research & script", "Storyboard & pictures", "Voice, captions & music", "Animate, render & review", "Thumbnail, upload text & memory"];
const items = [
  { id: "script", step: 0, label: "Research facts + write script", est: 240, out: "script.json",
    run: () => agent("script-writer", `Video folder: ${rel(VD)}. Read brief.json there and write research.md and script.json as your instructions say.`, "1-script.log") },
  { id: "board", step: 1, label: "Storyboard (scenes, shots)", est: 120, out: "storyboard.json",
    run: () => agent("storyboard-artist", `Video folder: ${rel(VD)}. Write storyboard.json from brief.json and script.json.`, "2-storyboard.log") },
  { id: "images", step: 1, label: "Draw pictures (FLUX)", est: 300, out: null,
    run: async (it) => {
      const all = shots(); it.est = Math.max(60, all.length * 75);
      for (const [i, s] of all.entries()) {
        it.detail = `picture ${i + 1} of ${all.length}`; it.frac = i / all.length;
        if (!fs.existsSync(shotFile(s))) await sh(PY, [T("image.py"), prompt(s), shotFile(s), String(B.imageW), String(B.imageH), String(s.seed ?? 7 + i)], "3-images.log");
      }
    } },
  { id: "check", step: 1, label: "Check pictures, redraw bad ones", est: 180, out: "image-review.json",
    run: async (it) => {
      await agent("visual-artist", `Video folder: ${rel(VD)}. Check the images and write image-review.json.`, "4-image-check.log");
      const redo = readJson(V("image-review.json"))?.redo || [];
      const S = sb();
      for (const [i, r] of redo.entries()) {
        it.detail = `redrawing ${i + 1} of ${redo.length}: ${r.reason || ""}`.slice(0, 70);
        const shot = S.scenes.find((x) => x.id === r.scene)?.shots[r.shot]; if (!shot) continue;
        shot.imagePrompt = r.imagePrompt || shot.imagePrompt; shot.seed = r.seed ?? (shot.seed || 7) + 100;
        fs.writeFileSync(V("storyboard.json"), JSON.stringify(S, null, 1));
        await sh(PY, [T("image.py"), prompt({ scene: r.scene, k: r.shot, ...shot }), shotFile({ scene: r.scene, k: r.shot }), String(B.imageW), String(B.imageH), String(shot.seed)], "4-image-check.log");
      }
    } },
  { id: "layers", step: 1, label: "Cut out 2.5D layers (Apple Vision)", est: 15, out: null,
    run: async (it) => {
      const par = shots().filter((s) => s.engine === "parallax");
      for (const [i, s] of par.entries()) {
        it.detail = `layer ${i + 1} of ${par.length}`; const fg = shotFile(s).replace(".png", "_fg.png");
        try { await sh("bash", [T("cutout.sh"), shotFile(s), fg], "4b-layers.log"); } catch { /* no subject found: scene falls back to a plain picture */ }
      }
    } },
  { id: "voice", step: 2, label: "Voiceover (Kokoro)", est: 90, out: "assets/voice.wav",
    run: (it) => sh(PY, [T("voice.py"), VD], "5-voice.log", (l) => { const m = /^line (\d+)\/(\d+)/.exec(l); if (m) { it.frac = m[1] / m[2]; it.detail = l; } }) },
  { id: "captions", step: 2, label: "Word-by-word captions (whisper)", est: 30, out: "assets/captions.json",
    run: () => sh(PY, [T("captions.py"), VD], "6-captions.log") },
  { id: "music", step: 2, label: "Background music (ACE-Step)", est: 180, out: "assets/music.wav", optional: true,
    run: () => sh(PY, [T("music.py"), VD, sb().musicPrompt, String(Math.ceil(readJson(V("assets", "lines.json")).durationSec + 1.5))], "7-music.log") },
  { id: "sfx", step: 2, label: "Sound effects on the hits", est: 90, out: "assets/sfx.json", optional: true,
    run: () => agent("sound-designer", `Video folder: ${rel(VD)}. Write assets/sfx.json.`, "7b-sfx.log") },
  { id: "build3d", step: 3, label: "Code 3D / motion scenes", est: 300, out: null,
    run: async (it) => {
      const cs = shots().filter((s) => s.engine === "custom" && !fs.existsSync(V("project", "custom", `S${s.scene}_${s.k}.tsx`)));
      if (!cs.length) return;
      it.detail = `${cs.length} scene(s)`;
      await agent("animator", `Video folder: ${rel(VD)}. Build job: write the custom scenes for these shots: ${cs.map((s) => `S${s.scene}_${s.k}`).join(", ")}.`, "8b-build3d.log");
    } },
  { id: "timeline", step: 3, label: "Build timeline", est: 5, out: "project/timeline.json", run: () => buildTimeline() },
  { id: "render", step: 3, label: "Render video (Remotion)", est: 150, out: "final.mp4",
    run: (it) => sh("bash", [T("render.sh"), VD], "9-render.log", (l) => { const m = /(\d+)\/(\d+)/.exec(l); if (m) it.frac = m[1] / m[2]; }) },
  { id: "review", step: 3, label: "Fresh-eyes review (P0/P1/P2)", est: 240, out: "review.json",
    run: () => agent("reviewer", `Video folder: ${rel(VD)}. Review final.mp4 and write review.json.`, "10-review.log") },
  { id: "fix", step: 3, label: "Fix P0/P1 and re-render", est: 300, out: "review.md",
    run: async (it) => {
      const fx = (readJson(V("review.json"))?.fixes || []).filter((f) => f.rank === "P0" || f.rank === "P1");
      it.detail = `${fx.length} fix(es)`;
      await agent("animator", `Video folder: ${rel(VD)}. ${fx.length ? "Fix job: fix the P0 and P1 items in review.json, re-render, then do your self-check" : "Self-check job only (reviewer found no P0/P1)"}, and write review.md.`, "10b-fix.log");
    } },
  { id: "thumb", step: 4, label: "Thumbnail + YouTube text", est: 150, out: "thumbnail.png",
    run: async () => {
      if (!fs.existsSync(V("thumbnail.json"))) await agent("thumbnail-designer", `Video folder: ${rel(VD)}. Write thumbnail.json and youtube.md.`, "11-thumbnail.log");
      await sh(PY, [T("thumbnail.py"), VD], "11-thumbnail.log");
    } },
  { id: "memory", step: 4, label: "Agents save lessons to memory", est: 120, out: "lessons.md", optional: true,
    run: () => agent("producer", `Video folder: ${rel(VD)}. Memory job: read image-review.json, review.json, review.md and the logs, then add 1-3 specific new lessons to each relevant .claude/agent-memory/<agent>/MEMORY.md (no duplicates; follow the 'Memory growth' rule in CLAUDE.md: if a MEMORY.md nears 60 lines or one topic has 5+ lessons, move them into a topic file in that folder and leave a one-line pointer in MEMORY.md), and write lessons.md listing what you added.`, "12-memory.log").then(() => { const lines = []; tidyMemory((l) => lines.push(l)); fs.appendFileSync(path.join(LOG, "12-memory.log"), "\n" + lines.join("\n") + "\n"); }) },
].map((x) => ({ ...x, state: "waiting", frac: 0 }));

/** Scene timing comes from the voice: a scene starts with its first line; shots split the scene evenly. */
function buildTimeline() {
  const L = readJson(V("assets", "lines.json")), S = sb(), cap = readJson(V("assets", "captions.json"), []);
  const total = L.durationSec + 1.2;
  const starts = S.scenes.map((sc, i) => { const ls = L.lines.filter((l) => l.scene === sc.id); return i === 0 ? 0 : ls.length ? ls[0].start - 0.15 : null; });
  for (let i = 1; i < starts.length; i++) if (starts[i] == null) starts[i] = starts[i - 1] + 2;
  const scenes = [];
  S.scenes.forEach((sc, i) => {
    const a = starts[i], b = i + 1 < starts.length ? starts[i + 1] : total, d = (b - a) / sc.shots.length;
    sc.shots.forEach((sh, k) => {
      const fg = `images/s${sc.id}_${k}_fg.png`, eng = sh.engine || "image";
      const custom = eng === "custom" && fs.existsSync(V("project", "custom", `S${sc.id}_${k}.tsx`));
      const engine = eng === "parallax" ? (fs.existsSync(V("assets", fg)) ? "parallax" : "image") : eng === "custom" ? (custom ? "custom" : "image") : eng;
      scenes.push({ image: `images/s${sc.id}_${k}.png`, start: +(a + k * d).toFixed(3), duration: +d.toFixed(3), motion: sh.motion || "zoom-in", engine,
        ...(engine === "parallax" ? { fg } : {}), ...(engine === "kinetic" ? { text: sh.text || sc.label || "", sub: sh.sub || "" } : {}),
        ...(engine === "custom" ? { component: `S${sc.id}_${k}` } : {}), ...(k === 0 && sc.label ? { label: sc.label } : {}) });
    });
  });
  const lib = readJson(J("library", "sfx", "index.json"), []); fs.mkdirSync(V("assets", "sfx"), { recursive: true });
  const sfx = (readJson(V("assets", "sfx.json"), []) || []).map((x) => { const e = lib.find((l) => l.id === x.id); if (!e) return null;
    fs.copyFileSync(J("library", e.file), V("assets", e.file)); return { file: e.file, start: Math.max(0, +x.start), volume: x.volume ?? 0.4 }; }).filter(Boolean);
  const tl = { font: S.font || "Montserrat", sfx, width: B.width, height: B.height, fps: B.fps, title: B.title, accent: S.accent || "#FFB703", scenes, voice: "voice.wav",
    music: fs.existsSync(V("assets", "music.wav")) ? "music.wav" : null, musicVolume: 0.18, captions: cap, durationSec: +total.toFixed(2) };
  fs.writeFileSync(V("project", "timeline.json"), JSON.stringify(tl, null, 1));
}

/* ---------------------------------------------------------------- drive + draw */
const head = { name: B.name, summary: `${B.format === "short" ? "Short 9:16" : "Video 16:9"} · ${B.styleLabel}` };
let note = "", lastLog = 0;
const remaining = () => items.reduce((s, i) => s + (i.state === "waiting" ? i.est : i.state === "running" ? Math.max(0, i.est - (Date.now() - i.t0) / 1000) : 0), 0);
const pct = () => { const tot = items.reduce((s, i) => s + i.est, 0); return Math.round((items.reduce((s, i) => s + (["done", "skipped"].includes(i.state) ? i.est : i.state === "running" ? Math.min(0.95, Math.max(i.frac || 0, (Date.now() - i.t0) / 1000 / i.est)) * i.est : 0), 0) / tot) * 100); };
function tick(force = false) {
  for (const i of items) if (i.state === "running") { i.left = Math.max(0, i.est - (Date.now() - i.t0) / 1000); if (!i.frac || i.id !== "voice") i.frac = Math.max(i.frac || 0, Math.min(0.95, (Date.now() - i.t0) / 1000 / i.est)); }
  if (process.stdout.isTTY) draw(panel(head, STEPS, items, remaining(), note));
  else if (force || Date.now() - lastLog > 60000) { lastLog = Date.now(); const r = items.find((i) => i.state === "running"); console.log(`[${new Date().toTimeString().slice(0, 8)}] ${pct()}% · ~${fmtDur(remaining())} left · ${r ? r.label + (r.detail ? ` (${r.detail})` : "") : "—"}`); }
}
const timer = setInterval(tick, 1000);
const t0 = Date.now();
for (const it of items) {
  if (it.out && fs.existsSync(V(it.out))) { it.state = "done"; continue; }
  it.state = "running"; it.t0 = Date.now(); tick(true);
  try { await it.run(it); it.state = "done"; it.frac = 1; }
  catch (e) {
    if (it.optional) { it.state = "skipped"; note = pc.yellow(`${it.label} skipped: ${e.message}`); }
    else { it.state = "failed"; note = pc.red(`${it.label} failed: ${e.message}`); tick(true); clearInterval(timer); console.log(`\n  ${note}\n  Fix it and run the same command again: finished steps are kept.\n`); process.exit(1); }
  }
  tick(true);
}
clearInterval(timer); tick(true);
console.log(`\n  ${pc.green("✔ Done")} in ${fmtDur((Date.now() - t0) / 1000)}\n  ${pc.bold("Video:")}     ${rel(V("final.mp4"))}\n  ${pc.bold("Thumbnail:")} ${rel(V("thumbnail.png"))}\n  ${pc.bold("Upload text:")} ${rel(V("youtube.md"))}\n`);
