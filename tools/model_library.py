#!/usr/bin/env python3
"""The 3D model library (library/models): ready-made CC0 kit models the Lego look uses for everyday objects.

  python3 tools/model_library.py fetch          download every model listed in library/models/sources.json (skips what is there)
  python3 tools/model_library.py fetch --from <folder>   copy from already-downloaded kits instead (no network)
  python3 tools/model_library.py index          rebuild library/models/index.json (the catalog the set-builder reads)

Model files are NOT in git (see .gitignore); sources.json and index.json are. scripts/setup.sh runs fetch + index.
Layout: library/models/kenney/<kit>/<name>.glb (+ Textures/), library/models/quaternius/<name>.glb|.obj+.mtl,
        library/models/<maker>/<pack>/... for the packs in sources.json "packs" (Google Drive folders, GitHub repos, poly.pizza models):
        quaternius/food|space|farm|animals, kaykit/furniture|adventurers, polypizza/insects. Animated packs list their motions.
"""
import http.cookiejar, io, json, os, re, shutil, struct, sys, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "library", "models")
SRC = json.load(open(os.path.join(LIB, "sources.json")))
UA = {"User-Agent": "Mozilla/5.0"}

def get(url, opener=None, referer=None):
    req = urllib.request.Request(url, headers={**UA, **({"Referer": referer} if referer else {})})
    return (opener.open if opener else urllib.request.urlopen)(req, timeout=120).read()

def kenney_kit(kit, local=None):
    """Keep only the kit's GLB models and their shared Textures folder."""
    dest = os.path.join(LIB, "kenney", kit)
    if os.path.isdir(dest) and any(f.endswith(".glb") for f in os.listdir(dest)): return f"kenney/{kit}: already there"
    os.makedirs(dest, exist_ok=True)
    if local:   # a folder holding kenney_<kit>/ unpacked
        base = os.path.join(local, f"kenney_{kit}", "Models")
        sub = next(d for d in ("GLB format", "GLTF format") if os.path.isdir(os.path.join(base, d)))
        for f in os.listdir(os.path.join(base, sub)):
            p = os.path.join(base, sub, f)
            if f.endswith(".glb"): shutil.copy2(p, dest)
            elif f == "Textures": shutil.copytree(p, os.path.join(dest, "Textures"), dirs_exist_ok=True)
        return f"kenney/{kit}: copied from {local}"
    jar = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    page = f"https://kenney.nl/assets/{kit}"; get(page, op)                      # the site hands out a session cookie first
    link = json.loads(get("https://kenney.nl/download-link/" + ("assets/" + kit).encode().hex(), op, page))["url"]   # id = hex of "assets/<kit>"
    z = zipfile.ZipFile(io.BytesIO(get(link, op, page)))
    for n in z.namelist():
        m = re.match(r"Models/(GLB|GLTF) format/(.+)$", n)
        if not m or n.endswith("/"): continue
        rel = m.group(2)
        if rel.endswith(".glb") or rel.startswith("Textures/"):
            out = os.path.join(dest, rel); os.makedirs(os.path.dirname(out), exist_ok=True); open(out, "wb").write(z.read(n))
    return f"kenney/{kit}: downloaded"

def quaternius(local=None):
    dest = os.path.join(LIB, "quaternius"); os.makedirs(dest, exist_ok=True); Q = SRC["quaternius"]; done = 0
    for name, (pid, *_rest) in Q["glb"].items():
        out = os.path.join(dest, name + ".glb")
        if os.path.exists(out): continue
        h = get(f"https://poly.pizza/m/{pid}").decode("utf8", "ignore")
        title = re.search(r'"Title":"([^"]+)"', h).group(1)
        g = re.search(r'"Title":"' + re.escape(title) + r'".{0,3000}?https://static\.poly\.pizza/([0-9a-f-]{36})\.glb', h, re.S) or re.search(r'https://static\.poly\.pizza/([0-9a-f-]{36})\.glb', h)
        open(out, "wb").write(get(f"https://static.poly.pizza/{g.group(1)}.glb")); done += 1
    for fname, fid in Q["drive"].items():
        out = os.path.join(dest, fname)
        if os.path.exists(out): continue
        open(out, "wb").write(get(f"https://drive.google.com/uc?export=download&id={fid}")); done += 1
    return f"quaternius: {done} downloaded"

