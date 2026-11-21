// REELIX 3D toy world kit (look "toy3d"), V4 (smooth + life in motion): rounded clay-toy shapes instead of square blocks.
// The set-builder copies this file to <video>/project/custom/_kit.tsx (files starting with "_" are shared code)
// and every shot file imports it:  import { ... } from "./_kit";
//
// Rules that make 3D render correctly in Remotion:
//  - Everything is driven by the frame (useShotTime / kf); never useFrame or clocks.
//  - One <Stage> per shot (ThreeCanvas inside). Portrait 9:16: keep figures in the middle band;
//    the top ~18% holds labels and the bottom ~30% holds captions.
//  - A character's look comes ONLY from its spec (characters/cast.json): same spec in every shot = same person.
//  - Smooth look: use Box (rounded), Ball, Pill and mat(); never or raw boxGeometry in shots.
import React, { useMemo } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

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
      <ThreeCanvas width={width} height={height} shadows={{ type: THREE.PCFSoftShadowMap }} camera={{ fov: camera.fov || 38, position: camera.pos }}
        onCreated={({ camera: c }) => { c.lookAt(...look); }}>
        <CamSync pos={camera.pos} look={look} fov={camera.fov || 38} />
        <color attach="background" args={[bg]} />
        {fog ? <fog attach="fog" args={fog} /> : null}
        {/* soft studio light: warm sky fill, key light with soft shadows, cool rim light from behind for round edges */}
        <hemisphereLight args={["#fff6e8", "#9a7a60", 1.25]} />
        <directionalLight position={[4, 8, 6]} intensity={1.7} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-radius={6} shadow-bias={-0.0004}
          shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
        <directionalLight position={[-5, 4, -6]} intensity={0.9} color="#dfe9ff" />
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

/* ------------------------------------------------------------------ materials and smooth shapes */
/** Soft clay / satin plastic: smooth shading, gentle sheen. */
const mat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  <meshStandardMaterial color={color} roughness={0.55} metalness={0} {...(extra as any)} />;
/** Box with a tiny bevelled edge (rigid things stay rigid). Pass round={0.3..0.5} for soft, toy-like parts. Same props as before, so old shots still work. */
const Box: React.FC<{ s: [number, number, number]; p?: [number, number, number]; r?: [number, number, number]; c: string; round?: number }> = ({ s, p = [0, 0, 0], r = [0, 0, 0], c, round = 0.06 }) => {
  const g = useMemo(() => new RoundedBoxGeometry(s[0], s[1], s[2], 3, Math.max(0.002, Math.min(Math.min(...s) * round, round > 0.1 ? 1 : 0.02))), [s[0], s[1], s[2], round]);
  return <mesh position={p} rotation={r} geometry={g} castShadow receiveShadow>{mat(c)}</mesh>;
};
/** Rounded box geometry for raw meshes: <mesh><RoundGeo args={[w, h, d]} />...</mesh> */
export const RoundGeo: React.FC<{ args: [number, number, number] | number[]; round?: number }> = ({ args, round = 0.06 }) => {
  const [w = 1, h = 1, dd = 1] = args as number[];
  const g = useMemo(() => new RoundedBoxGeometry(w, h, dd, 3, Math.max(0.002, Math.min(Math.min(w, h, dd) * round, 0.02))), [w, h, dd, round]);
  return <primitive object={g} attach="geometry" />;
};
/** Smooth ball. */
export const Ball: React.FC<{ r: number; p?: [number, number, number]; s?: [number, number, number]; c: string }> = ({ r, p = [0, 0, 0], s = [1, 1, 1], c }) =>
  <mesh position={p} scale={s} castShadow receiveShadow><sphereGeometry args={[r, 32, 24]} />{mat(c)}</mesh>;
/** Capsule (rounded limb): radius r, straight length len, centred on p, along y. */
export const Pill: React.FC<{ r: number; len: number; p?: [number, number, number]; rot?: [number, number, number]; s?: [number, number, number]; c: string }> = ({ r, len, p = [0, 0, 0], rot = [0, 0, 0], s = [1, 1, 1], c }) =>
  <mesh position={p} rotation={rot} scale={s} castShadow receiveShadow><capsuleGeometry args={[r, Math.max(0.001, len), 8, 20]} />{mat(c)}</mesh>;

/* ------------------------------------------------------------------ the toy figure (V4: human proportions + life) */
export type ToySpec = {
  name: string;
  height?: number;        // 1 = average adult; 0.9 short, 1.1 tall
  build?: number;         // 0 slim .. 1 stocky
  skin: string; hair: string; hairStyle?: "short" | "ponytail" | "bald" | "wig" | "long";
  coat: string; shirt?: string; pants: string; shoes?: string;
  hat?: "none" | "tricorn" | "cap"; hatColor?: string;
  beard?: boolean; beardColor?: string; cheeks?: string;
  child?: boolean;        // child proportions: bigger head for the body, shorter legs
};
export type Expr = "neutral" | "joy" | "laugh" | "sad" | "cry" | "angry" | "surprised" | "fear";
export type Pose = {
  x?: number; z?: number; rotY?: number;     // where they stand and which way they face (radians, 0 = toward camera)
  armL?: number; armR?: number;              // arm raise: 0 down, 1 straight forward, 1.6 up
  armLSide?: number; armRSide?: number;      // arm out to the side 0..1
  elbowL?: number; elbowR?: number;          // extra elbow bend (radians)
  head?: number; tilt?: number;              // head turn (radians), nod/tilt
  mouth?: number;                            // 0 closed .. 1 open (use talk())
  walk?: number;                             // walk phase in seconds (0 = standing)
  lean?: number;                             // body lean forward (radians), pivots at the hips
  look?: number;                             // eyes look up (0..1)
  expr?: Expr; exprK?: number;               // facial expression and its strength 0..1 (default 1)
  crouch?: number;                           // 0 standing .. 1 deep knee bend (anticipation before a jump, crying squat)
  sit?: number;                              // 0 standing .. 1 sitting (thighs forward, shins down); lower the Toy to the seat yourself
  y?: number;                                // lift off the ground (jumps)
  still?: boolean;                           // switch off automatic breathing, blinking and weight shift
};
/** Body measurements shared by Toy, Apron, AtHand, AtHead and handWorld (so props stay glued to hands). */
export function toyBody(spec: ToySpec) {
  const h = spec.height ?? 1, b = spec.build ?? 0.4;
  const legH = (spec.child ? 0.56 : 0.62) * h, bodyH = 0.7 * h, headS = 0.36;
  const hip = 0.15 + 0.05 * b, waist = 0.125 + 0.09 * b, chest = 0.155 + 0.06 * b, sh = 0.175 + 0.05 * b, depth = 0.74;
  return { h, b, legH, bodyH, headS, hip, waist, chest, sh, depth, shoulderX: sh + 0.015, shoulderY: legH + bodyH - 0.08 };
}
/** A smooth body of revolution from a side profile [[radius, y], ...] (like a vase), squashed front-to-back by `depth`. */
export const Lathe: React.FC<{ pts: [number, number][]; c: string; p?: [number, number, number]; depth?: number; seg?: number; phi?: [number, number]; side?: THREE.Side }> = ({ pts, c, p = [0, 0, 0], depth = 1, seg = 40, phi = [0, Math.PI * 2], side = THREE.FrontSide }) => {
  const g = useMemo(() => {
    const curve = new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(Math.max(0.0005, r), y)));
    return new THREE.LatheGeometry(curve.getPoints(36), seg, phi[0], phi[1]);
  }, [JSON.stringify(pts), seg, phi[0], phi[1]]);
  return <mesh position={p} scale={[1, 1, depth]} geometry={g} castShadow receiveShadow><meshStandardMaterial color={c} roughness={0.6} side={side} /></mesh>;
};
/** Tapered limb segment: rTop at the joint, rBot at the far end, hanging down `len` from its group origin. */
const Limb: React.FC<{ r1: number; r2: number; len: number; c: string; y0?: number }> = ({ r1, r2, len, c, y0 = 0 }) =>
  <mesh position={[0, y0 - len / 2, 0]} castShadow receiveShadow><cylinderGeometry args={[r1, r2, len, 32]} />{mat(c)}</mesh>;
const darken = (c: string, k = 0.8) => "#" + new THREE.Color(c).multiplyScalar(k).getHexString();
const nameSeed = (s: string) => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return (h % 1000) / 1000; };

/* ---- motion helpers (V4) */
/** Keyframes with ANTICIPATION and overshoot: moves a little the other way first, overshoots and settles (back easing). */
export const kfA = (t: number, keys: [number, number][], k = 1.6) => kf(t, keys, Easing.inOut(Easing.back(k)));
/** HEAD-FIRST turn: the head reaches the new direction first, the body follows `lag` seconds later. Spread into a pose. */
export function turn(t: number, keys: [number, number][], lag = 0.22) {
  const target = kf(t, keys), body = kf(t - lag, keys);
  return { rotY: body, head: Math.max(-1.1, Math.min(1.1, target - body)) };
}
/** A jump with anticipation: crouch down first, push off, fly, land and absorb. Spread into a pose ({ y, crouch }). */
export function jump(t: number, t0: number, h = 0.35, air = 0.5) {
  const prep = 0.25, u = (t - t0) / air;
  if (t < t0 - prep || t > t0 + air + 0.3) return { y: 0, crouch: 0 };
  if (t < t0) return { y: 0, crouch: Math.sin(((t - (t0 - prep)) / prep) * Math.PI / 2) * 0.6 };   // crouch down
  if (u <= 1) return { y: 4 * h * u * (1 - u), crouch: Math.max(0, 0.6 - u * 3) * 0.6 };            // push off and fly
  const v = (t - t0 - air) / 0.3; return { y: 0, crouch: Math.sin(v * Math.PI) * 0.45 };            // land and absorb
}

