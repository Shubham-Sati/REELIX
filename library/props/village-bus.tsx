// prop category=bus h=3.1
// Old Indian village bus: green body, cream roof and cream window stripe, rounded front with two round headlights, open windows
// (no glass, you can see the bench seats inside), front door on the right side (local -x) with a step, roof rack with tied cloth
// bundles. Faces +z (front), about 8.4 m long, 3.1 m to the top of the luggage. Hollow inside: a camera can sit in the aisle.
// riders 0..12 = passengers leaning out of the right-side windows (front to back), waving with t; roll = metres driven (wheels turn);
// roofShadow false lets light into the cabin for interior shots.
import React from "react";
import * as THREE from "three";
import { Box, Ball, Pill, XBox, RoundGeo, P3 } from "./_kit";

export const VBUS = { L: 8.4, W: 2.4, floor: 0.85, sill: 1.45, top: 2.3, door: [1.6, 2.5] as [number, number], doorZ: 2.05, step: 0.42 };   // door gap (local z) on the -x side, behind the front wheel
const G = "#3f8a4a", GD = "#2f6e3a", CREAM = "#f3e6c4", SEAT = "#7a4a2e";
const FOLK = ["#e9e2d2", "#f2a93b", "#c2452e", "#5a7fb8", "#d9c27a", "#f39cc0", "#9a7ab8", "#e0e0d8"];
const SKIN = ["#a8693f", "#b57a50", "#9a603a", "#ad6f45"];
/** window centres along z (6 per side, front to back) */
export const busWindows = () => { const z0 = 1.5, z1 = -VBUS.L / 2 + 0.6, n = 6; return Array.from({ length: n }, (_, i) => z0 - (i + 0.5) * (z0 - z1) / n); };
const NoShadowBox: React.FC<{ s: P3; p: P3; c: string }> = ({ s, p, c }) => <mesh position={p} receiveShadow><RoundGeo args={s} round={0.3} /><meshStandardMaterial color={c} roughness={0.55} /></mesh>;

