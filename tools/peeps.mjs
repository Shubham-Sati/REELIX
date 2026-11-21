// Open Peeps people as SVG (library/peeps: npm @opeepsfun/open-peeps 1.0.6, art CC0, code MIT; fetched by tools/asset_library.py).
// Approved from docs/experiments/2026-11-21-kit-2d-people.
//   node tools/peeps.mjs <out.svg> [--body Hoodie] [--head ShortOne] [--face Smile] [--beard Chin] [--glasses Glasses]
//                        [--skin "#D08B5B"] [--clothes "#9DDADB"] [--hair "#1b1b1b"] [--seed 7]      a bust; unset parts are picked from --seed
//   node tools/peeps.mjs <out.svg> --pose standing/WalkingColorTee [--skin ...]                      a full-body pose (comes WITHOUT a head)
//   node tools/peeps.mjs --list                                                                      every body, head, face, beard, glasses, pose
// The package mixes import and require and loads parts by name, so it is converted once to plain CommonJS (esbuild from the engine).
import fs from "fs"; import path from "path"; import { createRequire } from "module"; import { fileURLToPath } from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); const NM = path.join(ROOT, "library", "peeps", "node_modules");
const W = path.join(NM, ".peeps-cjs"), SRC = path.join(NM, "@opeepsfun", "open-peeps", "build");
if (!fs.existsSync(SRC)) { console.error("Open Peeps missing: run python3 tools/asset_library.py fetch"); process.exit(1); }
if (!fs.existsSync(path.join(W, "index.js"))) {
  const esbuild = createRequire(path.join(ROOT, "templates", "remotion", "package.json"))("esbuild"); const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".js") && files.push(path.join(d, e.name)));
  walk(SRC); await esbuild.build({ entryPoints: files, outdir: W, outbase: SRC, format: "cjs", platform: "node", bundle: false, logLevel: "error" });
}
const req = createRequire(path.join(W, "index.js")); const React = req("react"), server = req("react-dom/server"), P = req("./index.js");
const a = process.argv.slice(2), opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
const sets = { body: P.EffigyBodies, head: P.Heads, face: P.Faces, beard: P.Beards, glasses: P.Accessories, standing: P.StandingBodies, sitting: P.SittingBodies };
if (a[0] === "--list") { for (const [k, v] of Object.entries(sets)) console.log(`${k}: ${Object.keys(v).join(" ")}`); process.exit(0); }
const out = a[0]; if (!out) { console.error("usage: node tools/peeps.mjs <out.svg> [options] | --list"); process.exit(1); }
let seed = +(opt("--seed") || 7); const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); const pick = (o) => { const k = Object.keys(o); return k[Math.floor(rnd() * k.length)]; };
const skin = opt("--skin") || ["#F3D1B5", "#E8B48F", "#D08B5B", "#AE5D29", "#8D5524"][Math.floor(rnd() * 5)];
let svg;
if (opt("--pose")) {
  const [kind, name] = opt("--pose").split("/"); const cfg = sets[kind]?.[name]; if (!cfg) { console.error("unknown pose; see --list"); process.exit(1); }
  const C = req(`./body/${kind}/${name}.js`).default;
  svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cfg.viewBox}" width="${Math.round(cfg.width / 4)}" height="${Math.round(cfg.height / 4)}">${server.renderToStaticMarkup(React.createElement(C, { skinColor: skin }))}</svg>`;
} else {
  const part = (k, o) => ({ type: opt("--" + k) || pick(sets[k]), options: o });
  svg = server.renderToStaticMarkup(React.createElement(P.Effigy, {
    body: part("body", { skinColor: skin, clothingColor: opt("--clothes") || "#9DDADB", outlineColor: "black" }), head: part("head", { hairColor: opt("--hair") || "#1b1b1b", outlineColor: "black" }),
    face: part("face", { outlineColor: "black" }), beard: opt("--beard") ? { type: opt("--beard"), options: {} } : undefined, accessory: opt("--glasses") ? { type: opt("--glasses"), options: {} } : undefined }));
}
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, svg); console.log(out);
