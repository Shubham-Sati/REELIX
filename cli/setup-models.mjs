// Downloads/installs every REELIX model one after another, with a live bar per model:
// % done, GB downloaded of total, download speed and estimated time left (from this laptop's real speed).
//   node cli/setup-models.mjs [--no-music] [--only flux,kokoro,...]     (scripts/setup.sh runs this)
// Progress is measured by watching each model's folder grow; totals come from Hugging Face when online.
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { spawn } from "node:child_process";
import pc from "picocolors"; import { ROOT, fmtDur } from "./common.mjs"; import { draw } from "./ui.mjs";

const a = process.argv.slice(2);
const M = (process.env.REELIX_MODELS || path.join(os.homedir(), ".reelix")).replace(/^~/, os.homedir());
const HF = process.env.HF_HOME || path.join(os.homedir(), ".cache", "huggingface");
const MUSIC = !a.includes("--no-music"); const ONLY = a.includes("--only") ? a[a.indexOf("--only") + 1].split(",") : null;
fs.mkdirSync(M, { recursive: true }); const LOG = path.join(M, "setup.log");
const env = { ...process.env, HF_HUB_DISABLE_XET: "1", HF_HUB_DISABLE_PROGRESS_BARS: "1" };
const GB = 1e9, exists = (p) => fs.existsSync(p);
const vi = path.join(M, "venv-image"), vv = path.join(M, "venv-voice"), ace = path.join(M, "ace-step");
const WHISPER = path.join(os.homedir(), ".cache", "whisper", "ggml-large-v3-turbo-q5_0.bin");
const SPACY = "en_core_web_sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl";
const snap = (py, repo, dir) => [py, ["-c", `from huggingface_hub import snapshot_download as d; d(${JSON.stringify(repo)}${dir ? `, local_dir=${JSON.stringify(dir)}` : ""})`]];

/* size helpers */
// folder size = sum of real file sizes (du under-reports on APFS; symlinks are skipped so cache links are not counted twice)
const du = (p) => { if (!p || !fs.existsSync(p)) return 0; let t = 0; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.isFile()) try { t += fs.statSync(f).size; } catch {} } };
  try { fs.statSync(p).isDirectory() ? walk(p) : (t = fs.statSync(p).size); } catch {} return t; };
async function hfSize(repo, fallback) {
  try { const r = await fetch(`https://huggingface.co/api/models/${repo}?blobs=true`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json(); const s = j.siblings.reduce((t, f) => t + (f.size || 0), 0); return s || fallback; } catch { return fallback; }
}
async function urlSize(url, fallback) {
  try { const r = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8000) }); return Number(r.headers.get("content-length")) || fallback; } catch { return fallback; }
}

