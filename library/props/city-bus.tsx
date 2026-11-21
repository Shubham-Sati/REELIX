// prop category=bus h=3.1
// Red city bus (12 m single-deck): tomato-red body, cream roof stripe, dark tinted windows, two folding doors on the +z side,
// round headlights, black wheels. Faces +x. Explainer controls: xray (body and glass fade so the 40 seats show), seatsLit (0..40,
// seats glow yellow in order front to back), faces (0..1 of the 40 seats filled with riders), door (0 shut .. 1 open), brake, roll (metres driven, spins wheels).
import React from "react";
import { Box, Ball, XBox, Flat, Mini, VehShadow, glowMat, mixHex, P3 } from "./_kit";

export const BUS = { L: 12, W: 2.55, H: 3.1 };
const seatPos = (L: number) => { const out: [number, number][] = []; const x0 = L / 2 - 2.3, x1 = -L / 2 + 0.9;
  for (let r = 0; r < 10; r++) { const x = x0 + (x1 - x0) * (r / 9); for (const z of [0.88, 0.42, -0.42, -0.88]) out.push([x, z]); } return out; };
const CityBus: React.FC<{ p?: P3; rotY?: number; s?: number; xray?: number; seatsLit?: number; faces?: number; door?: number; brake?: number; roll?: number; color?: string; lookOut?: number; open?: boolean }> =
  ({ p = [0, 0, 0], rotY = 0, s = 1, xray = 0, seatsLit = 0, faces = 0, door = 0, brake = 0, roll = 0, color = "#e0483a", lookOut = 1.1, open = false }) => {
  const { L, W } = BUS, body = 1 - 0.82 * xray, glass = open ? 0.25 : 0.66 * (1 - 0.8 * xray);
  const seats = seatPos(L), nF = Math.round(faces * 40), wr = 0.5, spin = -roll / wr;
  const pillars = Array.from({ length: 8 }, (_, i) => -L / 2 + 0.1 + i * ((L - 0.2) / 7));
  return <group position={p} rotation={[0, rotY, 0]} scale={s}>
    <group rotation={[0, Math.PI / 2, 0]}><VehShadow w={W + 0.4} l={L + 0.3} k={0.8} /></group>
    {/* wheels */}
    {[L / 2 - 2.3, -L / 2 + 2.6].map((x) => [1, -1].map((zs) => <group key={x + "_" + zs} position={[x, wr, zs * (W / 2 - 0.1)]} rotation={[Math.PI / 2, spin, 0]}>
      <mesh castShadow><cylinderGeometry args={[wr, wr, 0.34, 32]} /><meshStandardMaterial color="#1d1d20" roughness={0.7} /></mesh>
      <mesh position={[0, zs * 0.175, 0]}><cylinderGeometry args={[0.24, 0.24, 0.02, 32]} /><meshStandardMaterial color="#b8bcc4" /></mesh>
      <Box s={[0.36, 0.03, 0.08]} p={[0, zs * 0.18, 0]} c="#8a8e96" />
    </group>))}
    {/* floor and seats (inside) */}
    <Box s={[L - 0.3, 0.1, W - 0.2]} p={[0, 0.78, 0]} c="#4a4e57" />
    {seats.map(([x, z], i) => { const lit = Math.max(0, Math.min(1, seatsLit - i)), c = mixHex("#55678a", "#ffc83d", lit);
      return <group key={i} position={[x, 0, z]}>
        <XBox s={[0.42, 0.13, 0.4]} p={[0, 1.2, 0]} c={c} round={0.3} glow={lit * 0.45} />
        <XBox s={[0.1, 0.55, 0.4]} p={[-0.2, 1.47, 0]} c={c} round={0.3} glow={lit * 0.45} />
        <Box s={[0.3, 0.38, 0.06]} p={[0, 0.97, 0]} c="#3a3e46" />
      </group>; })}
    {/* riders */}
    {seats.slice(0, nF).map(([x, z], i) => <Mini key={"m" + i} p={[x + 0.05, 1.27, z]} rotY={Math.PI / 2 - (z > 0 ? lookOut : z < -0.6 ? -0.9 : 0)} s={0.95} seed={i + 3} seated />)}
    {/* lower body, window glass band, roof */}
    <XBox s={[L, 1.05, W]} p={[0, 0.88, 0]} c={color} o={body} round={0.12} />
    <XBox s={[L - 0.04, 1.25, W - 0.06]} p={[0, 2.03, 0]} c="#1f2933" o={glass} round={0.04} shadow={false} />
    {!open ? <XBox s={[L, 0.5, W]} p={[0, 2.88, 0]} c={color} o={body} round={0.12} /> : null}
    {!open ? <XBox s={[L + 0.02, 0.17, W + 0.02]} p={[0, 2.62, 0]} c="#f6ead0" o={body} round={0.06} />
      : [1, -1].map((k) => <Box key={"os" + k} s={[L, 0.17, 0.1]} p={[0, 2.62, k * (W / 2 - 0.04)]} c="#f6ead0" />)}
    {!open ? <XBox s={[L - 0.6, 0.12, W - 0.5]} p={[0, 3.16, 0]} c="#f6ead0" o={body} round={0.3} /> : null}
    {body > 0.99 && !open ? <><Flat w={W - 0.56} l={L - 0.66} p={[0, 3.222, 0]} rotY={Math.PI / 2} c="#f6ead0" /><Flat w={W - 0.04} l={L - 0.04} p={[0, 3.132, 0]} rotY={Math.PI / 2} c={color} /></> : null}
    <XBox s={[L + 0.02, 0.08, W + 0.02]} p={[0, 1.38, 0]} c="#b8352a" o={body} round={0.06} />
    {pillars.map((x, i) => [1, -1].map((k) => <XBox key={"pl" + i + k} s={[0.14, 1.25, 0.1]} p={[x, 2.03, k * (W / 2 - 0.045)]} c={color} o={body} />))}
    {/* windscreen (clear dark glass) with the bus driver behind it */}
    <Mini p={[L / 2 - 0.9, 1.25, -0.6]} rotY={Math.PI / 2} s={0.95} seed={99} seated />
    <XBox s={[0.06, 1.3, W - 0.2]} p={[L / 2 + 0.005, 2.0, 0]} c="#33414f" o={0.55} round={0.3} shadow={false} />
    <mesh position={[L / 2 + 0.04, 2.25, 0.6]} rotation={[0, Math.PI / 2, 0.5]}><planeGeometry args={[0.12, 0.9]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.35} /></mesh>
    {/* front: headlights, bumper, destination strip, wipers */}
    {[1, -1].map((zs) => <group key={"h" + zs} position={[L / 2 + 0.01, 0.78, zs * 0.85]} rotation={[0, Math.PI / 2, 0]}>
      <mesh><circleGeometry args={[0.17, 48]} />{glowMat("#fff4c8", 0.55)}</mesh>
      <mesh position={[0, 0, -0.005]}><ringGeometry args={[0.17, 0.22, 32]} /><meshStandardMaterial color="#d9dce2" /></mesh></group>)}
    <Box s={[0.22, 0.28, W - 0.05]} p={[L / 2 + 0.02, 0.45, 0]} c="#2c2f36" />
    <Box s={[0.06, 0.2, 1.4]} p={[L / 2 + 0.01, 2.78, 0]} c="#1b1d22" />
    <mesh position={[L / 2 + 0.05, 2.78, 0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[1.2, 0.1]} />{glowMat("#ffb43a", 0.6)}</mesh>
    {/* back: brake lights */}
    {[1, -1].map((zs) => <mesh key={"b" + zs} position={[-L / 2 - 0.01, 0.95, zs * 0.95]} rotation={[0, -Math.PI / 2, 0]}><circleGeometry args={[0.13, 48]} />{glowMat("#ff3a2a", 0.25 + 0.6 * brake)}</mesh>)}
    {/* two folding doors on the +z side (front and middle) */}
    {[L / 2 - 1.05, -0.2].map((x) => <group key={"d" + x} position={[x, 0, W / 2 + 0.015]}>
      <XBox s={[1.2, 2.2, 0.03]} p={[0, 1.5, 0]} c="#16191e" o={body} />
      {[1, -1].map((k) => <group key={k} position={[k * 0.58, 0, 0.03]} rotation={[0, k * door * 1.35, 0]}>
        <XBox s={[0.56, 2.05, 0.05]} p={[-k * 0.28, 1.48, 0]} c="#3a4655" o={body} />
        <XBox s={[0.5, 1.4, 0.06]} p={[-k * 0.28, 1.68, 0]} c="#202a35" o={body} />
      </group>)}
      <Box s={[1.3, 0.12, 0.3]} p={[0, 0.36, 0.08]} c="#9aa0a8" />
    </group>)}
  </group>;
};
export default CityBus;
