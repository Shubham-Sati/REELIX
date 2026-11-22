// prop category=farm h=5.2
// Toy red barn: barn-red flat walls, cream pitched roof, white trim, big double door with white X braces and a hay-loft window. Front faces +z,
// origin on the ground at the barn's centre. About 5 m wide, 6 m deep, 5.2 m tall at s = 1. roof = roof colour.
import React, { useMemo } from "react";
import * as THREE from "three";
import { Box, Slab } from "./_kit";

type P3 = [number, number, number];
const RedBarn: React.FC<{ p?: P3; rotY?: number; s?: number; wall?: string; roof?: string; door?: number }> = ({ p = [0, 0, 0], rotY = 0, s = 1, wall = "#c4473a", roof = "#f1e4c6", door = 0 }) => {
  const W = 5, D = 6, H = 3.0, R = 2.1;
  const gable = useMemo(() => { const sh = new THREE.Shape(); sh.moveTo(-W / 2, 0); sh.lineTo(W / 2, 0); sh.lineTo(0, R); sh.lineTo(-W / 2, 0); return sh; }, []);
  const slope = Math.hypot(W / 2 + 0.3, R + 0.2), ang = Math.atan2(R, W / 2);
  const trim = "#f7f2e6";
  return <group position={p} rotation={[0, rotY, 0]} scale={s}>
    <Slab s={[W, H, D]} p={[0, H / 2, 0]} c={wall} />
    {[1, -1].map((sd) => <mesh key={sd} position={[0, H, sd * D / 2 - (sd > 0 ? 0.001 : -0.001)]} rotation={[0, sd > 0 ? 0 : Math.PI, 0]} castShadow receiveShadow>
      <shapeGeometry args={[gable]} /><meshStandardMaterial color={wall} roughness={0.6} side={THREE.DoubleSide} /></mesh>)}
    {[1, -1].map((sd) => <Box key={sd} s={[slope, 0.16, D + 0.5]} p={[sd * (W / 4 + 0.05), H + R / 2 + 0.08, 0]} r={[0, 0, -sd * ang]} c={roof} />)}
    {/* front trim and doors */}
    {[[-W / 2 + 0.06, H / 2], [W / 2 - 0.06, H / 2]].map(([x, y], i) => <Box key={i} s={[0.14, H, 0.08]} p={[x, y, D / 2 + 0.04]} c={trim} />)}
    <group position={[0, 0, D / 2 + 0.03]}>
      {[1, -1].map((sd) => <group key={sd} position={[sd * 1.1, 0, 0]} rotation={[0, sd * door * 1.4, 0]}><group position={[-sd * 0.55, 0, 0]}>
        <Box s={[1.1, 2.2, 0.07]} p={[0, 1.1, 0]} c={wall} />
        <Box s={[1.1, 0.1, 0.09]} p={[0, 2.15, 0.01]} c={trim} /><Box s={[1.1, 0.1, 0.09]} p={[0, 0.05, 0.01]} c={trim} />
        <Box s={[0.1, 2.2, 0.09]} p={[0.5, 1.1, 0.01]} c={trim} /><Box s={[0.1, 2.2, 0.09]} p={[-0.5, 1.1, 0.01]} c={trim} />
        <Box s={[2.3, 0.09, 0.09]} p={[0, 1.1, 0.02]} r={[0, 0, Math.atan2(2.1, 1.0)]} c={trim} /><Box s={[2.3, 0.09, 0.09]} p={[0, 1.1, 0.02]} r={[0, 0, -Math.atan2(2.1, 1.0)]} c={trim} />
      </group></group>)}
      <Box s={[2.3, 2.3, 0.04]} p={[0, 1.15, -0.04]} c="#4a3328" />
      <Box s={[1.0, 0.8, 0.07]} p={[0, H + 0.6, 0]} c="#f7f2e6" /><Box s={[0.8, 0.6, 0.08]} p={[0, H + 0.6, 0.01]} c="#5a3e30" />
    </group>
  </group>;
};
export default RedBarn;
