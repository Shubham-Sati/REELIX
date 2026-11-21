#!/usr/bin/env python3
"""Writes the short descriptions (objects/<name>.json) of the 15 remaining objects, read off the FLUX reference
pictures in 3-reference-pictures/. build_spec.py turns each into a full img2threejs spec. Sizes in metres, y up, +z = front.
Rotations: a cylinder stands along y; rot [1.5708,0,0] lays it along z, rot [0,0,1.5708] lays it along x."""
import json, math, os
HERE = os.path.dirname(os.path.abspath(__file__))
X, Z = [0, 0, 1.5708], [1.5708, 0, 0]

def save(name, o):
    json.dump(o, open(os.path.join(HERE, name + ".json"), "w"), indent=1)

def base(name, typ, form, structure, motion, materials):
    return {"name": name, "complexity": "moderate", "type": typ, "form": form, "structure": structure, "motion": motion, "materials": materials, "parts": [], "features": [], "details": []}

# ---------------- rocks: three rounded grey boulders + pebbles
o = base("Toy Rocks", "nature prop", ["rounded boulders"], ["three boulders", "pebbles"], ["static"], {"rock": ["#7d8086", "stone"], "rock2": ["#6c6f75", "stone"], "pebble": ["#8c8f94", "stone"]})
o["parts"] = [["rock-a", "macro", "ellipsoid", [0.62, 0.5, 0.58], [-0.42, 0.24, -0.15], [0, 0.3, 0.05], "rock"],
              ["rock-b", "macro", "ellipsoid", [0.6, 0.48, 0.56], [0.45, 0.23, -0.2], [0, -0.4, -0.05], "rock2"],
              ["rock-c", "meso", "ellipsoid", [0.6, 0.52, 0.58], [0.0, 0.25, 0.25], [0, 0.1, 0], "rock"],
              ["pebble-a", "meso", "ellipsoid", [0.14, 0.09, 0.12], [-0.15, 0.04, 0.6], [0, 0.5, 0], "pebble"],
              ["pebble-b", "meso", "ellipsoid", [0.11, 0.07, 0.1], [0.38, 0.03, 0.42], [0, 0.2, 0], "pebble"],
              ["chip-a", "micro", "ellipsoid", [0.06, 0.04, 0.06], [-0.6, 0.02, 0.28], [0, 0, 0], "pebble"],
              ["chip-b", "micro", "ellipsoid", [0.05, 0.03, 0.05], [0.7, 0.02, 0.15], [0, 0, 0], "pebble"]]
o["features"] = [["silhouette", "Three rounded boulders touching each other", ["rock-a", "rock-b", "rock-c"], "critical"], ["pebbles", "Small pebbles in front", ["pebble-a", "pebble-b"], "important"]]
o["details"] = [["gloss", "shiny round highlight on each boulder", "rock-c"], ["front-pebble", "pebble in front", "pebble-a"], ["side-pebble", "pebble at the side", "pebble-b"],
                ["chip-l", "tiny chip at left", "chip-a"], ["chip-r", "tiny chip at right", "chip-b"], ["round-edge", "rounded edge of the back boulder", "rock-a"]]
save("rocks", o)

# ---------------- mountain: dark rocky cone, white snow cap running down, boulders at the base
o = base("Toy Snowy Mountain", "landform", ["broad cone", "snow cap", "boulders"], ["rock cone", "snow cap", "snow drips", "base boulders"], ["static"],
         {"rock": ["#55575d", "stone"], "rock2": ["#6a6c72", "stone"], "snow": ["#f4f5f7", "plastic"]})
o["parts"] = [["rock-cone", "macro", "cone", [11.5, 8.0, 10.5], [0, 4.0, 0], [0, 0.3, 0], "rock"],
              ["snow-cap", "macro", "cone", [6.4, 4.4, 6.0], [0, 5.85, 0], [0, 0.3, 0], "snow"]]
for i in range(7):   # snow tongues running down from the cap
    a = i / 7 * math.tau
    o["parts"].append([f"snow-drip-{i}", "meso", "ellipsoid", [1.1, 2.0, 0.6], [round(math.sin(a) * 3.0, 2), 3.7, round(math.cos(a) * 2.8, 2)], [round(-math.cos(a) * 0.55, 2), round(a, 2), round(math.sin(a) * 0.55, 2)], "snow"])
for i in range(10):  # boulders round the base
    a = i / 10 * math.tau + 0.3
    o["parts"].append([f"boulder-{i}", "micro", "ellipsoid", [1.6, 1.1, 1.4], [round(math.sin(a) * 5.0, 2), 0.5, round(math.cos(a) * 4.6, 2)], [0, round(a, 2), 0], "rock2" if i % 2 else "rock"])
