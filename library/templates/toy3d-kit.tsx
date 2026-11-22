// REELIX 3D toy world kit (look "toy3d"), Lego V5 (docs/experiments/VERSIONS.md).
// The set-builder copies this file to <video>/project/custom/_kit.tsx (files starting with "_" are shared code)
// and every shot file imports it:  import { ... } from "./_kit";
//
// Rules that make 3D render correctly in Remotion:
//  - Everything is driven by the frame (useShotTime / kf); never useFrame or clocks.
//  - One <Stage> per shot (ThreeCanvas inside). Keep figures and the action in the middle band, in BOTH formats:
//    16:9 top ~15% labels, bottom ~18% captions; 9:16 top ~17% labels, bottom ~28% captions. Text is never drawn over
//    the animation: the engine draws the scene label and the storyboard shot "label" in the top band (no label code here).
//  - Soft look (approved 2026-11-22, docs/experiments/2026-11-22-soft-look): every colour is softened by itself (SOFT below: 90% colour
//    strength, darks lifted a little; skin, near-white and near-black untouched) and the Stage sky is lightened with a soft haze, so
//    sets look calm like the rock salt video. Shots need no code for it; use light skies, 3-4 main colours and few background objects.
//  - A character's look comes ONLY from its spec (characters/cast.json): same spec in every shot = same person.
//  - Shape rule: soft things are smooth (Ball, Pill, Lathe, Box with round 0.3-0.5); rigid things (tables, walls, glass,
//    machines) are Box with the default tiny bevel. Never flat shading. tools/smooth3d.py runs before every render.
//  - People (Toy): breathe, blink and shift weight by themselves. Use expr (neutral joy laugh sad cry angry surprised fear),
//    turn() for head-first turns, kfA() for moves with anticipation, jump() for jumps, crouch, sit (or <Seated>), child: true,
//    lean (bends at the hips). Props in hands: AtHand / handWorld; on heads: AtHead; clothes over the body: Apron.
//  - Effects: FireFX (glowing layered fire), Glow (soft halo), MoltenRibbon (molten glass / lava sheet).
//  - Objects: everyday objects come from the model library first: <KitModel file=... h=... /> with a line from library/models/catalog.txt
//    (1,572 CC0 models: trees, rocks, houses, city streets, shops, factories, cars, trucks, buses, trains, boats, bicycle, food, furniture,
//    farm, space, castle, insects...). Missing ones are built as _prop_<name>.tsx and saved to library/props.
//    Catalog lines with anim=... are rigged and move: <AnimatedModel file=... h=... clip="Walk" t={t} /> plays one of their motions.
//    Every model faces +z (catalog flip = pass flip). People riding bikes: <Cyclist> (full rider), never a Mini (Mini seated = torso only, inside vehicles).
//  - Animals: ready animated animals first (catalog category animal: alpaca bull cow deer donkey fox horse husky shiba-inu stag wolf;
//    walk, gallop, eat, idle...) with <AnimatedModel>. Any other animal by body plan + spec: Quad, Bird, Fish, Turtle with ready specs in ANIMALS (dog cat horse cow pig
//    elephant giraffe lion bear rabbit penguin owl parrot fish turtle); make a new one as a spec, never as loose shapes.
//    Older hand-made ones: Sheep, Duck, Rooster.
import React, { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, Easing, continueRender, delayRender, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/* ------------------------------------------------------------------ soft look (approved 2026-11-22, Option A of docs/experiments/2026-11-22-soft-look)
   Every colour given as a string (props, clothes, sets, backgrounds, fog) and every colour baked into a library model is softened once:
   colour strength x sat, mid and dark tones lifted a little toward liftTo. Near-white (lights, milk) and near-black (hair, eyes) stay,
   and skin colours are never changed (Toy registers its spec.skin), so people keep their identity. sky = how far the Stage background
   moves toward a pale version of itself; haze = default fog [near, far] in metres when a shot passes none.
   Set SOFT.on = false in a video's _kit.tsx copy for the old, stronger colours. */
export const SOFT = { on: true, sat: 0.9, lift: 0.08, liftTo: 0.75, keepAbove: 0.85, keepBelow: 0.14, sky: 0.35, haze: [30, 95] as [number, number] };
const SOFT_KEEP = new Set<string>();
/** Never soften this colour (skin). */
export const keepColour = (c?: string) => { if (c) SOFT_KEEP.add(c.toLowerCase()); };
const _hsl = { h: 0, s: 0, l: 0 };
export function softenColor(c: THREE.Color) {
  if (!SOFT.on) return c;
  c.getHSL(_hsl, THREE.SRGBColorSpace);
  const l = _hsl.l > SOFT.keepAbove || _hsl.l < SOFT.keepBelow ? _hsl.l : _hsl.l + (SOFT.liftTo - _hsl.l) * SOFT.lift;
  return c.setHSL(_hsl.h, _hsl.s * SOFT.sat, l, THREE.SRGBColorSpace);
}
const _setStyle = THREE.Color.prototype.setStyle;
if (!(THREE.Color.prototype as any).__soft) {   // patch once, even when several kit copies are bundled
  (THREE.Color.prototype as any).__soft = true;
  THREE.Color.prototype.setStyle = function (this: THREE.Color, style: string, cs?: any) {
    _setStyle.call(this, style, cs);
    return SOFT_KEEP.has(String(style).toLowerCase()) ? this : softenColor(this);
  } as any;
}
/** The Stage sky: SOFT.sky of the way toward a pale version of the same hue (navy night -> soft slate dusk). */
const softSky = (bg: string) => {
  if (!SOFT.on || !SOFT.sky) return bg;
  const c = new THREE.Color(); _setStyle.call(c, bg); c.getHSL(_hsl, THREE.SRGBColorSpace);
  const pale = new THREE.Color().setHSL(_hsl.h, Math.min(_hsl.s, 0.45) * 0.6, 0.92, THREE.SRGBColorSpace);
  return "#" + c.lerp(pale, SOFT.sky).getHexString();
};

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
  const sky = softSky(bg);   // soft look: lighter sky, and a soft haze when the shot sets none
  const haze: [string, number, number] | undefined = fog ? [fog[0].toLowerCase() === bg.toLowerCase() ? sky : fog[0], fog[1], fog[2]] : SOFT.on ? [sky, SOFT.haze[0], SOFT.haze[1]] : undefined;
  return (
    <AbsoluteFill style={{ background: sky }}>
      <ThreeCanvas width={width} height={height} shadows={{ type: THREE.PCFSoftShadowMap }} camera={{ fov: camera.fov || 38, position: camera.pos }}
        onCreated={({ camera: c }) => { c.lookAt(...look); }}>
        <CamSync pos={camera.pos} look={look} fov={camera.fov || 38} />
        <color attach="background" args={[sky]} />
        {haze ? <fog attach="fog" args={haze} /> : null}
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
  legs?: number;          // leg length factor (default 1); Cyclist uses 1.15 so a seated rider's feet reach the pedals
};
export type Expr = "neutral" | "joy" | "laugh" | "sad" | "cry" | "angry" | "surprised" | "fear";
export type Pose = {
  x?: number; z?: number; rotY?: number;     // where they stand and which way they face (radians, 0 = toward camera)
  armL?: number; armR?: number;              // arm raise in RADIANS: 0 down, 0.8 half forward, 1.57 straight forward, 2.4 up-forward, 3.0 straight up
  armLSide?: number; armRSide?: number;      // arm out to the side: 0 down at the side, 1 = about 55 deg out, 1.7 = straight out; negative swings it in front of the body
  elbowL?: number; elbowR?: number;          // elbow bend in radians (0 straight, 1.57 right angle, at most 2.4); a forearm never folds back past straight up (it looks broken)
  reachL?: Reach; reachR?: Reach;            // put the palm ON a spot and let the kit solve the arm (natural low elbow): "cheek" "mouth" "eyes" "chin" "ear" "head" "chest" "wave" "point", or [x, y, z] in the Toy's own frame (m, +z front, y from the feet). Use it whenever a hand touches the face or body.
  reachK?: number;                           // 0..1 blend from the arm angles to the reach (animate it with kf / kfA); default 1
  head?: number; tilt?: number;              // head turn (radians), nod/tilt
  mouth?: number;                            // 0 closed .. 1 open (use talk())
  walk?: number;                             // walk phase in seconds (0 = standing)
  lean?: number;                             // body lean forward (radians), pivots at the hips
  look?: number;                             // eyes look up (0..1)
  expr?: Expr; exprK?: number;               // facial expression and its strength 0..1 (default 1)
  crouch?: number;                           // 0 standing .. 1 deep knee bend (anticipation before a jump, crying squat)
  sit?: number;                              // 0 standing .. 1 sitting (thighs forward, shins down); lower the Toy to the seat yourself
  legL?: [number, number]; legR?: [number, number];   // direct [hip pitch, knee bend] in radians for one leg (negative hip = thigh forward); overrides walk/sit/crouch for that leg (used by Cyclist to keep feet on the pedals)
  y?: number;                                // lift off the ground (jumps)
  still?: boolean;                           // switch off automatic breathing, blinking and weight shift
};
/** Body measurements shared by Toy, Apron, AtHand, AtHead and handWorld (so props stay glued to hands). */
export function toyBody(spec: ToySpec) {
  const h = spec.height ?? 1, b = spec.build ?? 0.4;
  const legH = (spec.child ? 0.56 : 0.62) * h * (spec.legs ?? 1), bodyH = 0.7 * h, headS = 0.36;
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
/* ------------------------------------------------------------------ arms (fix 2026-11-22, docs/experiments/2026-11-22-arm-fix)
   Before, the help said "1.6 = arm up" while the angle is in radians (1.6 is only straight forward), so hands-to-face poses used too
   little raise and too much elbow, and the forearm folded back over the shoulder like a broken arm. Now: correct help, reach targets
   solved by search (like Cyclist's grips), and a guard that opens any elbow whose forearm would point back past straight up. */
export type Reach = "cheek" | "cheeks" | "mouth" | "eyes" | "chin" | "ear" | "head" | "chest" | "wave" | "point" | V3;   // no "hip": the arm has no twist joint, so hands on hips with elbows out cannot be posed
/** Palm and elbow of one arm in the Toy's own frame (no lean, no x/z/rotY) for raise r, side o, elbow e (same maths as the drawn arm). */
function armFK(B: ReturnType<typeof toyBody>, side: 1 | -1, r: number, o: number, e: number) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-r, 0, side * (0.06 + o * 0.9)));
  const S = new THREE.Vector3(side * B.shoulderX, B.shoulderY, 0), E = new THREE.Vector3(0, -0.27 * B.h, 0);
  const W = new THREE.Vector3(0, -0.22 * B.h - 0.03, 0.004).applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.12 - r * 0.05 - e).add(E);
  return { hand: W.applyQuaternion(q).add(S), elbow: E.clone().applyQuaternion(q).add(S) };
}
function reachPoint(B: ReturnType<typeof toyBody>, spec: ToySpec, s: 1 | -1, r: Reach): THREE.Vector3 {
  if (Array.isArray(r)) return new THREE.Vector3(r[0], r[1], r[2]);
  const R = spec.child ? 0.165 : 0.155, Y = B.legH + B.bodyH + B.headS * 0.62, fz = R * 0.95 + 0.035;   // fz: a palm in front of the face
  switch (r) {
    case "cheek": case "cheeks": return new THREE.Vector3(s * R * 0.8, Y - R * 0.5, fz * 0.75);
    case "mouth": return new THREE.Vector3(s * R * 0.12, Y - R * 0.42, fz);
    case "eyes": return new THREE.Vector3(s * R * 0.32, Y + R * 0.08, fz);
    case "chin": return new THREE.Vector3(s * R * 0.1, Y - R * 0.9, fz * 0.75);
    case "ear": return new THREE.Vector3(s * (R + 0.04), Y, 0.02);
    case "head": return new THREE.Vector3(s * R * 0.45, Y + R * 0.92, 0.02);
    case "chest": return new THREE.Vector3(s * 0.07, B.shoulderY - 0.14 * B.h, B.chest * B.depth + 0.09);
    case "wave": return new THREE.Vector3(s * (B.shoulderX + 0.16), Y + R * 0.5, 0.1);
    case "point": return new THREE.Vector3(s * B.shoulderX * 0.85, B.shoulderY + 0.02, 0.55 * B.h);
  }
  return new THREE.Vector3();
}
/** Where the elbow should go for some targets (hand on chest: elbow low and forward so the
    forearm crosses in front of the body). */
