#!/usr/bin/env python3
"""A map picture from Natural Earth (library/maps, public domain; fetched by tools/asset_library.py). Approved from docs/experiments/2026-11-21-kit-maps.
  python3 tools/map.py <out.png|out.svg> [--box lon0,lat0,lon1,lat1] [--chalk] [--labels] [--width 2400]
  --box: the region (default the world -180,-60,180,85; e.g. Europe -25,34,45,71, South Asia 60,5,100,38). --chalk: white lines on a
  green board (Chalkboard look). --labels: capitals with names. Plain equirectangular projection, no map library; PNG via ImageMagick."""
import json, os, subprocess, sys
D = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "library", "maps")
load = lambda f: json.load(open(os.path.join(D, f)))["features"]
countries, rivers, lakes, cities = load("ne_50m_admin_0_countries.geojson"), load("ne_50m_rivers_lake_centerlines.geojson"), load("ne_50m_lakes.geojson"), load("ne_110m_populated_places_simple.geojson")
PAL = ["#f6d18b", "#a8d5a2", "#f4a9a0", "#9fc5e8", "#d5b8e8", "#f9e79f"]

def rings(geom):
    if geom["type"] == "Polygon": return geom["coordinates"]
    if geom["type"] == "MultiPolygon": return [r for p in geom["coordinates"] for r in p]
    return []
def lines(geom):
    return [geom["coordinates"]] if geom["type"] == "LineString" else geom["coordinates"] if geom["type"] == "MultiLineString" else []

def draw(name, box, W=2400, chalk=False, labels=False):
    x0, y0, x1, y1 = box; H = int(W * (y1 - y0) / (x1 - x0))
    P = lambda c: f"{(c[0] - x0) / (x1 - x0) * W:.1f},{(y1 - c[1]) / (y1 - y0) * H:.1f}"
    path = lambda pts, close: "M" + " L".join(P(c) for c in pts) + (" Z" if close else "")
    sea, ink = ("#2f4a3a", "#f4f1e8") if chalk else ("#cfe6f3", "#5b6b78")
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}"><rect width="100%" height="100%" fill="{sea}"/>']
    for i, f in enumerate(countries):
        col = "none" if chalk else PAL[(f["properties"].get("MAPCOLOR7") or i) % len(PAL)]
        d = " ".join(path(r, True) for r in rings(f["geometry"]))
        out.append(f'<path d="{d}" fill="{col}" stroke="{ink}" stroke-width="{2.2 if chalk else 0.8}" stroke-linejoin="round"/>')
    if not chalk:
        for f in lakes: out.append(f'<path d="{" ".join(path(r, True) for r in rings(f["geometry"]))}" fill="{sea}"/>')
        for f in rivers: out.append(f'<path d="{" ".join(path(l, False) for l in lines(f["geometry"]))}" fill="none" stroke="#6fa8d6" stroke-width="1.2"/>')
    if labels:
        for f in cities:
            pr = f["properties"]
            if not pr.get("adm0cap"): continue
            lon, lat = f["geometry"]["coordinates"]
            if not (x0 < lon < x1 and y0 < lat < y1): continue
            x, y = P([lon, lat]).split(",")
            out.append(f'<circle cx="{x}" cy="{y}" r="5" fill="#c0392b" stroke="white" stroke-width="2"/><text x="{float(x) + 8}" y="{float(y) - 6}" font-size="20" fill="white" stroke="white" stroke-width="5">{pr["name"]}</text><text x="{float(x) + 8}" y="{float(y) - 6}" font-size="20" fill="#22303a">{pr["name"]}</text>')
    out.append("</svg>"); svg = name[:-4] + ".svg"; open(svg, "w").write("\n".join(out))
    if name.endswith(".png"): subprocess.run(["magick", "-font", "/System/Library/Fonts/Supplemental/Arial.ttf", "-density", "96", svg, name], check=True); os.remove(svg)
    print(name, W, "x", H)


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0].startswith("-"): print(__doc__); sys.exit(1)
    opt = lambda k, d: a[a.index(k) + 1] if k in a else d
    draw(a[0], tuple(float(x) for x in opt("--box", "-180,-60,180,85").split(",")), W=int(opt("--width", "2400")), chalk="--chalk" in a, labels="--labels" in a)