o["features"] = [["silhouette", "Broad dark rocky cone", ["rock-cone"], "critical"], ["snow", "White snow cap with tongues running down", ["snow-cap", "snow-drip-0"], "critical"], ["boulders", "Rounded boulders round the base", ["boulder-0", "boulder-1"], "important"]]
o["details"] = [["cap", "white snow top", "snow-cap"], ["drip-front", "snow running down the front", "snow-drip-0"], ["drip-side", "snow running down the side", "snow-drip-2"],
                ["boulder-front", "front boulder", "boulder-0"], ["boulder-side", "side boulder", "boulder-3"], ["round-edge", "rounded boulder edges", "boulder-5"]]
save("mountain", o)

# ---------------- pine: brown trunk, five stacked green tiers, pointed tip
o = base("Toy Pine Tree", "plant", ["stacked cones", "pointed tip", "short trunk"], ["trunk", "tiers", "tip"], ["sways"], {"trunk": ["#8a5a32", "wood"], "leaf": ["#2f9a3c", "plastic"], "leaf2": ["#27863a", "plastic"]})
o["parts"] = [["trunk", "macro", "cylinder", [0.42, 1.2, 0.42], [0, 0.6, 0], [0, 0, 0], "trunk"]]
for i, (r, y) in enumerate([(2.2, 1.65), (1.9, 2.35), (1.6, 3.0), (1.3, 3.6), (0.95, 4.15)]):
    o["parts"].append([f"tier-{i}", "macro" if i == 0 else "meso", "cone", [r, 1.2, r], [0, y, 0], [0, i * 0.4, 0], "leaf" if i % 2 == 0 else "leaf2"])
o["parts"] += [["tip", "micro", "cone", [0.5, 0.9, 0.5], [0, 4.75, 0], [0, 0, 0], "leaf"], ["trunk-flare", "micro", "cone", [0.6, 0.3, 0.6], [0, 0.15, 0], [0, 0, 0], "trunk"]]
o["features"] = [["silhouette", "Narrow cone of stacked tiers on a short trunk", ["tier-0", "tier-2", "tier-4"], "critical"], ["trunk", "Brown trunk below the lowest tier", ["trunk"], "important"]]
o["details"] = [["tip", "pointed top", "tip"], ["flare", "trunk widens at the ground", "trunk-flare"], ["tier-edge", "rounded tier edges", "tier-1"], ["tier-top", "small top tier", "tier-4"], ["low-tier", "wide bottom tier", "tier-0"], ["mid-tier", "middle tier", "tier-2"]]
save("pine", o)

# ---------------- palm: green base, curved segmented trunk, drooping fronds, coconuts
o = base("Toy Palm Tree", "plant", ["curved trunk", "radiating fronds"], ["base", "trunk segments", "fronds", "coconuts"], ["fronds sway"], {"trunk": ["#9a6a3c", "wood"], "trunk2": ["#b07c48", "wood"], "leaf": ["#43b443", "plastic"], "base": ["#5cc24a", "plastic"], "nut": ["#6b4628", "plastic"]})
o["parts"] = [["base", "macro", "cone", [1.6, 0.7, 1.6], [0, 0.35, 0], [0, 0, 0], "base"]]
for i in range(8):   # trunk curves to the left as it rises
    y = 0.75 + i * 0.55; x = -0.035 * i * i
    o["parts"].append([f"trunk-{i}", "meso" if i else "macro", "cylinder", [0.42 - i * 0.012, 0.6, 0.42 - i * 0.012], [round(x, 3), round(y, 2), 0], [0, 0, round(0.06 * i, 3)], "trunk" if i % 2 else "trunk2"])
top = [-2.0, 5.15, 0]
for i in range(7):
    a = i / 7 * math.tau
    o["parts"].append([f"frond-{i}", "meso", "ellipsoid", [2.6, 0.12, 0.7], [round(top[0] + math.cos(a) * 1.2, 2), round(top[1] - 0.25, 2), round(math.sin(a) * 1.2, 2)], [0, round(-a, 2), -0.35], "leaf"])
o["parts"] += [["coconut-a", "micro", "sphere", [0.3, 0.3, 0.3], [-1.85, 4.85, 0.18], [0, 0, 0], "nut"], ["coconut-b", "micro", "sphere", [0.3, 0.3, 0.3], [-2.15, 4.85, -0.12], [0, 0, 0], "nut"]]
o["features"] = [["silhouette", "Tall curved trunk with a crown of drooping fronds", ["trunk-0", "trunk-7", "frond-0"], "critical"], ["base", "Green round base", ["base"], "important"]]
o["details"] = [["rings", "trunk in stacked rings", "trunk-3"], ["nut-a", "coconut", "coconut-a"], ["nut-b", "coconut", "coconut-b"], ["frond-front", "front frond", "frond-1"], ["frond-back", "back frond", "frond-4"], ["base-edge", "rounded base", "base"]]
save("palm", o)

