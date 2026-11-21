"""Build a test copy's _kit.tsx: new base + the video's own extra code, patched to the new body."""
import sys, re
orig, base, out = sys.argv[1:4]
k = open(orig).read(); b = open(base).read()
rest = k[k.index("/* ------------------------------------------------------------------ sets and props"):]
rest = rest.replace("side * (d.W / 2 + 0.07), d.legH + d.bodyH - 0.08", "side * toyBody(spec).shoulderX, d.legH + d.bodyH - 0.08")
rest = re.sub(r"\{/\* apron: bib \+ skirt over the front, neck straps \*/\}\n.*?</group></group>\n",
              '{/* apron: cloth wrapped round the front of the body */}\n    <Apron spec={spec} pose={pose} c="#f07a2c" />\n', rest, flags=re.S)
rest = rest.replace("fz = d.D / 2 + 0.012, hs = d.headS;", "hs = 0.3;")
rest = rest.replace("<AtHand spec={spec} pose={pose} side={side}>\n    <mesh castShadow><icosahedronGeometry", "<AtHand spec={spec} pose={pose} side={side}><group scale={0.62}>\n    <mesh castShadow><icosahedronGeometry")
rest = rest.replace("{thumb ? <Box s={[0.05, 0.05, 0.13]} p={[0, -0.01, 0.1]} c=\"#8b8e93\" /> : null}\n  </AtHand>", "{thumb ? <Box s={[0.05, 0.05, 0.13]} p={[0, -0.01, 0.1]} c=\"#8b8e93\" /> : null}\n  </group></AtHand>")
rest = re.sub(r"const Ball: React\.FC<\{ r: number;[^\n]*d = 1 \}\) =>\n[^\n]*\n", "", rest)
rest = re.sub(r" d=\{\d\}", "", rest)
rest = rest.replace('<Box s={[hs * 1.1, 0.04, hs * 1.04]} p={[0, 0, -0.01]} c="#55585e" />', '<mesh rotation={[Math.PI / 2, 0, 0]} scale={[0.95, 1.05, 1]}><torusGeometry args={[0.152, 0.014, 12, 48]} />{mat("#55585e")}</mesh>')
if "export const Sheep" in rest:   # the video's own animals are replaced by the kit's realistic ones
    i = rest.index("export type AnimalPose"); j = rest.index("/* ---------- sets", i)
    rest = rest[:i] + open(base.replace("base.tsx", "animals.tsx")).read() + "\n" + rest[j:]
rest = rest.replace("<group rotation={[pose.lean || 0, 0, 0]}>", "<group position={leanPos(toyBody(spec).legH, pose.lean)} rotation={[pose.lean || 0, 0, 0]}>")
rest = rest.replace("m.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pose.lean || 0, 0, 0)));",
  "m.multiply(new THREE.Matrix4().compose(new THREE.Vector3(...leanPos(toyBody(spec).legH, pose.lean)), new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.lean || 0, 0, 0)), new THREE.Vector3(1, 1, 1)));")
# fire: cones -> glowing layered flames
rest = re.sub(r"export const Fire: React\.FC<.*?\n\);\n", "export const Fire: React.FC<{ p?: [number, number, number]; scale?: number; t: number }> = ({ p = [0, 0, 0], scale = 1, t }) =>\n  <FireFX p={p} scale={scale * 0.9} t={t} light={6} seed={2} />;\n", rest, count=1, flags=re.S)
rest = re.sub(r"export const Flames: React\.FC<.*?\n\);\n", "export const Flames: React.FC<{ p?: V3; scale?: number; t: number; light?: number }> = ({ p = [0, 0, 0], scale = 1, t, light = 3 }) =>\n  <FireFX p={p} scale={scale} t={t} light={light} seed={Math.round((p[0] + 3) * 7)} />;\n", rest, count=1, flags=re.S)
open(out, "w").write(b + "\n" + rest)
