// prop category=street h=3.2
// Traffic light with switchable lamps: state 0 = red, 1 = amber, 2 = green (the lit lamp glows, the others are dark).
// Pole on the ground, signal head facing +z. About 3.2 m tall at s = 1.
import React from "react";
import { Box, Glow, Pill } from "./_kit";

type P3 = [number, number, number];
const LAMPS = [["#ff3b2f", "#4a1512"], ["#ffb52e", "#4a3512"], ["#3fe06a", "#123a1c"]];

const TrafficSignal: React.FC<{ p?: P3; rotY?: number; s?: number; state?: number }> = ({ p = [0, 0, 0], rotY = 0, s = 1, state = 2 }) =>
  <group position={p} rotation={[0, rotY, 0]} scale={s}>
    <mesh position={[0, 0.06, 0]} castShadow><cylinderGeometry args={[0.18, 0.22, 0.12, 32]} /><meshStandardMaterial color="#3a3d42" roughness={0.5} /></mesh>
    <Pill r={0.06} len={2.3} p={[0, 1.25, 0]} c="#4a4e55" />
    <Box s={[0.42, 1.1, 0.3]} p={[0, 2.75, 0.05]} c="#2b2d31" round={0.25} />
    {LAMPS.map(([on, off], i) => { const isOn = Math.round(state) === i;   // red top, amber middle, green bottom
      return <group key={i} position={[0, 2.75 + (1 - i) * 0.33, 0.21]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.12, 0.12, 0.04, 32]} />
          <meshStandardMaterial color={isOn ? on : off} emissive={isOn ? on : "#000000"} emissiveIntensity={isOn ? 0.65 : 0} roughness={0.4} /></mesh>
        <Box s={[0.3, 0.04, 0.14]} p={[0, 0.14, 0.04]} r={[0.3, 0, 0]} c="#2b2d31" />
        {isOn ? <Glow r={0.26} c={on} k={0.45} /> : null}
      </group>; })}
  </group>;
export default TrafficSignal;
