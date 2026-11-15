// The REELIX pipeline: brief.json -> final.mp4 + thumbnail.png + youtube.md.
//   node cli/pipeline.mjs <video-folder>
// Each stage writes one file; a stage whose file already exists is skipped, so a re-run continues where it stopped.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import pc from "picocolors";
import { ROOT, J, readJson, findClaude, fmtDur, slug, agentModels, LIMIT_RE } from "./common.mjs";
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
let note = "";   // one-line message under the progress panel
const rel = (p) => path.relative(ROOT, p);

/* ---------------------------------------------------------------- running things */
function sh(cmd, args, logName, onLine, stdinFile) {
  return new Promise((res, rej) => {
    const log = fs.createWriteStream(path.join(LOG, logName), { flags: "a" });
    const p = spawn(cmd, args, { cwd: ROOT, stdio: [stdinFile ? fs.openSync(stdinFile, "r") : "pipe", "pipe", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1", REELIX_IMAGE_MODEL: B.imageModel || "schnell" } });
    const feed = (d) => { log.write(d); if (onLine) String(d).split("\n").filter(Boolean).forEach(onLine); };
    p.stdout.on("data", feed); p.stderr.on("data", feed);
    p.on("close", (c) => { log.end(); c === 0 ? res() : rej(new Error(`${path.basename(cmd)} exited ${c} (see ${rel(path.join(LOG, logName))})`)); });
  });
}
/** Run one Claude Code agent headless in the REELIX folder. Tries the agent's models in order (.claude/models.json):
 *  on a usage/rate limit or overload it re-runs the same job on the next model. */
async function agent(name, task, logName) {
  if (!CLAUDE) throw new Error("Claude Code CLI not found. Install it or open the Claude desktop app once.");
  const tools = "Read Write Edit Glob Grep Bash WebSearch WebFetch";
  const lp = path.join(LOG, logName);
  const models = agentModels(name);
  for (const [n, m] of models.entries()) {
    const before = fs.existsSync(lp) ? fs.statSync(lp).size : 0;
    fs.appendFileSync(lp, `\n### ${name} on ${m.key} (${m.id})\n`);
    const hit = () => { try { return LIMIT_RE.test(fs.readFileSync(lp, "utf8").slice(before)); } catch { return false; } };
    let err = null;
    try { await sh(CLAUDE, ["-p", task, "--agent", name, "--model", m.id, "--allowedTools", ...tools.split(" "), "--permission-mode", "acceptEdits", "--output-format", "text"], logName, null, "/dev/null"); }
    catch (e) { err = e; }
    if (!hit()) { if (err) throw err; return; }
    if (n < models.length - 1) { note = pc.yellow(`${name}: ${m.key} is limited or busy, trying ${models[n + 1].key}`); continue; }
    throw new Error("Claude usage limit reached on every model; run the same command again after it resets (finished steps are kept)");
  }
}

/* ---------------------------------------------------------------- stages */
const shots = () => (readJson(V("storyboard.json"))?.scenes || []).flatMap((s) => s.shots.map((sh, k) => ({ scene: s.id, k, ...sh })));
const shotFile = (s) => V("assets", "images", `s${s.scene}_${s.k}.png`);
const sb = () => readJson(V("storyboard.json"));
const prompt = (s) => {
  // each character in the shot gets its LOCKED look, word for word (cast list; older storyboards: name found in the prompt)
  const S = sb(); const chars = Object.entries(S.characters || {}).filter(([n]) => (s.cast ? s.cast.includes(n) : s.imagePrompt.includes(n))).map(([n, d]) => `${n}: ${d}`).join("; ");
  return `${s.imagePrompt}${chars ? `. ${chars}` : ""}. ${S.styleLine}`;
};

/** Anchor shots from storyboard.json "anchors" (one per character; a shared shot is listed once). */
function anchorShots() {
  // "shot" should be the 0-based index (as in file names s<scene>_<shot>), but agents sometimes count from 1:
  // use the given shot only if that character is in its cast; else the 1-based reading; else their first shot with a clear cast.
  const S = sb() || {}; const m = new Map();
  for (const [who, a] of Object.entries(S.anchors || {})) {
    const sc = (S.scenes || []).find((x) => x.id === a.scene) || {}; const has = (i) => (sc.shots?.[i]?.cast || []).includes(who);
    let scene = a.scene, k = has(a.shot) ? a.shot : has(a.shot - 1) ? a.shot - 1 : null;
    if (k == null) for (const x of S.scenes || []) { const i = (x.shots || []).findIndex((h) => (h.cast || []).includes(who)); if (i >= 0) { scene = x.id; k = i; break; } }
    const sh = (S.scenes || []).find((x) => x.id === scene)?.shots?.[k]; if (!sh) continue;
    const key = `${scene}_${k}`; if (!m.has(key)) m.set(key, { scene, k, ...sh, who: [] }); m.get(key).who.push(who);
    if (a.scene !== scene || a.shot !== k) { S.anchors[who] = { ...a, scene, shot: k }; fs.writeFileSync(V("storyboard.json"), JSON.stringify(S, null, 1)); }
  }
  return [...m.values()];
}
const drawShot = (s, i) => (fs.existsSync(shotFile(s)) ? Promise.resolve()
  : sh(PY, [T("image.py"), prompt(s), shotFile(s), String(B.imageW), String(B.imageH), String(s.seed ?? 7 + i)], "3-images.log"));
async function redraw(list, it, log) {
  const S = sb();
  for (const [i, r] of list.entries()) {
    it.detail = `redrawing ${i + 1} of ${list.length}: ${r.reason || ""}`.slice(0, 70);
    const shot = S.scenes.find((x) => x.id === r.scene)?.shots[r.shot]; if (!shot) continue;
    shot.imagePrompt = r.imagePrompt || shot.imagePrompt; shot.seed = r.seed ?? (shot.seed || 7) + 100;
    fs.writeFileSync(V("storyboard.json"), JSON.stringify(S, null, 1));
    fs.rmSync(shotFile({ scene: r.scene, k: r.shot }).replace(".png", "_fg.png"), { force: true });   // its 2.5D layer is redone too
    await sh(PY, [T("image.py"), prompt({ scene: r.scene, k: r.shot, ...shot }), shotFile({ scene: r.scene, k: r.shot }), String(B.imageW), String(B.imageH), String(shot.seed)], log);
  }
}
/** Apple Vision face distance from every shot to its cast's references -> assets/face-check.json (advice for the checkers). */
function faceCheck() {
  const cast = readJson(V("characters", "cast.json"), {}) || {}; const res = {};
  for (const [who, c] of Object.entries(cast)) {
    if (!c?.ref || !fs.existsSync(V(c.ref))) continue;
    const frames = shots().filter((s) => (s.cast || []).includes(who) && fs.existsSync(shotFile(s)));
    if (!frames.length) continue;
    const r = spawnSync("bash", [T("facematch.sh"), V(c.ref), ...frames.map(shotFile)], { encoding: "utf8" });
    for (const l of (r.stdout || "").split("\n").filter((x) => x.startsWith("{"))) {
      try { const d = JSON.parse(l); const f = path.basename(d.frame, ".png"); (res[f] ||= {})[who] = d.best ?? "no face found"; } catch {}
    }
  }
  fs.writeFileSync(V("assets", "face-check.json"), JSON.stringify({ about: "Apple Vision face distance to each character's reference (smaller = more alike; <0.75 usually same, >0.95 usually different; confirm by eye)", frames: res }, null, 1));
}

/** The music server (ACE-Step on :8001) holds ~7-18 GB. No step after "music" needs it, so it is always closed once music is done
 *  (even if it was already running before this video), and again before any heavy step (Wan) in case music was skipped. */
function freeMusic() {
  if (spawnSync("sh", ["-c", "lsof -ti tcp:8001"], { encoding: "utf8" }).stdout.trim()) spawnSync("sh", ["-c", "lsof -ti tcp:8001 | xargs kill; sleep 3"]);
}
const PICS = () => B.pictures !== false;   // looks that draw AI pictures (2D looks and the 3D AI motion look)
const WAN = () => !!B.wan;                 // 3D AI motion: each shot's picture is animated by Wan 2.2
const STEPS = ["Research & script", PICS() ? "Storyboard & pictures" : "Storyboard", "Voice, captions & music", "Animate, render & review", "Thumbnail, upload text & memory"];
const items = [
  { id: "script", step: 0, label: "Research facts + write script", est: 240, out: "script.json",
    run: () => agent("script-writer", `Video folder: ${rel(VD)}. Read brief.json there and write research.md and script.json as your instructions say.`, "1-script.log") },
  { id: "board", step: 1, label: "Storyboard (scenes, shots)", est: 120, out: "storyboard.json",
    run: () => agent("storyboard-artist", `Video folder: ${rel(VD)}. Write storyboard.json from brief.json and script.json.`, "2-storyboard.log") },
  { id: "anchors", when: PICS, step: 1, label: "Draw anchor frames first", est: 240, out: null,
    run: async (it) => {
      const as = anchorShots(); it.est = Math.max(30, as.length * 75);
      for (const [i, s] of as.entries()) { it.detail = `${s.who.join(", ")} (frame s${s.scene}_${s.k})`; it.frac = i / as.length; await drawShot(s, i); }
    } },
  { id: "anchor-check", when: PICS, step: 1, label: "Check anchor frames", est: 120, out: "anchor-review.json",
    run: async (it) => {
      if (!anchorShots().length) return fs.writeFileSync(V("anchor-review.json"), JSON.stringify({ redo: [], notes: "no characters" }));
      await agent("visual-artist", `Video folder: ${rel(VD)}. ANCHOR JOB: check the anchor frames and write anchor-review.json.`, "4a-anchors.log");
      await redraw(readJson(V("anchor-review.json"))?.redo || [], it, "4a-anchors.log");
    } },
  { id: "cast", when: PICS, step: 1, label: "Cut out characters (references)", est: 90, out: "characters/cast.json",
    run: async (it) => {
      const as = anchorShots(); fs.mkdirSync(V("characters"), { recursive: true });
      if (!as.length) return fs.writeFileSync(V("characters", "cast.json"), "{}");
      for (const s of as) {
        const dir = V("characters", "_cuts", `s${s.scene}_${s.k}`); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
        let out = ""; await sh("bash", [T("cutout.sh"), shotFile(s), "--each", dir], "4c-cast.log", (l) => { if (l.startsWith("{")) out = l; });
        fs.writeFileSync(path.join(dir, "cuts.json"), out || "{}");
      }
      await agent("visual-artist", `Video folder: ${rel(VD)}. CAST JOB: pick each character's cut-out and write characters/cast.json.`, "4c-cast.log");
      const cast = readJson(V("characters", "cast.json"), {}) || {};
      for (const [who, c] of Object.entries(cast)) {
        if (!c?.ref || !fs.existsSync(V(c.ref))) continue;
        const dst = `characters/${slug(who)}.png`;
        if (c.ref !== dst) { fs.copyFileSync(V(c.ref), V(dst)); c.ref = dst; }
      }
      fs.writeFileSync(V("characters", "cast.json"), JSON.stringify(cast, null, 1));
    } },
  { id: "images", when: PICS, step: 1, label: "Draw the other pictures (FLUX)", est: 300, out: null,
    run: async (it) => {
      const all = shots().filter((s) => !fs.existsSync(shotFile(s))); it.est = Math.max(30, all.length * 75);
      for (const [i, s] of all.entries()) { it.detail = `picture ${i + 1} of ${all.length}`; it.frac = i / all.length; await drawShot(s, i); }
    } },
  { id: "check", when: PICS, step: 1, label: "Check vs characters, redraw", est: 240, out: "image-review.json",
    run: async (it) => {
      it.detail = "face check"; faceCheck();
      await agent("visual-artist", `Video folder: ${rel(VD)}. CHECK JOB: check all frames (use characters/ and assets/face-check.json) and write image-review.json.`, "4-image-check.log");
      let redo = readJson(V("image-review.json"))?.redo || [];
      // every redraw is checked again (a redraw can fail the same way); up to 3 rounds, then whatever is left goes to the reviewer
      for (let round = 2; redo.length && round <= 4; round++) {
        await redraw(redo, it, "4-image-check.log");
        it.detail = `re-checking ${redo.length} redrawn frame(s), round ${round}`; faceCheck();
        const list = redo.map((r) => `s${r.scene}_${r.shot}`).join(", ");
        const file = `image-review-${round}.json`;
        await agent("visual-artist", `Video folder: ${rel(VD)}. CHECK JOB, re-check only these redrawn frames: ${list}. Write ${file}.${round === 4 ? " This is the last round: only list a frame if it is clearly broken." : ""}`, "4-image-check.log");
        redo = round < 4 ? readJson(V(file))?.redo || [] : [];
        if (round === 4) { const left = readJson(V(file))?.redo || []; if (left.length) fs.writeFileSync(V("image-unresolved.json"), JSON.stringify(left, null, 1)); }
      }
    } },
  { id: "layers", when: PICS, step: 1, label: "Cut out 2.5D layers (Apple Vision)", est: 15, out: null,
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
    run: () => sh(PY, [T("music.py"), VD, sb().musicPrompt, String(Math.ceil(readJson(V("assets", "lines.json")).durationSec + 1.5))], "7-music.log").finally(freeMusic) },
  { id: "sfx", step: 2, label: "Sound effects on the hits", est: 90, out: "assets/sfx.json", optional: true,
    run: () => agent("sound-designer", `Video folder: ${rel(VD)}. Write assets/sfx.json.`, "7b-sfx.log") },
  { id: "motion", when: WAN, step: 3, label: "Animate shots (Wan AI motion)", est: 1800, out: null,
    run: async (it) => {
      buildTimeline();   // shot lengths come from the voice timing
      const tl = readJson(V("project", "timeline.json")); const all = shots();
      const cfg = readJson(J("config", "models.json")); const loc = readJson(J("config", "models.local.json"), {}) || {};
      const W = { ...cfg.videoWan, ...(loc.videoWan || {}) }; const home = (x) => x.replace("{models}", (loc.models || cfg.models).replace(/^~/, process.env.HOME)).replace(/^~/, process.env.HOME);
      const portrait = B.height > B.width, ww = portrait ? W.width : W.height, wh = portrait ? W.height : W.width;
      // Shorts: every shot moves. Long videos: only shots the storyboard marks "move": true (the key moments).
      const moving = all.map((s, i) => ({ ...s, dur: tl.scenes[i]?.duration || 3 })).filter((s) => s.engine !== "kinetic" && (B.format === "short" || s.move === true));
      fs.mkdirSync(V("assets", "clips", "raw"), { recursive: true }); fs.mkdirSync(V("assets", "clips", "in"), { recursive: true });
      const jobs = [];
      for (const s of moving) {
        const name = `s${s.scene}_${s.k}`, raw = V("assets", "clips", "raw", `${name}.mp4`);
        if (fs.existsSync(raw) || !fs.existsSync(shotFile(s))) continue;
        const inp = V("assets", "clips", "in", `${name}.png`);
        spawnSync("magick", [shotFile(s), "-resize", `${ww}x${wh}^`, "-gravity", "center", "-extent", `${ww}x${wh}`, inp]);
        const secs = Math.min(5, Math.max(1.7, (s.dur + 0.45) / 1.3));   // clips may be slowed up to 1.3x to fill the shot
        const frames = Math.min(121, 4 * Math.ceil((secs * 24 - 1) / 4) + 1);
        const what = s.motionPrompt || `${s.action || s.imagePrompt}. Natural, gentle character motion, subtle camera move`;
        jobs.push({ image: inp, out: raw, frames, seed: s.seed ?? 42, prompt: `3D animated feature film shot, modern CG animation. ${what}. Smooth natural motion, consistent faces and clothes, ${B.lookStyle || "warm cinematic light"}.` });
      }
      if (jobs.length) {
        // Wan needs ~22 GB with swap: a music server left running (ACE-Step on :8001, ~7-18 GB) gets it killed by macOS. Free it first.
        it.detail = "freeing memory (closing the music server if open)"; freeMusic();
        it.est = jobs.length * 820 + 120; it.detail = `reading ${jobs.length} motion prompt(s)`;
        fs.writeFileSync(V("assets", "clips", "jobs.json"), JSON.stringify({ model_dir: home(W.model), w: ww, h: wh, jobs }, null, 1));
        const t0 = Date.now();
        await sh(home(W.python), [T("wan_i2v.py"), "--jobs", V("assets", "clips", "jobs.json")], "8a-motion.log", (l) => {
          const m = /^clip (\d+)\/(\d+)/.exec(l); if (m) { it.frac = (m[1] - 1) / m[2]; it.detail = `clip ${m[1]} of ${m[2]} (~${fmtDur((Date.now() - t0) / 1000)} so far)`; }
          const d = /Diffusion:\s+(\d+)%/.exec(l); if (d && it.detail) it.detail = it.detail.replace(/ · .*$/, "") + (d[1] === "100" ? " · turning into frames" : ` · motion ${d[1]}%`);
        });
      }
      it.detail = "matching colours + balanced grade";
      fs.writeFileSync(V("assets", "clips", "grade.json"), JSON.stringify({ width: B.width, height: B.height, fps: B.fps || 30,
        clips: moving.map((s) => ({ name: `s${s.scene}_${s.k}`, scene: s.scene, duration: s.dur, keepLight: !!s.keepLight })) }, null, 1));
      await sh(PY, [T("grade.py"), VD], "8a-motion.log");
      fs.rmSync(V("project", "timeline.json"), { force: true });   // the early timeline above had no clips yet: the timeline step must rebuild it
    } },
  { id: "build3d", step: 3, label: PICS() ? "Build 3D / motion scenes" : "Build 3D world + every shot", est: 300, out: null,
    run: async (it) => {
      if (!PICS()) {
        it.est = 900; it.detail = "set-builder: 3D world, characters, every shot";
        buildTimeline();   // shot times are needed to sync movement and mouths
        const need = shots().filter((s) => s.engine !== "kinetic" && !fs.existsSync(V("project", "custom", `S${s.scene}_${s.k}.tsx`)));
        if (need.length || !fs.existsSync(V("characters", "cast.json")))
          await agent("set-builder", `Video folder: ${rel(VD)}. Build the 3D toy world: characters/cast.json, project/custom/_kit.tsx and these shots: ${need.map((s) => `S${s.scene}_${s.k}`).join(", ")}. Check them with tools/still.sh.`, "8b-build3d.log");
        return;
      }
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
].filter((x) => !x.when || x.when())   // only the steps this look actually runs (3D looks have no picture steps)
 .map((x) => ({ ...x, state: "waiting", frac: 0 }));

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
      const engine = !PICS() ? (eng === "kinetic" ? "kinetic" : "custom")
        : WAN() && eng !== "kinetic" && fs.existsSync(V("assets", "clips", `s${sc.id}_${k}.mp4`)) ? "clip"
        : eng === "parallax" ? (fs.existsSync(V("assets", fg)) ? "parallax" : "image") : eng === "custom" ? (custom ? "custom" : "image") : eng;
      scenes.push({ image: PICS() ? `images/s${sc.id}_${k}.png` : "", start: +(a + k * d).toFixed(3), duration: +d.toFixed(3), motion: sh.motion || "zoom-in", engine,
        ...(engine === "parallax" ? { fg } : {}), ...(engine === "kinetic" ? { text: sh.text || sc.label || "", sub: sh.sub || "" } : {}),
        ...(engine === "custom" ? { component: `S${sc.id}_${k}` } : {}), ...(engine === "clip" ? { clip: `clips/s${sc.id}_${k}.mp4` } : {}), ...(k === 0 && sc.label ? { label: sc.label } : {}) });
    });
  });
  const lib = readJson(J("library", "sfx", "index.json"), []); fs.mkdirSync(V("assets", "sfx"), { recursive: true });
  const sfx = (readJson(V("assets", "sfx.json"), []) || []).map((x) => { const e = lib.find((l) => l.id === x.id); if (!e) return null;
    fs.copyFileSync(J("library", e.file), V("assets", e.file)); return { file: e.file, start: Math.max(0, +x.start), volume: x.volume ?? 0.4 }; }).filter(Boolean);
  const tl = { font: S.font || "Montserrat", sfx, lines: (L.lines || []).map((l) => ({ speaker: l.speaker, start: l.start, end: l.end })), width: B.width, height: B.height, fps: B.fps, title: B.title, accent: S.accent || "#FFB703", scenes, voice: "voice.wav",
    music: fs.existsSync(V("assets", "music.wav")) ? "music.wav" : null, musicVolume: 0.18, captions: cap, durationSec: +total.toFixed(2) };
  fs.writeFileSync(V("project", "timeline.json"), JSON.stringify(tl, null, 1));
}

