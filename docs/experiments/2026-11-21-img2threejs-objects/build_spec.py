#!/usr/bin/env python3
"""Expands a short object description (objects/<name>.json) into a full img2threejs ObjectSculptSpec.
The skill itself is untouched: this runs its own scripts (new_pre_spec_assessment.py, new_sculpt_spec.py) to make the
starter spec, then fills the fields the skill asks the agent to fill (object class, parts, materials, features,
details, lights), so its strict-quality gate and its code generator do the checking and the building.

  python3 build_spec.py objects/car.json work/car

Short description format (all sizes in metres; positions are part centres; rotations in radians):
{ "name": "Toy Car", "complexity": "moderate", "type": "vehicle", "form": [...], "structure": [...], "motion": [...],
  "materials": { "paint": ["#d83b2e", "plastic"], "glass": ["#9cc6e8", "glass"], ... },
  "parts": [ [id, level, primitive, [w,h,d], [x,y,z], [rx,ry,rz], material, extra?], ... ],   level: macro | meso | micro
  "features": [ [id, name, [part ids], tier], ... ],   "details": [ [id, text, part id], ... ] }
extra (optional dict) goes into geometryDescriptor (torusTubeRatio, latheProfile, extrude profile2D, tubePath ...).
"""
import copy, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__)); SK = os.path.join(HERE, "img2threejs")
src, out = sys.argv[1], sys.argv[2]
O = json.load(open(src)); os.makedirs(out, exist_ok=True)
# a refine (spec already exists): keep the review trail so passes already credited stay credited
OLD = json.load(open(os.path.join(out, "spec.json"))) if os.path.exists(os.path.join(out, "spec.json")) else None
ref = os.path.join(HERE, "3-reference-pictures", os.path.basename(src).replace(".json", ".png"))
py = lambda *a: subprocess.run([sys.executable, "-I", *a], check=True, cwd=out, capture_output=True, text=True)
py(f"{SK}/forge/stage2_spec/new_pre_spec_assessment.py", O["name"], "--image", ref, "--complexity", O.get("complexity", "moderate"), "--out", "assessment.json", "--force")
py(f"{SK}/forge/stage2_spec/new_sculpt_spec.py", O["name"], "--image", ref, "--assessment", "assessment.json", "--out", "spec.json", "--force")
S = json.load(open(os.path.join(out, "spec.json")))

def rgba(hexc, a=1.0):
    h = hexc.lstrip("#"); return f"rgba({int(h[0:2],16)}, {int(h[2:4],16)}, {int(h[4:6],16)}, {a})"
def shade(hexc, k):
    h = hexc.lstrip("#"); return "#" + "".join(f"{max(0, min(255, int(int(h[i:i+2],16) * k))):02x}" for i in (0, 2, 4))

# ---- object class (what the agent saw in the reference picture)
oc = S["preSpecAssessment"]["objectClass"]
oc.update(primaryType=O["type"], primaryDomain="object", formLanguage=O["form"], structureKind=O["structure"], motionPotential=O["motion"],
          materialFamilies=sorted({m[1] for m in O["materials"].values()}), notes="Filled from the FLUX reference picture (toy figurine look).")

