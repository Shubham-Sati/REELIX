// prop category=street h=2.9
// Bus stop shelter: red frame, clear back and side panels, cream roof, a bench, and a pole with a round red stop sign (no text). Faces +z.
import React from "react";
import { Box, XBox, Ball, Flat, P3 } from "./_kit";

const BusStop: React.FC<{ p?: P3; rotY?: number; s?: number; c?: string }> = ({ p = [0, 0, 0], rotY = 0, s = 1, c = "#e0483a" }) =>
  <group position={p} rotation={[0, rotY, 0]} scale={s}>
    {[[-1.5, -0.6], [1.5, -0.6], [-1.5, 0.55], [1.5, 0.55]].map(([x, z], i) => <Box key={i} s={[0.1, 2.5, 0.1]} p={[x, 1.25, z]} c={c} />)}
    <Box s={[3.3, 0.16, 1.5]} p={[0, 2.55, 0]} c="#f6ead0" />
    <Flat w={3.26} l={1.46} p={[0, 2.632, 0]} c="#f6ead0" />
    <Box s={[3.32, 0.1, 1.52]} p={[0, 2.44, 0]} c={c} />
    <XBox s={[2.9, 1.9, 0.05]} p={[0, 1.3, -0.6]} c="#cfe6f2" o={0.35} shadow={false} />
    {[1, -1].map((k) => <XBox key={k} s={[0.05, 1.9, 0.9]} p={[k * 1.5, 1.3, -0.08]} c="#cfe6f2" o={0.35} shadow={false} />)}
    <Box s={[2.2, 0.08, 0.42]} p={[0, 0.5, -0.36]} c="#8a5a34" />
    {[1, -1].map((k) => <Box key={"l" + k} s={[0.08, 0.5, 0.3]} p={[k * 0.95, 0.25, -0.36]} c="#5a5f68" />)}
    <group position={[2.1, 0, 0.5]}>
      <mesh position={[0, 1.4, 0]} castShadow><cylinderGeometry args={[0.05, 0.05, 2.8, 32]} /><meshStandardMaterial color="#9aa0a8" /></mesh>
      <mesh position={[0, 2.75, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.35, 0.35, 0.06, 40]} /><meshStandardMaterial color={c} /></mesh>
      <mesh position={[0, 2.75, 0.035]}><circleGeometry args={[0.22, 48]} /><meshStandardMaterial color="#f6ead0" /></mesh>
      <Box s={[0.26, 0.08, 0.03]} p={[0, 2.75, 0.05]} c={c} />
    </group>
  </group>;
export default BusStop;