function elbowHint(B: ReturnType<typeof toyBody>, s: 1 | -1, r: Reach, T: THREE.Vector3): THREE.Vector3 | null {
  if (r === "chest") return new THREE.Vector3(s * (B.shoulderX + 0.05), B.shoulderY - 0.25 * B.h, 0.13);
  return null;
}
/** How far a point is inside the torso (0 = outside): the torso as an upright ellipse, chest wide, depth squashed. */
function insideTorso(B: ReturnType<typeof toyBody>, p: THREE.Vector3) {
  if (p.y < B.legH || p.y > B.shoulderY + 0.02) return 0;
  const u = Math.min(1, Math.max(0, (p.y - B.legH) / (B.shoulderY - B.legH))), w = u < 0.45 ? B.waist + (B.hip - B.waist) * (1 - u / 0.45) * 0.5 : B.waist + (B.chest - B.waist) * Math.min(1, (u - 0.45) / 0.35);
  const rx = w + 0.01, rz = w * B.depth + 0.01, k = (p.x / rx) ** 2 + (p.z / rz) ** 2;   // narrow at the waist, wide at the chest
  return Math.max(0, 1 - k);
}
const reachCache = new Map<string, [number, number, number]>();
/** Arm angles [raise, side, elbow] that put the palm on the target with a natural arm: elbow low, never behind the body or inside it. */
export function solveReach(spec: ToySpec, side: 1 | -1, target: Reach): [number, number, number] {
  const B = toyBody(spec), T = reachPoint(B, spec, side, target), H = Array.isArray(target) ? null : elbowHint(B, side, target, T);
  const key = `${B.h}|${B.b}|${spec.child ? 1 : 0}|${side}|${T.x.toFixed(3)},${T.y.toFixed(3)},${T.z.toFixed(3)}`;
  const hit = reachCache.get(key); if (hit) return hit;
  let best: [number, number, number] = [0, 0, 0], bd = 1e9;
  const test = (r: number, o: number, e: number) => {
    const { hand, elbow } = armFK(B, side, r, o, e);
    if (hand.y > elbow.y && hand.z < elbow.z - 0.01) return;                     // folded back: never
    const d = hand.distanceToSquared(T)
      + 0.01 * Math.max(0, elbow.y - B.shoulderY) ** 2                           // elbow above the shoulder only when it must be
      + 0.05 * Math.max(0, -0.03 - elbow.z) ** 2                                 // elbow behind the body
      + (elbow.z < 0.14 ? 0.03 * Math.max(0, B.shoulderX * 0.8 - side * elbow.x) ** 2 : 0)   // elbow inside the chest
      + 0.0004 * (o * o + 0.3 * r * r + 0.2 * e * e)                             // the simplest arm that gets there
      + (H ? 0.8 * elbow.distanceToSquared(H) : 0)                               // elbow where this target wants it
      + 0.2 * [0.25, 0.5, 0.7].reduce((a, u) => a + insideTorso(B, elbow.clone().lerp(hand, u)), 0) ** 2;   // forearm never through the body
    if (d < bd) { bd = d; best = [r, o, e]; } };
  for (let r = -0.3; r <= 3.1; r += 0.1) for (let o = -0.7; o <= 1.9; o += 0.1) for (let e = 0; e <= 2.4; e += 0.1) test(r, o, e);
  const [r0, o0, e0] = best;
  for (let r = r0 - 0.1; r <= r0 + 0.1; r += 0.025) for (let o = o0 - 0.1; o <= o0 + 0.1; o += 0.025) for (let e = Math.max(0, e0 - 0.1); e <= Math.min(2.4, e0 + 0.1); e += 0.025) test(r, o, e);
  reachCache.set(key, best); return best;
}
/** Final [raise, side, elbow] of one arm: the reach (blended by reachK) or the given angles, with a folded-back forearm opened up. */
export function resolveArm(spec: ToySpec, pose: Pose, side: 1 | -1): [number, number, number] {
  let r = (side === 1 ? pose.armR : pose.armL) || 0, o = (side === 1 ? pose.armRSide : pose.armLSide) || 0, e = (side === 1 ? pose.elbowR : pose.elbowL) || 0;
  const reach = side === 1 ? pose.reachR : pose.reachL;
  if (reach) { const k = Math.max(0, Math.min(1, pose.reachK ?? 1)), [rr, ro, re] = solveReach(spec, side, reach); r += (rr - r) * k; o += (ro - o) * k; e += (re - e) * k; }
  const B = toyBody(spec); e = Math.min(2.4, Math.max(0, e));
  for (let i = 0; i < 60 && e > 0; i++) { const { hand, elbow } = armFK(B, side, r, o, e); if (!(hand.y > elbow.y && hand.z < elbow.z - 0.01)) break; e = Math.max(0, e - 0.05); }
  return [r, o, e];
}
export const Toy: React.FC<{ spec: ToySpec; pose?: Pose }> = ({ spec, pose = {} }) => {
  keepColour(spec.skin);   // soft look never changes skin
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
    const ov = side === 1 ? pose.legR : pose.legL;                                         // direct leg angles (Cyclist)
    const swing = pose.walk ? step * side * 0.5 : 0;
    const kb = ov ? ov[1] : (pose.walk ? Math.max(0, -step * side) * 0.6 : 0.04) + crouch * 1.7 + sit * 1.45;     // knee bend (same as V4)
    const L2 = legH * 0.5, K = new THREE.Vector3(0, -L2, 0);
    const A = new THREE.Vector3(0, -(L2 - 0.06), 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), kb).add(K);
    const r0 = 0.078 + 0.02 * B.b;
    const thick = (u: number) => u < 0.5 ? r0 - u * (r0 - 0.058) * 2 : 0.058 - (u - 0.5) * 0.024;
    return <group position={[side * hip * 0.48, legH, 0]} rotation={[ov ? ov[0] : swing - crouch * 0.85 - sit * 1.5, 0, 0]}>
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
        {arm(1, ...resolveArm(spec, pose, 1))}{arm(-1, ...resolveArm(spec, pose, -1))}
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

export const Tree: React.FC<{ p: [number, number, number]; s?: number; c?: string }> = ({ p, s = 1, c = "#5f9a4a" }) => (
  <group position={p} scale={s}><mesh position={[0, 0.4, 0]} castShadow><cylinderGeometry args={[0.08, 0.12, 0.8, 6]} />{mat("#6e4a2e")}</mesh>
    <Ball r={0.55} p={[0, 1.15, 0]} s={[1, 1.15, 1]} c={c} d={0} /><Ball r={0.35} p={[0.3, 1.5, 0.1]} c={c} d={0} /></group>
);

export const Hill: React.FC<{ p: [number, number, number]; s?: [number, number, number]; c?: string }> = ({ p, s = [4, 1.2, 3], c = "#7fb55a" }) => (
  <mesh position={p} scale={s} receiveShadow castShadow><icosahedronGeometry args={[1, 1]} />{mat(c)}</mesh>
);

