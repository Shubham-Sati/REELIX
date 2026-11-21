// prop category=tool h=2.6 (at s 1)
// Big toy stopwatch: silver case, cream face with 12 ticks, a crown and button on top, one red hand; the swept part of the face
// fills yellow (sweep 0..1 = fraction of a full turn). Faces +z, stands on its own little foot.
import React from "react";
import * as THREE from "three";
import { Box, Ball, P3 } from "./_kit";

const Stopwatch: React.FC<{ p?: P3; rotY?: number; s?: number; sweep?: number; rot?: P3 }> = ({ p = [0, 0, 0], rotY = 0, s = 1, sweep = 0, rot = [0, 0, 0] }) => {
  const a = Math.max(0.0001, Math.min(1, sweep)) * Math.PI * 2;
  return <group position={p} rotation={[rot[0], rotY + rot[1], rot[2]]} scale={s}>
    <group position={[0, 1.2, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow><cylinderGeometry args={[1, 1, 0.36, 64]} /><meshStandardMaterial color="#c9ced5" roughness={0.35} /></mesh>
      <mesh position={[0, 0, 0.18]} rotation={[0, 0, 0]}><torusGeometry args={[0.95, 0.07, 16, 64]} /><meshStandardMaterial color="#e0483a" roughness={0.4} /></mesh>
      <mesh position={[0, 0, 0.185]}><circleGeometry args={[0.9, 64]} /><meshStandardMaterial color="#fbf6ea" /></mesh>
      {sweep > 0.001 ? <mesh position={[0, 0, 0.19]}><circleGeometry args={[0.88, 64, Math.PI / 2 - a, a]} /><meshStandardMaterial color="#ffc83d" emissive="#ffc83d" emissiveIntensity={0.25} side={THREE.DoubleSide} /></mesh> : null}
      {Array.from({ length: 12 }, (_, i) => { const b = (i / 12) * Math.PI * 2; return <Box key={i} s={[0.05, i % 3 === 0 ? 0.16 : 0.09, 0.02]} p={[Math.sin(b) * 0.76, Math.cos(b) * 0.76, 0.2]} r={[0, 0, -b]} c="#2a2420" />; })}
      <group rotation={[0, 0, -a]} position={[0, 0, 0.21]}><Box s={[0.06, 0.82, 0.025]} p={[0, 0.34, 0]} c="#d8302a" /></group>
      <Ball r={0.07} p={[0, 0, 0.23]} c="#2a2420" />
      <Box s={[0.28, 0.2, 0.28]} p={[0, 1.08, 0]} c="#c9ced5" round={0.3} />
      <Box s={[0.42, 0.14, 0.3]} p={[0, 1.24, 0]} c="#e0483a" round={0.4} />
      <group position={[0.68, 0.72, 0]} rotation={[0, 0, -0.75]}><Box s={[0.2, 0.18, 0.24]} c="#c9ced5" round={0.3} /></group>
    </group>
    <Box s={[0.9, 0.24, 0.6]} p={[0, 0.12, 0]} c="#5a5f68" round={0.3} />
  </group>;
};
export default Stopwatch;
