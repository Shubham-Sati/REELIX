// Non-interactive: node cli/new.mjs <name> --about "..." --format short|video --style explainer|animated  -> prints the folder
import { newVideo } from "./common.mjs";
const a = process.argv.slice(2); const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const name = a[0], about = get("--about"), format = get("--format") || "short", style = get("--style") || "animated";
if (!name || !about) { console.error('usage: node cli/new.mjs <name> --about "..." --format short|video --style explainer|animated'); process.exit(1); }
console.log(newVideo(name, about, format, style));