/* ------------------------------------------------------------------ people helpers (V5) */
/** A Toy sitting on a stool or chair: the stool plus the Toy in the sit pose (thighs forward, shins down). */
export const Seated: React.FC<{ spec: ToySpec; pose?: Pose; seatY?: number; stool?: string }> = ({ spec, pose = {}, seatY = 0.46, stool = "#8a5a34" }) => {
  const legH = toyBody(spec).legH, hip = seatY + 0.09;
  const inner: Pose = { ...pose, x: 0, z: 0, rotY: 0, walk: 0, sit: 1 };
  return <group position={[pose.x || 0, 0, pose.z || 0]} rotation={[0, pose.rotY || 0, 0]}>
    <Box s={[0.62, seatY, 0.5]} p={[0, seatY / 2, -0.02]} c={stool} />
    <Box s={[0.7, 0.06, 0.56]} p={[0, seatY + 0.01, -0.02]} c="#6e4a2e" />
    <group position={[0, hip - legH, 0]}><Toy spec={spec} pose={inner} /></group>
  </group>;
};
type V3 = [number, number, number];
const armEuler = (pose: Pose, side: 1 | -1, raise: number, out: number) => {
  const step = pose.walk ? Math.sin(pose.walk * 7) : 0;
  return new THREE.Euler(-raise - (pose.walk ? -step * side * 0.5 : 0), 0, side * (0.06 + out * 0.9));
};
/** Children placed in a Toy's hand (origin = the palm). side 1 = right hand (armR). Props stay glued to the hand. */
export const AtHand: React.FC<{ spec: ToySpec; pose: Pose; side: 1 | -1; children: React.ReactNode }> = ({ spec, pose, side, children }) => {
  const B = toyBody(spec), h = B.h, lean = (pose.lean || 0) + (pose.crouch || 0) * 0.35;
  const [ar, ao, ae] = resolveArm(spec, pose, side), eb = -0.12 - ar * 0.05 - ae - (pose.walk ? 0.25 : 0);
  return <group position={[pose.x || 0, pose.y || 0, pose.z || 0]} rotation={[0, pose.rotY || 0, 0]}><group position={leanPos(B.legH, lean)} rotation={[lean, 0, 0]}>
    <group position={[side * B.shoulderX, B.shoulderY, 0]} rotation={armEuler(pose, side, ar, ao)}><group position={[0, -0.27 * h, 0]} rotation={[eb, 0, 0]}>
      <group position={[0, -0.22 * h - 0.03, 0.004]}>{children}</group></group></group></group></group>;
};
/** Children placed on a Toy's head (origin = head centre, +z = face). */
export const AtHead: React.FC<{ spec: ToySpec; pose: Pose; children: React.ReactNode }> = ({ spec, pose, children }) => {
  const B = toyBody(spec), lean = (pose.lean || 0) + (pose.crouch || 0) * 0.35;
  return <group position={[pose.x || 0, pose.y || 0, pose.z || 0]} rotation={[0, pose.rotY || 0, 0]}><group position={leanPos(B.legH, lean)} rotation={[lean, 0, 0]}>
    <group position={[0, B.legH + B.bodyH + B.headS * 0.62, 0]} rotation={[pose.tilt || 0, pose.head || 0, 0]}>{children}</group></group></group>;
};
/** World position of a Toy's hand (for ropes, sticks and props that point from the hand to somewhere). */
export function handWorld(spec: ToySpec, pose: Pose, side: 1 | -1): V3 {
  const B = toyBody(spec), h = B.h, lean = (pose.lean || 0) + (pose.crouch || 0) * 0.35;
  const [ar, ao, ae] = resolveArm(spec, pose, side), eb = -0.12 - ar * 0.05 - ae - (pose.walk ? 0.25 : 0);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(pose.x || 0, pose.y || 0, pose.z || 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, pose.rotY || 0, 0)), new THREE.Vector3(1, 1, 1));
  m.multiply(new THREE.Matrix4().compose(new THREE.Vector3(...leanPos(B.legH, lean)), new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, 0, 0)), new THREE.Vector3(1, 1, 1)));
  m.multiply(new THREE.Matrix4().compose(new THREE.Vector3(side * B.shoulderX, B.shoulderY, 0), new THREE.Quaternion().setFromEuler(armEuler(pose, side, ar, ao)), new THREE.Vector3(1, 1, 1)));
  m.multiply(new THREE.Matrix4().compose(new THREE.Vector3(0, -0.27 * h, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(eb, 0, 0)), new THREE.Vector3(1, 1, 1)));
  const v = new THREE.Vector3(0, -0.22 * h - 0.03, 0.004).applyMatrix4(m); return [v.x, v.y, v.z];
}

/* ------------------------------------------------------------------ animals (real proportions, smooth) */
export type AnimalPose = { x?: number; y?: number; z?: number; rotY?: number; s?: number; walk?: number; head?: number; tilt?: number; flap?: number; shake?: number; puff?: number; beak?: number; roll?: number; tail?: number; swim?: number };
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

/* ------------------------------------------------------------------ animals by BODY PLAN (docs/experiments/2026-11-21-lego-animals)
   One builder per body plan; a new animal is a spec (proportions + 1-3 signature features), not new code:
   Quad (dog, cat, horse, cow, pig, elephant, giraffe, lion, bear, rabbit ...), Bird (penguin, owl, parrot ...), Fish, Turtle.
   Ready specs are in ANIMALS. Rules: pick the body plan; set proportions (toy rule: head and eyes a little bigger, muzzle a
   little shorter, legs keep their real length class); give it SIGNATURE features that read as a black silhouette (trunk,
   long neck, mane, horns, curly tail, long ears, face mask); colour pattern last. Legs are one smooth turned shape growing
   out of the body (no flat tops). */
const Cyl: React.FC<{ r1: number; r2: number; len: number; p?: V3; rot?: V3; c: string }> = ({ r1, r2, len, p = [0, 0, 0], rot = [0, 0, 0], c }) =>
  <mesh position={p} rotation={rot} castShadow receiveShadow><cylinderGeometry args={[r1, r2, len, 32]} />{mat(c)}</mesh>;
const Cone: React.FC<{ r: number; len: number; p?: V3; rot?: V3; s?: V3; c: string }> = ({ r, len, p = [0, 0, 0], rot = [0, 0, 0], s = [1, 1, 1], c }) =>
  <mesh position={p} rotation={rot} scale={s} castShadow receiveShadow><coneGeometry args={[r, len, 32]} />{mat(c)}</mesh>;
/** Big smooth ball (64 x 48): for bodies and bellies, so where two big shapes meet the edge is clean, not ragged. */
const Big: React.FC<{ r: number; p?: V3; s?: V3; c: string }> = ({ r, p = [0, 0, 0], s = [1, 1, 1], c }) =>
  <mesh position={p} scale={s} castShadow receiveShadow><sphereGeometry args={[r, 64, 48]} />{mat(c)}</mesh>;
/** Smooth turned shape (legs): like the kit's Lathe but with a fine profile (120 points), so long legs shade evenly. */
const Turned: React.FC<{ pts: [number, number][]; c: string }> = ({ pts, c }) => {
  const g = useMemo(() => new THREE.LatheGeometry(new THREE.SplineCurve([...pts].sort((a, b) => a[1] - b[1]).map(([r, y]) => new THREE.Vector2(Math.max(0.0005, r), y))).getPoints(120), 56), [JSON.stringify(pts)]);
  // profile must run bottom -> top, or the faces point inward and the leg renders inside-out (you see its back wall)
  return <mesh geometry={g} castShadow receiveShadow>{mat(c)}</mesh>;
};
/** Smooth tapered tube along a curve (trunks, tails, necks that bend): overlapping balls, radius r1 -> r2. */
const Taper: React.FC<{ pts: V3[]; r1: number; r2: number; c: string; n?: number }> = ({ pts, r1, r2, c, n: nMin = 12 }) => {
  const balls = useMemo(() => { const cv = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const n = Math.min(260, Math.max(nMin, Math.ceil(cv.getLength() / (Math.min(r1, r2) * 0.18))));   // spacing <= 0.35 x the thin end: reads as one smooth tube
    return Array.from({ length: n }, (_, i) => { const k = i / (n - 1), v = cv.getPoint(k); return [v.x, v.y, v.z, r1 + (r2 - r1) * k] as const; }); }, [JSON.stringify(pts), r1, r2, nMin]);
  return <>{balls.map(([x, y, z, r], i) => <Ball key={i} r={r} p={[x, y, z]} c={c} />)}</>;
};
/** Eye: dark pupil with a white glint; iris colour for cats and owls; white = cartoon white ring. */
const Eye: React.FC<{ p: V3; r: number; iris?: string; white?: boolean }> = ({ p, r, iris, white }) => <group position={p}>
  {white ? <Ball r={r * 1.3} s={[1, 1, 0.55]} c="#f4efe6" /> : null}
  {iris ? <Ball r={r} s={[1, 1, 0.6]} p={[0, 0, r * 0.25]} c={iris} /> : null}
  <Ball r={iris ? r * 0.55 : r} s={iris ? [1, 1, 0.6] : [1, 1, 1]} p={[0, 0, iris ? r * 0.5 : white ? r * 0.5 : 0]} c="#141210" />
  <Ball r={r * 0.28} p={[r * 0.3, r * 0.35, r * (iris || white ? 0.95 : 0.8)]} c="#ffffff" /></group>;
/** Point on an ellipsoid (radii rx, ry, rz) in direction d. Used to put spots and patches ON the body surface. */
const onBody = (d: V3, rx: number, ry: number, rz: number, k = 0.94): V3 => {
  const t = 1 / Math.sqrt((d[0] / rx) ** 2 + (d[1] / ry) ** 2 + (d[2] / rz) ** 2); return [d[0] * t * k, d[1] * t * k, d[2] * t * k];
};
const Patches: React.FC<{ seed: number; n: number; r: [number, number]; rx: number; ry: number; rz: number; c: string; minY?: number }> = ({ seed, n, r, rx, ry, rz, c, minY = -0.3 }) => {
  const list = useMemo(() => { const g = rng(seed); const out: [V3, number][] = [];
    for (let i = 0; out.length < n && i < n * 20; i++) { const d: V3 = [g() * 2 - 1, g() * 2 - 1, g() * 2 - 1]; if (d[1] < minY) continue; const rr = r[0] + g() * (r[1] - r[0]), q = onBody(d, rx, ry, rz, 1), L = Math.hypot(...q), k = 1 - (rr * 0.72) / L;
      out.push([[q[0] * k, q[1] * k, q[2] * k], rr]); } return out; }, [seed, n, rx, ry, rz]);
  return <>{list.map(([p, rr], i) => <Ball key={i} r={rr} p={p} c={c} />)}</>;
};

