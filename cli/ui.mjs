// The live step panel with progress bars, redrawn in place (same look as AI Video Editor's make-video).
import pc from "picocolors"; import { fmtDur } from "./common.mjs";
const W = 14;
const bar = (f, state) => { const n = Math.round(Math.min(1, f) * W); const col = state === "done" ? pc.green : state === "running" ? pc.cyan : pc.dim; return col("█".repeat(n)) + pc.dim("░".repeat(W - n)); };
const icon = (s) => (s === "done" ? pc.green("✔") : s === "running" ? pc.cyan("●") : s === "failed" ? pc.red("✖") : s === "skipped" ? pc.yellow("–") : pc.dim("○"));
export function panel(head, steps, items, remaining, note = "") {
  const out = ["", `  ${pc.bold(pc.cyan("reelix"))} ${pc.dim("·")} ${pc.bold(head.name)} ${pc.dim("·")} ${head.summary}`, `  ${pc.dim("─".repeat(74))}`];
  steps.forEach((title, si) => {
    const its = items.filter((x) => x.step === si); const all = its.every((x) => x.state === "done" || x.state === "skipped");
    out.push("", `  ${all ? pc.green("✔") : pc.bold("▸")} ${pc.bold(`Step ${si + 1}`)}  ${pc.bold(title)}`);
    its.forEach((it, k) => {
      const label = `${String.fromCharCode(97 + k)}. ${it.label}`.padEnd(38);
      const f = it.state === "done" || it.state === "skipped" ? 1 : it.frac || 0;
      const right = it.state === "done" ? pc.green("done") : it.state === "skipped" ? pc.yellow("skipped") : it.state === "failed" ? pc.red("failed") : it.state === "waiting" ? pc.dim("waiting")
        : pc.cyan(it.left > 0 ? `~${fmtDur(it.left)} left` : "working…");
      out.push(`    ${icon(it.state)} ${it.state === "waiting" ? pc.dim(label) : label} ${bar(f, it.state)} ${String(Math.round(f * 100)).padStart(3)}%  ${right}`);
      if (it.state === "running" && it.detail) out.push(`        ${pc.dim(it.detail)}`);
    });
  });
  const tot = items.reduce((s, i) => s + i.est, 0), done = items.reduce((s, i) => s + (i.state === "done" || i.state === "skipped" ? i.est : (i.frac || 0) * i.est), 0);
  out.push("", `  ${pc.dim("Overall:")} ${pc.bold(`${Math.round((done / tot) * 100)}%`)}   ${pc.dim("Estimated time left:")} ${pc.bold(remaining > 0 ? `about ${fmtDur(remaining)}` : "none")}`);
  if (note) out.push(`  ${note}`);
  out.push("");
  return out;
}
let drawn = 0;
export function draw(lines) {
  if (!process.stdout.isTTY) return;
  if (drawn) process.stdout.write(`\x1b[${drawn}A\x1b[0J`);
  process.stdout.write(lines.join("\n") + "\n"); drawn = lines.length;
}
