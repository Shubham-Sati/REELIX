// prop category=tram h=5.4
// Long articulated city tram (Budapest Combino style, 56 m at default): butter-yellow sections with white roofs, wide dark windows,
// grey bellows joints, doors on the +z side, a pantograph on the roof reaching the overhead wire. Faces +x.
// Controls: faces (0..1 of the standing riders shown in the windows), door (0 shut .. 1 open), sections, L (total length).
import React from "react";
import { Box, XBox, Flat, Mini, VehShadow, glowMat, P3 } from "./_kit";

const Tram: React.FC<{ p?: P3; rotY?: number; s?: number; L?: number; sections?: number; faces?: number; door?: number; wireY?: number; color?: string }> =
  ({ p = [0, 0, 0], rotY = 0, s = 1, L = 56, sections = 6, faces = 0, door = 0, wireY = 5.4, color = "#f5cf55" }) => {
  const gap = 0.5, Ls = (L - gap * (sections - 1)) / sections, W = 2.4;
  const xs = Array.from({ length: sections }, (_, i) => L / 2 - Ls / 2 - i * (Ls + gap));
  const perSec = 20, total = perSec * sections, nF = Math.round(faces * total);
  return <group position={p} rotation={[0, rotY, 0]} scale={s}>
    <group rotation={[0, Math.PI / 2, 0]}><VehShadow w={W + 0.4} l={L + 0.4} k={0.7} /></group>
    {xs.map((x, si) => <group key={si} position={[x, 0, 0]}>
      {/* bogie skirt */}
      <Box s={[Ls - 0.4, 0.32, W - 0.3]} p={[0, 0.2, 0]} c="#2c2f36" />
      {/* standing riders (inside) */}
      {Array.from({ length: perSec }, (_, k) => { const idx = k * sections + ((si * 7) % sections); if (idx >= nF) return null;
        const row = k < 12 ? 0 : 1, col = row === 0 ? k : k - 12, n = row === 0 ? 12 : 8, xx = -Ls / 2 + 0.6 + col * ((Ls - 1.2) / (n - 1)), zz = row === 0 ? 0.75 : -0.45;
        return <Mini key={k} p={[xx, 0.7, zz]} rotY={row === 0 ? 0.25 * ((k % 3) - 1) : Math.PI / 2} s={1.05} seed={idx * 3 + 7} />; })}
      <Box s={[Ls - 0.2, 0.08, W - 0.2]} p={[0, 0.42, 0]} c="#4a4e57" />
      <XBox s={[Ls, 0.95, W]} p={[0, 0.85, 0]} c={color} round={0.1} />
      <XBox s={[Ls - 0.04, 1.45, W - 0.06]} p={[0, 2.03, 0]} c="#1f2933" o={0.3} round={0.03} shadow={false} />
      <XBox s={[Ls, 0.42, W]} p={[0, 2.95, 0]} c={color} round={0.1} />
      <Box s={[Ls - 0.1, 0.3, W - 0.3]} p={[0, 3.27, 0]} c="#f7f5ef" round={0.3} />
      <Flat w={W - 0.36} l={Ls - 0.16} p={[0, 3.422, 0]} rotY={Math.PI / 2} c="#f7f5ef" />
      <Box s={[Ls + 0.01, 0.1, W + 0.01]} p={[0, 1.33, 0]} c="#e8b93a" />
      {Array.from({ length: 5 }, (_, i) => [1, -1].map((k) => <XBox key={"pl" + i + k} s={[0.14, 1.45, 0.1]} p={[-Ls / 2 + 0.07 + i * ((Ls - 0.14) / 4), 2.03, k * (W / 2 - 0.045)]} c={color} />))}
      {/* one double door on the +z side per section */}
      <group position={[si % 2 ? -Ls * 0.18 : Ls * 0.18, 0, W / 2 + 0.015]}>
        <Box s={[1.3, 2.3, 0.03]} p={[0, 1.6, 0]} c="#16191e" />
        {[1, -1].map((k) => <Box key={k} s={[0.62, 2.2, 0.05]} p={[k * (0.31 + door * 0.55), 1.58, 0.04]} c="#3a4655" />)}
      </group>
      {/* pantograph on the middle section */}
      {si === Math.floor(sections / 2) ? <group position={[0, 3.42, 0]}>
        <Box s={[1.4, 0.12, 1.1]} c="#5a5f68" />
        {(() => { const h = wireY - 3.5, a = Math.atan2(h / 2, 0.7); return [1, -1].map((k) => <group key={k}>
          <mesh position={[k * 0.35, h * 0.25, 0]} rotation={[0, 0, -k * (Math.PI / 2 - a)]}><cylinderGeometry args={[0.035, 0.035, Math.hypot(0.7, h / 2), 8]} />{<meshStandardMaterial color="#3a3d44" />}</mesh>
          <mesh position={[k * 0.35, h * 0.75, 0]} rotation={[0, 0, k * (Math.PI / 2 - a)]}><cylinderGeometry args={[0.035, 0.035, Math.hypot(0.7, h / 2), 8]} />{<meshStandardMaterial color="#3a3d44" />}</mesh></group>); })()}
        <Box s={[0.16, 0.08, 1.5]} p={[0, wireY - 3.48, 0]} c="#3a3d44" />
      </group> : null}
    </group>)}
    {/* bellows joints */}
    {xs.slice(1).map((x, i) => <Box key={"j" + i} s={[gap + 0.1, 2.5, W - 0.25]} p={[x + Ls / 2 + gap / 2, 1.75, 0]} c="#4a4e57" round={0.3} />)}
    {/* nose: windscreen, lights */}
    <XBox s={[0.5, 1.6, W - 0.1]} p={[L / 2 + 0.05, 2.0, 0]} c="#1f2933" o={0.7} round={0.3} />
    {[1, -1].map((zs) => <mesh key={zs} position={[L / 2 + 0.03, 0.85, zs * 0.8]} rotation={[0, Math.PI / 2, 0]}><circleGeometry args={[0.15, 48]} />{glowMat("#fff4c8", 0.55)}</mesh>)}
    <Box s={[0.1, 0.25, W - 0.3]} p={[L / 2, 0.36, 0]} c="#2c2f36" />
  </group>;
};
export default Tram;
