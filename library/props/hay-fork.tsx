// prop category=tool h=1.5
// Wooden hay fork standing upright on its tines: long handle, metal crossbar and four prongs at the bottom. Base (prong tips) at p, about 1.5 m tall at s = 1.
import React from "react";
import { Box, Pill } from "./_kit";

type P3 = [number, number, number];
const HayFork: React.FC<{ p?: P3; rotY?: number; s?: number; tiltX?: number; tiltZ?: number }> = ({ p = [0, 0, 0], rotY = 0, s = 1, tiltX = 0, tiltZ = 0 }) =>
  <group position={p} rotation={[tiltX, rotY, tiltZ]} scale={s}>
    {[-0.09, -0.03, 0.03, 0.09].map((x) => <Pill key={x} r={0.01} len={0.26} p={[x, 0.14, 0]} c="#9aa1a8" />)}
    <Box s={[0.22, 0.035, 0.035]} p={[0, 0.29, 0]} c="#8a9097" round={0.3} />
    <Pill r={0.022} len={0.12} p={[0, 0.36, 0]} c="#8a9097" />
    <Pill r={0.02} len={1.08} p={[0, 0.96, 0]} c="#b57e4c" />
  </group>;
export default HayFork;
