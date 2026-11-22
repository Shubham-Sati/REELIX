// prop category=car h=1.75
// Indian auto rickshaw (three-wheeler): green lower body, yellow canopy roof and back, black frame, one front wheel and two rear wheels,
// a round headlight on the nose and a small driver. Faces +z, about 2.6 m long. honk 0..1 shows pulsing horn rings in front (ring faces sideways,
// so it reads when the rickshaw drives across the frame); roll = metres driven.
import React from "react";
import { Box, Ball, Pill, XBox, P3 } from "./_kit";

const AutoRickshaw: React.FC<{ p?: P3; rotY?: number; s?: number; honk?: number; roll?: number; driver?: boolean; body?: string; roof?: string; t?: number }> =
  ({ p = [0, 0, 0], rotY = 0, s = 1, honk = 0, roll = 0, driver = true, body = "#2f9a4c", roof = "#f2c230", t = 0 }) => {
  const spin = roll / 0.27;
  const wheel = (x: number, z: number, k: number) => <group key={x + "," + z} position={[x, 0.27, z]} rotation={[spin, 0, 0]}>
    <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.27, 0.27, 0.18, 32]} /><meshStandardMaterial color="#222428" roughness={0.8} /></mesh>
    <mesh position={[k * 0.095, 0, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.12, 0.12, 0.02, 32]} /><meshStandardMaterial color="#c9ced4" /></mesh>
  </group>;
  return <group position={p} rotation={[0, rotY, 0]} scale={s}>
    {/* passenger tub and floor */}
    <Box s={[1.3, 0.5, 1.45]} p={[0, 0.58, -0.3]} c={body} round={0.25} />
    <Box s={[0.12, 0.08, 1.3]} p={[0, 0.85, -0.3]} c="#f6ead0" />
    {/* nose (narrow front cowl) */}
    <Box s={[0.85, 0.95, 0.55]} p={[0, 0.72, 0.75]} c={body} round={0.4} />
    <Box s={[0.5, 0.18, 0.4]} p={[0, 0.42, 1.0]} c="#2a2c30" round={0.3} />
    <group position={[0, 1.02, 1.03]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.12, 0.12, 0.06, 32]} /><meshStandardMaterial color="#c9ced4" metalness={0.4} roughness={0.3} /></mesh>
      <Ball r={0.09} p={[0, 0, 0.03]} s={[1, 1, 0.5]} c="#fff4d0" />
    </group>
    {/* windscreen, frame, canopy */}
    <XBox s={[1.0, 0.55, 0.04]} p={[0, 1.37, 0.66]} c="#cfe6f2" o={0.35} shadow={false} />
    {[1, -1].map((sd) => <Pill key={"f" + sd} r={0.025} len={0.65} p={[sd * 0.55, 1.33, 0.6]} c="#222428" />)}
    {[1, -1].map((sd) => <Pill key={"b" + sd} r={0.025} len={0.8} p={[sd * 0.64, 1.25, -0.95]} c="#222428" />)}
    <Box s={[1.42, 0.14, 2.0]} p={[0, 1.72, -0.15]} c={roof} round={0.45} />
    <Box s={[1.36, 0.95, 0.1]} p={[0, 1.25, -1.08]} c={roof} round={0.3} />
    <Box s={[1.36, 0.1, 0.12]} p={[0, 1.62, 0.78]} c="#222428" />
    {/* bench seat */}
    <Box s={[1.15, 0.14, 0.45]} p={[0, 0.92, -0.7]} c="#2a2c30" round={0.35} />
    <Box s={[1.15, 0.45, 0.1]} p={[0, 1.18, -0.95]} c="#2a2c30" round={0.35} />
    {/* handlebar */}
    <Pill r={0.02} len={0.6} p={[0, 1.13, 0.42]} rot={[0, 0, Math.PI / 2]} c="#222428" />
    {driver ? <group position={[0, 0.88, 0.12]}>
      <Pill r={0.15} len={0.28} p={[0, 0.32, 0]} c="#c9b98a" />
      <Ball r={0.13} p={[0, 0.7, 0.02]} c="#9a603a" />
      <Ball r={0.135} p={[0, 0.74, -0.01]} s={[1, 0.7, 1]} c="#16110e" />
      {[1, -1].map((sd) => <Pill key={sd} r={0.04} len={0.3} p={[sd * 0.16, 0.36, 0.17]} rot={[1.2, 0, 0]} c="#c9b98a" />)}
    </group> : null}
    {wheel(0, 0.95, 1)}{wheel(0.62, -0.75, 1)}{wheel(-0.62, -0.75, -1)}
    {/* horn rings */}
    {honk > 0 ? [0, 1, 2].map((i) => { const f = ((t * 2.6 + i / 3) % 1); return <mesh key={"h" + i} position={[0, 1.0, 1.25 + f * 0.9]} rotation={[0, Math.PI / 2, 0]} scale={0.25 + f * 0.9}>
      <torusGeometry args={[0.5, 0.035, 16, 48]} /><meshStandardMaterial color="#ffd23a" emissive="#ffc23a" emissiveIntensity={0.5} transparent opacity={honk * (1 - f)} depthWrite={false} /></mesh>; }) : null}
  </group>;
};
export default AutoRickshaw;