def _opener():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def _srgb_mtl(path):
    """Quaternius OBJ packs come from Blender with LINEAR colours in the .mtl, but three.js reads Kd as sRGB, so they render far too dark."""
    t = open(path).read()
    open(path, "w").write(re.sub(r"^Kd ([\d.]+) ([\d.]+) ([\d.]+)", lambda k: "Kd " + " ".join(f"{float(v) ** (1 / 2.2):.4f}" for v in k.groups()), t, flags=re.M))

KEEP = {"obj": (".obj", ".mtl", ".png"), "gltf": (".gltf", ".bin", ".png"), "glb": (".glb",)}

def drive_folder(fid, dest, keep, op=None, depth=0):
    """Every wanted file of a public Google Drive folder (and its sub-folders), flattened into dest. Returns files written."""
    op = op or _opener(); html = get(f"https://drive.google.com/drive/folders/{fid}", op).decode("utf8", "ignore"); got = 0
    for m in re.finditer(r'\\x5b\\x22([A-Za-z0-9_-]{25,40})\\x22,\\x5b\\x22' + re.escape(fid) + r'\\x22\\x5d,\\x22((?:[^\\]|\\/)+?)\\x22,\\x22((?:[^\\]|\\/)+?)\\x22', html):
        cid, name, mime = m.group(1), m.group(2).replace("\\/", "/"), m.group(3).replace("\\/", "/")   # names/types may hold escaped slashes
        if mime == "application/vnd.google-apps.folder":
            if depth < 4 and "blend" not in name.lower() and "fbx" not in name.lower(): got += drive_folder(cid, dest, keep, op, depth + 1)
            continue
        out = os.path.join(dest, name)
        if not name.lower().endswith(KEEP[keep]) or os.path.exists(out): continue
        blob = get(f"https://drive.google.com/uc?export=download&id={cid}", op)
        if blob[:15].lower().startswith(b"<!doctype html") and b"confirm" in blob[:5000]:   # big file: Drive asks to confirm
            blob = get(f"https://drive.usercontent.google.com/download?id={cid}&export=download&confirm=t", op)
        open(out, "wb").write(blob); got += 1
    return got

def pack(key, P):
    """One entry of sources.json "packs" into library/models/<key>/ (skips files already there)."""
    dest = os.path.join(LIB, key); os.makedirs(dest, exist_ok=True)
    if P["type"] == "drive":
        n = sum(drive_folder(fid, dest, P["keep"]) for fid in ([P["id"]] if isinstance(P["id"], str) else P["id"]))
    elif P["type"] == "github":   # a public repo zip (KayKit keeps CC0 copies of its itch.io packs on GitHub); keep one folder
        if any(f.endswith(KEEP[P["keep"]][0]) for f in os.listdir(dest)): n = 0
        else:
            z = zipfile.ZipFile(io.BytesIO(get(f"https://codeload.github.com/{P['repo']}/zip/refs/heads/main"))); n = 0
            for name in z.namelist():
                rel = name.split("/", 1)[1] if "/" in name else ""
                if rel.startswith(P["path"] + "/") and not name.endswith("/") and name.lower().endswith(KEEP[P["keep"]]) and "/" not in rel[len(P["path"]) + 1:]:
                    open(os.path.join(dest, os.path.basename(name)), "wb").write(z.read(name)); n += 1
    else:   # poly.pizza: one model page per name, licence checked on the page
        n = 0
        for name, (pid, _h) in P["models"].items():
            out = os.path.join(dest, name + ".glb")
            if os.path.exists(out): continue
            h = get(f"https://poly.pizza/m/{pid}").decode("utf8", "ignore")
            if "CC0" not in (re.search(r'"Licence":"([^"]+)"', h) or [None, ""])[1]: print(f"  {name}: not CC0, skipped"); continue
            ids = list(dict.fromkeys(re.findall(r'static\.poly\.pizza/([0-9a-f-]{36})\.glb', h)))
            t = re.search(r'"Title":"([^"]+)"', h).group(1)
            g = ids[0] if len(ids) == 1 else (re.search(r'"Title":"' + re.escape(t) + r'".{0,3000}?static\.poly\.pizza/([0-9a-f-]{36})\.glb', h, re.S) or [None, None])[1]
            if g: open(out, "wb").write(get(f"https://static.poly.pizza/{g}.glb")); n += 1
    if P.get("linear"):
        for f in os.listdir(dest):
            mark = os.path.join(dest, f + ".srgb")
            if f.endswith(".mtl") and not os.path.exists(mark): _srgb_mtl(os.path.join(dest, f)); open(mark, "w").close()   # fix each .mtl once
    return f"{key}: {n} files downloaded"

