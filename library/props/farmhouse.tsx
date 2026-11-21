// prop category=house h=3.4
// Small yellow toy farmhouse: cream-trimmed walls, red pitched roof, white door, four windows, a chimney. Front faces +z, about 3.4 m tall at s = 1.
import React, { useMemo } from "react";
import * as THREE from "three";
import { Box } from "./_kit";

type P3 = [number, number, number];
const Farmhouse: React.FC<{ p?: P3; rotY?: number; s?: number; wall?: string; roof?: string }> = ({ p = [0, 0, 0], rotY = 0, s = 1, wall = "#f2cf5b", roof = "#c8453a" }) => {
  const W = 3.2, D = 2.4, H = 2.0;
  const gable = useMemo(() => { const sh = new THREE.Shape(); sh.moveTo(-D / 2, 0); sh.lineTo(D / 2, 0); sh.lineTo(0, 1.15); sh.lineTo(-D / 2, 0); return sh; }, []);
  const roofLen = Math.hypot(D / 2 + 0.25, 1.2);
  return <group position={p} rotation={[0, rotY, 0]} scale={s}>
    <Box s={[W + 0.2, 0.2, D + 0.2]} p={[0, 0.1, 0]} c="#cdbfa6" />
    <Box s={[W, H, D]} p={[0, 0.2 + H / 2, 0]} c={wall} />
    <mesh position={[-(W - 0.02) / 2, 0.2 + H, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
      <extrudeGeometry args={[gable, { depth: W - 0.02, bevelEnabled: false }]} />
      <meshStandardMaterial color={wall} roughness={0.55} />
    </mesh>
    {[1, -1].map((sd) => <Box key={sd} s={[W + 0.4, 0.12, roofLen]} p={[0, 0.2 + H + 0.6, sd * (D / 4 + 0.06)]} r={[sd * Math.atan2(1.2, D / 2 + 0.25), 0, 0]} c={roof} />)}
    <Box s={[0.35, 0.8, 0.35]} p={[0.9, 0.2 + H + 1.1, -0.3]} c="#a8452d" />
    <Box s={[0.6, 1.05, 0.06]} p={[0, 0.2 + 0.52, D / 2 + 0.02]} c="#f6f3ec" />
    <Box s={[0.08, 0.08, 0.05]} p={[0.18, 0.2 + 0.5, D / 2 + 0.06]} c="#c8a23a" />
    {[-1.05, 1.05].map((x) => [0.75, 1.55].map((y) => <group key={x + "_" + y}>
      <Box s={[0.56, 0.48, 0.06]} p={[x, 0.2 + y, D / 2 + 0.02]} c="#f6f3ec" />
      <Box s={[0.44, 0.36, 0.07]} p={[x, 0.2 + y, D / 2 + 0.03]} c="#9cc6e8" />
    </group>)).flat()}
  </group>;
};
export default Farmhouse;