/* the models, in install order. kind "dl" = measured download; "build" = timed step */
const items = [
  { id: "flux-app", group: "Pictures", label: "mflux (runs FLUX on the Mac)", build: 90, done: () => exists(path.join(vi, "bin", "mflux-generate")),
    cmd: ["bash", ["-c", `[ -x "${vi}/bin/python" ] || uv venv -q --python 3.12 "${vi}"; uv pip install -q --python "${vi}/bin/python" "mflux==0.24.0" "huggingface_hub>=1.0" pillow`]] },
  { id: "flux", group: "Pictures", label: "FLUX.1 schnell 4-bit", repo: "dhairyashil/FLUX.1-schnell-mflux-4bit", total: 9.6 * GB, dir: path.join(M, "flux1-schnell-4bit"),
    done: () => exists(path.join(M, "flux1-schnell-4bit", ".reelix-ok")) || (du(path.join(M, "flux1-schnell-4bit")) > 9 * GB && !exists(path.join(M, "flux1-schnell-4bit", ".cache", "huggingface", "download"))),
    cmd: () => snap(path.join(vi, "bin", "python"), "dhairyashil/FLUX.1-schnell-mflux-4bit", path.join(M, "flux1-schnell-4bit")) },
  { id: "voice-app", group: "Voice", label: "mlx-audio (runs Kokoro)", build: 300, done: () => exists(path.join(vv, "bin", "mlx_audio.tts.generate")),
    cmd: ["bash", ["-c", `[ -x "${vv}/bin/python" ] || uv venv -q --python 3.12 "${vv}"; uv pip install -q --python "${vv}/bin/python" --prerelease=allow mlx-audio "huggingface_hub>=1.0" soundfile "misaki[en]" "${SPACY}"`]] },
  { id: "kokoro", group: "Voice", label: "Kokoro-82M voice model", repo: "mlx-community/Kokoro-82M-bf16", total: 0.39 * GB, dir: path.join(HF, "hub", "models--mlx-community--Kokoro-82M-bf16"),
    done: () => { const s = path.join(HF, "hub", "models--mlx-community--Kokoro-82M-bf16", "snapshots"); try { return fs.readdirSync(s).some((v) => exists(path.join(s, v, "kokoro-v1_0.safetensors"))); } catch { return false; } },
    cmd: () => snap(path.join(vv, "bin", "python"), "mlx-community/Kokoro-82M-bf16") },
  { id: "whisper", group: "Captions", label: "whisper large-v3-turbo", url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin", total: 0.574 * GB, file: WHISPER,
    done: () => exists(WHISPER) && fs.statSync(WHISPER).size > 0.5 * GB,
    cmd: () => ["bash", ["-c", `mkdir -p "${path.dirname(WHISPER)}" && curl -L --fail -s -o "${WHISPER}.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin" && mv "${WHISPER}.part" "${WHISPER}"`]], measure: () => (exists(WHISPER + ".part") ? fs.statSync(WHISPER + ".part").size : 0) },
  ...(MUSIC ? [
  { id: "ace-app", group: "Music", label: "ACE-Step 1.5 program", build: 300, done: () => exists(path.join(ace, ".venv", "bin", "python")),
    cmd: ["bash", ["-c", `[ -d "${ace}/.git" ] || git clone -q https://github.com/ace-step/ACE-Step-1.5 "${ace}"; cd "${ace}" && uv sync -q`]] },
  { id: "ace", group: "Music", label: "ACE-Step 1.5 music model", repo: "ACE-Step/Ace-Step1.5", total: 10.1 * GB, dir: path.join(ace, "checkpoints"), done: () => exists(path.join(ace, ".reelix-ok")),
    cmd: ["bash", ["-c", `cd "${ace}" && uv run acestep-download && touch .reelix-ok`]] }] : []),
  { id: "cutout", group: "Cut-out", label: "Apple Vision cut-out (built here)", build: 40, done: () => exists(path.join(M, "bin", "cutout")) && fs.statSync(path.join(M, "bin", "cutout")).mtimeMs > fs.statSync(path.join(ROOT, "tools", "cutout.swift")).mtimeMs,
    cmd: ["bash", ["-c", `mkdir -p "${M}/bin" && swiftc -O "${ROOT}/tools/cutout.swift" -o "${M}/bin/cutout"`]] },
].filter((x) => !ONLY || ONLY.includes(x.id)).map((x) => ({ ...x, state: "waiting", cur: 0, base: 0 }));