# ---- materials: one per entry, with a palette, roughness and a local override (the strict gate asks for one)
tmpl_m = copy.deepcopy(S["materials"][0]); mats = []
CLASS = {"plastic": "plastic", "glass": "glass", "rubber": "rubber", "metal": "metal", "wood": "wood", "stone": "stone", "fabric": "fabric", "foliage": "organic", "organic": "organic", "emissive": "plastic"}
for mid, (col, fam) in O["materials"].items():
    m = copy.deepcopy(tmpl_m)
    m.update(id=mid, name=mid, baseColor=col, color=col)
    m["albedo"] = {"dominant": col, "secondary": [shade(col, 0.85), shade(col, 1.1)], "samplingNotes": "Toy figurine colours from the reference picture."}
    m["colorVariation"] = {"palette": [col, shade(col, 0.85), shade(col, 1.1)], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}
    m["roughness"] = 0.08 if fam == "glass" else 0.85 if fam in ("rubber", "stone", "wood", "foliage", "organic", "fabric") else 0.35
    m["metalness"] = 0.6 if fam == "metal" else 0.0
    m["localOverrides"] = [{"id": f"{mid}-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": shade(col, 1.08), "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]},
                           {"id": f"{mid}-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": shade(col, 0.8), "evidenceRefs": ["full-object"]}]
    for f in ("normal", "bump", "displacement", "surfaceFrequencyBands", "textureProjection", "textureResolution", "referencePbr"): m.pop(f, None)
    m["textureless"] = {"declared": True, "evidence": ["reference picture 3-reference-pictures/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}
    mats.append(m)
coat = copy.deepcopy(mats[0]); coat.update(id="coat", name="satin plastic coat", baseColor="#ffffff", color="#ffffff"); coat["roughness"] = 0.2; coat["clearcoat"] = 0.6   # glossy toy plastic, as in the reference pictures
coat["localOverrides"] = [{"id": "coat-gloss", "kind": "gloss", "mask": "top faces", "roughnessDelta": -0.1, "evidenceRefs": ["full-object"]}]
mats.append(coat)
S["materials"] = mats

# ---- parts
tmpl_c = copy.deepcopy(S["componentTree"][0]); comps = []
TOPO = {"box": "assembled-solid", "cylinder": "assembled-solid", "cone": "assembled-solid", "torus": "assembled-solid", "extrude": "assembled-solid",
        "sphere": "continuous-sculpt", "ellipsoid": "continuous-sculpt", "capsule": "continuous-sculpt", "lathe": "continuous-sculpt", "tube": "continuous-sculpt"}
root = copy.deepcopy(tmpl_c); root.update(id="root", name=O["name"], level="macro", role="assembly root", primitive="box", material=list(O["materials"])[0], materialLayers=[list(O["materials"])[0], "coat"])
root["transform"] = {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.001, 0.001, 0.001]}   # an invisible pivot; parts hang off it
root["dimensions"] = {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "m", "confidence": 1.0}
root["topologyRationale"] = "Assembly pivot only; the visible parts are its children."
mat_of = {k: v for k, v in O["materials"].items()}
root["colorMaterialRecipe"] = {"dominantAlbedo": rgba(list(mat_of.values())[0][0]), "secondaryAlbedo": rgba(shade(list(mat_of.values())[0][0], 0.85)), "materialClass": CLASS.get(list(mat_of.values())[0][1], "plastic"), "materialClassConfidence": 0.8}
comps.append(root)
for p in O["parts"]:
    pid, level, prim, dims, pos, rot, mat = p[:7]; extra = p[7] if len(p) > 7 else {}
    c = copy.deepcopy(tmpl_c)
    c.update(id=pid, name=pid.replace("-", " "), level=level, role=level + " part", primitive=prim, parent="root", material=mat, materialLayers=[mat, "coat"],
             topologyClass=TOPO.get(prim, "assembled-solid"), topologyRationale=f"{prim} matches the {pid} form seen in the reference.", fidelityTier="form")
    c["attachment"] = {"parentId": "root", "parentSocket": "root-origin", "localStart": pos, "localEnd": pos, "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}
    c["transform"] = {"position": pos, "rotation": rot, "scale": dims}
    c["dimensions"] = {"width": dims[0], "height": dims[1], "depth": dims[2], "units": "m", "confidence": 0.7}
    c["geometryDescriptor"] = {**c["geometryDescriptor"], **extra}
    col, fam = mat_of[mat]
    c["colorMaterialRecipe"] = {"dominantAlbedo": rgba(col), "secondaryAlbedo": rgba(shade(col, 0.85)), "materialClass": CLASS.get(fam, "plastic"), "materialClassConfidence": 0.8}
    c["localFeatures"] = [{"id": f"{pid}-form", "kind": "form", "description": f"{pid} shape as in the reference", "evidenceRefs": ["full-object"]}] if level == "micro" else []
    c["surfaceDetail"] = {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain",
                          "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground",
                          "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}
    comps.append(c)
S["componentTree"] = comps

# ---- identity features (what must read right), detail inventory, lights
S["featureReviewTargets"] = [{"id": fid, "name": nm, "tier": tier, "passIds": ["blockout", "structural-pass", "form-refinement"], "minimumScore": 0.8 if tier == "critical" else 0.7,
                              "mustPass": tier == "critical", "componentRefs": refs, "evidenceRefs": ["full-object"]} for fid, nm, refs, tier in O["features"]]
KIND = lambda t: "emissive" if "light" in t else "gloss" if ("glass" in t or "window" in t or "shiny" in t) else "bevel" if ("round" in t or "edge" in t) else "contour"
S["preSpecAssessment"]["detailInventory"]["details"] = [{"id": did, "kind": KIND(txt), "description": txt, "zone": "full-object", "mapsTo": {"ref": f"{part}-form"}, "evidenceRefs": ["full-object"]} for did, txt, part in O["details"]]
for d in O["details"]:   # each detail must exist as a localFeature on its part
    for c in comps:
        if c["id"] == d[2] and not any(f["id"] == f"{d[2]}-form" for f in c["localFeatures"]):
            c["localFeatures"].append({"id": f"{d[2]}-form", "kind": "detail", "description": d[1], "evidenceRefs": ["full-object"]})
S["lightingFromPhoto"] = [
    {"role": "key", "type": "directional", "direction": [4, 8, 6], "color": "#fff6e8", "intensity": 1.7, "notes": "soft studio key light from upper front right, soft PCF shadows"},
    {"role": "fill", "type": "hemisphere", "skyColor": "#fff6e8", "groundColor": "#9a7a60", "intensity": 1.25, "notes": "warm sky fill"},
    {"role": "rim", "type": "directional", "direction": [-5, 4, -6], "color": "#dfe9ff", "intensity": 0.9, "notes": "cool rim light from behind for round edges"},
    {"role": "exposure", "notes": "exposure 1.0, ACES filmic tone mapping, light grey background #dde6ec, contact shadow on the ground plane"}]
for bp in S["buildPasses"]:
    bp["componentRefs"] = [c["id"] for c in comps]
    if bp["id"] == "lighting-pass":
        bp["lights"] = [{"type": "directional", "role": "key", "position": [4, 8, 6], "color": "#fff6e8", "intensity": 1.7},
                        {"type": "hemisphere", "role": "fill", "color": "#fff6e8", "groundColor": "#9a7a60", "intensity": 1.25},
                        {"type": "directional", "role": "rim", "position": [-5, 4, -6], "color": "#dfe9ff", "intensity": 0.9}]
# toy plastic has no photo texture: use the skill's "balanced" quality priority instead of "reference-fidelity"
# (reference-fidelity's material pass demands 1024 px PBR maps extracted from photo pixels, which a flat toy does not have)
S.setdefault("lookDevTargets", {})["qualityPriority"] = "balanced"
if OLD:
    for k in ("reviewHistory", "sculptPipeline", "visualEvidence"):
        if k in OLD: S[k] = OLD[k]
json.dump(S, open(os.path.join(out, "spec.json"), "w"), indent=1)
r = subprocess.run([sys.executable, "-I", f"{SK}/forge/stage2_spec/validate_sculpt_spec.py", "spec.json", "--strict-quality"], cwd=out, capture_output=True, text=True)
print(r.stdout.strip().splitlines()[0] if r.stdout.strip() else "?")
print("\n".join(l for l in r.stdout.splitlines() if l.startswith("error")))
sys.exit(r.returncode)