const VillageBus: React.FC<{ p?: P3; rotY?: number; s?: number; t?: number; riders?: number; roll?: number; roofShadow?: boolean; seats?: boolean }> =
  ({ p = [0, 0, 0], rotY = 0, s = 1, t = 0, riders = 0, roll = 0, roofShadow = true, seats = true }) => {
  const { L, W, floor, sill, top } = VBUS, hx = W / 2, wz = busWindows(), wl = (wz[0] - wz[1]) - 0.16;
  const zs = [wz[0] + (wz[0] - wz[1]) / 2, ...wz.map((z) => z - (wz[0] - wz[1]) / 2)];   // window posts
  const spin = roll / 0.48;
  return <group position={p} rotation={[0, rotY, 0]} scale={s}>
    {/* floor + lower walls (door gap on the -x side for z in VBUS.door) */}
    <Box s={[W, floor - 0.45, L]} p={[0, (floor + 0.45) / 2, 0]} c={GD} />
    <Box s={[0.09, sill - floor, L]} p={[hx - 0.045, (sill + floor) / 2, 0]} c={G} />
    <Box s={[0.09, sill - floor, L / 2 + 1.6]} p={[-hx + 0.045, (sill + floor) / 2, (1.6 - L / 2) / 2]} c={G} />
    <Box s={[0.09, sill - floor, L / 2 - 2.5]} p={[-hx + 0.045, (sill + floor) / 2, (2.5 + L / 2) / 2]} c={G} />
    {/* cream stripe under the windows and the green band over them */}
    <Box s={[0.12, 0.12, L / 2 + 1.6]} p={[-hx + 0.05, sill, (1.6 - L / 2) / 2]} c={CREAM} />
    <Box s={[0.12, 0.12, L / 2 - 2.5]} p={[-hx + 0.05, sill, (2.5 + L / 2) / 2]} c={CREAM} />
    <Box s={[0.12, 0.12, L]} p={[hx - 0.05, sill, 0]} c={CREAM} />
    {[1, -1].map((sd) => <Box key={"u" + sd} s={[0.09, 0.4, L]} p={[sd * (hx - 0.045), top + 0.2, 0]} c={G} />)}
    {/* window posts */}
    {[1, -1].map((sd) => zs.map((z, i) => <Box key={sd + "p" + i} s={[0.1, top - sill, 0.14]} p={[sd * (hx - 0.05), (top + sill) / 2, z]} c={G} />))}
    <Box s={[0.1, top - sill, 0.14]} p={[hx - 0.05, (top + sill) / 2, L / 2 - 0.08]} c={G} />
    <Box s={[0.1, top - floor, 0.14]} p={[-hx + 0.05, (top + floor) / 2, 2.5]} c={G} />
    <Box s={[0.1, top - floor, 0.14]} p={[-hx + 0.05, (top + floor) / 2, 1.6]} c={G} />
    {/* door step */}
    <Box s={[0.35, 0.08, 0.85]} p={[-hx - 0.12, VBUS.step - 0.04, VBUS.doorZ]} c="#5a5f66" />
    <Box s={[0.08, 0.4, 0.85]} p={[-hx + 0.02, (VBUS.step + floor) / 2 - 0.02, VBUS.doorZ]} c="#4a4f56" />
    {/* roof (cream, rounded) */}
    {roofShadow ? <Box s={[W + 0.08, 0.18, L + 0.06]} p={[0, top + 0.47, 0]} c={CREAM} round={0.4} /> : <NoShadowBox s={[W + 0.08, 0.18, L + 0.06]} p={[0, top + 0.47, 0]} c={CREAM} />}
    {/* front: rounded nose, windscreen, headlights, grille, bumper */}
    <Box s={[W, sill - 0.45, 0.4]} p={[0, (sill + 0.45) / 2, L / 2 + 0.1]} c={G} round={0.35} />
    <Box s={[W - 0.1, 0.12, 0.42]} p={[0, sill, L / 2 + 0.1]} c={CREAM} round={0.3} />
    <XBox s={[W - 0.3, top - sill - 0.1, 0.05]} p={[0, (top + sill) / 2, L / 2 - 0.02]} c="#bfe0ee" o={0.35} shadow={false} />
    <Box s={[W, 0.42, 0.12]} p={[0, top + 0.2, L / 2 - 0.02]} c={G} />
    {[1, -1].map((sd) => <group key={"h" + sd} position={[sd * 0.82, 0.98, L / 2 + 0.31]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.18, 0.18, 0.06, 32]} /><meshStandardMaterial color="#c9ced4" metalness={0.4} roughness={0.3} /></mesh>
      <Ball r={0.14} p={[0, 0, 0.02]} s={[1, 1, 0.45]} c="#fff4d0" />
    </group>)}
    <Box s={[0.9, 0.32, 0.06]} p={[0, 0.95, L / 2 + 0.31]} c="#3a3f46" />
    <Box s={[W + 0.06, 0.16, 0.2]} p={[0, 0.55, L / 2 + 0.32]} c="#c9ced4" />
    {/* back */}
    <Box s={[W, top - 0.45 + 0.4, 0.1]} p={[0, (top + 0.4 + 0.45) / 2, -L / 2 + 0.05]} c={G} />
    <Box s={[W - 0.6, 0.6, 0.04]} p={[0, 1.9, -L / 2 - 0.01]} c="#2c3a44" />
    <Box s={[W + 0.06, 0.16, 0.2]} p={[0, 0.55, -L / 2 - 0.05]} c="#c9ced4" />
    {/* wheels */}
    {[[1, 3.3], [-1, 3.3], [1, -2.6], [-1, -2.6]].map(([sd, z], i) => <group key={"w" + i} position={[sd * (hx - 0.12), 0.48, z]} rotation={[spin, 0, 0]}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.48, 0.48, 0.32, 40]} /><meshStandardMaterial color="#25272b" roughness={0.8} /></mesh>
      <mesh position={[sd * 0.17, 0, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.22, 0.22, 0.03, 32]} /><meshStandardMaterial color="#c9ced4" metalness={0.4} roughness={0.35} /></mesh>
      <Box s={[0.04, 0.08, 0.3]} p={[sd * 0.19, 0, 0]} c="#8d949b" />
    </group>)}
    {/* roof rack with tied bundles */}
    {[1, -1].map((sd) => <Pill key={"r" + sd} r={0.03} len={L * 0.7} p={[sd * 0.95, top + 0.68, -0.2]} rot={[Math.PI / 2, 0, 0]} c="#3a3f46" />)}
    {[-2.8, -1.4, 0, 1.4, 2.4].map((z) => <Pill key={"c" + z} r={0.025} len={1.9} p={[0, top + 0.68, z]} rot={[0, 0, Math.PI / 2]} c="#3a3f46" />)}
    {[[-0.45, -2.2, "#c2452e"], [0.4, -2.0, "#2f6fb8"], [-0.2, -0.6, "#f2a93b"], [0.5, -0.2, "#8a5a34"], [-0.5, 0.9, "#3f9a4c"], [0.35, 1.3, "#e9e2d2"]].map(([x, z, c], i) =>
      <group key={"b" + i} position={[x as number, top + 0.82, z as number]}>
        <Box s={[0.75, 0.4, 0.8]} c={c as string} round={0.45} />
        <Pill r={0.018} len={0.82} p={[0, 0.2, 0]} rot={[Math.PI / 2, 0, 0]} c="#d9c27a" />
      </group>)}
    {/* bench seats inside, both sides of the aisle */}
    {seats ? wz.map((z, i) => [1, -1].map((sd) => <group key={"s" + i + sd} position={[sd * (hx - 0.55), floor, z - 0.15]}>
      <Box s={[0.82, 0.1, 0.46]} p={[0, 0.42, 0]} c={SEAT} round={0.3} />
      <Box s={[0.82, 0.55, 0.09]} p={[0, 0.72, -0.24]} c={SEAT} round={0.3} />
      {[1, -1].map((k) => <Box key={k} s={[0.05, 0.4, 0.05]} p={[k * 0.34, 0.2, 0]} c="#5a5f66" />)}
    </group>)) : null}
    {/* passengers leaning out of the right-side (-x) windows */}
    {wz.flatMap((z, i) => [0, 1].map((j) => ({ z: z + (j ? -0.32 : 0.32), k: i * 2 + j }))).map(({ z, k }) => {
      const on = Math.max(0, Math.min(1, riders - k)); if (on <= 0) return null;
      const sk = SKIN[k % 4], c = FOLK[(k * 3) % FOLK.length], wv = Math.sin(t * 9 + k * 1.7), hy = sill + 0.45 * on;
      return <group key={"rd" + k} position={[-hx + 0.25 - 0.2 * on, 0, z]}>
        <Pill r={0.17} len={0.3} p={[0.15, sill + 0.05, 0]} c={c} />
        <Ball r={0.15} p={[0, hy, 0]} c={sk} />
        <Ball r={0.155} p={[0.02, hy + 0.04, 0]} s={[1, 0.75, 1]} c={k % 3 === 1 ? "#e4e0d8" : "#16110e"} />
        {[1, -1].map((e) => <Ball key={e} r={0.022} p={[-0.13, hy + 0.02, e * 0.055]} c="#1a1410" />)}
        <mesh position={[-0.13, hy - 0.06, 0]} rotation={[0, Math.PI / 2, Math.PI]}><torusGeometry args={[0.04, 0.008, 16, 48, Math.PI]} /><meshStandardMaterial color="#7a3a30" /></mesh>
        <group position={[-0.05, sill + 0.15, 0.12]} rotation={[0, 0, -2.3 * on + wv * 0.35]}><Pill r={0.045} len={0.4} p={[0, -0.22, 0]} c={c} /><Ball r={0.055} p={[0, -0.46, 0]} c={sk} /></group>
      </group>; })}
  </group>;
};
export default VillageBus;