# ---------------- tree: brown trunk with branches, cloud of green balls, green base
o = base("Toy Round Tree", "plant", ["round canopy of balls", "branching trunk"], ["base", "trunk", "branches", "canopy"], ["sways"], {"trunk": ["#6b4528", "wood"], "leaf": ["#3aa83a", "plastic"], "leaf2": ["#2f9432", "plastic"], "base": ["#4fbe4a", "plastic"]})
o["parts"] = [["base", "macro", "cylinder", [1.5, 0.12, 1.5], [0, 0.06, 0], [0, 0, 0], "base"], ["trunk", "macro", "cylinder", [0.5, 2.0, 0.5], [0, 1.1, 0], [0, 0, 0], "trunk"],
              ["branch-l", "meso", "cylinder", [0.24, 1.1, 0.24], [-0.35, 2.3, 0], [0, 0, 0.6], "trunk"], ["branch-r", "meso", "cylinder", [0.24, 1.1, 0.24], [0.35, 2.3, 0], [0, 0, -0.6], "trunk"]]
balls = [(0, 3.4, 0, 1.6), (-1.1, 3.0, 0.3, 1.1), (1.1, 3.0, 0.2, 1.1), (0, 3.0, 1.0, 1.1), (0, 3.0, -1.0, 1.1), (-0.7, 3.9, 0.6, 1.0), (0.7, 3.9, 0.5, 1.0),
         (0, 4.3, 0, 1.0), (-0.8, 3.7, -0.6, 1.0), (0.8, 3.7, -0.6, 1.0), (-1.3, 3.5, 0.9, 0.7), (1.3, 3.5, 0.9, 0.7)]
for i, (x, y, z, r) in enumerate(balls):
    o["parts"].append([f"leaf-{i}", "meso" if i < 6 else "micro", "sphere", [r, r * 0.95, r], [x, y, z], [0, 0, 0], "leaf" if i % 2 else "leaf2"])
o["features"] = [["silhouette", "Round lumpy canopy on a thick trunk", ["leaf-0", "trunk"], "critical"], ["branches", "Trunk splits into two branches", ["branch-l", "branch-r"], "important"]]
o["details"] = [["lumps", "canopy made of round lumps", "leaf-5"], ["top-lump", "top lump", "leaf-7"], ["side-lump", "side lump", "leaf-10"], ["base-disc", "green round base", "base"], ["fork", "branch fork", "branch-l"], ["fork-r", "right branch", "branch-r"]]
save("tree", o)

# ---------------- nest: woven twig bowl with four blue eggs
o = base("Toy Bird Nest", "nature prop", ["round woven bowl", "eggs"], ["outer rim", "bowl", "twigs", "eggs"], ["static"], {"twig": ["#8a5a32", "wood"], "twig2": ["#a06c3e", "wood"], "egg": ["#2f7fd8", "plastic"]})
o["parts"] = [["rim", "macro", "torus", [0.48, 0.48, 0.48], [0, 0.1, 0], Z, "twig", {"torusTubeRatio": 0.22}],
              ["bowl", "macro", "ellipsoid", [0.42, 0.16, 0.42], [0, 0.07, 0], [0, 0, 0], "twig2"]]
for i in range(6):   # twig strands wrapped round the rim at different tilts
    o["parts"].append([f"twig-{i}", "meso", "torus", [0.5, 0.5, 0.5], [0, 0.08 + (i % 3) * 0.025, 0], [1.5708 + (i - 2.5) * 0.08, i * 0.5, 0], "twig" if i % 2 else "twig2", {"torusTubeRatio": 0.05}])
for i, (x, z) in enumerate([(-0.07, -0.06), (0.08, -0.05), (0, 0.08), (0.02, -0.12)]):
    o["parts"].append([f"egg-{i}", "meso" if i < 2 else "micro", "ellipsoid", [0.12, 0.15, 0.12], [x, 0.17 + (0.02 if i == 3 else 0), z], [0.4 * (i - 1.5), 0, 0.3], "egg"])
o["features"] = [["silhouette", "Round low bowl of twigs", ["rim", "bowl"], "critical"], ["eggs", "Four shiny blue eggs inside", ["egg-0", "egg-1", "egg-2"], "critical"]]
o["details"] = [["gloss", "shiny eggs", "egg-0"], ["twigs", "twig strands round the rim", "twig-0"], ["twigs-2", "crossing twigs", "twig-3"], ["egg-top", "egg on top", "egg-3"], ["egg-front", "front egg", "egg-2"], ["rim-edge", "rounded rim", "rim"]]
save("nest", o)

# ---------------- townhouse: three storeys, blue hipped roof, grid of windows, brown door, grey plinth
o = base("Toy Town House", "building", ["tall box", "low hipped roof", "window grid"], ["plinth", "walls", "roof", "windows", "door"], ["static"],
         {"wall": ["#f1e2b4", "plastic"], "roof": ["#7f97d6", "plastic"], "frame": ["#a8c8ea", "plastic"], "glass": ["#dfeaf6", "glass"], "door": ["#7a4a2c", "plastic"], "plinth": ["#9aa3ad", "plastic"]})
