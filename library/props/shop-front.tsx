// prop category=building h=3.4
// Narrow city shop front: cream plaster wall, a rolled-up steel shutter over an open doorway, a small display window, a red-and-white
// striped awning and a blank sign board. Faces +z, origin on the pavement at the wall's centre. About 3.6 m wide, 3.4 m tall at s = 1.
import React from "react";
import { Box, Ball, Pill, Slab } from "./_kit";

type P3 = [number, number, number];
const ShopFront: React.FC<{ p?: P3; rotY?: number; s?: number; wall?: string; trim?: string }> = ({ p = [0, 0, 0], rotY = 0, s = 1, wall = "#efe2c6", trim = "#c0392b" }) =>
  <group position={p} rotation={[0, rotY, 0]} scale={s}>
    {/* wall with a doorway (x 0.3 .. 1.4) */}
    <Slab s={[2.1, 3.4, 0.3]} p={[-0.75, 1.7, 0]} c={wall} />
    <Box s={[0.4, 3.4, 0.3]} p={[1.6, 1.7, 0]} c={wall} />
    <Slab s={[1.1, 1.2, 0.3]} p={[0.85, 2.8, 0]} c={wall} />
    <Box s={[1.1, 2.2, 0.1]} p={[0.85, 1.1, -0.6]} c="#5a4636" />
    {/* rolled-up shutter and its rails */}
    <Pill r={0.11} len={1.0} p={[0.85, 2.12, 0.18]} rot={[0, 0, Math.PI / 2]} c="#9aa1a8" />
    {[0.28, 1.42].map((x) => <Box key={x} s={[0.05, 2.2, 0.08]} p={[x, 1.1, 0.17]} c="#8d939a" />)}
    {/* display window with shelves of jars */}
    <Box s={[1.3, 0.95, 0.04]} p={[-0.85, 1.35, 0.16]} c="#bfe0f2" />
    {[[-0.85, 1.85, 1.42, 0.07], [-0.85, 0.85, 1.42, 0.08], [-1.53, 1.35, 0.07, 1.05], [-0.17, 1.35, 0.07, 1.05]].map(([x, y, sx, sy], i) => <Box key={i} s={[sx, sy, 0.08]} p={[x, y, 0.17]} c="#ffffff" />)}
    {[-1.3, -1.05, -0.8, -0.55].map((x, i) => <Ball key={i} r={0.07} p={[x, 1.08, 0.12]} c={["#e0402e", "#f2a93b", "#6cbb48", "#f2c22e"][i]} />)}
    {/* blank sign board + awning */}
    <Box s={[2.9, 0.42, 0.08]} p={[-0.05, 2.95, 0.19]} c={trim} />
    <Box s={[2.6, 0.26, 0.04]} p={[-0.05, 2.95, 0.24]} c="#fbf3e2" round={0.3} />
    <group position={[-0.05, 2.5, 0.2]} rotation={[0.35, 0, 0]}>
      {Array.from({ length: 10 }, (_, i) => <Box key={i} s={[0.33, 0.05, 0.55]} p={[-1.48 + i * 0.33, 0, 0.27]} c={i % 2 ? "#ffffff" : trim} />)}
    </group>
  </group>;
export default ShopFront;