/* ------------------------------------------------------------------ QUAD: dog, cat, horse, cow, pig, elephant, giraffe, lion, bear, rabbit */
export type QuadSpec = {
  name: string; c: string; belly?: string; leg?: string;
  len: number; girth: number; tall?: number;            // body length (z), body width radius, body height factor
  legLen: number; legR: number; foot: "hoof" | "paw" | "pad"; footC?: string; sit?: boolean;
  neckLen: number; neckTilt: number; neckR?: number;    // tilt: 0 = straight up, 1.2 = almost forward
  head: number; headLong?: number; headC?: string;      // head radius, z stretch
  muzzle?: { len: number; r: number; c?: string; drop?: number }; nose?: string; snoutDisc?: string;
  eye?: { r?: number; iris?: string; white?: boolean; out?: number };
  ears: "floppy" | "pointy" | "round" | "long" | "horse" | "elephant" | "none"; earC?: string; earIn?: string; earSize?: number;
  tail: "thin" | "up" | "curly" | "bushy" | "tuft" | "puff" | "none"; tailC?: string; tailLen?: number;
  horns?: "cow" | "ossicones"; hornC?: string;
  mane?: { kind: "horse" | "lion"; c: string };
  trunk?: { len: number; r: number }; tusks?: boolean;
  pattern?: { kind: "spots" | "patches"; c: string; n: number; r: [number, number]; seed?: number };
  whiskers?: boolean;
};
export const Quad: React.FC<{ spec: QuadSpec; pose?: AnimalPose }> = ({ spec: S, pose = {} }) => {
  const rx = S.girth, ry = S.girth * (S.tall || 1), rz = S.len / 2;
  const bodyY = S.legLen + ry * 0.7, legC = S.leg || S.c, w = pose.walk ? Math.sin(pose.walk * 9) * 0.45 : 0;
  const legZ = rz * 0.6;
  // neck base on the front top of the body; head at the end of the neck
  const base: V3 = [0, bodyY + ry * 0.45, rz * 0.78];
  const dir: V3 = [0, Math.cos(S.neckTilt), Math.sin(S.neckTilt)];
  const hl = S.headLong || 1;
  const headP: V3 = S.neckLen > 0 ? [0, base[1] + dir[1] * S.neckLen + S.head * 0.3, base[2] + dir[2] * S.neckLen + S.head * 0.25]
    : [0, bodyY + ry * 0.35, rz + S.head * hl * 0.55];
  const hc = S.headC || S.c, eye = S.eye || {};
  const er = (eye.r || 0.17) * S.head;
  const mz = S.muzzle;
  return <group position={[pose.x || 0, pose.y || 0, pose.z || 0]} rotation={[0, pose.rotY || 0, 0]} scale={pose.s || 1}>
    {/* legs: the THIGH is a smooth taper (round ends, no flat cap) whose wide top sits INSIDE the body: its size comes
        from the body's real half-width at that leg (the body narrows toward the chest and rump). It narrows to a round
        knee; the shin ends exactly on the ground. Diagonal pairs swing together when walking. */}
    {[[1, legZ, 1], [-1, legZ, -1], [1, -legZ, -1], [-1, -legZ, 1]].map(([sx, z, ph], i) => {
      const front = z > 0, folded = S.sit && !front;
      const half = rx * Math.sqrt(Math.max(0.2, 1 - (z / rz) ** 2));                   // body half-width at this z
      const x = sx * half * 0.45, tR = Math.max(S.legR * 1.05, Math.min(S.legR * (front ? 1.7 : 2.0), half * 0.42));
      const kR = S.legR * (front ? 1.02 : 1.12), Lg = bodyY, thigh = ry * 1.05, shin = Lg - thigh;
      const foot = S.foot === "hoof" ? S.legLen * 0.12 : S.legR * 0.7;                  // height of the hoof or paw
      return <group key={i} position={[x, bodyY, z]} rotation={[folded ? -1.4 : w * ph, 0, 0]}>
        {/* the whole leg is ONE smooth turned shape: a round dome hidden in the body, the thigh tapering to the knee,
            the shin tapering to the ankle. No joints to show, no flat ends. */}
        <Turned c={legC} pts={[[0.001, ry * 0.05 + tR], [tR * 0.72, ry * 0.05 + tR * 0.7], [tR, ry * 0.05], [tR * 0.96, -thigh * 0.4],
          [kR + (tR - kR) * 0.35, -thigh * 0.75], [kR, -thigh], [kR * 0.97, -thigh - shin * 0.3], [S.legR * 0.88, -thigh - shin * 0.65], [S.legR * 0.8, -Lg + foot], [S.legR * 0.72, -Lg + foot * 0.5], [0.001, -Lg + foot * 0.3]]} />{/* ends inside the hoof / paw */}
        {S.foot === "hoof" ? <Cyl r1={S.legR * 0.7} r2={S.legR * 0.92} len={foot} p={[0, -Lg + foot / 2, 0]} c={S.footC || "#2a2420"} />
          : <Ball r={S.legR * (S.foot === "pad" ? 1.25 : 1.15)} p={[0, -Lg + S.legR * 0.55, S.legR * 0.45]} s={[1, 0.62, 1.3]} c={S.footC || legC} />}
      </group>; })}
    {/* body */}
    <group position={[0, bodyY, 0]} rotation={[S.sit ? -0.45 : 0, 0, 0]}>
      <Big r={1} s={[rx, ry, rz]} c={S.c} />
      {S.belly ? <Big r={1} p={[0, -ry * 0.3, rz * 0.04]} s={[rx * 0.8, ry * 0.76, rz * 0.86]} c={S.belly} /> : null}
      {S.pattern ? <Patches seed={S.pattern.seed || 3} n={S.pattern.n} r={S.pattern.r} rx={rx} ry={ry} rz={rz} c={S.pattern.c} /> : null}
      {/* tail from the rump */}
      <group position={[0, ry * 0.35, -rz * 0.95]} rotation={[pose.tail || 0, 0, 0]}>
        {S.tail === "thin" || S.tail === "tuft" ? <Taper pts={[[0, 0, 0], [0, -(S.tailLen || 0.4) * 0.3, -(S.tailLen || 0.4) * 0.35], [0, -(S.tailLen || 0.4) * 0.85, -(S.tailLen || 0.4) * 0.45]]} r1={S.legR * 0.42} r2={S.legR * 0.25} c={S.tailC || S.c} /> : null}
        {S.tail === "up" ? <Taper pts={[[0, 0, 0], [0, (S.tailLen || 0.4) * 0.15, -(S.tailLen || 0.4) * 0.35], [0, (S.tailLen || 0.4) * 0.6, -(S.tailLen || 0.4) * 0.5], [0, (S.tailLen || 0.4) * 0.85, -(S.tailLen || 0.4) * 0.3]]} r1={S.legR * 0.5} r2={S.legR * 0.38} c={S.tailC || S.c} /> : null}
        {S.tail === "tuft" ? <Ball r={S.legR * 0.75} p={[0, -(S.tailLen || 0.4) * 0.9, -(S.tailLen || 0.4) * 0.46]} s={[1, 1.5, 1]} c={S.mane?.c || S.tailC || "#3a2a20"} /> : null}
        {S.tail === "bushy" ? <Taper pts={[[0, 0, 0], [0, 0.05, -(S.tailLen || 0.4) * 0.5], [0, -(S.tailLen || 0.4) * 0.35, -(S.tailLen || 0.4) * 0.95]]} r1={S.legR * 0.6} r2={S.legR * 1.15} c={S.tailC || S.c} n={24} /> : null}
        {S.tail === "curly" ? <mesh position={[0, 0.0, -0.04]} rotation={[0, Math.PI / 2, 0]} castShadow><torusGeometry args={[S.legR * 0.9, S.legR * 0.28, 16, 40, Math.PI * 1.6]} />{mat(S.tailC || S.c)}</mesh> : null}
        {S.tail === "puff" ? <Ball r={S.legR * 1.6} p={[0, 0, -0.02]} c={S.tailC || "#f4f1ea"} /> : null}
      </group>
    </group>
    {/* neck */}
    {S.neckLen > 0 ? <Pill r={S.neckR || S.head * 0.55} len={S.neckLen} p={[0, base[1] + dir[1] * S.neckLen / 2, base[2] + dir[2] * S.neckLen / 2]} rot={[S.neckTilt, 0, 0]} c={S.c} /> : null}
    {S.mane?.kind === "horse" ? Array.from({ length: 9 }, (_, i) => { const k = i / 8, nr = S.neckR || S.head * 0.55;
      return <Ball key={"m" + i} r={nr * 0.55} p={[0, base[1] + dir[1] * S.neckLen * k + Math.sin(S.neckTilt) * nr * 0.85, base[2] + dir[2] * S.neckLen * k - Math.cos(S.neckTilt) * nr * 0.85]} s={[0.55, 1.1, 1]} c={S.mane!.c} />; }) : null}
    {/* head */}
    <group position={headP} rotation={[pose.tilt || 0, pose.head || 0, 0]}>
      {S.mane?.kind === "lion" ? Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2;
        return <Ball key={"l" + i} r={S.head * 0.55} p={[Math.cos(a) * S.head * 0.95, Math.sin(a) * S.head * 0.95, -S.head * 0.35]} s={[1, 1, 0.8]} c={S.mane!.c} />; }) : null}
      {S.mane?.kind === "lion" ? <Ball r={S.head * 1.05} p={[0, 0, -S.head * 0.55]} c={S.mane.c} /> : null}
      <Ball r={S.head} s={[1, 1, hl]} c={hc} />
      {S.mane?.kind === "horse" ? <Ball r={S.head * 0.4} p={[0, S.head * 0.82, S.head * hl * 0.45]} s={[0.8, 0.5, 1.1]} c={S.mane.c} /> : null}
      {/* muzzle + nose */}
      {mz ? <group position={[0, -S.head * (mz.drop ?? 0.25), S.head * hl * 0.78]}>
        <Ball r={mz.r} s={[1, 0.85, mz.len / mz.r]} p={[0, 0, mz.len * 0.45]} c={mz.c || hc} />
        {S.snoutDisc ? <Cyl r1={mz.r * 0.78} r2={mz.r * 0.78} len={mz.r * 0.25} p={[0, 0, mz.len * 0.45 + mz.len * 0.98]} rot={[Math.PI / 2, 0, 0]} c={S.snoutDisc} /> : null}
        {S.snoutDisc ? [1, -1].map((s) => <Ball key={s} r={mz.r * 0.13} p={[s * mz.r * 0.3, 0, mz.len * 0.45 + mz.len * 1.1]} c="#5a2f33" />) : null}
        {S.nose ? <Ball r={mz.r * 0.38} p={[0, mz.r * 0.35, mz.len * 0.45 + mz.len * 0.92]} s={[1.3, 0.85, 0.9]} c={S.nose} /> : null}
        {S.whiskers ? [1, -1].flatMap((s) => [0.12, -0.05].map((dy, j) => <Cyl key={s + "w" + j} r1={0.0025} r2={0.0015} len={S.head * 0.9} p={[s * mz.r * 1.15, dy * mz.r, mz.len * 0.9]} rot={[0, 0, s * (Math.PI / 2 - 0.15 + j * 0.25)]} c="#f6f2ea" />)) : null}
      </group> : null}
      {/* eyes: front-facing for cats/dogs/lions, more to the side for prey animals (eye.out) */}
      {[1, -1].map((s) => { const o = eye.out ?? 0.55; return <Eye key={"e" + s} p={[s * S.head * o, S.head * 0.28, S.head * hl * Math.sqrt(Math.max(0.05, 1 - o * o)) * 0.92]} r={er} iris={eye.iris} white={eye.white} />; })}
      {/* ears */}
      {[1, -1].map((s) => { const es = S.earSize || 1, ec = S.earC || hc;
        if (S.ears === "pointy") return <group key={"k" + s}><Cone r={S.head * 0.32 * es} len={S.head * 0.62 * es} p={[s * S.head * 0.55, S.head * 0.88, 0]} rot={[0, 0, -s * 0.35]} s={[1, 1, 0.55]} c={ec} />
          {S.earIn ? <Cone r={S.head * 0.2 * es} len={S.head * 0.4 * es} p={[s * S.head * 0.53, S.head * 0.86, S.head * 0.09]} rot={[0, 0, -s * 0.35]} s={[1, 1, 0.3]} c={S.earIn} /> : null}</group>;
        if (S.ears === "horse") return <Cone key={"k" + s} r={S.head * 0.2 * es} len={S.head * 0.6 * es} p={[s * S.head * 0.42, S.head * 0.95, -S.head * 0.15]} rot={[-0.2, 0, -s * 0.25]} s={[1, 1, 0.6]} c={ec} />;
        if (S.ears === "floppy") return <Ball key={"k" + s} r={S.head * 0.42 * es} p={[s * S.head * 0.92, S.head * 0.05, -S.head * 0.05]} s={[0.35, 1.25, 0.8]} c={ec} />;
        if (S.ears === "round") return <group key={"k" + s}><Ball r={S.head * 0.3 * es} p={[s * S.head * 0.66, S.head * 0.78, -S.head * 0.1]} s={[1, 1, 0.5]} c={ec} />
          {S.earIn ? <Ball r={S.head * 0.17 * es} p={[s * S.head * 0.66, S.head * 0.78, -S.head * 0.03]} s={[1, 1, 0.4]} c={S.earIn} /> : null}</group>;
        if (S.ears === "long") return <group key={"k" + s} position={[s * S.head * 0.32, S.head * 0.8, -S.head * 0.1]} rotation={[-0.15, 0, -s * 0.12]}>
          <Pill r={S.head * 0.2 * es} len={S.head * 1.3 * es} p={[0, S.head * 0.85 * es, 0]} s={[1, 1, 0.45]} c={ec} />
          {S.earIn ? <Pill r={S.head * 0.12 * es} len={S.head * 1.1 * es} p={[0, S.head * 0.85 * es, S.head * 0.05]} s={[1, 1, 0.3]} c={S.earIn} /> : null}</group>;
        if (S.ears === "elephant") return <Ball key={"k" + s} r={S.head * 0.95 * es} p={[s * S.head * 0.95, S.head * 0.0, -S.head * 0.25]} s={[0.16, 1.05, 0.9]} c={ec} />;
        return null; })}
      {/* horns */}
      {S.horns === "cow" ? [1, -1].map((s) => <group key={"h" + s} position={[s * S.head * 0.55, S.head * 0.8, -S.head * 0.15]} rotation={[0, 0, -s * 1.0]}>
        <Taper pts={[[0, 0, 0], [0, S.head * 0.3, 0], [s * -S.head * 0.12, S.head * 0.52, S.head * 0.05]]} r1={S.head * 0.11} r2={S.head * 0.05} c={S.hornC || "#efe3c8"} n={14} /></group>) : null}
      {S.horns === "ossicones" ? [1, -1].map((s) => <group key={"o" + s}><Cyl r1={S.head * 0.09} r2={S.head * 0.11} len={S.head * 0.55} p={[s * S.head * 0.32, S.head * 1.1, -S.head * 0.2]} rot={[-0.2, 0, -s * 0.12]} c={S.c} />
        <Ball r={S.head * 0.14} p={[s * S.head * 0.36, S.head * 1.38, -S.head * 0.26]} c={S.hornC || "#3a2a1e"} /></group>) : null}
      {/* trunk + tusks */}
      {S.trunk ? <Taper pts={[[0, -S.head * 0.15, S.head * hl * 0.8], [0, -S.head * 0.55, S.head * hl * 0.8 + S.trunk.len * 0.25], [0, -S.head * 0.55 - S.trunk.len * 0.55, S.head * hl * 0.8 + S.trunk.len * 0.3], [0, -S.head * 0.6 - S.trunk.len * 0.85, S.head * hl * 0.8 + S.trunk.len * 0.42]]} r1={S.trunk.r} r2={S.trunk.r * 0.55} c={hc} n={36} /> : null}
      {S.tusks ? [1, -1].map((s) => <Cone key={"t" + s} r={S.head * 0.07} len={S.head * 0.55} p={[s * S.head * 0.3, -S.head * 0.55, S.head * hl * 0.85]} rot={[2.3, 0, 0]} c="#f3ecdc" />) : null}
    </group>
  </group>;
};

