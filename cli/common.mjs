// Shared paths and helpers for the reelix terminal.
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { fileURLToPath } from "node:url";
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const J = (...p) => path.join(ROOT, ...p);
export const slug = (s) => String(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const today = () => new Date().toISOString().slice(0, 10);
export const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
export const fmtDur = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`; };
/** The Claude Code CLI: PATH, the usual install spots, or the copy inside the Claude desktop app (newest). */
export function findClaude() {
  const c = (process.env.PATH || "").split(path.delimiter).map((d) => path.join(d, "claude"));
  const home = os.homedir();
  c.push(path.join(home, ".claude", "local", "claude"), path.join(home, ".local", "bin", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude");
  const base = path.join(home, "Library", "Application Support", "Claude", "claude-code");
  if (fs.existsSync(base)) for (const v of fs.readdirSync(base).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
    const vd = path.join(base, v); if (!fs.statSync(vd).isDirectory()) continue;
    for (const h of fs.readdirSync(vd)) c.push(path.join(vd, h, "claude.app", "Contents", "MacOS", "claude"));
  }
  return c.find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
}
/** An existing folder for this video name (any date), newest first, or null. */
export function findVideo(name) {
  const V = J("videos"); if (!fs.existsSync(V)) return null;
  const hit = fs.readdirSync(V).filter((f) => f.replace(/^\d{4}-\d{2}-\d{2}-/, "") === slug(name) && fs.existsSync(path.join(V, f, "brief.json"))).sort().pop();
  return hit ? path.join(V, hit) : null;
}
/** How long a short or a video should be. `input` is a preset name from config/formats.json <format>.lengths
 *  (short: 30 | 60 | 90 | 120 seconds; video: standard | long | deep), or for a VIDEO the user's own length: minutes ("7", "7.5m")
 *  or seconds ("420", "420s"). A bare number is minutes when it is small enough to be minutes, else seconds (a video is 1.5-12 min
 *  = 90-720 s, so the two never overlap). A short takes presets only. No input = the first preset.
 *  Returns { key, sec, label }, or null when it is not understood, not a preset (short) or outside <format>.targetSec. */
export function lengthFor(format, input) {
  const f = readJson(J("config", "formats.json"))?.[format] || {};
  const presets = f.lengths || {};
  const [min, max] = f.targetSec || (format === "short" ? [20, 120] : [90, 600]);
  const of = (key) => ({ key, sec: presets[key].sec, label: presets[key].label });
  const text = String(input ?? "").trim().toLowerCase();
  const first = Object.keys(presets)[0];
  if (!text) return first ? of(first) : { key: "standard", sec: format === "short" ? 30 : 150, label: format === "short" ? "30 seconds" : "About 2.5 minutes" };
  if (presets[text]) return of(text);
  const m = /^(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds|m|min|mins|minutes)?$/.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const minutes = m[2] ? m[2].startsWith("m") : format === "video" && n <= max / 60;
  const sec = Math.round(n * (minutes ? 60 : 1));
  const same = Object.keys(presets).find((k) => presets[k].sec === sec);
  if (same) return of(same);
  if (format === "short" || sec < min || sec > max) return null;   // a short has no custom length
  return { key: "custom", sec, label: `About ${+(sec / 60).toFixed(1)} minutes` };
}
/** Create videos/<date>-<slug>/brief.json. Returns the folder.
 *  length: see lengthFor() above (a preset, or for a video its own length). captions: draw word captions on the video (default off). */
export function newVideo(name, about, format, style, look = "painted", length = "standard", captions = false) {
  const F = readJson(J("config", "formats.json"));
  const dir = J("videos", `${today()}-${slug(name)}`);
  fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
  const f = F[format];
  const len = lengthFor(format, length) || lengthFor(format);   // a length that is not understood falls back to the default one
  const brief = { name: slug(name), title: name.replace(/-/g, " "), about, format, style, styleLabel: F.styles[style].label,
    width: f.width, height: f.height, fps: f.fps, imageW: f.imageW, imageH: f.imageH, targetSec: len.sec, length: len.key, lengthLabel: len.label, captions: captions === true,
    imageStyle: F.styles[style].imageStyle, look, lookLabel: readJson(J("config", "looks.json"))[look]?.label || look,
    lookStyle: readJson(J("config", "looks.json"))[look]?.styleLock || "", pictures: readJson(J("config", "looks.json"))[look]?.pictures !== false,
    imageModel: readJson(J("config", "looks.json"))[look]?.imageModel || "schnell", wan: !!readJson(J("config", "looks.json"))[look]?.wan, created: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, "brief.json"), JSON.stringify(brief, null, 1));
  fs.writeFileSync(path.join(dir, "brief.md"), `# ${brief.title}\n\n${about}\n\n- Format: ${format} (${f.width}x${f.height})\n- Style: ${brief.styleLabel}\n- Look: ${brief.lookLabel}\n- Target length: ~${brief.targetSec}s (${len.label.toLowerCase()}, length \"${len.key}\")\n- Captions on the video: ${brief.captions ? "on" : "off"}\n`);
  return dir;
}
/** Models to try for an agent, in order (.claude/models.json): the first, then fallbacks on a limit or overload. */
export function agentModels(name) {
  const M = readJson(J(".claude", "models.json"), {}) || {};
  const list = M.agents?.[name]?.models || ["opus", "sonnet", "haiku"];
  return list.map((k) => ({ key: k, id: M.ids?.[k] || k }));
}
/** Text that means "this model can't run now, try the next one". */
export const LIMIT_RE = /hit your [\w -]*limit|usage limit|rate limit|rate_limit|overloaded|\b529\b|model (is )?(not available|unavailable)|not_found_error.*model|requires usage credits|switch to another model/i;

/** When a usage limit says when it ends ("You've hit your 5-hour limit · resets 1:30am (Asia/Calcutta)"), how long to wait.
 *  Reads the LAST such line in `text`. Returns { ms, at: "1:30am" } for the next time the clock shows that time, or null when
 *  no time is given or it is more than maxHours away (a weekly limit: waiting makes no sense). The CLI prints the time in the
 *  account's time zone, which is this Mac's zone. */
export function limitReset(text, maxHours = 6, now = new Date()) {
  const all = [...String(text || "").matchAll(/resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/gi)];
  const m = all[all.length - 1];
  if (!m) return null;
  const hour = (Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0);
  const at = new Date(now); at.setHours(hour, Number(m[2] || 0), 0, 0);
  if (at <= now) at.setDate(at.getDate() + 1);
  const ms = at - now;
  return ms <= maxHours * 3600000 ? { ms, at: `${m[1]}:${m[2] || "00"}${m[3].toLowerCase()}` } : null;
}
