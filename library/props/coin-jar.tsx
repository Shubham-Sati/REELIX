// prop category=money h=0.3
// Clear glass savings jar with a brass lid ring that fills with gold coins: n = how many coins (can be fractional: the last one drops in).
// Origin on the table at its centre. About 0.18 m wide, 0.3 m tall at s = 1.
import React, { useMemo } from "react";
import * as THREE from "three";
import { rng } from "./_kit";

type P3 = [number, number, number];
const CoinJar: React.FC<{ p?: P3; rotY?: number; s?: number; n?: number; max?: number }> = ({ p = [0, 0, 0], rotY = 0, s = 1, n = 0, max = 60 }) => {
  const spots = useMemo(() => { const g = rng(17); return Array.from({ length: max }, (_, i) => { const layer = Math.floor(i / 5), a = (i % 5) * 1.25 + layer * 0.7 + g() * 0.4, rr = i % 5 === 4 ? 0 : 0.045;
    return { p: [Math.cos(a) * rr, 0.014 + layer * 0.016, Math.sin(a) * rr] as P3, r: [(g() - 0.5) * 0.5, g() * 3, (g() - 0.5) * 0.5] as P3 }; }); }, [max]);
  const glass = useMemo(() => new THREE.LatheGeometry([[0.001, 0.002], [0.085, 0.004], [0.095, 0.03], [0.095, 0.22], [0.08, 0.25], [0.07, 0.27]].map(([r, y]) => new THREE.Vector2(r, y)), 40), []);
  const whole = Math.floor(n), frac = n - whole;
  return <group position={p} rotation={[0, rotY, 0]} scale={s}>
    {spots.slice(0, Math.min(max, whole + 1)).map((c, i) => { const k = i < whole ? 1 : frac; if (k <= 0.02) return null;
      return <mesh key={i} position={[c.p[0], c.p[1] + (1 - k) * 0.3, c.p[2]]} rotation={c.r} castShadow><cylinderGeometry args={[0.04, 0.04, 0.01, 32]} />
        <meshStandardMaterial color="#f2c23a" emissive="#d99a1a" emissiveIntensity={0.15} metalness={0.35} roughness={0.3} /></mesh>; })}
    <mesh geometry={glass} renderOrder={3}><meshStandardMaterial color="#dff1fa" transparent opacity={0.28} roughness={0.1} metalness={0.1} depthWrite={false} side={THREE.DoubleSide} /></mesh>
    <mesh position={[0, 0.275, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.072, 0.012, 16, 48]} /><meshStandardMaterial color="#c9a24a" metalness={0.4} roughness={0.35} /></mesh>
  </group>;
};
export default CoinJar;