/* ---- face (V4 expression system) */
const EXPR: Record<Expr, { by: number; bt: number; eye: number; smile: number; open: number; ow: number; closed?: boolean; tears?: boolean }> = {
  neutral:   { by: 0,      bt: 0,     eye: 1,    smile: 0.15, open: 0,    ow: 1 },
  joy:       { by: 0.008,  bt: 0.12,  eye: 0.8,  smile: 1,    open: 0.35, ow: 1.35 },
  laugh:     { by: 0.012,  bt: 0.15,  eye: 0.2,  smile: 1,    open: 0.9,  ow: 1.4, closed: true },
  sad:       { by: 0.004,  bt: 0.42,  eye: 0.82, smile: -0.8, open: 0,    ow: 0.9 },
  cry:       { by: 0.006,  bt: 0.5,   eye: 0.2,  smile: -1,   open: 0.6,  ow: 1.2, closed: true, tears: true },
  angry:     { by: -0.012, bt: -0.5,  eye: 0.72, smile: -0.7, open: 0.1,  ow: 0.85 },
  surprised: { by: 0.024,  bt: 0.05,  eye: 1.3,  smile: 0,    open: 0.85, ow: 0.65 },
  fear:      { by: 0.016,  bt: 0.45,  eye: 1.22, smile: -0.5, open: 0.4,  ow: 1.15 },
};
const ToyFace: React.FC<{ spec: ToySpec; pose: Pose; t: number; hr: number; fz: number }> = ({ spec, pose, t, hr, fz }) => {
  const E = EXPR[pose.expr || "neutral"], k = pose.exprK ?? 1, N = EXPR.neutral, mix = (a: number, b: number) => a + (b - a) * k;
  const seed = nameSeed(spec.name), period = 2.8 + seed * 1.6, ph = (t + seed * 5) % period;
  const blink = pose.still ? 1 : ph < 0.13 ? Math.abs(ph / 0.065 - 1) * 0.9 + 0.1 : 1;   // quick close-open
  const eyeY = mix(N.eye, E.eye) * blink, closed = (E.closed && k > 0.5) || eyeY < 0.18;
  const by = mix(0, E.by), bt = mix(0, E.bt), smile = mix(N.smile, E.smile);
  const open = Math.max(pose.mouth || 0, mix(0, E.open)), ow = mix(1, E.ow), lk = pose.look || 0;
  const _b = 0; const browC = spec.beard ? (spec.beardColor || spec.hair) : spec.hair;
  return <group>
    {[1, -1].map((s) => <group key={s} position={[s * 0.06, 0.03 + lk * 0.012, fz - 0.028]} scale={1.3}>
      {closed ? <mesh position={[0, 0, 0.012]} rotation={[0, 0, E.smile >= 0 ? 0 : Math.PI]}><torusGeometry args={[0.02, 0.004, 16, 48, Math.PI]} />{mat("#2a1d17")}</mesh> : <>
        <Ball r={0.027} s={[1, 1.1 * eyeY, 0.55]} c="#fbf8f2" />
        <Ball r={0.016} p={[0, lk * 0.008, 0.012]} s={[1, 1.1 * Math.min(1, eyeY), 0.5]} c="#2a1d17" />
        {eyeY > 0.5 ? <Ball r={0.005} p={[0.006, 0.01 + lk * 0.008, 0.019]} c="#ffffff" /> : null}
        <mesh position={[0, 0.026 * eyeY + 0.002, 0.004]} rotation={[0.5, 0, 0]} scale={[1, 0.3, 1]}><sphereGeometry args={[0.028, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.5]} />{mat(spec.skin)}</mesh>{/* upper lid */}
      </>}
    </group>)}
    {/* brows: height and tilt (inner end up = sad/fear, inner end down = angry) */}
    {[1, -1].map((s) => <Pill key={"b" + s} r={0.0085} len={0.042} p={[s * 0.06, 0.085 + by + lk * 0.01 + (E.eye > 1.1 ? 0.01 * k : 0), fz - 0.025]} rot={[0, 0, Math.PI / 2 - s * (0.12 - bt * 0.0) + s * bt]} c={browC} />)}
    {/* mouth: smile/frown curve, opens for talking, laughing, surprise */}
    {open > 0.08 ? <Ball r={0.034} p={[0, -0.075 + smile * 0.004, fz - 0.035]} s={[1.15 * ow, 0.25 + 1.1 * open, 0.4]} c="#5a2a22" /> : null}
    {open > 0.3 && smile > 0.3 ? <Ball r={0.026} p={[0, -0.062, fz - 0.03]} s={[1.2 * ow, 0.35, 0.3]} c="#f6f1e8" /> : null}{/* teeth */}
    <mesh position={[0, -0.07 + (smile >= 0 ? 0.008 : -0.006), fz - 0.028]} rotation={[0, 0, smile >= 0 ? Math.PI : 0]} scale={[ow, Math.max(0.15, Math.abs(smile)), 1]}>
      <torusGeometry args={[0.036, 0.0065, 16, 48, Math.PI]} />{mat("#7a3a30")}</mesh>
    {E.tears && k > 0.3 ? [1, -1].map((s) => { const f = (t * 0.9 + (s > 0 ? 0 : 0.5)) % 1; return <Ball key={"t" + s} r={0.008} p={[s * 0.06, 0.005 - f * 0.08, fz - 0.015]} s={[1, 1.4, 1]} c="#8fd0f0" />; }) : null}
  </group>;
};
/** V5: one continuous limb along a curve through the joints, thickness r(u) for u 0..1 (no balls at joints, bends smoothly). */
const Sweep: React.FC<{ pts: THREE.Vector3[]; r: (u: number) => number; c: string; seg?: number }> = ({ pts, r, c, seg = 28 }) => {
  const key = pts.map((v) => v.toArray().map((n) => n.toFixed(4)).join(",")).join("|");
  const g = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    const tube = new THREE.TubeGeometry(curve, seg, 1, 20, false), P = tube.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i <= seg; i++) { const u = i / seg, ctr = curve.getPointAt(u), k = r(u);
      for (let j = 0; j <= 20; j++) { const q = i * 21 + j; P.setXYZ(q, ctr.x + (P.getX(q) - ctr.x) * k, ctr.y + (P.getY(q) - ctr.y) * k, ctr.z + (P.getZ(q) - ctr.z) * k); } }
    P.needsUpdate = true; tube.computeVertexNormals(); return tube;
  }, [key]);
  React.useEffect(() => () => g.dispose(), [g]);
  return <mesh geometry={g} castShadow receiveShadow>{mat(c)}</mesh>;
};
/** Little hand: palm, three fingers and a thumb (curl 0 open .. 1 fist). */
const Hand: React.FC<{ c: string; side: 1 | -1; curl?: number }> = ({ c, side, curl = 0.35 }) => <group>
  {/* V5: solid chubby cartoon hand: palm and fingers as one rounded mitten, thumb on the side */}
  <Ball r={0.04} p={[0, 0.004, 0]} s={[0.92, 1.0, 0.62]} c={c} />
  <group position={[0, -0.03, 0.004]} rotation={[curl * 0.9, 0, 0]}><Ball r={0.034} p={[0, -0.014, 0.004]} s={[1.0, 0.95, 0.66]} c={c} /></group>
  <group position={[-side * 0.03, 0.0, 0.012]} rotation={[0.35, 0, side * 0.6]}><Pill r={0.012} len={0.02} p={[0, -0.014, 0]} c={c} /></group>