/* ------------------------------------------------------------------ BIRD: penguin, owl, parrot (duck and rooster stay in the kit) */
export type BirdSpec = {
  name: string; c: string; belly?: string; wingC?: string; beak: string; legs: string;
  size: number; upright: number;                         // body length; 0 = level like a duck, 1 = standing like a penguin
  head: number; neck?: number; beakLen: number; hook?: boolean;
  eye?: { r?: number; iris?: string }; face?: string; tufts?: boolean; crest?: string;
  wings: "flipper" | "folded"; tail: "short" | "long" | "fan"; tailC?: string; legLen: number; feet?: string;
};
export const Bird: React.FC<{ spec: BirdSpec; pose?: AnimalPose }> = ({ spec: S, pose = {} }) => {
  const L = S.size, lean = (1 - S.upright) * 1.15, w = pose.walk ? Math.sin(pose.walk * 12) : 0;
  const bodyY = S.legLen + L * 0.42;
  const top: V3 = [0, bodyY + Math.cos(lean) * L * 0.42, Math.sin(lean) * L * 0.42];
  const hp: V3 = [0, top[1] + (S.neck || 0) + S.head * 0.6, top[2] + S.head * 0.15];
  const er = (S.eye?.r || 0.2) * S.head;
  return <group position={[pose.x || 0, pose.y || 0, pose.z || 0]} rotation={[0, pose.rotY || 0, w * 0.08]} scale={pose.s || 1}>
    {[1, -1].map((s) => <group key={s} position={[s * L * 0.14, S.legLen, 0.0]} rotation={[w * s * 0.5, 0, 0]}>
      <Cyl r1={L * 0.035} r2={L * 0.03} len={S.legLen} p={[0, -S.legLen / 2, 0]} c={S.legs} />
      <Ball r={L * 0.08} p={[0, -S.legLen + 0.006, L * 0.05]} s={[0.9, 0.2, 1.3]} c={S.feet || S.legs} /></group>)}
    <group position={[0, bodyY, 0]} rotation={[lean, 0, 0]}>
      <Big r={L * 0.5} s={[0.78, 1, 0.72]} c={S.c} />
      {S.belly ? <Big r={L * 0.42} p={[0, -L * 0.06, L * 0.2]} s={[0.6, 0.9, 0.45]} c={S.belly} /> : null}
      {[1, -1].map((s) => <group key={"w" + s} position={[s * L * 0.37, L * 0.1, -L * 0.02]} rotation={[0.1, 0, s * (0.08 + (pose.flap || 0) * 1.2)]}>
        {S.wings === "flipper" ? <Ball r={L * 0.28} p={[s * L * 0.02, -L * 0.12, 0]} s={[0.14, 1, 0.42]} c={S.wingC || S.c} />
          : <Ball r={L * 0.3} p={[s * L * 0.01, -L * 0.06, -L * 0.06]} s={[0.22, 0.9, 0.62]} c={S.wingC || S.c} />}</group>)}
      {/* tail */}
      {S.tail === "long" ? <group position={[0, -L * 0.42, -L * 0.18]} rotation={[-0.45, 0, 0]}><Pill r={L * 0.07} len={L * 0.9} p={[0, -L * 0.45, 0]} s={[1.3, 1, 0.35]} c={S.tailC || S.c} /></group> : null}
      {S.tail === "short" ? <Ball r={L * 0.12} p={[0, -L * 0.45, -L * 0.2]} s={[1.2, 0.8, 0.5]} c={S.tailC || S.c} /> : null}
      {S.tail === "fan" ? [-0.4, 0, 0.4].map((a, i) => <Ball key={i} r={L * 0.13} p={[Math.sin(a) * L * 0.12, -L * 0.48, -L * 0.25]} s={[0.5, 1.4, 0.25]} c={S.tailC || S.c} />) : null}
    </group>
    {S.neck ? <Pill r={S.head * 0.6} len={S.neck} p={[0, top[1] + S.neck / 2, top[2]]} c={S.c} /> : null}
    <group position={hp} rotation={[pose.tilt || 0, pose.head || 0, 0]}>
      <Big r={S.head} c={S.c} />
      {S.face ? <Big r={S.head} p={[0, S.head * 0.02, S.head * 0.5]} s={[0.78, 0.8, 0.55]} c={S.face} /> : null}{/* face mask: the front of the head in a lighter colour */}
      {S.tufts ? [1, -1].map((s) => <Cone key={"u" + s} r={S.head * 0.22} len={S.head * 0.55} p={[s * S.head * 0.55, S.head * 0.95, -S.head * 0.05]} rot={[0, 0, -s * 0.45]} s={[1, 1, 0.5]} c={S.c} />) : null}
      {S.crest ? [0, 1, 2].map((i) => <Ball key={"c" + i} r={S.head * 0.22} p={[0, S.head * (0.95 + i * 0.12), -S.head * (0.1 + i * 0.25)]} s={[0.45, 1.1, 0.8]} c={S.crest!} />) : null}
      {/* beak: a cone, hooked = upper beak curves down over the lower */}
      {S.hook ? <group position={[0, -S.head * 0.12, S.head * 0.86]}>
        <Ball r={S.beakLen * 0.55} p={[0, 0, S.beakLen * 0.25]} s={[0.72, 0.9, 1]} c={S.beak} />{/* round upper beak */}
        <Cone r={S.beakLen * 0.28} len={S.beakLen * 0.6} p={[0, -S.beakLen * 0.45, S.beakLen * 0.62]} rot={[Math.PI - 0.5, 0, 0]} s={[0.75, 1, 1]} c={S.beak} />{/* hooked tip */}
        <Ball r={S.beakLen * 0.32} p={[0, -S.beakLen * 0.38, S.beakLen * 0.18]} s={[0.8, 0.7, 1]} c="#2a2624" /></group>
        : <Cone r={S.head * 0.24} len={S.beakLen} p={[0, -S.head * 0.12, S.head * 0.88 + S.beakLen * 0.45]} rot={[Math.PI / 2, 0, 0]} s={[1, 1, 0.7]} c={S.beak} />}
      {[1, -1].map((s) => <Eye key={"e" + s} p={[s * S.head * (S.face ? 0.32 : 0.52), S.head * 0.18, S.head * (S.face ? 0.95 : 0.72)]} r={er} iris={S.eye?.iris} />)}
    </group>
  </group>;
};

