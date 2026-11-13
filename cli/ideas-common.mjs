// Shared by `reelix viral-ideas` and `reelix saved-ideas`: print ideas, save them as .md, pick one and start the video.
import fs from "node:fs"; import path from "node:path"; import { spawn } from "node:child_process";
import * as p from "@clack/prompts"; import pc from "picocolors";
import { J, today } from "./common.mjs";

const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
const scoreBar = (s) => { const n = Math.round((s || 0) / 10); return (s >= 75 ? pc.green : s >= 55 ? pc.yellow : pc.dim)("█".repeat(n)) + pc.dim("░".repeat(10 - n)); };
const tagOf = (d) => `${d.format === "short" ? "Short 9:16" : "Video 16:9"} · ${d.style === "explainer" ? "Explainer" : "Animated"}`;
const proof = (e) => `${e.views ? `${k(e.views)} views${e.viewsPerDay ? ` (${k(e.viewsPerDay)}/day)` : ""} · ` : ""}`;
export const makeCmd = (d) => `reelix ${d.name} --about "${(d.about || "").replace(/"/g, "'")}" --format ${d.format} --style ${d.style}`;

/** Print ideas in the terminal. note(d) adds an optional dim line (e.g. where a saved idea came from). */
export function printIdeas(ideas, note) {
  console.log("");
  ideas.forEach((d, i) => {
    console.log(`  ${pc.bold(pc.cyan(String(i + 1).padStart(2)))}. ${pc.bold(d.title)}`);
    console.log(`      ${scoreBar(d.score)} ${pc.bold(String(d.score))}/100   ${pc.magenta(tagOf(d))}`);
    console.log(`      ${pc.dim("Hook:")} “${d.hook}”`);
    console.log(`      ${pc.dim("Why: ")} ${d.why}`);
    for (const e of (d.evidence || []).slice(0, 2)) console.log(`      ${pc.dim("Proof:")} ${proof(e)}${pc.dim((e.title || "").slice(0, 60))} ${pc.dim(e.url || "")}`);
    if (note) console.log(`      ${pc.dim(note(d))}`);
    console.log("");
  });
}

/** The .md version of a list (each idea ends with a ready-made "Make it" command). */
export function ideasMd(ideas, heading) {
  const md = [`# ${heading}`, ""];
  ideas.forEach((d, i) => md.push(`## ${i + 1}. ${d.title}`, `- Score: ${d.score}/100 · ${tagOf(d)}`, `- Hook: ${d.hook}`, `- About: ${d.about}`, `- Why: ${d.why}`,
    ...(d.evidence || []).map((e) => `- Proof: ${proof(e)}${e.title || ""} ${e.url || ""}`), `- Make it: \`${makeCmd(d)}\``, ""));
  return md.join("\n");
}

/** Ask which idea to make; remember the pick for idea-scout; start `reelix <name>` with the answers filled in. */
export async function pickAndStart(ideas, topicLabel) {
  if (!process.stdout.isTTY) process.exit(0);
  const pick = await p.select({ message: "Make one of these now?", options: [...ideas.map((d, i) => ({ value: i, label: `${i + 1}. ${d.title}`, hint: `${d.format} · ${d.score}/100` })), { value: -1, label: pc.dim("No, just keep the list") }] });
  if (p.isCancel(pick) || pick === -1) { p.outro("Ideas saved. Make one any time: reelix list-ideas"); process.exit(0); }
  const d = ideas[pick];
  const PK = J(".claude", "agent-memory", "idea-scout", "picks.md");
  const lines = fs.existsSync(PK) ? fs.readFileSync(PK, "utf8").split("\n").filter((l) => l.startsWith("- ")) : [];
  lines.push(`- ${today()} · ${d.topic || topicLabel || "niche"} · ${d.format}/${d.style} · ${d.title}`);
  fs.writeFileSync(PK, `# Ideas the user picked (newest last, kept to 20 by the CLI)\n${lines.slice(-20).join("\n")}\n`);
  p.outro(`Starting ${pc.bold(d.name)}…`);
  const c = spawn(process.execPath, [J("cli", "reelix.mjs"), d.name, "--about", d.about, "--format", d.format, "--style", d.style], { stdio: "inherit" });
  c.on("close", (code) => process.exit(code));
}

/** A video exists for this idea when any videos/<date>-<name>/final.mp4 exists. */
export function videoMade(name) {
  const V = J("videos"); if (!fs.existsSync(V)) return false;
  return fs.readdirSync(V).some((f) => f.replace(/^\d{4}-\d{2}-\d{2}-/, "") === name && fs.existsSync(path.join(V, f, "final.mp4")));
}
export function videoStarted(name) {
  const V = J("videos"); if (!fs.existsSync(V)) return false;
  return fs.readdirSync(V).some((f) => f.replace(/^\d{4}-\d{2}-\d{2}-/, "") === name);
}