W, D, H = 3.2, 2.6, 6.2
o["parts"] = [["plinth", "macro", "box", [W + 0.2, 0.3, D + 0.2], [0, 0.15, 0], [0, 0, 0], "plinth"], ["walls", "macro", "box", [W, H, D], [0, 0.3 + H / 2, 0], [0, 0, 0], "wall"],
              ["roof", "macro", "cone", [W * 1.6, 0.8, D * 1.6], [0, 0.3 + H + 0.4, 0], [0, 0.7854, 0], "roof", {"note": "4-sided cone = hipped roof"}],
              ["eave", "meso", "box", [W + 0.3, 0.16, D + 0.3], [0, 0.3 + H + 0.05, 0], [0, 0, 0], "roof"],
              ["door", "meso", "box", [0.8, 1.5, 0.08], [-0.7, 1.05, D / 2 + 0.03], [0, 0, 0], "door"], ["door-canopy", "micro", "box", [1.1, 0.1, 0.4], [-0.7, 1.9, D / 2 + 0.18], [0, 0, 0], "frame"]]
k = 0
for fl in range(3):
    y = 1.4 + fl * 1.9
    for c, x in enumerate([-0.85, 0.15, 1.05]):
        if fl == 0 and c == 0: continue   # the door is there
        o["parts"].append([f"win-front-{k}", "micro", "box", [0.7, 0.95, 0.08], [x, y, D / 2 + 0.03], [0, 0, 0], "frame"])
        o["parts"].append([f"glass-front-{k}", "micro", "box", [0.5, 0.75, 0.1], [x, y, D / 2 + 0.03], [0, 0, 0], "glass"]); k += 1
    o["parts"].append([f"win-side-{fl}", "micro", "box", [0.08, 0.95, 0.6], [W / 2 + 0.03, y, -0.3], [0, 0, 0], "frame"])
    o["parts"].append([f"glass-side-{fl}", "micro", "box", [0.1, 0.75, 0.42], [W / 2 + 0.03, y, -0.3], [0, 0, 0], "glass"])
o["features"] = [["silhouette", "Tall three storey box with a low blue hipped roof", ["walls", "roof"], "critical"], ["windows", "Even grid of light blue framed windows", ["win-front-0", "win-front-4"], "critical"], ["door", "Brown door with a small canopy", ["door"], "important"]]
o["details"] = [["gloss", "shiny window glass", "glass-front-0"], ["canopy", "small canopy over the door", "door-canopy"], ["eave", "roof eave", "eave"], ["plinth", "grey plinth at the base", "plinth"], ["side-win", "windows on the side", "win-side-1"], ["top-win", "top floor windows", "win-front-6"]]
save("townhouse", o)

# ---------------- hut: round straw wall, wide cone roof with a knob, arched doorway, straw ribs
o = base("Toy Straw Hut", "building", ["round drum", "wide cone roof"], ["wall", "roof", "roof knob", "doorway", "straw ribs"], ["static"], {"straw": ["#e8b955", "fabric"], "straw2": ["#d9a743", "fabric"], "dark": ["#6b4423", "wood"]})
o["parts"] = [["wall", "macro", "cylinder", [3.0, 1.9, 3.0], [0, 0.95, 0], [0, 0, 0], "straw2"], ["roof", "macro", "cone", [4.0, 2.0, 4.0], [0, 2.85, 0], [0, 0, 0], "straw"],
              ["roof-rim", "meso", "torus", [3.95, 3.95, 3.95], [0, 1.9, 0], Z, "straw", {"torusTubeRatio": 0.05}], ["knob", "meso", "cone", [0.6, 0.6, 0.6], [0, 4.05, 0], [0, 0, 0], "straw2"],
              ["doorway", "meso", "box", [1.2, 1.2, 0.3], [0, 0.6, 1.4], [0, 0, 0], "dark"], ["door-arch", "micro", "cylinder", [1.2, 0.3, 1.2], [0, 1.2, 1.4], Z, "dark"]]
for i in range(12):
    a = i / 12 * math.tau
    o["parts"].append([f"rib-{i}", "micro", "box", [0.08, 1.9, 0.08], [round(math.sin(a) * 1.52, 2), 0.95, round(math.cos(a) * 1.52, 2)], [0, round(a, 2), 0], "straw"])
o["features"] = [["silhouette", "Round drum with a wide straw cone roof", ["wall", "roof"], "critical"], ["door", "Dark arched doorway in front", ["doorway", "door-arch"], "critical"]]
o["details"] = [["knob", "knob on the roof top", "knob"], ["ribs", "vertical straw ribs", "rib-0"], ["rim", "roof rim", "roof-rim"], ["arch", "round doorway top", "door-arch"], ["rib-side", "side ribs", "rib-3"], ["wall-edge", "rounded wall", "wall"]]
save("hut", o)

