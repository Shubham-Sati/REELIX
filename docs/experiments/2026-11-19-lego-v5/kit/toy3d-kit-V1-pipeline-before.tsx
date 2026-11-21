// REELIX 3D toy world kit (look "toy3d"). The set-builder copies this file to <video>/project/custom/_kit.tsx
// (files starting with "_" are shared code, not scenes) and every shot file imports it:  import { ... } from "./_kit";
//
// Rules that make 3D render correctly in Remotion:
//  - Everything is driven by the frame (useShotTime / kf); never useFrame or clocks.
//  - One <Stage> per shot (ThreeCanvas inside). Portrait 9:16: keep figures in the middle band;
//    the top ~18% holds labels and the bottom ~30% holds captions.
//  - A character's look comes ONLY from its spec (characters/cast.json): same spec in every shot = same person.
import React, { useMemo } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

/* ------------------------------------------------------------------ time + motion helpers */
/** Seconds since this shot started. */
export const useShotTime = () => { const f = useCurrentFrame(); const { fps } = useVideoConfig(); return f / fps; };
/** Keyframes: kf(t, [[0, 0], [1.2, 1], [2, 0.4]]) -> smooth (ease in-out) value between keys, held at the ends. */
export function kf(t: number, keys: [number, number][], ease = Easing.inOut(Easing.cubic)): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
    if (t <= t1) return v0 + (v1 - v0) * ease((t - t0) / Math.max(1e-6, t1 - t0));
  }
  return keys[keys.length - 1][1];
}
/** Deterministic random numbers (same every render). */
export function rng(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
type Line = { speaker: string; start: number; end: number };
/** Mouth opening 0..1 while `speaker` has a line playing (absolute video time = shotStart + t). */
export function talk(speaker: string, lines: Line[] = [], shotStart = 0, t = 0): number {
  const now = shotStart + t;
  const on = lines.some((l) => l.speaker === speaker && now >= l.start && now <= l.end);
  if (!on) return 0;
  return 0.35 + 0.65 * Math.abs(Math.sin(now * 13.0) * Math.cos(now * 5.3));
}

/* ------------------------------------------------------------------ stage: canvas, light, camera */
export type Cam = { pos: [number, number, number]; look?: [number, number, number]; fov?: number };
/** A shot's 3D world. `camera` can change every frame (pass kf values) for dolly/pan moves. */
export const Stage: React.FC<{ camera: Cam; bg?: string; children: React.ReactNode; fog?: [string, number, number] }> = ({ camera, bg = "#f2dcc0", children, fog }) => {
  const { width, height } = useVideoConfig();
  const look = camera.look || [0, 1, 0];
  return (
    <AbsoluteFill style={{ background: bg }}>
      <ThreeCanvas width={width} height={height} shadows camera={{ fov: camera.fov || 38, position: camera.pos }}
        onCreated={({ camera: c }) => { c.lookAt(...look); }}>
        <CamSync pos={camera.pos} look={look} fov={camera.fov || 38} />
        <color attach="background" args={[bg]} />
        {fog ? <fog attach="fog" args={fog} /> : null}
        <hemisphereLight args={["#fff6e8", "#8a6a50", 1.1]} />
        <directionalLight position={[4, 8, 6]} intensity={1.6} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024}
          shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
        {children}
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
/** Applies the camera props on every frame (Remotion re-renders per frame). */
const CamSync: React.FC<{ pos: [number, number, number]; look: [number, number, number]; fov: number }> = ({ pos, look, fov }) => {
  const { camera } = useThree();
  camera.position.set(...pos); (camera as THREE.PerspectiveCamera).fov = fov; (camera as THREE.PerspectiveCamera).updateProjectionMatrix(); camera.lookAt(...look);
  return null;
};

/* ------------------------------------------------------------------ materials */
const mat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  <meshStandardMaterial color={color} flatShading roughness={0.85} metalness={0} {...(extra as any)} />;
const Box: React.FC<{ s: [number, number, number]; p?: [number, number, number]; r?: [number, number, number]; c: string }> = ({ s, p = [0, 0, 0], r = [0, 0, 0], c }) =>
  <mesh position={p} rotation={r} castShadow receiveShadow><boxGeometry args={s} />{mat(c)}</mesh>;

/* ------------------------------------------------------------------ the toy figure */
export type ToySpec = {
  name: string;
  height?: number;        // 1 = average adult; 0.9 short, 1.1 tall
  build?: number;         // 0 slim .. 1 stocky
  skin: string; hair: string; hairStyle?: "short" | "ponytail" | "bald" | "wig" | "long";
  coat: string; shirt?: string; pants: string; shoes?: string;
  hat?: "none" | "tricorn" | "cap"; hatColor?: string;
  beard?: boolean; beardColor?: string; cheeks?: string;
};
export type Pose = {
  x?: number; z?: number; rotY?: number;     // where they stand and which way they face (radians, 0 = toward camera)
  armL?: number; armR?: number;              // arm raise: 0 down, 1 straight forward, 1.6 up
  armLSide?: number; armRSide?: number;      // arm out to the side 0..1
  head?: number; tilt?: number;              // head turn (radians), nod/tilt
  mouth?: number;                            // 0 closed .. 1 open (use talk())
  walk?: number;                             // walk phase in seconds (0 = standing)
  lean?: number;                             // body lean forward (radians)
  look?: number;                             // eyes look up (0..1)
};
/** A low-poly toy person. Same spec = same character in every shot. */
export const Toy: React.FC<{ spec: ToySpec; pose?: Pose }> = ({ spec, pose = {} }) => {
  const h = spec.height ?? 1, b = spec.build ?? 0.4;
  const W = 0.42 + 0.22 * b;                       // body width
  const legH = 0.62 * h, bodyH = 0.7 * h, headS = 0.36;
  const step = pose.walk ? Math.sin(pose.walk * 7) : 0;
  const bob = pose.walk ? Math.abs(Math.cos(pose.walk * 7)) * 0.04 : 0;
  const arm = (side: 1 | -1, raise = 0, out = 0) => (
    <group position={[side * (W / 2 + 0.07), legH + bodyH - 0.08, 0]} rotation={[-raise - (pose.walk ? -step * side * 0.5 : 0), 0, side * out * 0.9]}>
      <Box s={[0.13, 0.52 * h, 0.14]} p={[0, -0.26 * h, 0]} c={spec.coat} />
      <mesh position={[0, -0.55 * h, 0]} castShadow><sphereGeometry args={[0.075, 8, 6]} />{mat(spec.skin)}</mesh>
    </group>
  );
  const leg = (side: 1 | -1) => (
    <group position={[side * W * 0.22, legH, 0]} rotation={[pose.walk ? step * side * 0.5 : 0, 0, 0]}>
      <Box s={[0.17, legH, 0.18]} p={[0, -legH / 2, 0]} c={spec.pants} />
      <Box s={[0.19, 0.08, 0.28]} p={[0, -legH + 0.04, 0.05]} c={spec.shoes || "#3a2a20"} />
    </group>
  );
  return (
    <group position={[pose.x || 0, bob, pose.z || 0]} rotation={[0, pose.rotY || 0, 0]}>
      {leg(1)}{leg(-1)}
      <group rotation={[pose.lean || 0, 0, 0]} position={[0, 0, 0]}>
        {/* body: coat with a shirt front */}
        <Box s={[W, bodyH, 0.36 + 0.12 * b]} p={[0, legH + bodyH / 2, 0]} c={spec.coat} />
        <Box s={[W * 0.36, bodyH * 0.6, 0.02]} p={[0, legH + bodyH * 0.62, 0.19 + 0.06 * b]} c={spec.shirt || "#efe6d2"} />
        {arm(1, pose.armR, pose.armRSide)}{arm(-1, pose.armL, pose.armLSide)}
        {/* head */}
        <group position={[0, legH + bodyH + headS * 0.62, 0]} rotation={[pose.tilt || 0, pose.head || 0, 0]}>
          <Box s={[headS, headS * 1.08, headS * 0.95]} c={spec.skin} />
          {/* eyes */}
          {[1, -1].map((s) => <mesh key={s} position={[s * 0.07, 0.05 + (pose.look || 0) * 0.02, headS * 0.48]}><sphereGeometry args={[0.028, 6, 4]} />{mat("#1d1a18")}</mesh>)}
          {/* mouth opens with speech */}
          <mesh position={[0, -0.09, headS * 0.48]} scale={[1, 0.25 + 1.6 * (pose.mouth || 0), 1]}><boxGeometry args={[0.09, 0.03, 0.02]} />{mat("#5a2a22")}</mesh>
          {spec.cheeks ? [1, -1].map((s) => <mesh key={"c" + s} position={[s * 0.12, -0.03, headS * 0.47]}><circleGeometry args={[0.035, 8]} />{mat(spec.cheeks!)}</mesh>) : null}
          {/* hair */}
          {spec.hairStyle !== "bald" ? <Box s={[headS * 1.04, headS * 0.3, headS * 1.0]} p={[0, headS * 0.45, -0.01]} c={spec.hair} /> : null}
          {spec.hairStyle === "wig" ? [1, -1].map((s) => <mesh key={"w" + s} position={[s * headS * 0.55, 0.02, -0.02]}><cylinderGeometry args={[0.06, 0.06, 0.12, 8]} />{mat(spec.hair)}</mesh>) : null}
          {spec.hairStyle === "ponytail" || spec.hairStyle === "wig" ? <Box s={[0.08, 0.2, 0.08]} p={[0, -0.02, -headS * 0.55]} c={spec.hair} /> : null}
          {spec.hairStyle === "long" ? <Box s={[headS * 1.06, headS * 0.8, 0.1]} p={[0, -0.05, -headS * 0.5]} c={spec.hair} /> : null}
          {spec.beard ? <Box s={[headS * 0.7, 0.12, 0.06]} p={[0, -0.16, headS * 0.47]} c={spec.beardColor || spec.hair} /> : null}
          {/* hats */}
          {spec.hat === "tricorn" ? <group position={[0, headS * 0.66, 0]}>
            <mesh castShadow><cylinderGeometry args={[0.3, 0.3, 0.05, 3]} />{mat(spec.hatColor || "#22201e")}</mesh>
            <mesh position={[0, 0.09, 0]} castShadow><cylinderGeometry args={[0.15, 0.17, 0.16, 8]} />{mat(spec.hatColor || "#22201e")}</mesh></group> : null}
          {spec.hat === "cap" ? <Box s={[headS * 1.08, 0.1, headS * 1.05]} p={[0, headS * 0.6, 0]} c={spec.hatColor || "#5a4632"} /> : null}
        </group>
      </group>
    </group>
  );
};

/* ------------------------------------------------------------------ sets and props */
export const Floor: React.FC<{ c?: string; size?: number; planks?: boolean }> = ({ c = "#9a6a44", size = 30, planks = true }) => (
  <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[size, size]} />{mat(c)}</mesh>
    {planks ? Array.from({ length: 14 }, (_, i) => <mesh key={i} position={[-6.5 + i, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.02, size]} />{mat("#6e4a2e")}</mesh>) : null}
  </group>
);
/** A room corner: back wall (+ optional window). */
export const Room: React.FC<{ wall?: string; floor?: string; window?: boolean; depth?: number }> = ({ wall = "#e9d8bd", floor = "#9a6a44", window: win = true, depth = -2.5 }) => (
  <group>
    <Floor c={floor} />
    <Box s={[16, 7, 0.2]} p={[0, 3.5, depth]} c={wall} />
    {win ? <group position={[-2.2, 2.6, depth + 0.12]}>
      <Box s={[1.3, 1.5, 0.05]} c="#9cc6e8" />
      <Box s={[1.45, 0.08, 0.08]} p={[0, 0.78, 0]} c="#6e4a2e" /><Box s={[1.45, 0.08, 0.08]} p={[0, -0.78, 0]} c="#6e4a2e" />
      <Box s={[0.08, 1.6, 0.08]} p={[0.7, 0, 0]} c="#6e4a2e" /><Box s={[0.08, 1.6, 0.08]} p={[-0.7, 0, 0]} c="#6e4a2e" /><Box s={[0.06, 1.5, 0.06]} c="#6e4a2e" />
    </group> : null}
  </group>
);
/** Flickering low-poly fire (deterministic). */
export const Fire: React.FC<{ p?: [number, number, number]; scale?: number; t: number }> = ({ p = [0, 0, 0], scale = 1, t }) => (
  <group position={p} scale={scale}>
    {[["#ff8a1e", 0.28, 0.75, 0], ["#ffc23a", 0.18, 0.5, 1.7], ["#ff5a1a", 0.22, 0.6, 3.1]].map(([c, r, hh, ph], i) => (
      <mesh key={i} position={[(i - 1) * 0.12, (hh as number) / 2, 0]} scale={[1, 1 + 0.18 * Math.sin(t * 9 + (ph as number)), 1]}>
        <coneGeometry args={[r as number, hh as number, 5]} /><meshStandardMaterial color={c as string} emissive={c as string} emissiveIntensity={1.4} flatShading /></mesh>))}
    <pointLight position={[0, 0.5, 0.3]} intensity={6 + Math.sin(t * 11) * 1.2} distance={6} color="#ff9a40" />
  </group>
);
/** A stone fireplace with logs and fire. */
export const Fireplace: React.FC<{ p?: [number, number, number]; t: number; lit?: boolean }> = ({ p = [0, 0, -2.3], t, lit = true }) => (
  <group position={p}>
    <Box s={[2.4, 1.7, 0.5]} p={[0, 0.85, 0]} c="#cfc3b2" />
    <Box s={[1.5, 1.1, 0.52]} p={[0, 0.6, 0.02]} c="#2a1d17" />
    <Box s={[2.7, 0.18, 0.7]} p={[0, 1.75, 0.08]} c="#7a5236" />
    <Box s={[0.9, 0.12, 0.14]} p={[0, 0.1, 0.25]} r={[0, 0.3, 0]} c="#6e4a2e" /><Box s={[0.9, 0.12, 0.14]} p={[0, 0.1, 0.25]} r={[0, -0.3, 0]} c="#5c3d26" />
    {lit ? <Fire p={[0, 0.12, 0.28]} scale={0.9} t={t} /> : null}
  </group>
);
/** Smoke puffs rising from a point. */
export const Smoke: React.FC<{ p?: [number, number, number]; t: number; n?: number; rise?: number; spread?: number; color?: string }> = ({ p = [0, 0, 0], t, n = 9, rise = 3, spread = 0.5, color = "#d9d4cc" }) => {
  const r = useMemo(() => { const g = rng(7); return Array.from({ length: n }, () => [g(), g(), g()]); }, [n]);
  return <group position={p}>{r.map(([a, b2, c], i) => {
    const life = ((t * 0.35 + i / n) % 1);
    return <mesh key={i} position={[Math.sin(life * 6 + a * 6) * spread * life, life * rise, (b2 - 0.5) * spread]} scale={0.12 + life * 0.35}>
      <icosahedronGeometry args={[1, 0]} /><meshStandardMaterial color={color} transparent opacity={0.85 * (1 - life)} flatShading /></mesh>;
  })}</group>;
};
/** Rows of little houses with red roofs (a town seen from above or behind). */
export const Town: React.FC<{ rows?: number; cols?: number; p?: [number, number, number]; seed?: number }> = ({ rows = 5, cols = 9, p = [0, 0, -6], seed = 3 }) => {
  const g = useMemo(() => { const r = rng(seed); return Array.from({ length: rows * cols }, () => [r(), r(), r()]); }, [rows, cols, seed]);
  return <group position={p}>{g.map(([a, b2, c], i) => {
    const x = (i % cols - cols / 2) * 1.25 + (a - 0.5) * 0.3, z = -Math.floor(i / cols) * 1.4, hh = 0.7 + b2 * 0.7;
    return <group key={i} position={[x, 0, z]}>
      <Box s={[0.9, hh, 0.9]} p={[0, hh / 2, 0]} c={c > 0.5 ? "#f1e3cc" : "#e8d2b0"} />
      <mesh position={[0, hh + 0.22, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[0.72, 0.45, 4]} />{mat(c > 0.3 ? "#c4573a" : "#a8452d")}</mesh>
    </group>;
  })}</group>;
};
export const Cloud: React.FC<{ p: [number, number, number]; s?: number }> = ({ p, s = 1 }) => (
  <group position={p} scale={s}>{[[0, 0, 0, 0.6], [0.55, -0.1, 0, 0.45], [-0.55, -0.1, 0, 0.5], [0.2, 0.25, 0, 0.45]].map(([x, y, z, r], i) =>
    <mesh key={i} position={[x, y, z]}><icosahedronGeometry args={[r, 0]} />{mat("#f4ece2")}</mesh>)}</group>
);
export const Sun: React.FC<{ p?: [number, number, number] }> = ({ p = [-3, 6, -12] }) => (
  <mesh position={p}><circleGeometry args={[1.1, 24]} /><meshBasicMaterial color="#ffd86a" /></mesh>
);
/** A balloon: envelope (stripes), ropes and basket (basket=false for the first Montgolfier-style balloon). */
export const Balloon: React.FC<{ p?: [number, number, number]; s?: number; colors?: [string, string]; basket?: boolean; t?: number }> = ({ p = [0, 3, 0], s = 1, colors = ["#244a8f", "#e6b43c"], basket = true, t = 0 }) => (
  <group position={p} scale={s} rotation={[0, t * 0.2, 0]}>
    <mesh position={[0, 1.1, 0]} scale={[1, 1.18, 1]} castShadow><sphereGeometry args={[1, 12, 10]} />{mat(colors[0])}</mesh>
    {[0.65, 1.1, 1.55].map((y, i) => <mesh key={i} position={[0, y, 0]} scale={[1, 1, 1]}><torusGeometry args={[Math.sqrt(Math.max(0.05, 1 - ((y - 1.1) / 1.18) ** 2)) * 1.005, 0.035, 4, 16]} />{mat(colors[1])}</mesh>)}
    <mesh position={[0, 0.02, 0]}><cylinderGeometry args={[0.32, 0.22, 0.3, 10, 1, true]} />{mat(colors[0])}</mesh>
    {basket ? <group position={[0, -0.75, 0]}>
      {[[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]].map(([x, z], i) => <mesh key={i} position={[x * 0.9, 0.35, z * 0.9]}><cylinderGeometry args={[0.01, 0.01, 0.75, 3]} />{mat("#5a4632")}</mesh>)}
      <Box s={[0.5, 0.32, 0.5]} c="#9a6a3a" /></group> : null}
  </group>
);
export const Table: React.FC<{ p?: [number, number, number]; c?: string }> = ({ p = [0, 0, 0], c = "#7a5236" }) => (
  <group position={p}><Box s={[1.6, 0.1, 0.9]} p={[0, 0.85, 0]} c={c} />
    {[[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]].map(([x, z], i) => <Box key={i} s={[0.09, 0.85, 0.09]} p={[x, 0.42, z]} c={c} />)}</group>
);
/** A flat sheet (paper, letter, map) that can float or rise. */
export const Paper: React.FC<{ p: [number, number, number]; r?: [number, number, number]; s?: [number, number]; c?: string }> = ({ p, r = [0, 0, 0], s = [0.35, 0.45], c = "#f3ead6" }) => (
  <mesh position={p} rotation={r} castShadow><planeGeometry args={s} /><meshStandardMaterial color={c} side={THREE.DoubleSide} flatShading /></mesh>
);
