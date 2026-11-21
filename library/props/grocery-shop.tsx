// prop category=building h=3.3
// Small corner grocery shop: cream walls, big front window, door, green-and-white striped awning, a blank green sign board,
// and two crates of produce out front. Faces +z. About 3.4 m wide, 3.3 m tall, 2.4 m deep at s = 1.
import React from "react";
import { Box, Ball, Food } from "./_kit";

type P3 = [number, number, number];
const WALL = "#f4ead6", TRIM = "#2f8a4e", GLASS = "#b9def2", WOOD = "#b57e4c";

const GroceryShop: React.FC<{ p?: P3; rotY?: number; s?: number; crates?: boolean }> = ({ p = [0, 0, 0], rotY = 0, s = 1, crates = true }) =>
  <group position={p} rotation={[0, rotY, 0]} scale={s}>
    <Box s={[3.4, 2.9, 2.4]} p={[0, 1.45, 0]} c={WALL} />
    <Box s={[3.55, 0.22, 2.55]} p={[0, 2.98, 0]} c={TRIM} />
    <Box s={[2.2, 0.42, 0.06]} p={[0, 2.62, 1.22]} c={TRIM} round={0.2} />
    <Box s={[1.9, 0.26, 0.03]} p={[0, 2.62, 1.26]} c="#f7f1e2" round={0.3} />
    {/* window with shelves of produce behind the glass */}
    <Box s={[1.8, 1.2, 0.05]} p={[-0.6, 1.25, 1.21]} c={GLASS} />
    {[[-0.6, 1.88, 1.95, 0.08], [-0.6, 0.62, 1.95, 0.1], [-1.53, 1.25, 0.08, 1.3], [0.33, 1.25, 0.08, 1.3]].map(([x, y, sx, sy], i) => <Box key={i} s={[sx, sy, 0.1]} p={[x, y, 1.23]} c="#ffffff" />)}
    {[-1.15, -0.85, -0.55, -0.25, 0.05].map((x, i) => <Ball key={i} r={0.08} p={[x, 0.95, 1.12]} c={["#e0402e", "#f29a2e", "#6cbb48", "#e0402e", "#f2c22e"][i]} />)}
    {/* door */}
    <Box s={[0.75, 1.75, 0.05]} p={[1.0, 0.875, 1.21]} c={TRIM} />
    <Box s={[0.5, 0.9, 0.03]} p={[1.0, 1.15, 1.24]} c={GLASS} />
    <Ball r={0.035} p={[0.75, 0.85, 1.26]} c="#e8c35a" />
    {/* striped awning over the window and door */}
    <group position={[0, 2.18, 1.25]} rotation={[0.42, 0, 0]}>
      {Array.from({ length: 10 }, (_, i) => <Box key={i} s={[0.34, 0.05, 0.85]} p={[-1.53 + i * 0.34, 0, 0.42]} c={i % 2 ? "#ffffff" : TRIM} />)}
      {Array.from({ length: 10 }, (_, i) => <Ball key={"sc" + i} r={0.17} p={[-1.53 + i * 0.34, 0, 0.85]} s={[1, 0.25, 0.6]} c={i % 2 ? "#ffffff" : TRIM} />)}
    </group>
    {crates ? [-1.0, -0.2].map((x, i) => <group key={i} position={[x, 0, 1.6]}>
      <Box s={[0.62, 0.32, 0.42]} p={[0, 0.16, 0]} c={WOOD} />
      {[-0.18, 0, 0.18].map((dx, j) => <Food key={j} kind={i ? "orange" : "tomato"} p={[dx, 0.32, (j - 1) * 0.05]} s={i ? 2.3 : 2.6} />)}
    </group>) : null}
  </group>;
export default GroceryShop;