/* drawing */
const W = 18, gbs = (b) => `${(b / GB).toFixed(b < 10 * GB ? 2 : 1)} GB`;
const mbs = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB/s` : `${Math.round(b / 1e3)} KB/s`);
let speed = 0; const hist = [];   // overall bytes/s from the last ~10 s
const bar = (f, s) => { const n = Math.round(Math.min(1, f) * W); const c = s === "done" ? pc.green : s === "running" ? pc.cyan : pc.dim; return c("█".repeat(n)) + pc.dim("░".repeat(W - n)); };
const icon = (s) => (s === "done" ? pc.green("✔") : s === "running" ? pc.cyan("●") : s === "failed" ? pc.red("✖") : pc.dim("○"));
const frac = (it) => (it.state === "done" ? 1 : it.build ? Math.min(0.95, it.t0 ? (Date.now() - it.t0) / 1000 / it.build : 0) : Math.min(0.99, it.cur / it.total));
const leftOf = (it) => (it.state === "done" ? 0 : it.build ? Math.max(5, it.build - (it.t0 ? (Date.now() - it.t0) / 1000 : 0)) : (it.total - it.cur) / (speed || 8e6));
function screen(note = "") {
  const out = ["", `  ${pc.bold(pc.cyan("reelix"))} ${pc.dim("·")} ${pc.bold("installing models")} ${pc.dim("·")} ${pc.dim(M)}`, `  ${pc.dim("─".repeat(84))}`];
  let g = "";
  for (const it of items) {
    if (it.group !== g) { g = it.group; const all = items.filter((x) => x.group === g); out.push("", `  ${all.every((x) => x.state === "done") ? pc.green("✔") : pc.bold("▸")} ${pc.bold(g)}`); }
    const f = frac(it), lbl = it.label.padEnd(34);
    const size = it.build ? "".padEnd(19) : `${gbs(it.state === "done" ? it.total : it.cur)} / ${gbs(it.total)}`.padEnd(19);
    const right = it.state === "done" ? pc.green(it.skipped ? "already installed" : "done") : it.state === "failed" ? pc.red("failed (see setup.log)") : it.state === "waiting" ? pc.dim(`~${fmtDur(leftOf(it))}`)
      : pc.cyan(`${it.build ? "installing" : mbs(it.rate || 0)}  ~${fmtDur(leftOf(it))} left`);
    out.push(`    ${icon(it.state)} ${it.state === "waiting" ? pc.dim(lbl) : lbl} ${bar(f, it.state)} ${String(Math.round(f * 100)).padStart(3)}%  ${pc.dim(size)} ${right}`);
  }
  const tb = items.filter((i) => !i.build), all = tb.reduce((s, i) => s + i.total, 0), got = tb.reduce((s, i) => s + (i.state === "done" ? i.total : i.cur), 0);
  const left = items.reduce((s, i) => s + leftOf(i), 0);
  out.push("", `  ${pc.dim("Overall:")} ${pc.bold(`${Math.round((got / all) * 100)}%`)}  ${pc.dim(`${gbs(got)} of ${gbs(all)}`)}   ${pc.dim("Speed:")} ${pc.bold(speed ? mbs(speed) : "measuring…")}   ${pc.dim("Time left:")} ${pc.bold(left > 1 ? `about ${fmtDur(left)}` : "none")}`);
  if (note) out.push(`  ${note}`);
  out.push(""); return out;
}
let lastLine = 0;
function tick() {
  const r = items.find((i) => i.state === "running");
  if (r && !r.build) {
    const now = (r.measure ? r.measure() : du(r.file || r.dir)) - r.base; const t = Date.now();
    r.cur = Math.max(r.cur, Math.min(r.total, now));
    hist.push([t, items.reduce((s, i) => s + (i.state === "done" && !i.skipped ? i.total : i.state === "running" ? i.cur : 0), 0)]);
    while (hist.length > 2 && t - hist[0][0] > 10000) hist.shift();
    if (hist.length > 1) { const [t0, b0] = hist[0], [t1, b1] = hist[hist.length - 1]; const s = ((b1 - b0) / (t1 - t0)) * 1000; if (s > 0) speed = speed ? speed * 0.6 + s * 0.4 : s; r.rate = speed; }
  }
  if (process.stdout.isTTY) draw(screen());
  else if (Date.now() - lastLine > 30000) { lastLine = Date.now(); const got = items.filter((i) => !i.build); console.log(`[${new Date().toTimeString().slice(0, 8)}] ${r ? r.label : "-"} ${Math.round(frac(r || items[0]) * 100)}% · overall ${Math.round(got.reduce((s, i) => s + (i.state === "done" ? i.total : i.cur), 0) / got.reduce((s, i) => s + i.total, 0) * 100)}% · ~${fmtDur(items.reduce((s, i) => s + leftOf(i), 0))} left`); }
}
const run = (cmd, args) => new Promise((res, rej) => { const log = fs.createWriteStream(LOG, { flags: "a" }); log.write(`\n### ${cmd} ${args.join(" ").slice(0, 300)}\n`);
  const p = spawn(cmd, args, { env }); p.stdout.pipe(log); p.stderr.pipe(log); p.on("close", (c) => (c === 0 ? res() : rej(new Error(`exit ${c}`)))); });

/* go */
await Promise.all(items.map(async (it) => { if (it.repo) it.total = await hfSize(it.repo, it.total); if (it.url) it.total = await urlSize(it.url, it.total); }));
for (const it of items) if (it.done()) { it.state = "done"; it.skipped = true; }
const timer = setInterval(tick, 1000); tick();
let failed = 0;
for (const it of items) {
  if (it.state === "done") continue;
  it.state = "running"; it.t0 = Date.now(); it.base = it.build || it.measure ? 0 : du(it.file || it.dir); it.cur = 0;
  const [c, args] = typeof it.cmd === "function" ? it.cmd() : it.cmd;
  try { await run(c, args); it.state = "done"; it.cur = it.total; if (it.id === "flux") fs.writeFileSync(path.join(it.dir, ".reelix-ok"), ""); }
  catch (e) { it.state = "failed"; failed++; if (it.group === "Music") it.note = "music is optional"; }
  tick();
}
clearInterval(timer); tick();
if (process.stdout.isTTY) draw(screen(failed ? pc.red(`${failed} item(s) failed. Details: ${LOG}. Run scripts/setup.sh again to retry: finished ones are kept.`) : pc.green("All models installed.")));
else console.log(failed ? `${failed} failed, see ${LOG}` : "All models installed.");
process.exit(failed && items.some((i) => i.state === "failed" && i.group !== "Music") ? 1 : 0);