</group>;
/** Soft contact shadow on the ground under a character (keeps feet planted). */
const shadowTex = (() => { let tx: THREE.Texture | null = null; return () => { if (tx) return tx;
  const cv = document.createElement("canvas"); cv.width = cv.height = 64; const g = cv.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, "rgba(0,0,0,0.55)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); tx = new THREE.CanvasTexture(cv); return tx; }; })();
export const ContactShadow: React.FC<{ r?: number; k?: number; p?: [number, number, number] }> = ({ r = 0.32, k = 1, p = [0, 0.004, 0] }) =>
  <mesh position={p} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}><planeGeometry args={[r * 2, r * 2]} /><meshBasicMaterial map={shadowTex()} transparent opacity={k} depthWrite={false} /></mesh>;

/** A toy person with human proportions and life: breathing, blinking, expressions, weight shift, knees that bend,
 *  fingers, collar, cuffs and a swinging coat hem. Same spec = same character in every shot. */
export const Toy: React.FC<{ spec: ToySpec; pose?: Pose }> = ({ spec, pose = {} }) => {
  const t = useShotTime(), seed = nameSeed(spec.name), live = !pose.still;
  const B = toyBody(spec), { h, legH, bodyH, hip, waist, chest, sh, depth } = B;
  const step = pose.walk ? Math.sin(pose.walk * 7) : 0;
  const bob = pose.walk ? Math.abs(Math.cos(pose.walk * 7)) * 0.04 : 0;
  const crouch = pose.crouch || 0, sit = pose.sit || 0;
  const breath = live ? 0.5 + 0.5 * Math.sin(t * 2.0 + seed * 6) : 0;
  const roll = pose.walk ? step * 0.05 : live ? 0.022 * Math.sin(t * 0.7 + seed * 9) : 0;   // weight over the standing leg
  const drop = crouch * 0.16 * h * (1 - sit);                                       // body lowers when the knees bend
  const upper = 0.27 * h, fore = 0.22 * h;
  const sway = pose.walk ? Math.sin(pose.walk * 7 + 1.2) * 0.04 : 0;     // coat hem swing
  const arm = (side: 1 | -1, raise = 0, out = 0, elbow = 0) => {
    const eb = -0.12 - raise * 0.05 - elbow - (pose.walk ? 0.25 : 0);           // elbow bend (same as V4)
    const W = new THREE.Vector3(0, -fore, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), eb).add(new THREE.Vector3(0, -upper, 0));
    const E = new THREE.Vector3(0, -upper, 0), M1 = new THREE.Vector3(0, -upper * 0.5, 0), M2 = E.clone().lerp(W, 0.5);
    const thick = (u: number) => u < 0.08 ? 0.058 * Math.sqrt(u / 0.08) + 0.004 : u < 0.5 ? 0.061 - (u - 0.08) * 0.034 : u < 0.62 ? 0.047 + Math.sin((u - 0.5) / 0.12 * Math.PI) * 0.002 : 0.047 - (u - 0.62) * 0.022;
    return <group position={[side * B.shoulderX, B.shoulderY + breath * 0.006, 0]} rotation={[-raise - (pose.walk ? -step * side * 0.5 : 0), 0, side * (0.06 + out * 0.9)]}>
      {/* V5: one continuous sleeve from the shoulder through the elbow to the wrist (no joint balls) */}
      <Sweep pts={[new THREE.Vector3(0, 0.035, 0), new THREE.Vector3(0, -0.01, 0), M1, E, M2, W]} r={thick} c={spec.coat} />
      <group position={[0, -upper, 0]} rotation={[eb, 0, 0]}>
        <Limb r1={0.025} r2={0.024} len={0.03} y0={-fore + 0.012} c={spec.skin} />{/* wrist */}
        <group position={[0, -fore - 0.03, 0.004]}><Hand c={spec.skin} side={side} curl={pose.walk ? 0.6 : 0.35} /></group>
      </group>
    </group>;
  };
  const leg = (side: 1 | -1) => {
    const swing = pose.walk ? step * side * 0.5 : 0;
    const kb = (pose.walk ? Math.max(0, -step * side) * 0.6 : 0.04) + crouch * 1.7 + sit * 1.45;     // knee bend (same as V4)
    const L2 = legH * 0.5, K = new THREE.Vector3(0, -L2, 0);
    const A = new THREE.Vector3(0, -(L2 - 0.06), 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), kb).add(K);
    const r0 = 0.078 + 0.02 * B.b;
    const thick = (u: number) => u < 0.5 ? r0 - u * (r0 - 0.058) * 2 : 0.058 - (u - 0.5) * 0.024;
    return <group position={[side * hip * 0.48, legH, 0]} rotation={[swing - crouch * 0.85 - sit * 1.5, 0, 0]}>
      {/* V5: one continuous trouser leg from the hip through the knee to the ankle (no knee ball) */}
      <Sweep pts={[new THREE.Vector3(0, 0.04, 0), new THREE.Vector3(0, -L2 * 0.5, 0), K, K.clone().lerp(A, 0.5), A]} r={thick} c={spec.pants} />
      <group position={[0, -L2, 0]} rotation={[kb, 0, 0]}>
        <group rotation={[-crouch * 0.85 - sit * 0.05, 0, 0]} position={[0, -L2 + 0.035, 0]}><Ball r={0.06} p={[0, 0, 0.045]} s={[0.85, 0.55, 1.6]} c={spec.shoes || "#3a2a20"} /></group>
      </group>
    </group>;
  };
  const y = (k: number) => legH + bodyH * k;
  const hr = spec.child ? 0.165 : 0.155, fz = hr * 0.97;
  const lean = (pose.lean || 0) + crouch * 0.35;
  return (
    <group position={[pose.x || 0, 0, pose.z || 0]} rotation={[0, pose.rotY || 0, 0]}>
      <ContactShadow r={0.34 * h} k={Math.max(0.25, 0.9 - (pose.y || 0) * 1.5)} />
      <group position={[0, bob - drop + (pose.y || 0), 0]}>
      {leg(1)}{leg(-1)}
      <group position={leanPos(legH, lean)} rotation={[lean, 0, 0]}>
      <group position={[legH * Math.sin(roll), legH * (1 - Math.cos(roll)), 0]} rotation={[0, 0, roll]}>
        <Lathe c={spec.pants} depth={depth} pts={[[0, legH - 0.07], [hip * 0.85, legH - 0.06], [hip, legH], [hip * 0.98, y(0.12)], [waist, y(0.2)]]} />
        {/* torso breathes: chest widens slightly */}
        <group position={[0, legH, 0]} scale={[1 + breath * 0.018, 1 + breath * 0.008, 1 + breath * 0.022]}><group position={[0, -legH, 0]}>
          <Lathe c={spec.coat} depth={depth} pts={[[hip * 1.04, legH - 0.02], [hip * 1.02, y(0.08)], [waist * 1.03, y(0.32)], [chest, y(0.6)], [chest * 1.01, y(0.76)], [sh * 0.93, y(0.88)], [sh * 0.72, y(0.95)], [0.085, y(0.99)], [0.055, y(1.0)], [0, y(1.0)]]} />
          {/* coat hem: a short flared skirt that swings when walking */}
          <group position={[0, legH + 0.01, 0]} rotation={[sway, 0, roll * -0.6]}><Lathe c={darken(spec.coat, 0.93)} depth={depth} side={THREE.DoubleSide} pts={[[hip * 1.06, 0.03], [hip * 1.12, -0.04], [hip * 1.2, -0.11]]} /></group>
          {/* V5: clean coat front: a soft placket line (no oval patch) */}
          <Pill r={0.006} len={bodyH * 0.62} p={[0, y(0.52), chest * depth + 0.004]} c={darken(spec.coat, 0.85)} />
          {[0.36, 0.5, 0.64].map((kk) => <Ball key={kk} r={0.013} p={[0, y(kk), (kk < 0.5 ? waist : chest) * depth + 0.008]} c="#6e4a2e" />)}
          {/* soft fold lines at the waist and elbows of the coat */}
          {[1, -1].map((s) => <mesh key={"f" + s} position={[s * waist * 0.55, y(0.3), waist * depth * 0.9]} rotation={[0, s * 0.5, s * 0.35]}><torusGeometry args={[0.035, 0.0035, 16, 48, Math.PI * 0.6]} />{mat(darken(spec.coat, 0.78))}</mesh>)}
        </group></group>
        <mesh position={[0, y(1.0) + 0.012, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, depth + 0.12, 1]}><torusGeometry args={[0.062, 0.016, 16, 48]} />{mat(spec.shirt || "#efe6d2")}</mesh>{/* collar */}
        <Limb r1={0.048} r2={0.055} len={0.09} y0={y(1.0) + 0.07} c={spec.skin} />
        {arm(1, pose.armR, pose.armRSide, pose.elbowR)}{arm(-1, pose.armL, pose.armLSide, pose.elbowL)}
        <group position={[0, legH + bodyH + B.headS * 0.62 + breath * 0.004, 0]} rotation={[(pose.tilt || 0) + (live ? 0.02 * Math.sin(t * 0.9 + seed * 4) : 0), (pose.head || 0), -roll * 0.5]}>
          <Ball r={hr} s={[0.9, 1.06, 0.95]} c={spec.skin} />
          <Ball r={hr * 0.78} p={[0, -0.05, 0.02]} s={[0.92, 0.8, 0.95]} c={spec.skin} />
          <Ball r={0.017} p={[0, -0.022, fz + 0.002]} s={[1, 0.9, 1]} c={spec.skin} />
          {[1, -1].map((s) => <Ball key={"e" + s} r={0.026} p={[s * hr * 0.88, -0.005, -0.005]} s={[0.45, 1, 0.8]} c={spec.skin} />)}
          <ToyFace spec={spec} pose={pose} t={t} hr={hr} fz={fz} />
          {spec.cheeks ? [1, -1].map((s) => <Ball key={"c" + s} r={0.022} p={[s * 0.085, -0.03, fz - 0.035]} s={[1, 0.75, 0.4]} c={spec.cheeks!} />) : null}
          {/* V5 hair: shells fitted to the head (head = sphere hr scaled 0.9 / 1.06 / 0.95), so it never floats */}
          {spec.hairStyle !== "bald" ? <mesh position={[0, 0.002, -0.004]} scale={[hr * 0.9 * 1.035, hr * 1.06 * 1.035, hr * 0.95 * 1.04]} castShadow>
            <sphereGeometry args={[1, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.4]} />{mat(spec.hair)}</mesh> : null}
          {spec.hairStyle !== "bald" ? <mesh position={[0, 0.002, -0.006]} scale={[hr * 0.9 * 1.035, hr * 1.06 * 1.035, hr * 0.95 * 1.04]} castShadow>
            <sphereGeometry args={[1, 40, 24, Math.PI, Math.PI, 0, Math.PI * 0.6]} />{mat(spec.hair)}</mesh> : null}
          {spec.hairStyle === "wig" ? [1, -1].map((s) => <Pill key={"w" + s} r={0.036} len={0.05} p={[s * hr * 0.92, -0.01, -0.02]} c={spec.hair} />) : null}
          {spec.hairStyle === "ponytail" || spec.hairStyle === "wig" ? <Pill r={0.035} len={0.1} p={[0, -0.05, -hr * 0.95]} c={spec.hair} /> : null}
          {spec.hairStyle === "long" ? <Box s={[hr * 1.85, hr * 1.7, 0.1]} p={[0, -0.07, -hr * 0.7]} c={spec.hair} round={0.45} /> : null}
          {spec.beard ? <Ball r={hr * 0.62} p={[0, -0.085, fz - 0.07]} s={[0.95, 0.6, 0.5]} c={spec.beardColor || spec.hair} /> : null}
          {spec.hat === "tricorn" ? <group position={[0, hr * 1.0, 0]}>
            <mesh castShadow><cylinderGeometry args={[0.26, 0.26, 0.04, 3]} />{mat(spec.hatColor || "#22201e")}</mesh>
            <Ball r={0.14} p={[0, 0.05, 0]} s={[1, 0.75, 1]} c={spec.hatColor || "#22201e"} /></group> : null}
          {spec.hat === "cap" ? <group position={[0, hr * 0.75, 0]}>
            <Ball r={hr * 1.02} s={[1, 0.55, 1.05]} c={spec.hatColor || "#5a4632"} />
            <Box s={[hr * 1.2, 0.025, hr * 0.7]} p={[0, -0.02, hr * 0.9]} c={spec.hatColor || "#5a4632"} /></group> : null}
        </group>
      </group>
      </group>
      </group>
    </group>
  );
};