# ---------------- wheels helper for vehicles
def wheels(o, pts, r, w, tyre="rubber", hub="hub"):
    for i, (x, y, z) in enumerate(pts):
        o["parts"].append([f"wheel-{i}", "meso", "cylinder", [r * 2, w, r * 2], [x, y, z], X, tyre])
        o["parts"].append([f"hub-{i}", "micro", "cylinder", [r * 1.1, w + 0.02, r * 1.1], [x + (0.01 if x > 0 else -0.01), y, z], X, hub])

# ---------------- bus: red box body, window band, front screen, black skirt, wheels
o = base("Toy City Bus", "vehicle", ["long rounded box", "window band"], ["body", "roof", "windows", "skirt", "wheels", "lights"], ["drives", "wheels spin"],
         {"paint": ["#d8302a", "plastic"], "glass": ["#3a4048", "glass"], "skirt": ["#2a2a2a", "plastic"], "rubber": ["#222222", "rubber"], "hub": ["#d6d6d6", "plastic"], "light": ["#f6f1d8", "emissive"]})
L, Wd, Hb = 8.5, 2.5, 2.9
o["parts"] = [["body", "macro", "box", [Wd, Hb - 0.4, L], [0, 0.4 + (Hb - 0.4) / 2, 0], [0, 0, 0], "paint"], ["roof", "macro", "box", [Wd - 0.1, 0.2, L - 0.2], [0, Hb + 0.05, 0], [0, 0, 0], "paint"],
              ["skirt", "meso", "box", [Wd + 0.02, 0.35, L + 0.02], [0, 0.55, 0], [0, 0, 0], "skirt"], ["windscreen", "meso", "box", [Wd - 0.3, 1.2, 0.06], [0, 2.0, L / 2 + 0.01], [0, 0, 0], "glass"]]
for side, x in (("l", Wd / 2 + 0.01), ("r", -Wd / 2 - 0.01)):
    for i in range(5):
        o["parts"].append([f"win-{side}-{i}", "micro", "box", [0.06, 0.9, 1.2], [x, 2.05, -2.9 + i * 1.45], [0, 0, 0], "glass"])
o["parts"] += [["light-l", "micro", "sphere", [0.32, 0.32, 0.12], [0.85, 0.95, L / 2 + 0.02], [0, 0, 0], "light"], ["light-r", "micro", "sphere", [0.32, 0.32, 0.12], [-0.85, 0.95, L / 2 + 0.02], [0, 0, 0], "light"],
               ["sign", "micro", "box", [1.4, 0.3, 0.06], [0, 2.75, L / 2 + 0.02], [0, 0, 0], "skirt"]]
wheels(o, [(1.1, 0.5, 2.7), (-1.1, 0.5, 2.7), (1.1, 0.5, -2.7), (-1.1, 0.5, -2.7)], 0.5, 0.36)
o["features"] = [["silhouette", "Long red box bus", ["body", "roof"], "critical"], ["windows", "Row of dark side windows and a big front screen", ["win-l-0", "windscreen"], "critical"], ["wheels", "Four wheels", ["wheel-0", "wheel-2"], "important"]]
o["details"] = [["gloss", "shiny windows", "windscreen"], ["lights", "round headlights", "light-l"], ["sign", "route sign above the screen", "sign"], ["skirt", "dark skirt along the bottom", "skirt"], ["hubs", "silver hubs", "hub-0"], ["side-win", "side windows", "win-l-2"]]
save("bus", o)

# ---------------- train: green steam locomotive
o = base("Toy Steam Locomotive", "vehicle", ["long cylinder boiler", "box cab", "big wheels"], ["frame", "boiler", "smokebox", "chimney", "dome", "cab", "cowcatcher", "wheels"], ["drives", "wheels spin"],
         {"green": ["#3fa548", "plastic"], "green2": ["#35913d", "plastic"], "dark": ["#2a2f2a", "plastic"], "rubber": ["#2c6b33", "plastic"], "hub": ["#4fb85a", "plastic"], "glass": ["#1f2a20", "glass"]})
o["parts"] = [["frame", "macro", "box", [2.0, 0.5, 7.2], [0, 0.95, -0.2], [0, 0, 0], "green2"], ["boiler", "macro", "cylinder", [1.7, 4.2, 1.7], [0, 2.0, 0.9], Z, "green"],
              ["smokebox", "meso", "cylinder", [1.8, 0.4, 1.8], [0, 2.0, 3.05], Z, "green2"], ["chimney", "meso", "cylinder", [0.6, 1.1, 0.6], [0, 3.3, 2.6], [0, 0, 0], "green2"],
              ["chimney-lip", "micro", "cylinder", [0.8, 0.15, 0.8], [0, 3.85, 2.6], [0, 0, 0], "green"], ["dome", "meso", "sphere", [0.8, 0.7, 0.8], [0, 2.95, 1.2], [0, 0, 0], "green"],
              ["dome-2", "micro", "sphere", [0.6, 0.5, 0.6], [0, 2.9, 0.2], [0, 0, 0], "green"], ["cab", "macro", "box", [2.2, 2.4, 2.0], [0, 2.3, -2.6], [0, 0, 0], "green"],
              ["cab-roof", "meso", "box", [2.5, 0.2, 2.4], [0, 3.6, -2.6], [0, 0, 0], "green2"], ["cab-window", "micro", "box", [2.25, 0.8, 0.9], [0, 2.9, -2.4], [0, 0, 0], "glass"],
              ["cowcatcher", "meso", "extrude", [1, 1, 1], [-0.95, 0.35, 3.3], [0, 1.5708, 0], "green2", {"profile2D": {"points": [[0, 0], [0.9, 0], [0, 0.9]], "depth": 1.9}}]]
