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
/** Create videos/<date>-<slug>/brief.json. Returns the folder. */
export function newVideo(name, about, format, style) {
  const F = readJson(J("config", "formats.json"));
  const dir = J("videos", `${today()}-${slug(name)}`);
  fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
  const f = F[format];
  const brief = { name: slug(name), title: name.replace(/-/g, " "), about, format, style, styleLabel: F.styles[style].label,
    width: f.width, height: f.height, fps: f.fps, imageW: f.imageW, imageH: f.imageH, targetSec: format === "short" ? 30 : 150,
    imageStyle: F.styles[style].imageStyle, created: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, "brief.json"), JSON.stringify(brief, null, 1));
  fs.writeFileSync(path.join(dir, "brief.md"), `# ${brief.title}\n\n${about}\n\n- Format: ${format} (${f.width}x${f.height})\n- Style: ${brief.styleLabel}\n- Target length: ~${brief.targetSec}s\n`);
  return dir;
}