/** Cloth that wraps the front of a Toy's body (apron, tabard, waistcoat). from/to are body heights 0..1 (can go below 0 over the thighs). */
export const Apron: React.FC<{ spec: ToySpec; pose?: Pose; c: string; from?: number; to?: number; wrap?: number }> = ({ spec, pose = {}, c, from = -0.45, to = 0.82, wrap = 2.3 }) => {
  const B = toyBody(spec), { legH, bodyH, hip, waist, chest, depth } = B, y = (k: number) => legH + bodyH * k;
  const bob = pose.walk ? Math.abs(Math.cos(pose.walk * 7)) * 0.04 : 0;
  const r = (k: number) => k < 0 ? hip * 1.12 + (-k) * 0.08 : k < 0.32 ? hip * 1.08 + (waist * 1.06 - hip * 1.08) * (k / 0.32) : waist * 1.06 + (chest * 1.05 - waist * 1.06) * Math.min(1, (k - 0.32) / 0.3);
  const ks = Array.from({ length: 9 }, (_, i) => from + (to - from) * i / 8);
  return <group position={[pose.x || 0, bob, pose.z || 0]} rotation={[0, pose.rotY || 0, 0]}><group position={leanPos(toyBody(spec).legH, pose.lean)} rotation={[pose.lean || 0, 0, 0]}>
    <Lathe c={c} depth={depth} phi={[-wrap / 2, wrap]} side={THREE.DoubleSide} pts={ks.map((k) => [r(k) + 0.012, y(k)] as [number, number])} />
  </group></group>;
};

/* ------------------------------------------------------------------ lean from the hips (keeps legs and body on one line) */
/** Offset that makes a lean of `a` radians pivot at hip height L instead of at the feet. */
export const leanPos = (L: number, a = 0): [number, number, number] => [0, L * (1 - Math.cos(a)), -L * Math.sin(a)];

