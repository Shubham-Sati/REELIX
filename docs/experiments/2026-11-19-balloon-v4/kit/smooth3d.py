"""Make every 3D shape in a toy3d video smooth: rounded boxes, round cylinders/cones/spheres/torus, smooth rocks, no flat shading.
   python3 smooth3d.py <video>/project/custom"""
import re, sys, glob, os
d = sys.argv[1]
GEO = '''
/** Rounded box geometry for raw meshes: <mesh><RoundGeo args={[w, h, d]} />...</mesh> */
export const RoundGeo: React.FC<{ args: [number, number, number] | number[]; round?: number }> = ({ args, round = 0.06 }) => {
  const [w = 1, h = 1, dd = 1] = args as number[];
  const g = useMemo(() => new RoundedBoxGeometry(w, h, dd, 3, Math.max(0.002, Math.min(Math.min(w, h, dd) * round, 0.02))), [w, h, dd, round]);
  return <primitive object={g} attach="geometry" />;
};
'''
def seg(m, idx, lo=5, hi=40, to=32):
    parts = m.group(2).split(",")
    if len(parts) > idx:
        try:
            v = int(parts[idx].strip())
            if lo <= v < hi: parts[idx] = " " + str(to) if idx else str(to)
        except ValueError: pass
    return m.group(1) + ",".join(parts) + m.group(3)
for f in glob.glob(os.path.join(d, "*.tsx")):
    s = open(f).read(); o = s
    s = s.replace(" flatShading", "")
    s = re.sub(r"<boxGeometry args=\{", "<RoundGeo args={", s)
    s = re.sub(r"(<cylinderGeometry args=\{\[)([^\]]*)(\])", lambda m: seg(m, 3), s)   # radial segments
    s = re.sub(r"(<coneGeometry args=\{\[)([^\]]*)(\])", lambda m: seg(m, 2), s)
    s = re.sub(r"(<sphereGeometry args=\{\[)([^\]]*)(\])", lambda m: seg(m, 1, 3, 32, 32), s)
    s = re.sub(r"(<sphereGeometry args=\{\[)([^\]]*)(\])", lambda m: seg(m, 2, 2, 24, 24), s)
    s = re.sub(r"(<torusGeometry args=\{\[)([^\]]*)(\])", lambda m: seg(m, 2, 3, 16, 16), s)
    s = re.sub(r"(<torusGeometry args=\{\[)([^\]]*)(\])", lambda m: seg(m, 3, 5, 48, 48), s)
    s = re.sub(r"(<latheGeometry args=\{\[)([^\]]*)(\])", lambda m: seg(m, 1, 5, 48, 48), s)
    s = re.sub(r"(<circleGeometry args=\{\[)([^\]]*)(\])", lambda m: seg(m, 1, 5, 48, 48), s)
    s = re.sub(r"<(icosahedron|dodecahedron|octahedron)Geometry args=\{\[([^,\]]+)(?:,\s*[0-2])?\]\}", r"<icosahedronGeometry args={[\2, 3]}", s)
    if os.path.basename(f) == "_kit.tsx":
        if "export const RoundGeo" not in s:
            i = s.index("/** Smooth ball. */"); s = s[:i] + GEO.lstrip() + s[i:]
    elif "RoundGeo" in s and not re.search(r"import[^;]*RoundGeo[^;]*from \"\./_kit\"", s):
        s = re.sub(r"import \{([^}]*)\} from \"\./_kit\";", lambda m: 'import {' + m.group(1).rstrip() + ', RoundGeo } from "./_kit";', s, count=1)
    if s != o: open(f, "w").write(s); print("smoothed", os.path.basename(f))