/* ------------------------------------------------------------------ FISH and TURTLE */
export type FishSpec = { name: string; c: string; belly?: string; fin: string; stripe?: string; len: number; deep: number };
export const Fish: React.FC<{ spec: FishSpec; pose?: AnimalPose }> = ({ spec: S, pose = {} }) => {
  const L = S.len, sw = pose.swim ? Math.sin(pose.swim * 10) * 0.35 : 0;
  const prof: [number, number][] = [[0.001, -L * 0.5], [S.deep * 0.25, -L * 0.42], [S.deep * 0.45, -L * 0.2], [S.deep * 0.5, 0], [S.deep * 0.42, L * 0.2], [S.deep * 0.22, L * 0.4], [S.deep * 0.08, L * 0.48], [0.001, L * 0.5]];
  return <group position={[pose.x || 0, pose.y || 0, pose.z || 0]} rotation={[0, (pose.rotY || 0), 0]} scale={pose.s || 1}>
    <group rotation={[-Math.PI / 2, 0, 0]}>{/* lathe is along y: turn it so the head points +z */}
      <group scale={[0.55, 1, 1]}><Lathe pts={prof} c={S.c} /></group>
    </group>
    {S.stripe ? [-0.12, 0.08].map((z, i) => <Ball key={i} r={S.deep * 0.47} p={[0, 0, z * L]} s={[0.29, 1.02, 0.12]} c={S.stripe!} />) : null}
    {S.belly ? <Ball r={S.deep * 0.4} p={[0, -S.deep * 0.18, L * 0.05]} s={[0.5, 0.55, 1.6]} c={S.belly} /> : null}
    <group position={[0, 0, -L * 0.48]} rotation={[0, sw, 0]}>{/* tail fin */}
      {[1, -1].map((s) => <Ball key={s} r={S.deep * 0.42} p={[0, s * S.deep * 0.26, -S.deep * 0.3]} s={[0.1, 0.8, 0.55]} c={S.fin} />)}</group>
    <Ball r={S.deep * 0.35} p={[0, S.deep * 0.5, -L * 0.05]} s={[0.08, 0.7, 1.1]} c={S.fin} />{/* back fin */}
    {[1, -1].map((s) => <Ball key={"p" + s} r={S.deep * 0.18} p={[s * S.deep * 0.28, -S.deep * 0.12, L * 0.12]} s={[0.15, 0.6, 1]} c={S.fin} />)}
    {[1, -1].map((s) => <Eye key={"e" + s} p={[s * S.deep * 0.22, S.deep * 0.1, L * 0.32]} r={S.deep * 0.09} white />)}
  </group>;
};
export type TurtleSpec = { name: string; shell: string; plate: string; skin: string; len: number };
export const Turtle: React.FC<{ spec: TurtleSpec; pose?: AnimalPose }> = ({ spec: S, pose = {} }) => {
  const L = S.len, w = pose.walk ? Math.sin(pose.walk * 6) * 0.35 : 0;
  const plates = useMemo(() => { const out: V3[] = [[0, 1, 0]]; for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; out.push([Math.cos(a) * 0.62, 0.62, Math.sin(a) * 0.62]); } return out; }, []);
  return <group position={[pose.x || 0, pose.y || 0, pose.z || 0]} rotation={[0, pose.rotY || 0, 0]} scale={pose.s || 1}>
    {[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sz], i) => <group key={i} position={[sx * L * 0.3, L * 0.1, sz * L * 0.26]} rotation={[w * sx * sz, sx * sz * 0.4, 0]}>
      <Ball r={L * 0.1} p={[sx * L * 0.06, -L * 0.03, sz * L * 0.04]} s={[1.3, 0.7, 1]} c={S.skin} /></group>)}
    <group position={[0, L * 0.12, 0]}>
      <Ball r={L * 0.5} s={[0.85, 0.55, 1]} p={[0, 0, 0]} c={S.shell} />
      {plates.map((d, i) => <Ball key={i} r={L * 0.13} p={onBody(d, L * 0.425, L * 0.275, L * 0.5, 0.98)} s={[1, 0.45, 1]} c={S.plate} />)}
      <Cyl r1={L * 0.43} r2={L * 0.43} len={L * 0.05} p={[0, -L * 0.02, 0]} c={S.plate} />{/* shell rim */}
    </group>
    <Pill r={L * 0.1} len={L * 0.18} p={[0, L * 0.17, L * 0.5]} rot={[1.2, 0, 0]} c={S.skin} />
    <group position={[0, L * 0.24, L * 0.64]} rotation={[pose.tilt || 0, pose.head || 0, 0]}>
      <Ball r={L * 0.13} s={[0.9, 0.85, 1.15]} c={S.skin} />
      {[1, -1].map((s) => <Eye key={s} p={[s * L * 0.075, L * 0.04, L * 0.08]} r={L * 0.022} />)}
    </group>
    <Ball r={L * 0.06} p={[0, L * 0.1, -L * 0.52]} s={[0.7, 0.6, 1.3]} c={S.skin} />
  </group>;
};