wheels(o, [(1.0, 0.75, 1.6), (-1.0, 0.75, 1.6), (1.0, 0.75, 0.0), (-1.0, 0.75, 0.0), (1.0, 0.75, -1.6), (-1.0, 0.75, -1.6)], 0.72, 0.22)
o["parts"] += [["rod-l", "micro", "box", [0.08, 0.12, 3.4], [1.13, 0.75, 0.0], [0, 0, 0], "dark"], ["rod-r", "micro", "box", [0.08, 0.12, 3.4], [-1.13, 0.75, 0.0], [0, 0, 0], "dark"]]
o["features"] = [["silhouette", "Long boiler with a chimney at the front and a box cab at the back", ["boiler", "cab", "chimney"], "critical"], ["wheels", "Six big wheels joined by rods", ["wheel-0", "rod-l"], "critical"], ["cowcatcher", "Slanted cowcatcher at the front", ["cowcatcher"], "important"]]
o["details"] = [["lip", "chimney lip", "chimney-lip"], ["domes", "two domes on the boiler", "dome-2"], ["rods", "side rods", "rod-l"], ["window", "cab window", "cab-window"], ["roof", "cab roof overhang", "cab-roof"], ["smokebox", "front smokebox ring", "smokebox"]]
save("train", o)

# ---------------- bicycle: two thin wheels, diamond frame, seat, handlebar
o = base("Toy Bicycle", "vehicle", ["two thin rings", "diamond frame"], ["wheels", "frame tubes", "fork", "seat", "handlebar", "pedals"], ["wheels spin", "pedals turn"],
         {"frame": ["#2a62d8", "plastic"], "tyre": ["#2a62d8", "plastic"], "hub": ["#1d4fb8", "plastic"], "grey": ["#9aa0a8", "metal"]})
R, wb, y0 = 0.36, 1.05, 0.38
fz, rz = wb / 2, -wb / 2
o["parts"] = [["wheel-front", "macro", "torus", [R * 2, R * 2, R * 2], [0, y0, fz], [0, 1.5708, 0], "tyre", {"torusTubeRatio": 0.09}],
              ["wheel-rear", "macro", "torus", [R * 2, R * 2, R * 2], [0, y0, rz], [0, 1.5708, 0], "tyre", {"torusTubeRatio": 0.09}],
              ["hub-front", "micro", "cylinder", [0.08, 0.08, 0.08], [0, y0, fz], X, "hub"], ["hub-rear", "micro", "cylinder", [0.08, 0.08, 0.08], [0, y0, rz], X, "hub"]]
def tube(name, a, b, r, mat="frame", level="meso"):
    mx, my, mz = [(a[i] + b[i]) / 2 for i in range(3)]; dy, dz = b[1] - a[1], b[2] - a[2]
    o["parts"].append([name, level, "cylinder", [r, round(math.hypot(dy, dz), 3), r], [round(mx, 3), round(my, 3), round(mz, 3)], [round(math.atan2(dz, dy), 3), 0, 0], mat])
bb, seat, head = (0, 0.32, -0.05), (0, 0.85, -0.22), (0, 0.85, 0.36)
tube("down-tube", bb, head, 0.05); tube("seat-tube", bb, seat, 0.05); tube("top-tube", seat, head, 0.045)
tube("chain-stay", bb, (0, y0, rz), 0.035); tube("seat-stay", seat, (0, y0, rz), 0.035); tube("fork", head, (0, y0, fz), 0.045)
tube("stem", head, (0, 1.0, 0.33), 0.04)
for i in range(6):   # spokes
    a = i / 6 * math.pi
    for wn, z in (("f", fz), ("r", rz)):
        o["parts"].append([f"spoke-{wn}-{i}", "micro", "cylinder", [0.015, R * 1.9, 0.015], [0, y0, z], [round(a, 3), 0, 0], "frame"])
