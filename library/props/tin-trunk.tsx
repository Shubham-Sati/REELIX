// prop category=furniture h=0.48
// Old dented tin trunk: blue-grey painted steel box with a lid rim, brass corner straps, a hasp and side handles, one dent on the front.
// Faces +z, origin on the floor at its centre. About 0.85 m wide, 0.48 m tall, 0.45 m deep at s = 1.
import React from "react";
import { Box, Ball } from "./_kit";

type P3 = [number, number, number];
const TinTrunk: React.FC<{ p?: P3; rotY?: number; s?: number; c?: string }> = ({ p = [0, 0, 0], rotY = 0, s = 1, c = "#6f8494" }) =>
  <group position={p} rotation={[0, rotY, 0]} scale={s}>
    <Box s={[0.85, 0.4, 0.45]} p={[0, 0.2, 0]} c={c} />
    <Box s={[0.88, 0.08, 0.48]} p={[0, 0.44, 0]} c={c} />
    <Box s={[0.89, 0.025, 0.49]} p={[0, 0.4, 0]} c="#4f5f6b" />
    {[-1, 1].map((sx) => [-1, 1].map((sz) => <Box key={sx + "" + sz} s={[0.06, 0.47, 0.06]} p={[sx * 0.415, 0.235, sz * 0.22]} c="#c9a24a" />))}
    <Box s={[0.07, 0.11, 0.02]} p={[0, 0.37, 0.235]} c="#c9a24a" />
    <Ball r={0.02} p={[0, 0.33, 0.25]} c="#a88a3a" />
    {[-1, 1].map((sx) => <mesh key={sx} position={[sx * 0.44, 0.3, 0]} rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[0.05, 0.01, 16, 48, Math.PI]} /><meshStandardMaterial color="#3a3d42" /></mesh>)}
    {/* the dent: a shallow darker hollow with a light rim */}
    <Ball r={0.08} p={[-0.2, 0.2, 0.218]} s={[1.2, 0.8, 0.12]} c="#56687a" />
    <mesh position={[-0.2, 0.2, 0.226]} scale={[1.2, 0.8, 1]}><torusGeometry args={[0.08, 0.006, 16, 48]} /><meshStandardMaterial color="#8ea3b4" /></mesh>
  </group>;
export default TinTrunk;