/* ------------------------------------------------------------------ preset animals (docs/experiments/2026-11-21-lego-animals) */
/** Ready specs: <Quad spec={ANIMALS.horse} />, or change one: <Quad spec={{ ...ANIMALS.dog, c: "#222" }} />. */
export const ANIMALS = {
  dog: { name: "Dog", c: "#c98a4b", belly: "#f0dcc0", len: 0.62, girth: 0.17, tall: 1.05, legLen: 0.24, legR: 0.045, foot: "paw", neckLen: 0.1, neckTilt: 0.55, head: 0.13, headLong: 1.0,
    muzzle: { len: 0.1, r: 0.07, c: "#f0dcc0" }, nose: "#1e1714", eye: { r: 0.17, white: true, out: 0.42 }, ears: "floppy", earC: "#8a5428", tail: "thin", tailLen: 0.3 } as QuadSpec,
  cat: { name: "Cat", c: "#8a8f99", belly: "#e9e6e0", len: 0.62, girth: 0.11, tall: 1.05, legLen: 0.22, legR: 0.029, foot: "paw", neckLen: 0.07, neckTilt: 0.4, neckR: 0.06, head: 0.098, headLong: 0.9,
    muzzle: { len: 0.03, r: 0.045, c: "#e9e6e0", drop: 0.38 }, nose: "#d98a8f", eye: { r: 0.21, iris: "#8fbf3a", out: 0.38 }, ears: "pointy", earSize: 1.25, earIn: "#e7a9ad", tail: "up", tailLen: 0.3, whiskers: true,
    pattern: { kind: "patches", c: "#5c616b", n: 9, r: [0.03, 0.045], seed: 4 } } as QuadSpec,
  horse: { name: "Horse", c: "#8a4f2a", leg: "#7a4424", len: 1.0, girth: 0.23, tall: 1.12, legLen: 0.6, legR: 0.062, foot: "hoof", neckLen: 0.4, neckTilt: 0.5, neckR: 0.12, head: 0.145, headLong: 1.55,
    muzzle: { len: 0.1, r: 0.105, c: "#6e3c20", drop: 0.4 }, eye: { r: 0.15, out: 0.8 }, ears: "horse", earSize: 1.1, tail: "bushy", tailC: "#2a1a12", tailLen: 0.5, mane: { kind: "horse", c: "#2a1a12" } } as QuadSpec,
  cow: { name: "Cow", c: "#f2efe8", leg: "#f2efe8", len: 1.0, girth: 0.27, tall: 1.05, legLen: 0.42, legR: 0.06, foot: "hoof", neckLen: 0.12, neckTilt: 1.05, neckR: 0.15, head: 0.15, headLong: 1.15,
    muzzle: { len: 0.12, r: 0.11, c: "#e7a8a8", drop: 0.3 }, eye: { r: 0.17, out: 0.7, white: true }, ears: "floppy", earSize: 0.75, horns: "cow", tail: "tuft", tailLen: 0.5, mane: undefined,
    pattern: { kind: "patches", c: "#1f1c1b", n: 9, r: [0.07, 0.12], seed: 7 } } as QuadSpec,
  pig: { name: "Pig", c: "#efa8ad", len: 0.7, girth: 0.22, tall: 1.0, legLen: 0.14, legR: 0.045, foot: "hoof", footC: "#c97a80", neckLen: 0, neckTilt: 0, head: 0.15, headLong: 0.95,
    muzzle: { len: 0.07, r: 0.075, drop: 0.12 }, snoutDisc: "#f7c3c6", eye: { r: 0.12, out: 0.55 }, ears: "pointy", earSize: 0.9, tail: "curly" } as QuadSpec,
  elephant: { name: "Elephant", c: "#8e959c", len: 1.25, girth: 0.42, tall: 1.0, legLen: 0.45, legR: 0.13, foot: "pad", footC: "#b9bec2", neckLen: 0, neckTilt: 0, head: 0.3, headLong: 0.95,
    eye: { r: 0.09, out: 0.7 }, ears: "elephant", tail: "tuft", tailLen: 0.5, trunk: { len: 0.6, r: 0.075 }, tusks: true } as QuadSpec,
  giraffe: { name: "Giraffe", c: "#e6b45c", leg: "#e6b45c", len: 0.95, girth: 0.21, tall: 1.05, legLen: 0.95, legR: 0.045, foot: "hoof", neckLen: 1.05, neckTilt: 0.32, neckR: 0.07, head: 0.11, headLong: 1.3,
    muzzle: { len: 0.13, r: 0.07, c: "#d9a453", drop: 0.25 }, eye: { r: 0.18, out: 0.72, white: true }, ears: "horse", horns: "ossicones", tail: "tuft", tailLen: 0.5, mane: { kind: "horse", c: "#8a5a2a" },
    pattern: { kind: "spots", c: "#9a5a22", n: 26, r: [0.04, 0.065], seed: 11 } } as QuadSpec,
  lion: { name: "Lion", c: "#d9a14c", belly: "#ebc68a", len: 0.95, girth: 0.22, tall: 1.05, legLen: 0.36, legR: 0.065, foot: "paw", neckLen: 0.06, neckTilt: 0.7, head: 0.17, headLong: 0.95,
    muzzle: { len: 0.07, r: 0.09, c: "#ebc68a", drop: 0.3 }, nose: "#5a3324", eye: { r: 0.14, iris: "#c98a1e", out: 0.42 }, ears: "round", tail: "tuft", tailLen: 0.6, mane: { kind: "lion", c: "#8a4a1c" } } as QuadSpec,
  bear: { name: "Bear", c: "#6b4428", len: 0.85, girth: 0.3, tall: 1.05, legLen: 0.26, legR: 0.09, foot: "paw", neckLen: 0, neckTilt: 0, head: 0.2, headLong: 0.95,
    muzzle: { len: 0.09, r: 0.095, c: "#b98a5e", drop: 0.25 }, nose: "#1a1210", eye: { r: 0.11, out: 0.45 }, ears: "round", earIn: "#8a5a3a", tail: "puff", tailC: "#6b4428" } as QuadSpec,
  rabbit: { name: "Rabbit", c: "#d8cfc2", belly: "#f6f2ea", len: 0.36, girth: 0.13, tall: 1.05, legLen: 0.07, legR: 0.04, foot: "pad", footC: "#f6f2ea", sit: true, neckLen: 0, neckTilt: 0, head: 0.11, headLong: 0.95,
    muzzle: { len: 0.03, r: 0.045, c: "#f6f2ea", drop: 0.3 }, nose: "#e48a92", eye: { r: 0.2, out: 0.62 }, ears: "long", earIn: "#efb6bb", tail: "puff", whiskers: true } as QuadSpec,
  penguin: { name: "Penguin", c: "#1f2328", belly: "#f6f4ee", beak: "#f2a03a", legs: "#f2a03a", size: 0.55, upright: 1, head: 0.12, beakLen: 0.08, wings: "flipper", tail: "short", legLen: 0.04 } as BirdSpec,
  owl: { name: "Owl", c: "#8a6440", belly: "#d9c29a", beak: "#3a2a1c", legs: "#c9a36a", size: 0.45, upright: 0.92, head: 0.14, beakLen: 0.05, hook: true, eye: { r: 0.3, iris: "#f2c22e" }, face: "#e6d3b0",
    tufts: true, wings: "folded", wingC: "#6e4e30", tail: "short", legLen: 0.06 } as BirdSpec,
  parrot: { name: "Parrot", c: "#d8352a", belly: "#e4482e", wingC: "#2f7fd0", beak: "#f1ead6", legs: "#5a5550", size: 0.36, upright: 0.7, head: 0.1, neck: 0.03, beakLen: 0.085, hook: true, eye: { r: 0.17, iris: "#f4efe6" },
    face: "#f4efe6", wings: "folded", tail: "long", tailC: "#2f7fd0", legLen: 0.08 } as BirdSpec,
  fish: { name: "Fish", c: "#f28a2e", fin: "#f7b05e", stripe: "#f8f4ec", len: 0.6, deep: 0.3 } as FishSpec,
  turtle: { name: "Turtle", shell: "#4f7a3a", plate: "#6f9a4a", skin: "#93b56a", len: 0.6 } as TurtleSpec,
};

/* ------------------------------------------------------------------ ready-made models from the model library (library/models/index.json)
   Everyday objects (trees, rocks, houses, cars, buses, trains, boats, bicycles...) come from free CC0 kits, not loose shapes:
   <KitModel file="models/quaternius/bus.obj" h={3} body="#d8402e" flip />  (copy file, h, body, flip from the catalog entry).
   It waits for the file before the frame is drawn, sizes it to h metres tall (a kit person is 1.75), stands it on the ground centred
   at p, and repaints it in the Lego V5 satin plastic keeping the kit's colours. tools/render.sh copies every models/... file a shot
   names into the video's assets, so write the path as a plain string. (docs/experiments/2026-11-21-lego-objects) */
const modelCache = new Map<string, Promise<THREE.Object3D>>();
function loadModel(file: string) {
  if (!modelCache.has(file)) modelCache.set(file, new Promise((ok, fail) => {
    if (file.endsWith(".obj")) {
      new MTLLoader().load(staticFile(file.replace(/\.obj$/, ".mtl")), (m) => { m.preload(); new OBJLoader().setMaterials(m).load(staticFile(file), ok, undefined, fail); }, undefined,
        () => new OBJLoader().load(staticFile(file), ok, undefined, fail));
    } else loadGltf(file).then((g) => ok(g.scene), fail);
  }));
  return modelCache.get(file)!;
}
const gltfCache = new Map<string, Promise<any>>();
function loadGltf(file: string) {
  if (!gltfCache.has(file)) gltfCache.set(file, new Promise((ok, fail) => new GLTFLoader().load(staticFile(file), ok, undefined, fail)));
  return gltfCache.get(file)!;
}
/** Lego satin plastic in place of a model's own materials, keeping its colours (and its texture unless repainted). */
const satin = (m: any, colour: (s: any) => THREE.Color, keepMap: boolean) => {
  const src = Array.isArray(m.material) ? m.material : [m.material];
  const out = src.map((s: any) => new THREE.MeshStandardMaterial({ color: colour(s), map: keepMap ? s.map || null : null, roughness: 0.55, metalness: 0,
    alphaMap: s.alphaMap || null, transparent: !!s.transparent, alphaTest: s.alphaTest || (s.map && s.transparent ? 0.5 : 0), side: s.side ?? THREE.FrontSide, opacity: s.opacity ?? 1 }));
  m.material = Array.isArray(m.material) ? out : out[0];
};
/** Size a loaded model to h metres tall, standing on the ground, centred (rigged models are measured with their bones applied). */
const fitModel = (o: THREE.Object3D, h: number) => {
  o.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o, true), size = new THREE.Vector3(), c = new THREE.Vector3(); box.getSize(size); box.getCenter(c);
  const wrap = new THREE.Group(); o.position.set(-c.x, -box.min.y, -c.z); wrap.add(o); wrap.scale.setScalar(size.y > 0 ? h / size.y : 1);
  return wrap;
};
/** Part colours by material name, for OBJ files that kept only part names (body = the paint colour). */
const partColour = (name: string, body: string) => {
  const n = name.toLowerCase();
  if (/window|glass/.test(n)) return "#9cc6e8";
  if (/light|lamp/.test(n)) return "#fff1b8";
  if (/wheel|tire|tyre|bottom|rubber/.test(n)) return "#2a2a2a";
  if (/bumper|metal|chrome|handle|details|frame/.test(n)) return "#9a9a9a";
  if (/yellow/.test(n)) return "#f2b632";
  return body;
};
/** Kenney's nature kit paints leaves teal; repaint those two materials a natural green (autumn leaves keep their colour). */
const LEAF: Record<string, string> = { leafsgreen: "#5aa846", leafsdark: "#2f7d3c" };
export const KitModel: React.FC<{ file: string; h: number; p?: [number, number, number]; rotY?: number; flip?: boolean; body?: string; smooth?: boolean; color?: string }> =
  ({ file, h, p = [0, 0, 0], rotY = 0, flip = false, body, smooth = false, color }) => {
  const [scene, setScene] = useState<THREE.Object3D | null>(null);
  const [handle] = useState(() => delayRender("model " + file));
  useEffect(() => { loadModel(file).then((s) => { setScene(s); continueRender(handle); }).catch((e) => { console.error("KitModel", file, e); continueRender(handle); }); }, [file, handle]);
  const obj = useMemo(() => {
    if (!scene) return null;
    const o = skeletonClone(scene);   // a plain clone leaves a rigged model's bones behind and it vanishes
    o.traverse((m: any) => {
      if (!m.isMesh) return;
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
      if (smooth && !m.isSkinnedMesh) { const g = m.geometry.clone(); g.deleteAttribute("normal"); m.geometry = mergeVertices(g, 1e-4); m.geometry.computeVertexNormals(); }
      satin(m, (s) => color ? new THREE.Color(color) : body ? new THREE.Color(partColour(s.name || "", body)) : LEAF[(s.name || "").toLowerCase()] ? new THREE.Color(LEAF[(s.name || "").toLowerCase()]) : s.color ? softenColor(s.color.clone()) : new THREE.Color("#cccccc"), !(body || color));
    });
    return fitModel(o, h);
  }, [scene, h, smooth, body, color]);
  return obj ? <group position={p} rotation={[0, rotY + (flip ? Math.PI : 0), 0]}><primitive object={obj} /></group> : null;
};