o["parts"] += [["handlebar", "meso", "cylinder", [0.04, 0.5, 0.04], [0, 1.0, 0.33], X, "frame"], ["seat", "meso", "ellipsoid", [0.16, 0.06, 0.28], [0, 0.89, -0.24], [0, 0, 0], "frame"],
               ["pedal-l", "micro", "box", [0.1, 0.03, 0.06], [0.1, 0.25, -0.05], [0, 0, 0], "grey"], ["pedal-r", "micro", "box", [0.1, 0.03, 0.06], [-0.1, 0.39, -0.05], [0, 0, 0], "grey"]]
o["features"] = [["silhouette", "Two thin round wheels joined by a diamond frame", ["wheel-front", "wheel-rear", "down-tube"], "critical"], ["controls", "Seat and handlebar on top", ["seat", "handlebar"], "important"]]
o["details"] = [["spokes", "spokes in the wheels", "spoke-f-0"], ["hub", "wheel hub", "hub-front"], ["pedals", "pedals", "pedal-l"], ["stays", "rear stays", "seat-stay"], ["stem", "handlebar stem", "stem"], ["seat", "rounded seat", "seat"]]
save("bicycle", o)

# ---------------- motorbike: red sport bike
o = base("Toy Sport Motorbike", "vehicle", ["low fairing", "two wheels"], ["wheels", "fairing", "tank", "seat", "fork", "handlebars", "exhaust"], ["drives", "wheels spin"],
         {"paint": ["#d6232a", "plastic"], "dark": ["#2a2a2a", "plastic"], "rubber": ["#1f1f1f", "rubber"], "hub": ["#c9232a", "plastic"], "metal": ["#b8bcc2", "metal"], "glass": ["#9cc6e8", "glass"]})
wheels(o, [(0, 0.34, 0.72), (0, 0.34, -0.72)], 0.34, 0.16)
o["parts"] += [["fairing", "macro", "ellipsoid", [0.42, 0.55, 1.15], [0, 0.72, 0.25], [-0.15, 0, 0], "paint"], ["tank", "macro", "ellipsoid", [0.4, 0.3, 0.6], [0, 0.95, 0.0], [0, 0, 0], "paint"],
               ["seat", "meso", "box", [0.3, 0.1, 0.55], [0, 0.98, -0.42], [0.1, 0, 0], "dark"], ["tail", "meso", "ellipsoid", [0.28, 0.2, 0.55], [0, 0.95, -0.72], [0.2, 0, 0], "paint"],
               ["fork-l", "meso", "cylinder", [0.05, 0.7, 0.05], [0.09, 0.62, 0.62], [-0.35, 0, 0], "metal"], ["fork-r", "meso", "cylinder", [0.05, 0.7, 0.05], [-0.09, 0.62, 0.62], [-0.35, 0, 0], "metal"],
               ["handlebar", "micro", "cylinder", [0.035, 0.55, 0.035], [0, 1.05, 0.42], X, "dark"], ["screen", "micro", "ellipsoid", [0.28, 0.2, 0.08], [0, 1.08, 0.62], [-0.6, 0, 0], "glass"],
               ["exhaust", "micro", "cylinder", [0.09, 0.6, 0.09], [-0.18, 0.5, -0.5], [1.35, 0, 0], "metal"], ["engine", "meso", "box", [0.32, 0.3, 0.4], [0, 0.45, 0.05], [0, 0, 0], "dark"]]
o["features"] = [["silhouette", "Low red sport bike with two wheels", ["fairing", "wheel-0", "wheel-1"], "critical"], ["seat", "Black seat behind the tank", ["seat", "tank"], "important"]]
o["details"] = [["screen", "small windscreen", "screen"], ["exhaust", "silver exhaust pipe", "exhaust"], ["forks", "front forks", "fork-l"], ["bars", "handlebars", "handlebar"], ["engine", "dark engine block", "engine"], ["tail", "pointed tail", "tail"]]
save("motorbike", o)

# ---------------- sailboat: blue hull, orange rim, white sail, mast
o = base("Toy Sailing Boat", "vehicle", ["pointed hull", "triangle sail"], ["hull", "rim", "deck", "mast", "sail", "jib"], ["floats", "rocks"],
         {"hull": ["#2f6fc4", "plastic"], "rim": ["#f0962e", "plastic"], "deck": ["#f3b04a", "plastic"], "sail": ["#f8f8f6", "plastic"], "mast": ["#e8e8e8", "plastic"]})