/* ---------------------------------------------------------------- drive + draw */
const head = { name: B.name, summary: `${B.format === "short" ? "Short 9:16" : "Video 16:9"} · ${B.styleLabel}${B.lookLabel ? ` · ${B.lookLabel}` : ""}` };
let lastLog = 0;
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
  if (it.when && !it.when()) { it.state = "skipped"; continue; }
  it.state = "running"; it.t0 = Date.now(); tick(true);
  try { await it.run(it); it.state = "done"; it.frac = 1; }
  catch (e) {
    if (it.optional) { it.state = "skipped"; note = pc.yellow(`${it.label} skipped: ${e.message}`); }
    else { it.state = "failed"; note = pc.red(`${it.label} failed: ${e.message}`); tick(true); clearInterval(timer); console.log(process.stdout.isTTY ? "\n  Fix it and run the same command again: finished steps are kept.\n" : `\n  ${note}\n  Fix it and run the same command again: finished steps are kept.\n`); process.exit(1); }
  }
  tick(true);
}
clearInterval(timer); tick(true);
console.log(`\n  ${pc.green("✔ Done")} in ${fmtDur((Date.now() - t0) / 1000)}\n  ${pc.bold("Video:")}     ${rel(V("final.mp4"))}\n  ${pc.bold("Thumbnail:")} ${rel(V("thumbnail.png"))}\n  ${pc.bold("Upload text:")} ${rel(V("youtube.md"))}\n`);
