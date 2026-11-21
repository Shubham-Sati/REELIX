// prop category=animal-home h=1.0
// Toy dog kennel: red wooden box with a cream pitched roof, a round-topped dark doorway at the front (+z) and a little bone sign plate.
// Base at p, about 1.0 m tall at s = 1.
import React, { useMemo } from "react";
import * as THREE from "three";
import { Box, Ball } from "./_kit";

type P3 = [number, number, number];
const Kennel: React.FC<{ p?: P3; rotY?: number; s?: number; wall?: string; roof?: string }> = ({ p = [0, 0, 0], rotY = 0, s = 1, wall = "#c8453a", roof = "#f2e6c8" }) => {
  const W = 0.9, D = 1.0, H = 0.62;
  const gable = useMemo(() => { const sh = new THREE.Shape(); sh.moveTo(-W / 2, 0); sh.lineTo(W / 2, 0); sh.lineTo(0, 0.34); sh.lineTo(-W / 2, 0); return sh; }, []);
  const roofLen = Math.hypot(W / 2 + 0.1, 0.38);
  return <group position={p} rotation={[0, rotY, 0]} scale={s}>
    <Box s={[W, H, D]} p={[0, H / 2, 0]} c={wall} />
    {[1, -1].map((sd) => <mesh key={sd} position={[0, H, sd * (D / 2 - 0.005)]} rotation={[0, sd > 0 ? 0 : Math.PI, 0]} castShadow>
      <extrudeGeometry args={[gable, { depth: 0.01, bevelEnabled: false }]} /><meshStandardMaterial color={wall} roughness={0.55} /></mesh>)}
    {[1, -1].map((sd) => <Box key={"r" + sd} s={[roofLen, 0.06, D + 0.16]} p={[sd * (W / 4 + 0.03), H + 0.19, 0]} r={[0, 0, -sd * Math.atan2(0.38, W / 2 + 0.1)]} c={roof} />)}
    <Box s={[0.36, 0.34, 0.03]} p={[0, 0.17, D / 2 + 0.005]} c="#2a1f1a" />
    <mesh position={[0, 0.34, D / 2 + 0.005]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.18, 0.18, 0.03, 32, 1, false, -Math.PI / 2, Math.PI]} /><meshStandardMaterial color="#2a1f1a" roughness={0.7} /></mesh>
    <group position={[0, H + 0.1, D / 2 + 0.02]}>
      <Box s={[0.16, 0.035, 0.02]} p={[0, 0, 0]} c="#f6f3ec" round={0.4} />
      {[-1, 1].map((x) => [-1, 1].map((y) => <Ball key={x + "" + y} r={0.022} p={[x * 0.08, y * 0.016, 0]} c="#f6f3ec" />))}
    </group>
  </group>;
};
export default Kennel;