/* ------------------------------------------------------------------ fire (stylized, glowing) */
const NOISE = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }`;
const FLAME_VS = `uniform float uTime; uniform float uSeed; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){ vUv = uv; vec3 p = position; float h = clamp(uv.y, 0.0, 1.0);
  float sway = sin(uTime * 7.0 + uSeed * 5.0 + h * 4.0) * 0.12 + sin(uTime * 13.0 + uSeed * 2.0 + h * 9.0) * 0.05;
  p.x += sway * h * h; p.z += cos(uTime * 6.0 + uSeed * 3.0 + h * 5.0) * 0.06 * h * h;
  p.y *= 1.0 + 0.12 * sin(uTime * 10.0 + uSeed * 7.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const FLAME_FS = NOISE + `uniform float uTime; uniform float uSeed; uniform vec3 uCore; uniform vec3 uMid; uniform vec3 uTip; uniform float uPower;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){ float h = clamp(vUv.y, 0.0, 1.0);
  float n = fbm(vec2(vUv.x * 6.0 + uSeed * 10.0, h * 3.0 - uTime * 2.4));
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 0.9);          // soft silhouette
  float body = smoothstep(0.0, 0.25, (1.0 - h) * 1.25 + (n - 0.5) * 0.9 - 0.15); // ragged, licking top
  vec3 col = mix(uCore, uMid, smoothstep(0.0, 0.45, h)); col = mix(col, uTip, smoothstep(0.45, 1.0, h));
  float a = body * edge * uPower * (1.0 - smoothstep(0.85, 1.0, h));
  gl_FragColor = vec4(col * (0.7 + 0.6 * n), a); }`;
const flameGeo = (() => { let g: THREE.LatheGeometry | null = null; return () => g || (g = new THREE.LatheGeometry(
  new THREE.SplineCurve([[0.001, 0], [0.55, 0.12], [0.75, 0.3], [0.6, 0.55], [0.32, 0.8], [0.001, 1.0]].map(([r, y]) => new THREE.Vector2(r, y))).getPoints(30), 32)); })();
const Tongue: React.FC<{ t: number; seed: number; p: [number, number, number]; s: [number, number, number]; core: string; mid: string; tip: string; power: number }> = ({ t, seed, p, s, core, mid, tip, power }) => {
  const m = useMemo(() => new THREE.ShaderMaterial({ vertexShader: FLAME_VS, fragmentShader: FLAME_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uSeed: { value: seed }, uCore: { value: new THREE.Color(core) }, uMid: { value: new THREE.Color(mid) }, uTip: { value: new THREE.Color(tip) }, uPower: { value: power } } }), [seed, core, mid, tip, power]);
  m.uniforms.uTime.value = t;
  return <mesh position={p} scale={s} geometry={flameGeo()} material={m} renderOrder={10} />;
};
/** Soft round glow (additive halo) around a light source. */
export const Glow: React.FC<{ p?: [number, number, number]; r?: number; c?: string; k?: number }> = ({ p = [0, 0, 0], r = 0.6, c = "#ff8a30", k = 0.6 }) => {
  const m = useMemo(() => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uC: { value: new THREE.Color(c) }, uK: { value: k } },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uC; uniform float uK; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(max(dot(normalize(vN), normalize(vV)), 0.0), 2.5); gl_FragColor = vec4(uC * f * uK, f * uK); }` }), [c, k]);
  return <mesh position={p} material={m} renderOrder={9}><sphereGeometry args={[r, 32, 24]} /></mesh>;
};
/** Stylized glowing fire: layered teardrop flame tongues (red outside, orange, white-yellow core), noisy licking tips,
 *  sway, glow halo, rising embers and a flickering light. Deterministic (driven by t). Base at the origin, about 1 unit tall at scale 1. */
export const FireFX: React.FC<{ p?: [number, number, number]; scale?: number; t: number; light?: number; seed?: number; embers?: boolean }> = ({ p = [0, 0, 0], scale = 1, t, light = 4, seed = 1, embers = true }) => {
  const tongues = useMemo(() => { const g = rng(seed * 97 + 3); return Array.from({ length: 5 }, (_, i) => ({ x: (g() - 0.5) * 0.36, z: (g() - 0.5) * 0.2, h: 0.65 + g() * 0.45, w: 0.16 + g() * 0.08, s: g() * 10 })); }, [seed]);
  const em = useMemo(() => { const g = rng(seed * 31 + 7); return Array.from({ length: 10 }, () => [g() - 0.5, g(), g() - 0.5, 0.6 + g() * 0.8]); }, [seed]);
  const fl = 1 + 0.12 * Math.sin(t * 11 + seed) + 0.06 * Math.sin(t * 23 + seed * 2);
  return <group position={p} scale={scale}>
    {tongues.map((q, i) => <group key={i}>
      <Tongue t={t} seed={q.s} p={[q.x, 0, q.z]} s={[q.w * 1.25, q.h, q.w * 1.25]} core="#ff7a1a" mid="#ff4a12" tip="#a8200a" power={0.75} />
      <Tongue t={t} seed={q.s + 1.3} p={[q.x, 0.01, q.z]} s={[q.w * 0.85, q.h * 0.78, q.w * 0.85]} core="#ffd36a" mid="#ff9a2a" tip="#ff5a14" power={0.85} />
      <Tongue t={t} seed={q.s + 2.7} p={[q.x, 0.02, q.z + 0.01]} s={[q.w * 0.45, q.h * 0.5, q.w * 0.45]} core="#fffbe6" mid="#ffe48a" tip="#ffb03a" power={0.9} />
    </group>)}
    <Glow p={[0, 0.3, 0]} r={0.55} c="#ff7a24" k={0.35 * fl} />
    {embers ? em.map(([x, ph, z, sp], i) => { const life = (t * 0.6 * sp + ph) % 1; return <mesh key={"e" + i} position={[x * 0.5 + Math.sin(life * 7 + i) * 0.08, 0.3 + life * 1.3, z * 0.4]} scale={0.018 * (1 - life)}>
      <sphereGeometry args={[1, 32, 24]} /><meshBasicMaterial color="#ffc04a" transparent opacity={1 - life} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>; }) : null}
    {light > 0 ? <pointLight position={[0, 0.5, 0.35]} intensity={light * fl} distance={5} color="#ff9440" /> : null}
  </group>;
};

/* ------------------------------------------------------------------ molten glass */
const MOLTEN_VS = `attribute float aCool; varying float vCool; varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vW;
void main(){ vCool = aCool; vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vW = position; gl_Position = projectionMatrix * mv; }`;
const MOLTEN_FS = NOISE + `uniform float uTime; varying float vCool; varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vW;
void main(){ vec3 N = normalize(vN), V = normalize(vV); float ndv = max(dot(N, V), 0.0); float fres = pow(1.0 - ndv, 3.0);
  float flow = fbm(vec2(vW.x * 2.2 - uTime * 1.1, vW.z * 5.0));                 // hot streaks flowing along the ribbon
  float veins = smoothstep(0.55, 0.8, fbm(vec2(vW.x * 4.0 - uTime * 1.6, vW.z * 9.0)));
  float c = clamp(vCool, 0.0, 1.0);
  vec3 white = vec3(1.0, 0.96, 0.82), hot = vec3(1.0, 0.62, 0.16), amber = vec3(0.95, 0.42, 0.10), glass = vec3(0.50, 0.83, 0.80);
  vec3 col = mix(white, hot, smoothstep(0.0, 0.25, c)); col = mix(col, amber, smoothstep(0.25, 0.55, c));
  float glow = (1.0 - smoothstep(0.35, 0.7, c));
  col *= 0.75 + 0.45 * flow + 0.5 * veins * glow;                                 // brighter where the streaks are
  vec3 L = normalize(vec3(0.4, 1.0, 0.5)); vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 80.0);                                     // glossy wet shine
  vec3 cool = glass * (0.35 + 0.4 * ndv) + vec3(0.85, 0.95, 1.0) * fres * 0.9;     // cooled: clear teal glass with bright rim
  vec3 hotCol = col + vec3(1.0, 0.8, 0.5) * fres * 0.6 * glow;                     // rim glow on the hot glass
  vec3 outc = mix(hotCol, cool, smoothstep(0.55, 0.9, c)) + vec3(1.0) * spec * 0.9;
  float a = mix(1.0, 0.55 + 0.4 * fres, smoothstep(0.6, 0.95, c));
  gl_FragColor = vec4(outc, a); }`;
/** A continuous ribbon of molten glass along x from x0 to front: rounded "pillow" cross-section, width w(x), height h(x),
 *  cool(x) 0 = white-hot .. 1 = cooled clear glass. Glows, has flowing hot streaks, a wet shine and a rounded leading edge. */
export const MoltenRibbon: React.FC<{ x0: number; front: number; t: number; y?: number; width: (d: number) => number; height: (d: number) => number; cool: (d: number) => number; wobble?: (d: number, t: number) => number }> = ({ x0, front, t, y = 0, width, height, cool, wobble }) => {
  const NX = 90, NS = 18;
  const geo = useMemo(() => { const g = new THREE.BufferGeometry(); const n = (NX + 1) * (NS + 1);
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    g.setAttribute("aCool", new THREE.BufferAttribute(new Float32Array(n), 1));
    const idx: number[] = []; for (let i = 0; i < NX; i++) for (let j = 0; j < NS; j++) { const a = i * (NS + 1) + j, b = a + NS + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    g.setIndex(idx); return g; }, []);
  const L = Math.max(0.01, front - x0), P = geo.attributes.position as THREE.BufferAttribute, U = geo.attributes.uv as THREE.BufferAttribute, C = geo.attributes.aCool as THREE.BufferAttribute;
  for (let i = 0; i <= NX; i++) {
    const d = (i / NX) * L, x = x0 + d, tipK = Math.min(1, (L - d) / 0.25), tip = Math.sqrt(Math.max(0, tipK));   // round leading edge
    const w = width(d) * (0.35 + 0.65 * tip), h = height(d) * tip, wy = wobble ? wobble(d, t) : 0, k = cool(d);
    for (let j = 0; j <= NS; j++) { const a = Math.PI * (j / NS); const z = -Math.cos(a) * w / 2, yy = Math.pow(Math.sin(a), 0.6) * h;   // pillow section, flat bottom
      const q = i * (NS + 1) + j; P.setXYZ(q, x, y + yy + wy * Math.sin(a), z); U.setXY(q, i / NX, j / NS); C.setX(q, k); }
  }
  P.needsUpdate = true; C.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
  const m = useMemo(() => new THREE.ShaderMaterial({ vertexShader: MOLTEN_VS, fragmentShader: MOLTEN_FS, transparent: true, side: THREE.DoubleSide, uniforms: { uTime: { value: 0 } } }), []);
  m.uniforms.uTime.value = t;
  return <mesh geometry={geo} material={m} />;
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
export const Fire: React.FC<{ p?: [number, number, number]; scale?: number; t: number }> = ({ p = [0, 0, 0], scale = 1, t }) =>
  <FireFX p={p} scale={scale * 0.9} t={t} light={6} seed={2} />;
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
      <icosahedronGeometry args={[1, 3]} /><meshStandardMaterial color={color} transparent opacity={0.85 * (1 - life)} /></mesh>;
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
    <mesh key={i} position={[x, y, z]}><icosahedronGeometry args={[r, 3]} />{mat("#f4ece2")}</mesh>)}</group>
);
export const Sun: React.FC<{ p?: [number, number, number] }> = ({ p = [-3, 6, -12] }) => (
  <mesh position={p}><circleGeometry args={[1.1, 48]} /><meshBasicMaterial color="#ffd86a" /></mesh>
);
/** A balloon: envelope (stripes), ropes and basket (basket=false for the first Montgolfier-style balloon). */
export const Balloon: React.FC<{ p?: [number, number, number]; s?: number; colors?: [string, string]; basket?: boolean; t?: number }> = ({ p = [0, 3, 0], s = 1, colors = ["#244a8f", "#e6b43c"], basket = true, t = 0 }) => (
  <group position={p} scale={s} rotation={[0, t * 0.2, 0]}>
    <mesh position={[0, 1.1, 0]} scale={[1, 1.18, 1]} castShadow><sphereGeometry args={[1, 32, 24]} />{mat(colors[0])}</mesh>
    {[0.65, 1.1, 1.55].map((y, i) => <mesh key={i} position={[0, y, 0]} scale={[1, 1, 1]}><torusGeometry args={[Math.sqrt(Math.max(0.05, 1 - ((y - 1.1) / 1.18) ** 2)) * 1.005, 0.035, 4, 16]} />{mat(colors[1])}</mesh>)}
    <mesh position={[0, 0.02, 0]}><cylinderGeometry args={[0.32, 0.22, 0.3, 32, 1, true]} />{mat(colors[0])}</mesh>
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
  <mesh position={p} rotation={r} castShadow><planeGeometry args={s} /><meshStandardMaterial color={c} side={THREE.DoubleSide} /></mesh>
);

/* ================================================================== ADDED for "the smoke idea" (balloon, animals, sets) */
const UP = new THREE.Vector3(0, 1, 0);
/** A thin rope/stick between two points a and b. */
export const Rope: React.FC<{ a: [number, number, number]; b: [number, number, number]; r?: number; c?: string }> = ({ a, b, r = 0.012, c = "#6b5236" }) => {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const d = vb.clone().sub(va); const len = Math.max(1e-4, d.length());
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  return <mesh position={mid.toArray() as any} quaternion={q}><cylinderGeometry args={[r, r, len, 4]} />{mat(c)}</mesh>;
};
/** World position of a Toy's hand (ignores armSide, lean and walk): use it to put props in hands or tie ropes. side 1 = armR. */
export function handPos(spec: ToySpec, pose: Pose, side: 1 | -1, parent: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const h = spec.height ?? 1, b = spec.build ?? 0.4, W = 0.42 + 0.22 * b;
  const r = side === 1 ? (pose.armR || 0) : (pose.armL || 0), L = 0.6 * h;
  const lx = side * (W / 2 + 0.07), ly = 0.62 * h + 0.7 * h - 0.08 - L * Math.cos(r), lz = L * Math.sin(r);
  const a = pose.rotY || 0;
  return [parent[0] + (pose.x || 0) + lx * Math.cos(a) + lz * Math.sin(a), parent[1] + ly, parent[2] + (pose.z || 0) - lx * Math.sin(a) + lz * Math.cos(a)];
}
/** Gold trim and the pale blue sash for the King; give it the same pose (x, z, rotY, lean) as his Toy. */
export const RoyalTrim: React.FC<{ spec: ToySpec; pose?: Pose }> = ({ spec, pose = {} }) => {
  const h = spec.height ?? 1, b = spec.build ?? 0.4, W = 0.42 + 0.22 * b, legH = 0.62 * h, bodyH = 0.7 * h, fz = (0.36 + 0.12 * b) / 2 + 0.012;
  return <group position={[pose.x || 0, 0, pose.z || 0]} rotation={[0, pose.rotY || 0, 0]}><group position={leanPos(toyBody(spec).legH, pose.lean)} rotation={[pose.lean || 0, 0, 0]}>
    <Box s={[0.13, bodyH * 1.15, 0.02]} p={[0, legH + bodyH * 0.5, fz + 0.01]} r={[0, 0, 0.62]} c="#a9d2f0" />
    {[1, -1].map((s) => <Box key={s} s={[0.035, bodyH * 0.95, 0.02]} p={[s * W * 0.24, legH + bodyH * 0.5, fz]} c="#e2b43a" />)}
    <Box s={[W + 0.01, 0.05, (0.36 + 0.12 * b) + 0.02]} p={[0, legH + 0.04, 0]} c="#e2b43a" />
  </group></group>;
};
/** A Toy sitting on a wooden stool (Toy unchanged: it is lowered into the stool block and given thighs and shins). */
export const Seated: React.FC<{ spec: ToySpec; pose?: Pose; seatY?: number; stool?: string }> = ({ spec, pose = {}, seatY = 0.46, stool = "#8a5a34" }) => {
  const legH = toyBody(spec).legH, hip = seatY + 0.09;
  const inner: Pose = { ...pose, x: 0, z: 0, rotY: 0, walk: 0, sit: 1 };
  return <group position={[pose.x || 0, 0, pose.z || 0]} rotation={[0, pose.rotY || 0, 0]}>
    <Box s={[0.62, seatY, 0.5]} p={[0, seatY / 2, -0.02]} c={stool} />
    <Box s={[0.7, 0.06, 0.56]} p={[0, seatY + 0.01, -0.02]} c="#6e4a2e" />
    <group position={[0, hip - legH, 0]}><Toy spec={spec} pose={inner} /></group>
  </group>;
};

/* ---------- the Montgolfier balloon (pear shape, painted bands, suns) */
const PROFILE: [number, number][] = [[0.3, 0], [0.42, 0.25], [0.66, 0.7], [0.9, 1.2], [1.02, 1.7], [1.03, 2.05], [0.94, 2.4], [0.74, 2.68], [0.42, 2.86], [0.02, 2.94]];
const rAt = (y: number) => { for (let i = 1; i < PROFILE.length; i++) { const [r0, y0] = PROFILE[i - 1], [r1, y1] = PROFILE[i]; if (y <= y1) return r0 + (r1 - r0) * (y - y0) / (y1 - y0); } return 0; };
export type BalloonProps = { p?: [number, number, number]; s?: number; body?: string; trim?: string; inflate?: number; basket?: "none" | "round" | "gallery"; rot?: [number, number, number]; children?: React.ReactNode; spin?: number };
/** Pear-shaped Montgolfier balloon, neck at the group origin. `inflate` 0..1 swells it; children ride in the basket (origin = basket floor). */
export const MBalloon: React.FC<BalloonProps> = ({ p = [0, 0, 0], s = 1, body = "#7cc0ea", trim = "#e8b53a", inflate = 1, basket = "round", rot = [0, 0, 0], children, spin = 0 }) => {
  const pts = useMemo(() => PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), []);
  const iv = Math.max(0, Math.min(1, inflate));
  const env: [number, number, number] = [0.45 + 0.55 * iv, 0.3 + 0.7 * iv, 0.45 + 0.55 * iv];
  return <group position={p} scale={s} rotation={rot}>
    <group scale={env} rotation={[0, spin, 0]}>
      <mesh castShadow receiveShadow><latheGeometry args={[pts, 48]} /><meshStandardMaterial color={body} roughness={0.9} side={THREE.DoubleSide} /></mesh>
      {[0.55, 1.45, 2.3].map((y, i) => <mesh key={i} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[rAt(y) + 0.015, i === 1 ? 0.06 : 0.04, 16, 48]} />{mat(trim)}</mesh>)}
      {Array.from({ length: 7 }, (_, i) => <group key={"s" + i} rotation={[0, (i / 7) * Math.PI * 2, 0]}>
        <mesh position={[0, 1.9, rAt(1.9) + 0.02]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.16, 0.16, 0.03, 32]} />{mat(trim)}</mesh>
        <mesh position={[0, 1.0, rAt(1.0) + 0.02]} rotation={[0.35, 0, 0]}><coneGeometry args={[0.07, 0.24, 4]} />{mat(trim)}</mesh>
      </group>)}
      <mesh position={[0, 2.97, 0]}><sphereGeometry args={[0.1, 32, 24]} />{mat(trim)}</mesh>
    </group>
    {basket === "round" ? <group>
      {[0, 1, 2, 3].map((i) => { const a = i * Math.PI / 2 + Math.PI / 4; return <Rope key={i} a={[Math.cos(a) * 0.3 * env[0], 0.02, Math.sin(a) * 0.3 * env[0]]} b={[Math.cos(a) * 0.4, -0.52, Math.sin(a) * 0.4]} />; })}
      <group position={[0, -0.9, 0]}><WickerBasket r={0.44} h={0.4}>{children}</WickerBasket></group>
    </group> : null}
    {basket === "gallery" ? <group position={[0, -0.02, 0]}>
      <mesh receiveShadow castShadow><cylinderGeometry args={[0.85, 0.85, 0.06, 32]} />{mat("#9a6a3a")}</mesh>
      <mesh position={[0, 0.32, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.84, 0.03, 16, 48]} />{mat(trim)}</mesh>
      {Array.from({ length: 8 }, (_, i) => { const a = i / 8 * Math.PI * 2; return <Box key={i} s={[0.04, 0.32, 0.04]} p={[Math.cos(a) * 0.84, 0.16, Math.sin(a) * 0.84]} c="#7a5236" />; })}
      <group position={[0, 0.03, 0]}>{children}</group>
    </group> : null}
  </group>;
};
/** Round open wicker basket; children sit on its floor (origin). */
export const WickerBasket: React.FC<{ r?: number; h?: number; children?: React.ReactNode }> = ({ r = 0.44, h = 0.4, children }) => (
  <group>
    <mesh position={[0, h / 2, 0]} castShadow receiveShadow><cylinderGeometry args={[r, r * 0.9, h, 32, 1, true]} /><meshStandardMaterial color="#b07c40" roughness={0.95} side={THREE.DoubleSide} /></mesh>
    <mesh position={[0, 0.02, 0]} receiveShadow><cylinderGeometry args={[r * 0.9, r * 0.9, 0.04, 32]} />{mat("#8a5c2e")}</mesh>
    {[0.12, 0.26].map((y) => <mesh key={y} position={[0, y * h / 0.4, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[r * (0.92 + 0.08 * y / 0.4) + 0.01, 0.018, 16, 48]} />{mat("#8a5c2e")}</mesh>)}
    <mesh position={[0, h, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[r, 0.035, 16, 48]} />{mat("#7a4f26")}</mesh>
    {children}
  </group>
);

/* ---------- animals (face +z; origin on the ground between the feet) */

/* ------------------------------------------------------------------ animals (real proportions, smooth) */
export type AnimalPose = { x?: number; y?: number; z?: number; rotY?: number; s?: number; walk?: number; head?: number; tilt?: number; flap?: number; shake?: number; puff?: number; beak?: number; roll?: number };
export type SheepSpec = { name: string; kind: "sheep"; wool: string; face: string; legs: string };
export type DuckSpec = { name: string; kind: "duck"; body: string; bill: string; feet: string };
export type RoosterSpec = { name: string; kind: "rooster"; body: string; tail: string; comb: string; beak: string; legs: string };
const AEye: React.FC<{ p: [number, number, number]; r?: number; white?: boolean }> = ({ p, r = 0.016, white }) => <group position={p}>
  {white ? <Ball r={r * 1.35} s={[1, 1, 0.6]} c="#f4efe6" /> : null}
  <Ball r={r} p={[0, 0, white ? r * 0.55 : 0]} c="#141210" />
  <Ball r={r * 0.3} p={[r * 0.35, r * 0.4, (white ? r * 0.55 : 0) + r * 0.8]} c="#ffffff" /></group>;
/** Sheep: woolly oval body on thin dark legs, long dark face with drooping ears. */
export const Sheep: React.FC<{ spec: SheepSpec; pose?: AnimalPose }> = ({ spec, pose = {} }) => {
  const w = pose.walk ? Math.sin(pose.walk * 11) * 0.5 : 0;
  const tufts = useMemo(() => { const g = rng(5); return Array.from({ length: 22 }, () => { const a = g() * Math.PI * 2, e = (g() - 0.35) * 1.4; return [Math.cos(a) * 0.24 * Math.cos(e), 0.06 + Math.sin(e) * 0.17, Math.sin(a) * 0.33 * Math.cos(e), 0.09 + g() * 0.04]; }); }, []);
  return <group position={[pose.x || 0, pose.y || 0, pose.z || 0]} rotation={[0, pose.rotY || 0, pose.roll || 0]} scale={pose.s || 1}>
    {[[0.11, 0.2, 1], [-0.11, 0.2, -1], [0.11, -0.2, -1], [-0.11, -0.2, 1]].map(([x, z, ph], i) =>
      <group key={i} position={[x, 0.3, z]} rotation={[w * ph, 0, 0]}>
        <Limb r1={0.034} r2={0.022} len={0.3} c={spec.legs} />
        <Ball r={0.026} p={[0, -0.295, 0.008]} s={[1, 0.7, 1.2]} c="#2a2624" /></group>)}
    <group position={[0, 0.44, 0]} rotation={[0, 0, pose.shake || 0]} scale={1 + (pose.puff || 0) * 0.08}>
      <Ball r={0.27} s={[0.92, 0.82, 1.3]} c={spec.wool} />
      {tufts.map(([x, y, z, r], i) => <Ball key={i} r={r} p={[x, y, z]} c={spec.wool} />)}
      <Ball r={0.05} p={[0, 0.06, -0.36]} s={[1, 1.2, 0.8]} c={spec.wool} />{/* tail */}
    </group>
    <group position={[0, 0.58, 0.34]} rotation={[0.35 + (pose.tilt || 0), pose.head || 0, (pose.shake || 0) * 0.6]}>
      <Ball r={0.1} p={[0, 0.02, -0.02]} c={spec.wool} />{/* wool cap */}
      <Ball r={0.075} p={[0, -0.02, 0.06]} s={[0.85, 1, 1.45]} c={spec.face} />{/* long face */}
      <Ball r={0.05} p={[0, -0.05, 0.14]} s={[0.95, 0.8, 1]} c={spec.face} />{/* muzzle */}
      {[1, -1].map((s) => <Ball key={"n" + s} r={0.008} p={[s * 0.018, -0.04, 0.188]} c="#0c0a0a" />)}
      {[1, -1].map((s) => <Ball key={s} r={0.04} p={[s * 0.1, 0.01, 0.0]} s={[1.6, 0.45, 0.8]} c={spec.face} />)}{/* drooping ears */}
      {[1, -1].map((s) => <AEye key={"e" + s} p={[s * 0.052, 0.02, 0.09]} r={0.013} white />)}
    </group>
  </group>;
};
/** Duck: teardrop body with a tipped-up tail, curved neck, round head and a flat wide bill. */
export const Duck: React.FC<{ spec: DuckSpec; pose?: AnimalPose }> = ({ spec, pose = {} }) => {
  const w = pose.walk ? Math.sin(pose.walk * 13) : 0;
  return <group position={[pose.x || 0, pose.y || 0, pose.z || 0]} rotation={[0, pose.rotY || 0, (pose.roll || 0) + w * 0.12]} scale={pose.s || 1}>
    {[1, -1].map((s) => <group key={s} position={[s * 0.06, 0.11, 0.01]} rotation={[w * s * 0.6, 0, 0]}>
      <Limb r1={0.016} r2={0.012} len={0.09} c={spec.feet} />
      <Ball r={0.045} p={[0, -0.095, 0.035]} s={[1, 0.18, 1.3]} c={spec.feet} /></group>)}
    <group position={[0, 0.22, 0]} rotation={[-0.15, 0, 0]}>
      <Ball r={0.16} s={[0.85, 0.75, 1.3]} c={spec.body} />
      <Ball r={0.07} p={[0, 0.05, -0.2]} s={[0.8, 0.6, 1.4]} c={spec.body} />{/* tipped-up tail */}
      {[1, -1].map((s) => <group key={"w" + s} position={[s * 0.12, 0.03, -0.02]} rotation={[0.1, 0, s * (pose.flap || 0) * 1.3]}>
        <Ball r={0.1} p={[s * 0.01, -0.01, -0.02]} s={[0.25, 0.6, 1.4]} c="#ecebe4" /></group>)}
    </group>
    <Pill r={0.045} len={0.09} p={[0, 0.36, 0.13]} rot={[0.35, 0, 0]} c={spec.body} />{/* neck */}
    <group position={[0, 0.45, 0.16]} rotation={[pose.tilt || 0, pose.head || 0, 0]}>
      <Ball r={0.075} s={[0.92, 1, 1.05]} c={spec.body} />
      <Ball r={0.05} p={[0, -0.018, 0.085]} s={[0.85, 0.28, 1.25]} c={spec.bill} />{/* flat bill */}
      {[1, -1].map((s) => <AEye key={s} p={[s * 0.05, 0.02, 0.04]} r={0.012} />)}
    </group>
  </group>;
};
/** Rooster: plump upright body, neck ruff, red comb and wattle, small beak, arched tail feathers, thin legs. */
export const Rooster: React.FC<{ spec: RoosterSpec; pose?: AnimalPose }> = ({ spec, pose = {} }) => {
  const w = pose.walk ? Math.sin(pose.walk * 12) : 0, pf = 1 + (pose.puff || 0) * 0.18;
  return <group position={[pose.x || 0, pose.y || 0, pose.z || 0]} rotation={[0, pose.rotY || 0, pose.roll || 0]} scale={pose.s || 1}>
    {[1, -1].map((s) => <group key={s} position={[s * 0.055, 0.22, 0]} rotation={[w * s * 0.5, 0, 0]}>
      <Limb r1={0.03} r2={0.014} len={0.07} c={spec.body} />{/* feathered thigh */}
      <Limb r1={0.012} r2={0.011} len={0.2} y0={-0.02} c={spec.legs} />
      {[-0.4, 0, 0.4].map((a, i) => <Pill key={i} r={0.007} len={0.05} p={[Math.sin(a) * 0.03, -0.215, Math.cos(a) * 0.03]} rot={[Math.PI / 2, 0, -a]} c={spec.legs} />)}</group>)}
    <group position={[0, 0.36, 0]} rotation={[-0.35, 0, 0]} scale={[pf, pf, pf]}>
      <Ball r={0.15} s={[0.85, 0.95, 1.25]} c={spec.body} />
      <Ball r={0.1} p={[0, 0.03, 0.11]} s={[1, 1.1, 0.9]} c="#a94e22" />{/* breast */}
      {[1, -1].map((s) => <group key={s} position={[s * 0.11, 0.02, -0.02]} rotation={[0, 0, s * (pose.flap || 0) * 1.2]}>
        <Ball r={0.1} p={[s * 0.01, -0.01, 0]} s={[0.25, 0.65, 1.3]} c="#9a4a20" /></group>)}
    </group>
    {[-0.5, -0.15, 0.2, 0.55].map((a, i) => <group key={"t" + i} position={[0, 0.42, -0.16]} rotation={[0.2 - i * 0.12, a * 0.5, 0]}>
      <mesh rotation={[0, Math.PI / 2, 0]} position={[0, 0.0, -0.12]} castShadow><torusGeometry args={[0.13, 0.018 - i * 0.002, 16, 48, Math.PI * 0.9]} />{mat(i % 2 ? spec.tail : "#163024")}</mesh></group>)}
    <Pill r={0.06} len={0.08} p={[0, 0.5, 0.09]} rot={[0.3, 0, 0]} c="#d2802e" />{/* neck ruff */}
    <group position={[0, 0.6, 0.12]} rotation={[pose.tilt || 0, pose.head || 0, 0]}>
      <Ball r={0.065} s={[0.9, 1.05, 1.1]} c={spec.body} />
      {[-0.035, 0, 0.035].map((z, i) => <Ball key={i} r={0.022 + (i === 1 ? 0.006 : 0)} p={[0, 0.07 + (i === 1 ? 0.01 : 0), z]} s={[0.55, 1.1, 1]} c={spec.comb} />)}
      <mesh position={[0, 0.0, 0.075]} rotation={[Math.PI / 2 - (pose.beak || 0) * 0.3, 0, 0]}><coneGeometry args={[0.02, 0.05, 32]} />{mat(spec.beak)}</mesh>
      <mesh position={[0, -0.016, 0.07]} rotation={[Math.PI / 2 + (pose.beak || 0) * 0.5, 0, 0]}><coneGeometry args={[0.014, 0.035, 32]} />{mat(spec.beak)}</mesh>
      <Ball r={0.018} p={[0, -0.05, 0.055]} s={[0.7, 1.5, 0.8]} c={spec.comb} />{/* wattle */}
      {[1, -1].map((s) => <AEye key={s} p={[s * 0.045, 0.015, 0.035]} r={0.011} />)}
    </group>
  </group>;
};

/* ---------- sets */
/** Versailles palace facade (cream walls, blue-grey roof). Faces +z; centre pavilion optional balcony at y 1.2. */
export const Palace: React.FC<{ p?: [number, number, number]; width?: number; balcony?: boolean }> = ({ p = [0, 0, -6], width = 16, balcony = false }) => {
  const n = Math.floor(width / 1.1);
  return <group position={p}>
    <Box s={[width, 2.8, 1.2]} p={[0, 1.4, 0]} c="#f0e2c4" />
    <Box s={[width + 0.1, 0.16, 1.3]} p={[0, 2.85, 0]} c="#e2cfa6" />
    <Box s={[width - 0.4, 0.8, 0.9]} p={[0, 3.3, -0.1]} r={[0, 0, 0]} c="#6d7f96" />
    <mesh position={[0, 3.3, 0.36]} rotation={[0.55, 0, 0]}><RoundGeo args={[width - 0.2, 0.9, 0.08]} />{mat("#7a8ca4")}</mesh>
    {Array.from({ length: n }, (_, i) => { const x = (i - (n - 1) / 2) * 1.1; if (Math.abs(x) < 1.6) return null; return <group key={i} position={[x, 0, 0.61]}>
      <Box s={[0.5, 0.9, 0.04]} p={[0, 0.85, 0]} c="#7d93ab" /><Box s={[0.6, 0.08, 0.06]} p={[0, 1.33, 0]} c="#fbf3e2" />
      <Box s={[0.42, 0.6, 0.04]} p={[0, 2.1, 0]} c="#7d93ab" /><Box s={[0.5, 0.06, 0.06]} p={[0, 2.43, 0]} c="#fbf3e2" />
      <Box s={[0.6, 0.66, 0.1]} p={[0, 3.35, 0.4]} c="#f0e2c4" /><Box s={[0.36, 0.42, 0.04]} p={[0, 3.35, 0.46]} c="#7d93ab" />
    </group>; })}
    <group position={[0, 0, 0.35]}>
      <Box s={[3.0, 3.4, 1.2]} p={[0, 1.7, 0]} c="#f6ead0" />
      <mesh position={[0, 3.62, 0.1]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 1]}><cylinderGeometry args={[0.55, 0.55, 3.2, 3]} />{mat("#f6ead0")}</mesh>
      {[-1.05, -0.35, 0.35, 1.05].map((x) => <mesh key={x} position={[x, 1.6, 0.62]} castShadow><cylinderGeometry args={[0.09, 0.1, 3.0, 32]} />{mat("#fbf3e2")}</mesh>)}
      <Box s={[0.9, 1.6, 0.05]} p={[0, 0.8, 0.61]} c="#5e7088" />
      <Box s={[0.6, 0.8, 0.05]} p={[0, 2.4, 0.61]} c="#7d93ab" />
      <mesh position={[0, 3.62, 0.67]}><circleGeometry args={[0.2, 48]} />{mat("#e2b43a")}</mesh>
      {balcony ? <group position={[0, 1.15, 0.9]}>
        <Box s={[2.2, 0.1, 0.8]} c="#e9dcc0" />
        <Box s={[2.2, 0.05, 0.05]} p={[0, 0.42, 0.38]} c="#e2b43a" />
        {Array.from({ length: 9 }, (_, i) => <Box key={i} s={[0.04, 0.4, 0.04]} p={[-1.0 + i * 0.25, 0.22, 0.38]} c="#e2b43a" />)}
      </group> : null}
    </group>
  </group>;
};
/** Many small toy people (a crowd). `cheer` 0..1 lifts arms; `hats` 0..1 throws their hats up. */
export const Crowd: React.FC<{ n?: number; x?: [number, number]; z?: [number, number]; seed?: number; cheer?: number; hats?: number; t?: number; s?: number; face?: number }> = ({ n = 10, x = [-3, 3], z = [-1, 1], seed = 9, cheer = 0, hats = 0, t = 0, s = 0.45, face = 0 }) => {
  const people = useMemo(() => { const g = rng(seed); const coats = ["#c4573a", "#3d6fa8", "#8a6a3e", "#5a7a3a", "#a8452d", "#6a4a7a", "#d6a04a", "#4a5a6a"];
    const skins = ["#f2c7a5", "#e8b48e", "#f6d2b8", "#d9a07a"]; const hairs = ["#3a2a1e", "#6a4a2a", "#d8d2c4", "#1e1a18", "#a0682e"];
    return Array.from({ length: n }, (_, i) => ({ x: x[0] + (x[1] - x[0]) * g(), z: z[0] + (z[1] - z[0]) * g(), ph: g() * 6, d: 0.8 + g() * 0.4,
      spec: { name: "p" + i, height: 0.85 + g() * 0.25, build: g(), skin: skins[Math.floor(g() * 4)], hair: hairs[Math.floor(g() * 5)], coat: coats[Math.floor(g() * 8)], pants: g() > 0.5 ? "#3a3030" : "#6a5a4a", hat: (g() > 0.45 ? "tricorn" : "none") as any, hatColor: "#2a2420" } as ToySpec })); }, [n, seed, x[0], x[1], z[0], z[1]]);
  return <group>{people.map((q, i) => {
    const c = Math.max(0, Math.min(1, cheer * q.d + (cheer > 0 ? 0.05 * Math.sin(t * 7 + q.ph) : 0)));
    const hy = hats * (1.8 + q.d) - hats * hats * 0.9, hasHat = q.spec.hat === "tricorn";
    const spec = hats > 0.02 && hasHat ? { ...q.spec, hat: "none" as const } : q.spec;
    const top = (0.62 + 0.7) * (q.spec.height ?? 1) + 0.42;
    return <group key={i} position={[q.x, 0, q.z]} scale={s}>
      <Toy spec={spec} pose={{ rotY: face + Math.sin(q.ph) * 0.3, armL: 0.1 + 2.5 * c + Math.sin(t * 9 + q.ph) * 0.15 * c, armR: 0.1 + 2.6 * c + Math.cos(t * 8 + q.ph) * 0.15 * c, look: c, tilt: -0.2 * c, mouth: c * 0.8 }} />
      {hats > 0.02 && hasHat ? <group position={[0, top + hy, 0]} rotation={[hats * 5 * q.d, hats * 4, 0]}>
        <mesh><cylinderGeometry args={[0.3, 0.3, 0.05, 3]} />{mat("#2a2420")}</mesh><mesh position={[0, 0.09, 0]}><cylinderGeometry args={[0.15, 0.17, 0.16, 32]} />{mat("#2a2420")}</mesh></group> : null}
    </group>; })}</group>;
};
export const Tree: React.FC<{ p: [number, number, number]; s?: number; c?: string }> = ({ p, s = 1, c = "#5f9a4a" }) => (
  <group position={p} scale={s}><mesh position={[0, 0.4, 0]} castShadow><cylinderGeometry args={[0.08, 0.12, 0.8, 32]} />{mat("#6e4a2e")}</mesh>
    <Ball r={0.55} p={[0, 1.15, 0]} s={[1, 1.15, 1]} c={c} /><Ball r={0.35} p={[0.3, 1.5, 0.1]} c={c} /></group>
);
export const Hill: React.FC<{ p: [number, number, number]; s?: [number, number, number]; c?: string }> = ({ p, s = [4, 1.2, 3], c = "#7fb55a" }) => (
  <mesh position={p} scale={s} receiveShadow castShadow><icosahedronGeometry args={[1, 3]} />{mat(c)}</mesh>
);
/** Wooden beamed ceiling at height y. */
export const Ceiling: React.FC<{ y?: number; c?: string }> = ({ y = 3.2, c = "#e2cfae" }) => (
  <group position={[0, y, 0]}>
    <mesh rotation={[Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[16, 12]} />{mat(c)}</mesh>
    {[-3, -1.6, -0.2, 1.2, 2.6].map((z) => <Box key={z} s={[16, 0.22, 0.24]} p={[0, -0.11, z]} c="#6e4a2e" />)}
  </group>
);
export const CopperPots: React.FC<{ p?: [number, number, number] }> = ({ p = [1.8, 2.3, -2.3] }) => (
  <group position={p}><Box s={[1.6, 0.06, 0.06]} c="#3a2a20" />
    {[[-0.55, 0.22], [0, 0.28], [0.55, 0.18]].map(([x, r], i) => <group key={i} position={[x, -0.08, 0.05]}>
      <Rope a={[0, 0, 0]} b={[0, -0.18, 0]} c="#3a2a20" />
      <mesh position={[0, -0.18 - r, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[r, r, 0.12, 32]} /><meshStandardMaterial color="#c8743a" roughness={0.4} metalness={0.5} /></mesh></group>)}
  </group>
);
/** Light silk box (thin wooden frame + cream silk walls, open bottom). `puff` 0..1 swells the silk; `glow` lights it from inside. */
export const SilkBox: React.FC<{ p?: [number, number, number]; s?: number; puff?: number; glow?: number; rot?: [number, number, number] }> = ({ p = [0, 0, 0], s = 1, puff = 0, glow = 0, rot = [0, 0, 0] }) => {
  const W = 0.56, H = 0.48, f = "#8a5a34", b = 1 + puff * 0.12;
  const edges: [number, number, number, number, number, number][] = [];
  for (const sx of [1, -1]) for (const sz of [1, -1]) edges.push([0.025, H, 0.025, sx * W / 2, H / 2, sz * W / 2]);
  for (const y of [0, H]) for (const sz of [1, -1]) { edges.push([W, 0.025, 0.025, 0, y, sz * W / 2]); edges.push([0.025, 0.025, W, sz * W / 2, y, 0]); }
  return <group position={p} scale={s} rotation={rot}>
    <mesh position={[0, H / 2 + puff * 0.03, 0]} scale={[b, 1 + puff * 0.08, b]} castShadow>
      <RoundGeo args={[W - 0.01, H, W - 0.01]} /><meshStandardMaterial color="#f6ead2" emissive="#ffb050" emissiveIntensity={glow * 0.35} roughness={0.9} />
    </mesh>
    {edges.map(([a, bb, c, x, y, z], i) => <Box key={i} s={[a, bb, c]} p={[x, y, z]} c={f} />)}
  </group>;
};
export const Dish: React.FC<{ p?: [number, number, number] }> = ({ p = [0, 0, 0] }) => (
  <group position={p}><mesh castShadow><cylinderGeometry args={[0.16, 0.12, 0.06, 32]} /><meshStandardMaterial color="#9aa0a8" metalness={0.5} roughness={0.4} /></mesh></group>
);
export const Platform: React.FC<{ p?: [number, number, number]; w?: number; d?: number; h?: number }> = ({ p = [0, 0, 0], w = 2.4, d = 2.0, h = 0.3 }) => (
  <group position={p}><Box s={[w, h, d]} p={[0, h / 2, 0]} c="#9a6a3e" />
    {Array.from({ length: Math.floor(w / 0.3) }, (_, i) => <Box key={i} s={[0.02, 0.005, d]} p={[-w / 2 + 0.3 * (i + 1), h + 0.003, 0]} c="#6e4a2e" />)}</group>
);

/* ---------- the cast: the ONLY place character looks live (copied from characters/cast.json) */
export const CAST = {
  Joseph: { name: "Joseph", height: 1.0, build: 0.7, skin: "#f2c7a5", hair: "#e4e0d8", hairStyle: "ponytail", coat: "#7a4a2a", shirt: "#efe3c4", pants: "#4a2f1e", shoes: "#1c1a18", hat: "none", hatColor: "#22201e", beard: false, cheeks: "#e8a68a" } as ToySpec,
  Etienne: { name: "Etienne", height: 1.1, build: 0.15, skin: "#f2c7a5", hair: "#4a2c1a", hairStyle: "ponytail", coat: "#2f6b3e", shirt: "#f2e08a", pants: "#1e1c1c", shoes: "#1c1a18", hat: "none", hatColor: "#22201e", beard: false } as ToySpec,
  King: { name: "King", height: 1.12, build: 1.0, skin: "#f6cfc4", hair: "#f4f1ea", hairStyle: "wig", coat: "#24479a", shirt: "#fbf8f0", pants: "#f4f1ea", shoes: "#141414", hat: "none", hatColor: "#22201e", beard: false, cheeks: "#f0a0a0" } as ToySpec,
  Sheep: { name: "Sheep", kind: "sheep", wool: "#f4ecd8", face: "#1e1b1a", legs: "#1e1b1a" } as SheepSpec,
  Duck: { name: "Duck", kind: "duck", body: "#fbfaf5", bill: "#f08a24", feet: "#f08a24" } as DuckSpec,
  Rooster: { name: "Rooster", kind: "rooster", body: "#c8642a", tail: "#1f3a2c", comb: "#d8262a", beak: "#f2c230", legs: "#f2c230" } as RoosterSpec,
};
