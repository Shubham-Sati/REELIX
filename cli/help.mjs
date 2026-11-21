// reelix help : every command with what it is for and examples.
import pc from "picocolors";
const C = (s) => pc.cyan(s), D = pc.dim, B = pc.bold;
const rows = [
  ["MAKE A VIDEO"],
  ["reelix <video-name>", "Make a YouTube Video or Short. Asks what it is about, Video or Short, the style, then the look. The style decides which looks you are offered: Explainer teaches (3D Lego world or AI motion; Chalkboard diagrams when built), Animated tells a story (2D Realistic painting or Cartoon, or 3D AI motion or Lego world). Then makes everything (about 30-40 min for a Lego Short).", ["reelix how-tea-came-to-england"]],
  ["  --about \"…\"", "Answer question 1 (what the video is about) from the command line."],
  ["  --format short|video", "Answer question 2: short = 9:16 vertical, video = 16:9."],
  ["  --length <length>", "How long. A short: 30, 60, 90 or 120 seconds (default 30, only these). A video: standard, long or deep (about 2.5, 5 or 10 minutes; default standard) or your own length in minutes, 1.5 to 12 (--length 7). Longer means deeper research, more chapters and much more time to make."],
  ["  --style explainer|animated", "Explainer / Tutorial (teach a thing) or Animated / Motion Graphics (tell a story). It decides which looks the next question offers."],
  ["  --look painted|cartoon|aimotion|toy3d", "Answer the look question: painted / cartoon are 2D AI pictures (Animated style); aimotion (AI motion, Wan) and toy3d (Lego, built in code) are 3D and work with both styles. Flags are not restricted by style; the questions are."],
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
