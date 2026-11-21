// prop category=prop h=0.08
// Big round toy compass lying flat: cream face in a brass rim, four tick marks, red-and-white needle that turns.
// needle = yaw in radians (0 = red tip points -z / "north" into the scene). glow 0..1 lights the rim. About 0.6 m across at s = 1.
import React from "react";
import { Box, Ball } from "./_kit";

type P3 = [number, number, number];
const ToyCompass: React.FC<{ p?: P3; rotY?: number; s?: number; needle?: number; glow?: number }> = ({ p = [0, 0, 0], rotY = 0, s = 1, needle = 0, glow = 0 }) =>
  <group position={p} rotation={[0, rotY, 0]} scale={s}>
    <mesh position={[0, 0.035, 0]} castShadow receiveShadow><cylinderGeometry args={[0.32, 0.33, 0.07, 64]} />
      <meshStandardMaterial color="#d9a83a" emissive="#ffcf5a" emissiveIntensity={glow * 0.6} roughness={0.35} metalness={0.2} /></mesh>
    <mesh position={[0, 0.072, 0]} receiveShadow><cylinderGeometry args={[0.27, 0.27, 0.01, 64]} /><meshStandardMaterial color="#f6f0e0" roughness={0.6} /></mesh>
    {[0, 1, 2, 3].map((i) => <Box key={i} s={[0.03, 0.012, i === 0 ? 0.09 : 0.06]} p={[Math.sin(i * Math.PI / 2) * 0.22, 0.08, -Math.cos(i * Math.PI / 2) * 0.22]} r={[0, -i * Math.PI / 2, 0]} c={i === 0 ? "#e2382e" : "#5a5550"} />)}
    <group position={[0, 0.09, 0]} rotation={[0, needle, 0]}>
      <mesh position={[0, 0, -0.1]} rotation={[-Math.PI / 2, 0, 0]} scale={[1, 1, 0.35]} castShadow><coneGeometry args={[0.04, 0.2, 4]} /><meshStandardMaterial color="#e2382e" roughness={0.45} /></mesh>
      <mesh position={[0, 0, 0.1]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.35]} castShadow><coneGeometry args={[0.04, 0.2, 4]} /><meshStandardMaterial color="#f4f1ea" roughness={0.45} /></mesh>
      <Ball r={0.022} p={[0, 0.006, 0]} c="#d9a83a" />
    </group>
    <mesh position={[0, 0.115, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.27, 64]} /><meshStandardMaterial color="#dff3ff" transparent opacity={0.18} roughness={0.1} depthWrite={false} /></mesh>
  </group>;
export default ToyCompass;