/* ------------------------------------------------------------------ a rigged library model playing one of its motions
   <AnimatedModel file="models/quaternius/animals/Cow.gltf" h={1.5} clip="Walk" t={t} p={[x, 0, 0]} rotY={Math.PI / 2} />
   Catalog lines with anim=... list the motions (Walk, Gallop, Eating, Idle ... for animals; Walking_A, Running_A, Sit_Chair_Idle,
   Cheer, PickUp ... for KayKit characters). The motion is driven by t (shot seconds), never a clock, so every render is the same.
   speed = playback rate (1 = as made); moving it across the set is up to the shot (change p with t). Same Lego satin plastic and
   sizing as KitModel. (docs/experiments/2026-11-21-kit-animated-animals, -kit-animated-people) */
export const AnimatedModel: React.FC<{ file: string; h: number; clip: string; t: number; speed?: number; p?: [number, number, number]; rotY?: number; flip?: boolean; color?: string }> =
  ({ file, h, clip, t, speed = 1, p = [0, 0, 0], rotY = 0, flip = false, color }) => {
  const [gltf, setGltf] = useState<any>(null);
  const [handle] = useState(() => delayRender("animated model " + file));
  useEffect(() => { loadGltf(file).then((g) => { setGltf(g); continueRender(handle); }).catch((e) => { console.error("AnimatedModel", file, e); continueRender(handle); }); }, [file, handle]);
  const rig = useMemo(() => {
    if (!gltf) return null;
    const o = skeletonClone(gltf.scene);
    o.traverse((m: any) => { if (!m.isMesh) return; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
      satin(m, (s) => color ? new THREE.Color(color) : s.color ? softenColor(s.color.clone()) : new THREE.Color("#cccccc"), !color); });
    const mixer = new THREE.AnimationMixer(o);
    const a = gltf.animations.find((x: any) => x.name === clip) || gltf.animations.find((x: any) => x.name.toLowerCase().includes(clip.toLowerCase())) || gltf.animations[0];
    if (!a) console.warn("AnimatedModel", file, "has no motion", clip);
    if (a) mixer.clipAction(a).play();
    mixer.setTime(0);
    return { wrap: fitModel(o, h), mixer };
  }, [gltf, clip, h, color]);
  if (rig) rig.mixer.setTime(Math.max(0, t) * speed);
  return rig ? <group position={p} rotation={[0, rotY + (flip ? Math.PI : 0), 0]}><primitive object={rig.wrap} /></group> : null;
};


/* ------------------------------------------------------------------ a person riding a bicycle (never a Mini: Mini seated is torso-only, for inside vehicles)
   The library bicycle (Quaternius, turned to face +z) with a full Toy on the saddle and turning cranks + pedals (the model has none).
   - Legs: ONE crank angle drives the pedals AND the legs; each leg's hip/knee angles are solved (2-bone IK) so the foot stays on its
     pedal, so legs and pedals always turn at the same speed. The rider's legs are 15% longer (toy legs are short; seated it does not show).
   - Hands: fixed on the handlebar grips (arm and elbow angles searched so each palm sits on its grip); the arms never swing.
     steer (-1 left .. 1 right): the grips swing round the head tube, so the hands follow, and the head turns into the turn.
   Rides toward its own +z: rotY = direction of travel. t = shot time; rpm = pedal turns per minute (0 = coasting).
   Measured on Bicycle.obj per 1.05 m of bike (after the flip): saddle top y 0.93 z -0.33, bottom bracket y 0.29 z -0.317,
   grips x +-0.207 y 1.026 z 0.478. */
const cyclistArms = new Map<string, { R: [number, number, number]; L: [number, number, number] }>();
export const Cyclist: React.FC<{ spec: ToySpec; p?: [number, number, number]; rotY?: number; t?: number; rpm?: number; steer?: number; bike?: string; expr?: Expr; head?: number; size?: number }> =
  ({ spec, p = [0, 0, 0], rotY = 0, t = 0, rpm = 60, steer = 0, bike = "#2a6fd0", expr, head = 0, size = 0.92 }) => {
  const rider: ToySpec = { ...spec, legs: 1.15 }, B = toyBody(rider), k = size / 1.05;
  const hipY = 0.93 * k + 0.03, hipZ = -0.33 * k, lift = hipY - B.legH;           // the Toy is lifted so its hips sit on the saddle
  const bb = { y: 0.29 * k, z: -0.317 * k }, crank = 0.16 * k, px = 0.13 * k;
  const ang = (t * rpm / 60) * Math.PI * 2;                                      // crank angle (0 = right pedal at the bottom)
  const L1 = B.legH * 0.5, L2 = B.legH * 0.5 - 0.035;                            // thigh, shin as the Toy draws them
  const legIK = (a: number): [number, number] => {
    const fy = bb.y - crank * Math.cos(a) + 0.04, fz = bb.z - crank * Math.sin(a);   // the pedal as drawn (rotation x = a puts it at -sin a): bottom -> back -> top -> front = pedalling forward
    const dy = fy - hipY, dz = fz - hipZ, D = Math.min(Math.hypot(dy, dz), L1 + L2 - 0.005);
    const phi = Math.atan2(dz, -dy), alpha = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D))));
    const th = phi + alpha, kz = Math.sin(th) * L1, ky = -Math.cos(th) * L1;    // knee forward of the hip-foot line
    return [-th, th - Math.atan2(dz - kz, -(dy - ky))];
  };
  // a real cycling lean (~43 deg): toy arms are short (0.52 m), and only this lean lets both palms reach the grips (checked: within 1 cm, straight or steering)
  const lean = 0.75, st = Math.round(Math.max(-1, Math.min(1, steer)) * 50) / 50;
  // grips (in the Toy's frame), swung round the head tube by the steering angle
  // grips in the Toy's frame. Steering turns the bar round the head tube (just behind the grips); facing +z, +x is the rider's
  // left, so a right turn (steer > 0) is a negative yaw.
  const grip = (side: 1 | -1): V3 => {
    const yaw = -st * 0.35, gx = side * 0.207 * k, dz = 0.05 * k, pivotZ = 0.478 * k - dz;
    const x = gx * Math.cos(yaw) + dz * Math.sin(yaw), z = -gx * Math.sin(yaw) + dz * Math.cos(yaw);
    return [x, 1.026 * k - lift, pivotZ + z - hipZ];
  };
  const key = `${rider.name}|${size}|${st}`;
  if (!cyclistArms.has(key)) {                                                   // search arm raise / side / elbow so each palm sits on its grip
    const best = (side: 1 | -1): [number, number, number] => {
      const g = grip(side); let b: [number, number, number] = [0.5, 0.1, 0.2], bd = 1e9;
      const test = (r: number, o: number, e: number) => {
        const q: Pose = { lean, still: true, ...(side === 1 ? { armR: r, armRSide: o, elbowR: e } : { armL: r, armLSide: o, elbowL: e }) };
        const w = handWorld(rider, q, side), d = (w[0] - g[0]) ** 2 + (w[1] - g[1]) ** 2 + (w[2] - g[2]) ** 2;
        if (d < bd) { bd = d; b = [r, o, e]; } };
      for (let r = -0.2; r <= 2.2; r += 0.1) for (let o = -0.4; o <= 0.6; o += 0.1) for (let e = 0; e <= 1.6; e += 0.1) test(r, o, e);   // o < 0 = arm swings inward (the grips sit inside the shoulders)
      const [r0, o0, e0] = b;
      for (let r = r0 - 0.1; r <= r0 + 0.1; r += 0.02) for (let o = o0 - 0.1; o <= o0 + 0.1; o += 0.025) for (let e = Math.max(0, e0 - 0.1); e <= e0 + 0.1; e += 0.02) test(r, o, e);
      return b; };
    cyclistArms.set(key, { R: best(1), L: best(-1) });
  }
  const arms = cyclistArms.get(key)!;
  const pose: Pose = { lean, tilt: -lean * 0.8, still: true, expr, head: head - st * 0.45,   // head up to look ahead (the lean tips it down), and into the turn
    armR: arms.R[0], armRSide: arms.R[1], elbowR: arms.R[2], armL: arms.L[0], armLSide: arms.L[1], elbowL: arms.L[2],
    legR: legIK(ang), legL: legIK(ang + Math.PI) };
  const dark = "#2b2b2b";
  const crankArm = (side: 1 | -1, a: number) => <group position={[side * px * 0.75, bb.y, bb.z]} rotation={[a, 0, 0]}>
    <Box s={[0.022, crank, 0.03]} p={[0, -crank / 2, 0]} c={dark} round={0.4} />
    <group position={[side * 0.035, -crank, 0]} rotation={[-a, 0, 0]}><Box s={[0.08, 0.018, 0.055]} c={dark} round={0.3} /></group>{/* pedal stays level */}
  </group>;
  return <group position={p} rotation={[0, rotY, 0]}>
    <KitModel file="models/quaternius/Bicycle.obj" h={size} body={bike} flip />
    <mesh position={[px * 0.62, bb.y, bb.z]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.1 * k, 0.1 * k, 0.012, 32]} />{mat(dark)}</mesh>{/* chainring */}
    {crankArm(1, ang)}{crankArm(-1, ang + Math.PI)}
    <group position={[0, lift, hipZ]}><Toy spec={rider} pose={pose} /></group>
  </group>;
};
