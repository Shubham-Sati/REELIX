// ROUND 1 (experiment 2026-11-21-lego-objects): common objects drawn with what the Lego kit already has.
// Kit objects used as they are: Tree, Hill, Town (houses). Everything else is hand-built from the kit's basic shapes
// (Ball, Pill, Lathe, RoundGeo, cylinders, cones), the way the set-builder does it today. No research yet.
// Scale: 1 unit = about 1 metre (a kit person is about 1.75 tall).
import React, { useMemo } from "react";
import * as THREE from "three";
import { Ball, Pill, Lathe, RoundGeo, rng } from "./_kit";

type V3 = [number, number, number];
const M: React.FC<{ c: string; r?: number; m?: number }> = ({ c, r = 0.55, m = 0 }) => <meshStandardMaterial color={c} roughness={r} metalness={m} />;
const Blk: React.FC<{ s: V3; p?: V3; r?: V3; c: string; round?: number }> = ({ s, p = [0, 0, 0], r = [0, 0, 0], c, round = 0.06 }) =>
  <mesh position={p} rotation={r} castShadow receiveShadow><RoundGeo args={s} round={round} /><M c={c} /></mesh>;
const Cyl: React.FC<{ r1: number; r2?: number; len: number; p?: V3; rot?: V3; c: string; seg?: number }> = ({ r1, r2, len, p = [0, 0, 0], rot = [0, 0, 0], c, seg = 32 }) =>
  <mesh position={p} rotation={rot} castShadow receiveShadow><cylinderGeometry args={[r1, r2 ?? r1, len, seg]} /><M c={c} /></mesh>;
const Cone: React.FC<{ r: number; len: number; p?: V3; rot?: V3; c: string; seg?: number }> = ({ r, len, p = [0, 0, 0], rot = [0, 0, 0], c, seg = 32 }) =>
  <mesh position={p} rotation={rot} castShadow receiveShadow><coneGeometry args={[r, len, seg]} /><M c={c} /></mesh>;
/** A wheel standing up, axle along x: dark tyre + light hub. */
const Wheel: React.FC<{ r: number; w: number; p: V3; tyre?: string; hub?: string }> = ({ r, w, p, tyre = "#222222", hub = "#c9c9c9" }) => <group position={p}>
  <Cyl r1={r} len={w} rot={[0, 0, Math.PI / 2]} c={tyre} />
  <Cyl r1={r * 0.55} len={w * 1.05} rot={[0, 0, Math.PI / 2]} c={hub} /></group>;

/* ---------------- nature */
export const Rocks: React.FC<{ p?: V3 }> = ({ p = [0, 0, 0] }) => {
  const list = useMemo(() => { const g = rng(9); return Array.from({ length: 5 }, (_, i) => [(g() - 0.5) * 1.2, (g() - 0.5) * 0.8, 0.15 + g() * 0.35, g() * 3] as const); }, []);
  return <group position={p}>{list.map(([x, z, r, a], i) =>
    <mesh key={i} position={[x, r * 0.55, z]} rotation={[a, a * 2, 0]} scale={[1.2, 0.75, 1]} castShadow receiveShadow><dodecahedronGeometry args={[r, 0]} /><M c={i % 2 ? "#8d8a85" : "#a7a29a"} r={0.8} /></mesh>)}</group>;
};
export const Mountain: React.FC<{ p?: V3 }> = ({ p = [0, 0, 0] }) => <group position={p}>
  <Cone r={5} len={6} p={[0, 3, 0]} c="#7d7a72" seg={7} />
  <Cone r={1.75} len={2.1} p={[0, 4.95, 0]} c="#f4f4f2" seg={7} />
  <Cone r={3.4} len={4} p={[3.5, 2, -1]} c="#8a867c" seg={6} /></group>;
export const PineTree: React.FC<{ p?: V3 }> = ({ p = [0, 0, 0] }) => <group position={p}>
  <Cyl r1={0.14} r2={0.2} len={1.2} p={[0, 0.6, 0]} c="#6e4a2e" />
  {[0, 1, 2].map((i) => <Cone key={i} r={1.3 - i * 0.32} len={1.6} p={[0, 1.6 + i * 0.95, 0]} c="#2f6b3a" />)}</group>;
