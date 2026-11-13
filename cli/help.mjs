// reelix help : every command with what it is for and examples.
import pc from "picocolors";
const C = (s) => pc.cyan(s), D = pc.dim, B = pc.bold;
const rows = [
  ["MAKE A VIDEO"],
  ["reelix <video-name>", "Make a YouTube Video or Short. Asks 3 questions: what it is about, Video or Short, style. Then makes everything (about 30 min for a Short).", ["reelix how-tea-came-to-england"]],
  ["  --about \"…\"", "Answer question 1 (what the video is about) from the command line."],
  ["  --format short|video", "Answer question 2: short = 9:16 vertical, video = 16:9."],
  ["  --style explainer|animated", "Answer question 3: Explainer / Tutorial, or Animated / Motion Graphics."],
  ["  --yes", "Start without asking \"Start making this video?\"", ["reelix moon-dust --about \"Why moon dust is dangerous\" --format short --style animated --yes"]],
  ["", "Run the same command again after a stop or error: finished steps are kept."],
  ["FIND IDEAS"],
  ["reelix viral-ideas [count] [topic]", "Viral YouTube Video and Shorts ideas, backed by what is getting views right now. Default 5 ideas in your channel niche (config/voice.md). Pick one to start making it.",
    ["reelix viral-ideas", "reelix viral-ideas 10", "reelix viral-ideas 10 space history"]],
  ["reelix list-ideas [count]", "Saved ideas that have no video yet, oldest first (default 5). Pick one to start making it. Also: reelix saved-ideas.",
    ["reelix list-ideas", "reelix list-ideas 10"]],
  ["HELP"],
  ["reelix help", "This list (also: reelix --help, reelix -h)."],
  ["SETUP AND UPKEEP (run inside the REELIX folder)"],
  ["scripts/setup.sh", "Install everything on a new Mac: tools, packages and all models, with a progress bar per model.", ["scripts/setup.sh --no-music", "scripts/setup.sh --check", "scripts/setup.sh --use-existing \"/path/to/AI Video Editor\""]],
  ["node cli/memory.mjs", "Check and tidy the agents' memory (runs on its own after every video)."],
];
const out = ["", `  ${pc.bgCyan(pc.black(" reelix "))}  ${B("AI YouTube video and Shorts maker")}`, `  ${D("Everything runs on your Mac. Results: videos/<date>-<name>/final.mp4, thumbnail.png, youtube.md")}`];
for (const [cmd, what, ex] of rows) {
  if (what === undefined) { out.push("", `  ${B(pc.magenta(cmd))}`); continue; }
  const sub = cmd.startsWith("  "), pad = sub ? "          " : "      ";
  if (sub) out.push(`      ${C(cmd.trim())}  ${D("·")} ${what}`); else out.push(cmd ? `    ${C(cmd)}` : "", `${pad}${what}`.replace(/^\s+$/, ""));
  for (const e of ex || []) out.push(`${pad}${D("e.g.")} ${e}`);
}
out.push("", `  ${D("Full guide: SETUP.md and README.md")}`, "");
console.log(out.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n"));
