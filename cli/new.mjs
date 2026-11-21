// Non-interactive: node cli/new.mjs <name> --about "..." --format short|video --length <30|60|90|120 for a short; standard|long|deep or minutes for a video> --style explainer|animated --look painted|cartoon|aimotion|toy3d [--captions]  -> prints the folder (explainer offers toy3d/aimotion; animated offers all four)
import { newVideo } from "./common.mjs";
const a = process.argv.slice(2); const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const name = a[0], about = get("--about"), format = get("--format") || "short", style = get("--style") || "animated", look = get("--look") || "painted";
if (!name || !about) { console.error('usage: node cli/new.mjs <name> --about "..." --format short|video --style explainer|animated --look painted|cartoon|aimotion|toy3d'); process.exit(1); }
console.log(newVideo(name, about, format, style, look, get("--length"), a.includes("--captions")));   // captions on the video: off unless --captions
