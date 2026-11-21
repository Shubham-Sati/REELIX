// prop category=building h=7.6
// Town clock tower: cream stone shaft, terracotta pyramid roof, a big clock face on the front (+z) with hour and minute hands.
// hours = time on the clock (8 = eight o'clock; 7.95 -> 8 clicks the minute hand to twelve).
import React from "react";
import { Box, Ball, P3 } from "./_kit";

const ClockTower: React.FC<{ p?: P3; rotY?: number; s?: number; hours?: number; face?: string }> = ({ p = [0, 0, 0], rotY = 0, s = 1, hours = 8, face = "#fbf6ea" }) => {
  const hA = -((hours % 12) / 12) * Math.PI * 2, mA = -((hours % 1)) * Math.PI * 2, cy = 5.3;
  return <group position={p} rotation={[0, rotY, 0]} scale={s}>
    <Box s={[2.3, 0.5, 2.3]} p={[0, 0.25, 0]} c="#d8c7a6" />
    <Box s={[1.8, 5.6, 1.8]} p={[0, 3.2, 0]} c="#f1e3c6" />
    <Box s={[2.1, 0.25, 2.1]} p={[0, 6.05, 0]} c="#d8c7a6" />
    <mesh position={[0, 6.85, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[1.55, 1.4, 4]} /><meshStandardMaterial color="#c9714e" roughness={0.55} /></mesh>
    <Ball r={0.12} p={[0, 7.6, 0]} c="#e3b23c" />
    {[1, -1].map((k) => <Box key={k} s={[0.35, 1.0, 0.1]} p={[k * 0.45, 2.0, 0.91]} c="#7fa8c8" />)}
    <Box s={[0.6, 1.3, 0.1]} p={[0, 0.85, 0.91]} c="#8a5a34" />
    <group position={[0, cy, 0.93]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0]}><cylinderGeometry args={[0.82, 0.82, 0.1, 48]} /><meshStandardMaterial color="#3a3d44" /></mesh>
      <mesh position={[0, 0, 0.06]}><circleGeometry args={[0.72, 48]} /><meshStandardMaterial color={face} emissive={face} emissiveIntensity={0.15} /></mesh>
      {Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return <Box key={i} s={[0.06, i % 3 === 0 ? 0.16 : 0.09, 0.03]} p={[Math.sin(a) * 0.6, Math.cos(a) * 0.6, 0.08]} r={[0, 0, -a]} c="#2a2420" />; })}
      <group rotation={[0, 0, hA]} position={[0, 0, 0.1]}><Box s={[0.09, 0.42, 0.03]} p={[0, 0.17, 0]} c="#2a2420" /></group>
      <group rotation={[0, 0, mA]} position={[0, 0, 0.13]}><Box s={[0.06, 0.6, 0.03]} p={[0, 0.26, 0]} c="#2a2420" /></group>
      <Ball r={0.06} p={[0, 0, 0.15]} c="#e3b23c" />
    </group>
  </group>;
};
export default ClockTower;
