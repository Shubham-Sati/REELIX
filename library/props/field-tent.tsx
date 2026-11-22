// prop category=prop h=2.2
// Small cream field tent (open-front canopy / gazebo): four thin grey poles, a cream peaked roof with a short valance, guy ropes.
// Front faces +z, origin on the ground at the centre. About 3 m wide, 2.6 m deep, 2.2 m tall at s = 1.
import React from "react";
import { Box, Pill } from "./_kit";

type P3 = [number, number, number];
const FieldTent: React.FC<{ p?: P3; rotY?: number; s?: number; c?: string }> = ({ p = [0, 0, 0], rotY = 0, s = 1, c = "#f1e6cc" }) => {
  const W = 3, D = 2.6, H = 1.9;
  return <group position={p} rotation={[0, rotY, 0]} scale={s}>
    {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z], i) => <Pill key={i} r={0.03} len={H} p={[x * W / 2, H / 2, z * D / 2]} c="#9aa0a6" />)}
    <mesh position={[0, H + 0.28, 0]} rotation={[0, Math.PI / 4, 0]} scale={[W / 2 * 1.414, 1, D / 2 * 1.414]} castShadow receiveShadow>
      <coneGeometry args={[1, 0.6, 4, 1]} /><meshStandardMaterial color={c} roughness={0.7} /></mesh>
    {[[0, D / 2, W, 0], [0, -D / 2, W, 0], [W / 2, 0, D, Math.PI / 2], [-W / 2, 0, D, Math.PI / 2]].map(([x, z, l, r], i) =>
      <Box key={i} s={[l + 0.04, 0.2, 0.03]} p={[x, H - 0.08, z]} r={[0, r, 0]} c={i === 0 ? "#e8d8b4" : c} round={0.2} />)}
  </group>;
};
export default FieldTent;
