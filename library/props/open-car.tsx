// prop category=car h=1.5
// Cutaway car for explainers: a small car with its roof lifted off (roofLift 0 on .. 1 floated up and away) so all five seats show.
// seatGlow[i] 0..1 lights seat i yellow (0 driver, 1 front passenger, 2-4 back bench). Faces +z; driver sits at x -0.42.
// Driver sitting: put a Toy (sit 1) at DRIVER_SEAT with y = seat top + 0.09 - legH; wheel: STEER position.
import React from "react";
import { Box, XBox, VehShadow, glowMat, mixHex, P3 } from "./_kit";

export const SEATS: P3[] = [[-0.42, 0.66, 0.22], [0.42, 0.66, 0.22], [-0.5, 0.66, -0.85], [0, 0.66, -0.85], [0.5, 0.66, -0.85]];
export const SEAT_TOP = 0.73;
const OpenCar: React.FC<{ p?: P3; rotY?: number; s?: number; c?: string; roofLift?: number; seatGlow?: number[]; steer?: P3; showWheel?: boolean; wheelR?: number }> =
  ({ p = [0, 0, 0], rotY = 0, s = 1, c = "#c9ced5", roofLift = 0, seatGlow = [], steer = [-0.42, 1.08, 0.66], showWheel = true, wheelR = 0.17 }) => {
  const wr = 0.34;
  return <group position={p} rotation={[0, rotY, 0]} scale={s}>
    <VehShadow w={2.0} l={4.4} k={0.8} />
    {[[0.86, 1.35], [-0.86, 1.35], [0.86, -1.35], [-0.86, -1.35]].map(([x, z], i) => <group key={i} position={[x, wr, z]} rotation={[0, 0, Math.PI / 2]}>
      <mesh castShadow><cylinderGeometry args={[wr, wr, 0.26, 32]} /><meshStandardMaterial color="#1d1d20" roughness={0.7} /></mesh>
      <mesh position={[0, x > 0 ? 0.135 : -0.135, 0]}><cylinderGeometry args={[0.17, 0.17, 0.01, 32]} /><meshStandardMaterial color="#b8bcc4" /></mesh></group>)}
    {/* shell: floor, hood, trunk, doors (sides), dashboard */}
    <Box s={[1.7, 0.14, 4.1]} p={[0, 0.32, 0]} c="#3a3e46" />
    <Box s={[1.82, 0.62, 1.15]} p={[0, 0.66, 1.5]} c={c} round={0.28} />
    <Box s={[1.82, 0.62, 0.85]} p={[0, 0.66, -1.62]} c={c} round={0.28} />
    {[1, -1].map((k) => <Box key={k} s={[0.14, 0.66, 2.4]} p={[k * 0.84, 0.66, -0.2]} c={c} round={0.3} />)}
    <Box s={[1.82, 0.28, 4.25]} p={[0, 0.42, 0]} c={c} round={0.3} />
    <Box s={[1.56, 0.3, 0.3]} p={[0, 1.0, 0.82]} c="#3a3e46" round={0.3} />
    {/* windscreen frame stays (low), headlights and tail lights */}
    {[1, -1].map((k) => <mesh key={"hl" + k} position={[k * 0.6, 0.72, 2.08]}><circleGeometry args={[0.13, 48]} />{glowMat("#fff4c8", 0.5)}</mesh>)}
    {[1, -1].map((k) => <mesh key={"tl" + k} position={[k * 0.65, 0.78, -2.05]} rotation={[0, Math.PI, 0]}><circleGeometry args={[0.1, 48]} />{glowMat("#ff3a2a", 0.35)}</mesh>)}
    {/* seats */}
    {SEATS.map(([x, y, z], i) => { const g = seatGlow[i] || 0, col = mixHex("#5a6070", "#ffc83d", g), w = i >= 2 ? 0.46 : 0.5;
      return <group key={i} position={[x, 0, z]}>
        <XBox s={[w, 0.16, 0.5]} p={[0, y, 0]} c={col} round={0.35} glow={g * 0.5} />
        <XBox s={[w, 0.62, 0.14]} p={[0, y + 0.36, -0.26]} c={col} round={0.35} glow={g * 0.5} />
      </group>; })}
    {/* steering wheel */}
    {showWheel ? <group position={steer}>
      <mesh rotation={[0.35, 0, 0]}><torusGeometry args={[wheelR, 0.03, 16, 48]} /><meshStandardMaterial color="#26282e" /></mesh>
      <mesh position={[0, -0.08, 0.16]} rotation={[0.35 + Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.03, 0.03, 0.36, 32]} /><meshStandardMaterial color="#26282e" /></mesh></group> : null}
    {/* the lifted roof: pillars + roof panel float up and back */}
    {roofLift < 0.99 ? <group position={[0, 1.6 * roofLift, -0.9 * roofLift]} rotation={[-0.25 * roofLift, 0, 0]}>
      <XBox s={[1.6, 0.1, 1.9]} p={[0, 1.5, -0.25]} c={c} round={0.3} o={1 - roofLift * 0.65} />
      {[[0.74, 0.72], [-0.74, 0.72], [0.74, -1.2], [-0.74, -1.2]].map(([x, z], i) => <XBox key={i} s={[0.09, 0.56, 0.09]} p={[x, 1.2, z]} c={c} o={1 - roofLift * 0.65} />)}
    </group> : null}
  </group>;
};
export default OpenCar;
