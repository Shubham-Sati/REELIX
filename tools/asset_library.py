#!/usr/bin/env python3
"""2D and Chalkboard assets in library/ (approved from docs/experiments/2026-11-21-kit-icons, -kit-maps, -kit-2d-people, -kit-chalk-fonts).

  python3 tools/asset_library.py fetch     download what is missing:
      library/icons/lucide/*.svg   every Lucide icon (lucide-static 0.460.0, ISC licence: keep library/icons/lucide/LICENSE)
      library/maps/*.geojson       Natural Earth (public domain): countries 1:110m and 1:50m, rivers, lakes, capitals
      library/peeps/               Open Peeps (npm @opeepsfun/open-peeps 1.0.6: art CC0, code MIT) + react, for tools/peeps.mjs
  library/chalk/fonts.json (in git) lists the 14 handwriting fonts; they need no download (@remotion/google-fonts loads them at render).
Files are not in git except READMEs and fonts.json. scripts/setup.sh runs this."""
import io, json, os, subprocess, sys, tarfile, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); LIB = os.path.join(ROOT, "library")
get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "reelix-setup"}), timeout=120).read()

def icons():
    d = os.path.join(LIB, "icons", "lucide")
    if os.path.isdir(d) and len(os.listdir(d)) > 100: return "icons: already there"
    os.makedirs(d, exist_ok=True); t = tarfile.open(fileobj=io.BytesIO(get("https://registry.npmjs.org/lucide-static/-/lucide-static-0.460.0.tgz"))); n = 0
    for m in t.getmembers():
        if m.isfile() and (m.name.startswith("package/icons/") and m.name.endswith(".svg") or m.name == "package/LICENSE"):
            open(os.path.join(d, os.path.basename(m.name)), "wb").write(t.extractfile(m).read()); n += 1
    return f"icons: {n} files"

def maps():
    d = os.path.join(LIB, "maps"); os.makedirs(d, exist_ok=True); n = 0
    for f in ["ne_110m_admin_0_countries", "ne_50m_admin_0_countries", "ne_50m_rivers_lake_centerlines", "ne_50m_lakes", "ne_110m_populated_places_simple"]:
        out = os.path.join(d, f + ".geojson")
        if not os.path.exists(out): open(out, "wb").write(get(f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/{f}.geojson")); n += 1
    return f"maps: {n} downloaded"

def peeps():
    d = os.path.join(LIB, "peeps")
    if os.path.isdir(os.path.join(d, "node_modules", "@opeepsfun")): return "peeps: already there"
    os.makedirs(d, exist_ok=True); open(os.path.join(d, "package.json"), "w").write('{"name":"reelix-peeps","private":true}')
    subprocess.run(["npm", "install", "--no-audit", "--no-fund", "--silent", "@opeepsfun/open-peeps@1.0.6", "react@18.3.1", "react-dom@18.3.1"], cwd=d, check=True)
    return "peeps: installed"

if __name__ == "__main__":
    if (sys.argv[1] if len(sys.argv) > 1 else "") != "fetch": print(__doc__); sys.exit()
    for f in (icons, maps, peeps):
        try: print(f())
        except Exception as e: print(f.__name__, "FAILED:", e, "(run again later)")