# ---------------------------------------------------------------- index
def _mat(node):
    """4x4 local matrix of a glTF node (matrix, or translation * rotation * scale)."""
    if "matrix" in node:
        m = node["matrix"]; return [[m[c * 4 + r] for c in range(4)] for r in range(4)]   # glTF stores column-major
    tx, ty, tz = node.get("translation", [0, 0, 0]); x, y, z, w = node.get("rotation", [0, 0, 0, 1]); sx, sy, sz = node.get("scale", [1, 1, 1])
    R = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    return [[R[0][0] * sx, R[0][1] * sy, R[0][2] * sz, tx], [R[1][0] * sx, R[1][1] * sy, R[1][2] * sz, ty], [R[2][0] * sx, R[2][1] * sy, R[2][2] * sz, tz], [0, 0, 0, 1]]
def _mul(A, B): return [[sum(A[i][k] * B[k][j] for k in range(4)) for j in range(4)] for i in range(4)]

def gltf_json(path):
    if path.endswith(".gltf"): return json.load(open(path))
    b = open(path, "rb").read(); n = struct.unpack("<I", b[12:16])[0]; return json.loads(b[20:20 + n])

def obj_box(path):
    xs, ys, zs = [], [], []
    for line in open(path, errors="ignore"):
        if line.startswith("v "):
            x, y, z = map(float, line.split()[1:4]); xs.append(x); ys.append(y); zs.append(z)
    return [max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)] if xs else [1, 1, 1]

def box(path): return obj_box(path) if path.endswith(".obj") else glb_box(path)

def glb_box(path):
    """World-space size of a GLB: every mesh's accessor box corners pushed through its full node transform chain."""
    if path.endswith(".gltf"): j = json.load(open(path))
    else: b = open(path, "rb").read(); n = struct.unpack("<I", b[12:16])[0]; j = json.loads(b[20:20 + n])
    lo, hi = [1e9] * 3, [-1e9] * 3
    def walk(i, M):
        node = j["nodes"][i]; W = _mul(M, _mat(node))
        if "mesh" in node:
            for prim in j["meshes"][node["mesh"]]["primitives"]:
                a = j["accessors"][prim["attributes"]["POSITION"]]; mn, mx = a["min"], a["max"]
                for cx in (mn[0], mx[0]):
                    for cy in (mn[1], mx[1]):
                        for cz in (mn[2], mx[2]):
                            v = [W[r][0] * cx + W[r][1] * cy + W[r][2] * cz + W[r][3] for r in range(3)]
                            for k in range(3): lo[k] = min(lo[k], v[k]); hi[k] = max(hi[k], v[k])
        for c in node.get("children", []): walk(c, W)
    I = [[1 if r == c else 0 for c in range(4)] for r in range(4)]
    for r in j["scenes"][j.get("scene", 0)]["nodes"]: walk(r, I)
    return [hi[k] - lo[k] for k in range(3)]

CATS = [("cliff", "landform"), ("bridge", "prop"), ("path", "ground"), ("campfire", "prop"), ("platform", "ground"), ("ground", "ground"), ("tree", "tree"), ("palm", "tree"), ("pine", "tree"), ("bush", "plant"), ("plant", "plant"), ("flower", "plant"), ("grass", "plant"), ("cactus", "plant"), ("mushroom", "plant"),
        ("rock", "rock"), ("stone", "rock"), ("cliff", "landform"), ("log", "prop"), ("campfire", "prop"), ("bridge", "prop"), ("fence", "prop"), ("path", "ground"), ("ground", "ground"),
        ("building", "house"), ("driveway", "ground"), ("planter", "prop"), ("tent", "prop"), ("bed", "prop"), ("sign", "prop"), ("statue", "prop"), ("pot", "prop"), ("crop", "plant"),
        ("railroad", "track"), ("track", "track"), ("spline", "track"), ("train", "train"), ("boat", "boat"), ("ship", "boat"), ("canoe", "boat"), ("buoy", "prop"), ("cargo", "prop"),
        ("container", "prop"), ("gate", "prop"), ("ramp", "prop"), ("arrow", "prop"), ("debris", "part"), ("wheel", "part"), ("cone", "prop"), ("box", "prop"), ("kart", "car"),
        ("truck", "truck"), ("tractor", "truck"), ("firetruck", "truck"), ("ambulance", "truck"), ("delivery", "truck"), ("garbage", "truck"), ("van", "car"), ("police", "car"),
        ("taxi", "car"), ("sedan", "car"), ("suv", "car"), ("hatchback", "car"), ("race", "car")]