export const PalmTree: React.FC<{ p?: V3 }> = ({ p = [0, 0, 0] }) => <group position={p}>
  {Array.from({ length: 10 }, (_, i) => <Cyl key={i} r1={0.16 - i * 0.006} len={0.55} p={[Math.sin(i * 0.12) * i * 0.06, 0.28 + i * 0.52, 0]} rot={[0, 0, -i * 0.025]} c={i % 2 ? "#a07a4e" : "#8e6a42"} />)}
  {Array.from({ length: 7 }, (_, i) => { const a = (i / 7) * Math.PI * 2; return <group key={"l" + i} position={[0.55, 5.3, 0]} rotation={[0, a, 0]}>
    <Ball r={1} p={[1.0, -0.25, 0]} s={[1.3, 0.08, 0.3]} c="#3f8a3a" /></group>; })}
  {[0, 1, 2].map((i) => <Ball key={"c" + i} r={0.13} p={[0.55 + (i - 1) * 0.15, 5.15, 0.1]} c="#6b4a2a" />)}</group>;
export const Nest: React.FC<{ p?: V3 }> = ({ p = [0, 0, 0] }) => <group position={p}>
  <mesh position={[0, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow><torusGeometry args={[0.16, 0.07, 16, 40]} /><M c="#8a6436" r={0.9} /></mesh>
  <Cyl r1={0.14} r2={0.1} len={0.06} p={[0, 0.03, 0]} c="#7a5630" />
  {[[0, 0], [0.07, 0.05], [-0.06, 0.05]].map(([x, z], i) => <Ball key={i} r={0.045} p={[x, 0.09, z]} s={[1, 1.25, 1]} c="#9fd0e6" />)}</group>;

/* ---------------- houses */
export const Cottage: React.FC<{ p?: V3 }> = ({ p = [0, 0, 0] }) => <group position={p}>
  <Blk s={[4, 2.6, 3]} p={[0, 1.3, 0]} c="#f1e3cc" />
  <mesh position={[0, 3.25, 0]} rotation={[0, 0, 0]} scale={[1, 1, 1]} castShadow><cylinderGeometry args={[1.9, 1.9, 4.4, 3]} /><M c="#b8452d" /></mesh>
  <Blk s={[0.8, 1.5, 0.1]} p={[0, 0.75, 1.52]} c="#7a4a2c" />
  {[-1.3, 1.3].map((x) => <Blk key={x} s={[0.8, 0.8, 0.08]} p={[x, 1.5, 1.52]} c="#9cc6e8" />)}
  <Blk s={[0.5, 1.2, 0.5]} p={[1.2, 4.0, -0.5]} c="#9a8a7a" /></group>;
export const Townhouse: React.FC<{ p?: V3 }> = ({ p = [0, 0, 0] }) => <group position={p}>
  <Blk s={[3.2, 5.2, 3]} p={[0, 2.6, 0]} c="#e8c9a0" />
  <mesh position={[0, 5.9, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[2.5, 1.4, 4]} /><M c="#5a6b7a" /></mesh>
  {[1.3, 3.6].flatMap((y) => [-0.85, 0.85].map((x) => <Blk key={x + "_" + y} s={[0.7, 0.9, 0.08]} p={[x, y, 1.52]} c="#9cc6e8" />))}
  <Blk s={[0.8, 1.6, 0.1]} p={[0, 0.8, 1.52]} c="#3a5a7a" /></group>;
export const Hut: React.FC<{ p?: V3 }> = ({ p = [0, 0, 0] }) => <group position={p}>
  <Cyl r1={1.5} len={2} p={[0, 1, 0]} c="#c9a46a" />
  <Cone r={2.0} len={1.8} p={[0, 2.9, 0]} c="#b08a4a" />
  <Blk s={[0.7, 1.3, 0.1]} p={[0, 0.65, 1.5]} c="#5a3a20" /></group>;

/* ---------------- vehicles */
export const Car: React.FC<{ p?: V3; c?: string }> = ({ p = [0, 0, 0], c = "#d83b2e" }) => <group position={p}>
  <Blk s={[1.7, 0.6, 4]} p={[0, 0.6, 0]} c={c} round={0.3} />
  <Blk s={[1.5, 0.6, 2]} p={[0, 1.15, -0.2]} c={c} round={0.3} />
  <Blk s={[1.52, 0.42, 1.6]} p={[0, 1.17, -0.2]} c="#9cc6e8" round={0.2} />
  {[[0.8, 1.3], [-0.8, 1.3], [0.8, -1.3], [-0.8, -1.3]].map(([x, z], i) => <Wheel key={i} r={0.36} w={0.3} p={[x, 0.36, z]} />)}
  {[0.55, -0.55].map((x) => <Ball key={x} r={0.12} p={[x, 0.7, 2.0]} c="#fff4c2" />)}</group>;
export const Bus: React.FC<{ p?: V3 }> = ({ p = [0, 0, 0] }) => <group position={p}>
  <Blk s={[2.4, 2.4, 8]} p={[0, 1.6, 0]} c="#f2b632" round={0.12} />
  {Array.from({ length: 6 }, (_, i) => <Blk key={i} s={[2.42, 0.8, 0.9]} p={[0, 2.1, -3 + i * 1.05]} c="#9cc6e8" />)}
  <Blk s={[2.1, 1.0, 0.1]} p={[0, 2.1, 4.0]} c="#9cc6e8" />
  {[[1.1, 2.6], [-1.1, 2.6], [1.1, -2.6], [-1.1, -2.6]].map(([x, z], i) => <Wheel key={i} r={0.5} w={0.35} p={[x, 0.5, z]} />)}</group>;
export const Train: React.FC<{ p?: V3 }> = ({ p = [0, 0, 0] }) => <group position={p}>
  <Blk s={[1.8, 0.4, 6]} p={[0, 0.6, 0]} c="#2a2a2a" />
  <Cyl r1={0.8} len={3.4} p={[0, 1.6, 1.0]} rot={[Math.PI / 2, 0, 0]} c="#1f5a3a" />
  <Blk s={[1.9, 2.2, 1.8]} p={[0, 1.9, -1.8]} c="#1f5a3a" />
  <Cyl r1={0.22} r2={0.3} len={0.9} p={[0, 2.7, 2.2]} c="#2a2a2a" />
  {[-2.2, -0.8, 0.8, 2.2].flatMap((z) => [0.85, -0.85].map((x) => <Wheel key={x + "_" + z} r={0.45} w={0.18} p={[x, 0.45, z]} tyre="#333" hub="#b8452d" />))}</group>;
export const Bicycle: React.FC<{ p?: V3 }> = ({ p = [0, 0, 0] }) => <group position={p}>
  {[0.55, -0.55].map((z) => <mesh key={z} position={[0, 0.35, z]} rotation={[0, Math.PI / 2, 0]} castShadow><torusGeometry args={[0.33, 0.03, 12, 40]} /><M c="#222" /></mesh>)}
  <Pill r={0.025} len={0.7} p={[0, 0.55, 0]} rot={[Math.PI / 2, 0, 0]} c="#2a6fd0" />
  <Pill r={0.025} len={0.5} p={[0, 0.5, -0.25]} rot={[0.4, 0, 0]} c="#2a6fd0" />
  <Pill r={0.025} len={0.5} p={[0, 0.55, 0.45]} rot={[-0.3, 0, 0]} c="#2a6fd0" />
  <Blk s={[0.12, 0.05, 0.22]} p={[0, 0.78, -0.3]} c="#222" />
  <Pill r={0.02} len={0.45} p={[0, 0.85, 0.5]} rot={[0, 0, Math.PI / 2]} c="#888" /></group>;
export const Motorbike: React.FC<{ p?: V3 }> = ({ p = [0, 0, 0] }) => <group position={p}>
  {[0.7, -0.7].map((z) => <Wheel key={z} r={0.32} w={0.16} p={[0, 0.32, z]} />)}
  <Ball r={0.4} p={[0, 0.65, 0]} s={[0.5, 0.6, 1.4]} c="#c8302a" />
  <Blk s={[0.3, 0.12, 0.6]} p={[0, 0.95, -0.25]} c="#222" round={0.3} />
  <Pill r={0.025} len={0.7} p={[0, 1.0, 0.55]} rot={[0, 0, Math.PI / 2]} c="#888" />
  <Ball r={0.1} p={[0, 0.85, 0.75]} c="#fff4c2" /></group>;
export const Boat: React.FC<{ p?: V3 }> = ({ p = [0, 0, 0] }) => <group position={p}>
  <Blk s={[1.6, 0.7, 4]} p={[0, 0.35, 0]} c="#f4f1ea" round={0.4} />
  <Cyl r1={0.05} len={3.5} p={[0, 2.4, 0.2]} c="#7a5236" />
  <mesh position={[0, 2.3, -0.5]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[1.4, 2.6]} /><meshStandardMaterial color="#f8f4ea" side={THREE.DoubleSide} /></mesh></group>;
export const Plane: React.FC<{ p?: V3 }> = ({ p = [0, 0, 0] }) => <group position={p}>
  <Pill r={0.6} len={6} p={[0, 1.5, 0]} rot={[Math.PI / 2, 0, 0]} c="#eef1f4" />
  <Blk s={[8, 0.12, 1.4]} p={[0, 1.4, 0.3]} c="#d0d6dc" />
  <Blk s={[2.6, 0.1, 0.8]} p={[0, 1.7, -3.0]} c="#d0d6dc" />
  <Blk s={[0.1, 1.3, 1.0]} p={[0, 2.3, -3.1]} c="#2a6fd0" /></group>;
