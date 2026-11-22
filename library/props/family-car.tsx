// prop category=car h=1.72
// Small four-door family sedan (toy scale for kit people): glossy sky-blue body, silver bumpers, see-through glass so the people
// inside show, five seats, a steering wheel on the right (Indian right-hand drive: driver at x -0.42), a driver door that opens
// (door 0 shut .. 1 open, hinged at its front edge), headlights (lights 0..1, with soft beams at night), red tail lights (brake 0..1),
// wheels that turn (roll = metres driven). Faces +z, about 4.1 m long, 1.7 m wide, 1.72 m tall. children are drawn in the car's
// own frame (seat people with CAR_SEATS: hips at seat point, sit 1, y = seat top + 0.09 - legH).
import React from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Box, Ball, XBox, Glow, P3 } from "./_kit";

export const CAR_SEAT_TOP = 0.42;
export const CAR_SEATS: Record<string, P3> = { driver: [-0.42, 0, -0.2], front: [0.42, 0, -0.2], rearL: [-0.45, 0, -0.95], rearM: [0, 0, -0.95], rearR: [0.45, 0, -0.95] };
export const CAR_WHEEL: P3 = [-0.42, 1.0, 0.26];
const FamilyCar: React.FC<{ p?: P3; rotY?: number; s?: number; c?: string; door?: number; lights?: number; brake?: number; roll?: number; beams?: number; glass?: number; children?: React.ReactNode }> =
  ({ p = [0, 0, 0], rotY = 0, s = 1, c = "#7cc3ec", door = 0, lights = 0, brake = 0, roll = 0, beams = 0, glass = 0.32, children }) => {
  const trim = "#5ba7d8", silver = "#d4d8de", inner = "#3a3d44", seat = "#4d525c", tyre = "#222428", gl = "#a9d6ee";
  const R = 0.33, spin = roll / R;
  const belt = 0.92, roofY = 1.68;
  const pill = (a: [number, number], b: [number, number], x: number) => { const dy = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dy, dz);
    return <Box s={[0.17, L, 0.15]} p={[x, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2]} r={[Math.atan2(dz, dy), 0, 0]} c={c} round={0.3} />; };
  const ws = { a: [belt, 1.0] as [number, number], b: [roofY - 0.04, 0.5] as [number, number] }, rs = { a: [belt, -1.55] as [number, number], b: [roofY - 0.04, -1.05] as [number, number] };
  const pane = (a: [number, number], b: [number, number]) => { const dy = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dy, dz);
    return <XBox s={[1.58, L, 0.02]} p={[0, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2]} r={[Math.atan2(dz, dy), 0, 0]} c={gl} o={glass} shadow={false} recv={false} />; };
  const wheel = (x: number, z: number) => <group key={x + "," + z} position={[x, R, z]}>
    <group rotation={[spin, 0, 0]}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[R, R, 0.26, 32]} /><meshStandardMaterial color={tyre} roughness={0.8} /></mesh>
      <mesh position={[Math.sign(x) * 0.135, 0, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.17, 0.17, 0.02, 32]} /><meshStandardMaterial color={silver} metalness={0.4} roughness={0.3} /></mesh>
      <Box s={[0.03, 0.26, 0.05]} p={[Math.sign(x) * 0.14, 0, 0]} c="#9aa0a8" />
    </group>
  </group>;
  const gloss = { roughness: 0.28 };
  return <group position={p} rotation={[0, rotY, 0]} scale={s}>
    {/* soft shadow under the car */}
    <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1, 2.3, 1]}><circleGeometry args={[0.95, 48]} /><meshBasicMaterial color="#000000" transparent opacity={0.22} depthWrite={false} /></mesh>
    {wheel(0.8, 1.32)}{wheel(-0.8, 1.32)}{wheel(0.8, -1.32)}{wheel(-0.8, -1.32)}
    {/* floor, hood block, trunk block, cabin side walls */}
    <Box s={[1.6, 0.06, 2.2]} p={[0, 0.27, -0.1]} c={inner} />
    <group>
      <mesh position={[0, 0.58, 1.5]} castShadow receiveShadow><primitive object={roundBox(1.7, 0.66, 1.1, 0.16)} attach="geometry" /><meshStandardMaterial color={c} {...gloss} /></mesh>
      <mesh position={[0, 0.58, -1.6]} castShadow receiveShadow><primitive object={roundBox(1.7, 0.66, 0.9, 0.16)} attach="geometry" /><meshStandardMaterial color={c} {...gloss} /></mesh>
    </group>
    <Box s={[0.08, 0.68, 2.12]} p={[0.81, 0.58, -0.1]} c={c} />
    <Box s={[0.08, 0.68, 0.92]} p={[-0.81, 0.58, -0.66]} c={c} />
    <Box s={[0.012, 0.03, 0.9]} p={[0.856, 0.75, -0.1]} c={trim} />
    {/* bumpers, grille, lights */}
    {[1, -1].map((sd) => <Box key={"bp" + sd} s={[1.78, 0.17, 0.16]} p={[0, 0.36, sd * 2.08]} c={silver} round={0.45} />)}
    <Box s={[0.8, 0.14, 0.03]} p={[0, 0.64, 2.06]} c="#2b2e33" round={0.3} />
    {[1, -1].map((sd) => <group key={"hl" + sd} position={[sd * 0.6, 0.7, 2.04]}>
      <mesh scale={[1.3, 0.8, 0.45]}><sphereGeometry args={[0.1, 32, 24]} /><meshStandardMaterial color={lights > 0.05 ? "#fff6d0" : "#e9eef2"} emissive="#fff1b0" emissiveIntensity={0.9 * lights} /></mesh>
      {lights > 0.05 ? <Glow r={0.32} c="#fff0b0" k={0.45 * lights} /> : null}
      {beams > 0.02 ? <mesh position={[0, -0.3, 2.6]} rotation={[-Math.PI / 2 + 0.07, 0, 0]} renderOrder={6}><coneGeometry args={[0.75, 5.2, 32, 1, true]} />
        <meshBasicMaterial color="#fff2c0" transparent opacity={0.06 * beams} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} /></mesh> : null}
    </group>)}
    {[1, -1].map((sd) => <group key={"tl" + sd} position={[sd * 0.62, 0.72, -2.06]}>
      <Box s={[0.32, 0.12, 0.03]} c="#c8302a" />
      <mesh position={[0, 0, -0.018]}><planeGeometry args={[0.3, 0.1]} /><meshStandardMaterial color="#ff4a3a" emissive="#ff2a1a" emissiveIntensity={0.15 + 0.75 * Math.max(brake, lights * 0.4)} side={THREE.DoubleSide} /></mesh>
      {brake > 0.05 ? <Glow r={0.3} c="#ff3020" k={0.45 * brake} /> : null}
    </group>)}
    {/* dashboard, steering wheel, seats */}
    <Box s={[1.56, 0.2, 0.4]} p={[0, 0.84, 0.78]} c={inner} round={0.3} />
    <group position={CAR_WHEEL} rotation={[-0.95, 0, 0]}>
      <mesh><torusGeometry args={[0.15, 0.022, 16, 48]} /><meshStandardMaterial color="#25272b" roughness={0.5} /></mesh>
      <Box s={[0.26, 0.03, 0.03]} c="#25272b" />
    </group>
    <mesh position={[-0.42, 0.9, 0.52]} rotation={[-0.95 + Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.025, 0.025, 0.42, 32]} /><meshStandardMaterial color="#25272b" /></mesh>
    {[-0.42, 0.42].map((x) => <group key={"fs" + x}>
      <Box s={[0.56, 0.14, 0.52]} p={[x, CAR_SEAT_TOP - 0.07, -0.1]} c={seat} round={0.4} />
      <Box s={[0.54, 0.66, 0.13]} p={[x, 0.76, -0.42]} r={[-0.12, 0, 0]} c={seat} round={0.4} />
      <Box s={[0.26, 0.16, 0.1]} p={[x, 1.18, -0.47]} r={[-0.12, 0, 0]} c={seat} round={0.45} />
    </group>)}
    <Box s={[1.5, 0.14, 0.5]} p={[0, CAR_SEAT_TOP - 0.07, -0.85]} c={seat} round={0.4} />
    <Box s={[1.5, 0.62, 0.13]} p={[0, 0.74, -1.12]} r={[-0.1, 0, 0]} c={seat} round={0.4} />
    {/* pillars, roof, glass */}
    {[0.8, -0.8].map((x) => <group key={"pl" + x}>{pill(ws.a, ws.b, x)}{pill(rs.a, rs.b, x)}<Box s={[0.15, roofY - belt, 0.16]} p={[x, (roofY + belt) / 2, -0.28]} c={c} round={0.3} /></group>)}
    <mesh position={[0, roofY, -0.27]} castShadow><primitive object={roundBox(1.74, 0.14, 1.74, 0.4)} attach="geometry" /><meshStandardMaterial color={c} {...gloss} /></mesh>
    {pane(ws.a, ws.b)}{pane(rs.a, rs.b)}
    <XBox s={[0.02, roofY - belt - 0.05, 1.45]} p={[0.8, (roofY + belt) / 2, -0.28]} c={gl} o={glass} shadow={false} recv={false} />
    <XBox s={[0.02, roofY - belt - 0.05, 0.62]} p={[-0.8, (roofY + belt) / 2, -0.72]} c={gl} o={glass} shadow={false} recv={false} />
    {/* driver door (front right), hinged at its front edge, swings out to -x */}
    <group position={[-0.82, 0, 0.98]} rotation={[0, door * 1.15, 0]}>
      <Box s={[0.07, 0.66, 1.2]} p={[0, 0.58, -0.62]} c={c} />
      <Box s={[0.012, 0.03, 1.1]} p={[-0.04, 0.75, -0.62]} c={trim} />
      <Box s={[0.03, 0.04, 0.16]} p={[-0.045, 0.8, -1.0]} c={silver} round={0.4} />
      <XBox s={[0.02, roofY - belt - 0.08, 0.7]} p={[0, (roofY + belt) / 2 - 0.02, -0.82]} c={gl} o={glass} shadow={false} recv={false} />
      <Box s={[0.06, 0.08, 0.14]} p={[-0.06, 1.0, -0.12]} c={c} round={0.4} />{/* mirror */}
    </group>
    <Box s={[0.06, 0.08, 0.14]} p={[0.88, 1.0, 0.86]} c={c} round={0.4} />
    {children}
  </group>;
};
const rbCache = new Map<string, THREE.BufferGeometry>();
function roundBox(w: number, h: number, d: number, r: number) {
  const k = [w, h, d, r].join(",");
  if (!rbCache.has(k)) rbCache.set(k, new RoundedBoxGeometry(w, h, d, 4, Math.min(w, h, d) * r));
  return rbCache.get(k)!;
}
export default FamilyCar;