o["parts"] = [["hull", "macro", "ellipsoid", [1.6, 1.1, 4.0], [0, 0.55, 0], [0, 0, 0], "hull"], ["rim", "meso", "torus", [1.75, 4.2, 1.0], [0, 0.95, 0], Z, "rim", {"torusTubeRatio": 0.07}],
              ["deck", "meso", "ellipsoid", [1.45, 0.18, 3.8], [0, 0.95, 0], [0, 0, 0], "deck"], ["mast", "macro", "cylinder", [0.1, 3.6, 0.1], [0, 2.7, 0.3], [0, 0, 0], "mast"],
              ["mast-top", "micro", "sphere", [0.22, 0.22, 0.22], [0, 4.55, 0.3], [0, 0, 0], "sail"],
              ["sail", "macro", "extrude", [1, 1, 1], [0.02, 1.15, 0.25], [0, 1.5708, 0], "sail", {"profile2D": {"points": [[0, 0], [1.9, 0], [0, 3.3]], "depth": 0.04}}],
              ["jib", "meso", "extrude", [1, 1, 1], [0.02, 1.15, 0.4], [0, -1.5708, 0], "sail", {"profile2D": {"points": [[0, 0], [1.3, 0], [0, 2.6]], "depth": 0.04}}],
              ["seat", "micro", "box", [1.2, 0.08, 0.3], [0, 1.05, -0.9], [0, 0, 0], "rim"], ["seat-2", "micro", "box", [1.1, 0.08, 0.3], [0, 1.05, -1.5], [0, 0, 0], "rim"]]
o["features"] = [["silhouette", "Pointed blue hull with a tall white triangle sail", ["hull", "sail", "mast"], "critical"], ["rim", "Orange rim round the hull", ["rim"], "important"]]
o["details"] = [["top", "ball on top of the mast", "mast-top"], ["jib", "small front sail", "jib"], ["seats", "orange seats", "seat"], ["seats-2", "back seat", "seat-2"], ["deck", "orange deck", "deck"], ["gloss", "shiny hull", "hull"]]
save("sailboat", o)

# ---------------- plane: pink propeller plane with dark wings
o = base("Toy Propeller Plane", "vehicle", ["capsule fuselage", "straight wings", "propeller"], ["fuselage", "wings", "tail", "propeller", "cockpit", "wheels"], ["flies", "propeller spins"],
         {"body": ["#f4b49a", "plastic"], "wing": ["#2c4a4e", "plastic"], "glass": ["#9cc6e8", "glass"], "white": ["#f2f2f2", "plastic"], "rubber": ["#222222", "rubber"], "hub": ["#d8d8d8", "plastic"]})
o["parts"] = [["fuselage", "macro", "ellipsoid", [1.3, 1.25, 6.2], [0, 1.6, 0], [0, 0, 0], "body"], ["nose", "meso", "cylinder", [1.0, 0.4, 1.0], [0, 1.6, 3.0], Z, "white"],
              ["spinner", "micro", "cone", [0.4, 0.5, 0.4], [0, 1.6, 3.4], Z, "white"],
              ["blade-a", "meso", "ellipsoid", [0.35, 2.6, 0.08], [0, 1.6, 3.25], [0, 0, 0.5], "wing"], ["blade-b", "meso", "ellipsoid", [0.35, 2.6, 0.08], [0, 1.6, 3.25], [0, 0, -1.07], "wing"],
              ["wing-l", "macro", "ellipsoid", [3.6, 0.18, 1.3], [1.8, 1.3, 0.6], [0, 0, -0.06], "wing"], ["wing-r", "macro", "ellipsoid", [3.6, 0.18, 1.3], [-1.8, 1.3, 0.6], [0, 0, 0.06], "wing"],
              ["stab-l", "meso", "ellipsoid", [1.4, 0.12, 0.6], [0.65, 1.85, -2.7], [0, 0, 0], "wing"], ["stab-r", "meso", "ellipsoid", [1.4, 0.12, 0.6], [-0.65, 1.85, -2.7], [0, 0, 0], "wing"],
              ["fin", "meso", "extrude", [1, 1, 1], [0.05, 1.9, -3.1], [0, 1.5708, 0], "body", {"profile2D": {"points": [[0, 0], [1.1, 0], [0.1, 1.2]], "depth": 0.1}}],
              ["cockpit", "meso", "ellipsoid", [0.8, 0.55, 1.1], [0, 2.15, 1.3], [0, 0, 0], "glass"],
              ["strut-l", "micro", "cylinder", [0.06, 0.8, 0.06], [0.45, 0.85, 1.2], [0, 0, -0.3], "wing"], ["strut-r", "micro", "cylinder", [0.06, 0.8, 0.06], [-0.45, 0.85, 1.2], [0, 0, 0.3], "wing"]]
wheels(o, [(0.65, 0.35, 1.2), (-0.65, 0.35, 1.2)], 0.35, 0.18)
o["features"] = [["silhouette", "Plump pink body with straight dark wings and a tail", ["fuselage", "wing-l", "wing-r", "fin"], "critical"], ["propeller", "Two-blade propeller on a white nose", ["blade-a", "spinner"], "critical"], ["wheels", "Two wheels under the wings", ["wheel-0"], "important"]]
o["details"] = [["gloss", "shiny cockpit glass", "cockpit"], ["spinner", "white spinner", "spinner"], ["struts", "wheel struts", "strut-l"], ["tail", "tail fin", "fin"], ["stab", "tail wings", "stab-l"], ["nose", "white nose ring", "nose"]]
save("plane", o)
print("wrote 14 objects (car and cottage already exist)")