EVERYDAY = ["idle", "walk", "run", "sit", "lie", "eat", "gallop", "jump", "cheer", "wave", "interact", "pickup", "use_item", "throw", "punch", "dodge", "hit", "death"]

def category(name):
    n = name.lower()
    for key, cat in CATS:
        if key in n: return cat
    return "prop"

def index():
    items = []
    for kit in SRC["kenney"]["kits"]:
        d = os.path.join(LIB, "kenney", kit)
        if not os.path.isdir(d): continue
        boxes = {f[:-4]: glb_box(os.path.join(d, f)) for f in sorted(os.listdir(d)) if f.endswith(".glb")}
        ref, axis, size = SRC["kenney"]["scale"][kit]
        rb = boxes[ref]; k = size / (rb[1] if axis == "h" else max(rb[0], rb[2]))   # one scale per kit keeps its models in proportion
        for name, b in boxes.items():
            c = category(name); c = SRC["kenney"].get("cat", {}).get(kit, c) if c == "prop" else c   # a kit's own category when the name says nothing
            items.append({"id": f"kenney/{kit}/{name}", "file": f"models/kenney/{kit}/{name}.glb", "category": c, "source": f"Kenney {kit} (CC0)",
                          "h": round(max(b[1] * k, 0.01), 3), "l": round(max(b[0], b[2]) * k, 3)})
    Q = SRC["quaternius"]
    for name, (pid, cat, h, l) in Q["glb"].items():
        if os.path.exists(os.path.join(LIB, "quaternius", name + ".glb")):
            items.append({"id": f"quaternius/{name}", "file": f"models/quaternius/{name}.glb", "category": cat, "source": "Quaternius (CC0)", "h": h, "l": l})
    for name, (fname, cat, h, l, body, flip) in Q["obj"].items():
        if os.path.exists(os.path.join(LIB, "quaternius", fname + ".obj")):
            items.append({"id": f"quaternius/{name}", "file": f"models/quaternius/{fname}.obj", "category": cat, "source": "Quaternius (CC0)", "h": h, "l": l, "body": body, **({"flip": True} if flip else {})})
    for key, P in [kv for kv in SRC.get("packs", {}).items() if not kv[0].startswith("_")]:   # Google Drive / GitHub / poly.pizza packs
        d = os.path.join(LIB, key)
        if not os.path.isdir(d): continue
        ext = {"obj": ".obj", "gltf": ".gltf", "glb": ".glb"}[P.get("keep", "glb")]
        files = sorted(f for f in os.listdir(d) if f.endswith(ext))
        boxes = {f: box(os.path.join(d, f)) for f in files}
        if "scale" in P:   # one scale for the whole pack, from a reference model
            ref, axis, size = P["scale"]; rb = boxes.get(ref + ext)
            if not rb: print(f"  {key}: reference {ref} missing"); continue
            ks = {f: size / (rb[1] if axis == "h" else max(rb[0], rb[2])) for f in files}
        else:              # a real height per model (animals, characters, insects)
            sizes = P.get("sizes") or {n: v[1] for n, v in P.get("models", {}).items()}
            ks = {f: sizes[f[:-len(ext)]] / boxes[f][1] for f in files if f[:-len(ext)] in sizes and boxes[f][1] > 0}
        for f, k in ks.items():
            b = boxes[f]; name = f[:-len(ext)]; c = category(name)
            it = {"id": f"{key}/{name}", "file": f"models/{key}/{f}", "category": P["cat"] if c == "prop" else c, "source": P["source"],
                  "h": round(max(b[1] * k, 0.005), 3), "l": round(max(b[0], b[2]) * k, 3)}
            clips = [a.get("name", "") for a in gltf_json(os.path.join(d, f)).get("animations", [])] if P.get("animated") else []
            if clips: it["clips"] = clips
            items.append(it)
    for f in sorted(os.listdir(os.path.join(ROOT, "library", "props"))) if os.path.isdir(os.path.join(ROOT, "library", "props")) else []:
        if f.endswith(".tsx"):   # objects built in code for a video and saved for reuse (see CLAUDE.md, model library)
            first = open(os.path.join(ROOT, "library", "props", f)).readline()
            m = re.search(r"category=(\w+).*?h=([\d.]+)", first)
            items.append({"id": f"props/{f[:-4]}", "file": f"library/props/{f}", "category": m.group(1) if m else "prop", "source": "built for REELIX", "h": float(m.group(2)) if m else 1.0, "code": True})
    cats = {}
    for it in items: cats[it["category"]] = cats.get(it["category"], 0) + 1
    json.dump({"_about": "Catalog of ready-made 3D models for the Lego look (built by tools/model_library.py index). Use one in a shot with <KitModel file=\"<file>\" h={h} /> from the kit; "
               "h = real height in metres (a kit person is 1.75), l = length. clips = the model is rigged and moves: use <AnimatedModel file h clip=\"Walk\" t={t} /> with one of these motion names. code: true = an object built for an earlier video, reused by copying library/props/<name>.tsx into the video as _prop_<name>.tsx.",
               "counts": dict(sorted(cats.items())), "models": items}, open(os.path.join(LIB, "index.json"), "w"), indent=1)
    # the same catalog as one line per model, easy to grep: category | file | h | l | extra
    with open(os.path.join(LIB, "catalog.txt"), "w") as f:
        f.write("# Model library catalog (made by tools/model_library.py index). Use: <KitModel file=\"<file>\" h={<h>} [body=... flip] />. h, l in metres.\n")
        f.write("# anim=... : a rigged model that moves; use <AnimatedModel file=\"<file>\" h={<h>} clip=\"<one of anim>\" t={t} /> instead of KitModel.\n")
        f.write("# grep it, e.g.: grep -iE 'bus|tram' library/models/catalog.txt    code props (library/props) are copied into the video as _prop_<name>.tsx\n")
        for it in sorted(items, key=lambda x: (x["category"], x["id"])):
            cl = sorted(it.get("clips") or [], key=lambda n: next((i for i, k in enumerate(EVERYDAY) if k in n.lower()), 99))   # everyday motions first
            anim = ("anim=" + ",".join(cl[:14]) + (f",+{len(cl) - 14} more (index.json)" if len(cl) > 14 else "")) if cl else ""
            extra = " ".join(x for x in (f'body={it["body"]}' if it.get("body") else "", "flip" if it.get("flip") else "", "code" if it.get("code") else "", anim) if x)
            f.write(f'{it["category"]:9}| {it["file"]:58}| h={it["h"]:<6}| l={it.get("l", "")}{" | " + extra if extra else ""}\n')
    return f"index: {len(items)} models in {len(cats)} categories"

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "index"
    local = sys.argv[sys.argv.index("--from") + 1] if "--from" in sys.argv else None
    if cmd == "fetch":
        for kit in SRC["kenney"]["kits"]: print(kenney_kit(kit, local))
        if local and os.path.isdir(os.path.join(local, "q")):   # already-downloaded Quaternius files
            os.makedirs(os.path.join(LIB, "quaternius"), exist_ok=True)
            names = {v[0] for v in SRC["quaternius"]["obj"].values()}
            for f in os.listdir(os.path.join(local, "q")):
                if f.endswith((".obj", ".mtl")) and f.split(".")[0] in names: shutil.copy2(os.path.join(local, "q", f), os.path.join(LIB, "quaternius", f))
        print(quaternius(local))
        for key, P in [kv for kv in SRC.get("packs", {}).items() if not kv[0].startswith("_")]:
            try: print(pack(key, P))
            except Exception as e: print(f"{key}: FAILED ({e}); run fetch again later, finished files are kept")
        print(index())
    else:
        print(index())
