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
  <mesh position={[0, y0 - len / 2, 0]} castShadow receiveShadow><cylinderGeometry args={[r1, r2, len, 24]} />{mat(c)}</mesh>;
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
      {closed ? <mesh position={[0, 0, 0.012]} rotation={[0, 0, E.smile >= 0 ? 0 : Math.PI]}><torusGeometry args={[0.02, 0.004, 8, 20, Math.PI]} />{mat("#2a1d17")}</mesh> : <>
        <Ball r={0.027} s={[1, 1.1 * eyeY, 0.55]} c="#fbf8f2" />
        <Ball r={0.016} p={[0, lk * 0.008, 0.012]} s={[1, 1.1 * Math.min(1, eyeY), 0.5]} c="#2a1d17" />
        {eyeY > 0.5 ? <Ball r={0.005} p={[0.006, 0.01 + lk * 0.008, 0.019]} c="#ffffff" /> : null}
        <mesh position={[0, 0.026 * eyeY + 0.002, 0.004]} rotation={[0.5, 0, 0]} scale={[1, 0.3, 1]}><sphereGeometry args={[0.028, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5]} />{mat(spec.skin)}</mesh>{/* upper lid */}
      </>}
    </group>)}
    {/* brows: height and tilt (inner end up = sad/fear, inner end down = angry) */}
    {[1, -1].map((s) => <Pill key={"b" + s} r={0.0085} len={0.042} p={[s * 0.06, 0.085 + by + lk * 0.01 + (E.eye > 1.1 ? 0.01 * k : 0), fz - 0.025]} rot={[0, 0, Math.PI / 2 - s * (0.12 - bt * 0.0) + s * bt]} c={browC} />)}
    {/* mouth: smile/frown curve, opens for talking, laughing, surprise */}
    {open > 0.08 ? <Ball r={0.034} p={[0, -0.075 + smile * 0.004, fz - 0.035]} s={[1.15 * ow, 0.25 + 1.1 * open, 0.4]} c="#5a2a22" /> : null}
    {open > 0.3 && smile > 0.3 ? <Ball r={0.026} p={[0, -0.062, fz - 0.03]} s={[1.2 * ow, 0.35, 0.3]} c="#f6f1e8" /> : null}{/* teeth */}
    <mesh position={[0, -0.07 + (smile >= 0 ? 0.008 : -0.006), fz - 0.028]} rotation={[0, 0, smile >= 0 ? Math.PI : 0]} scale={[ow, Math.max(0.15, Math.abs(smile)), 1]}>
      <torusGeometry args={[0.036, 0.0065, 8, 24, Math.PI]} />{mat("#7a3a30")}</mesh>
    {E.tears && k > 0.3 ? [1, -1].map((s) => { const f = (t * 0.9 + (s > 0 ? 0 : 0.5)) % 1; return <Ball key={"t" + s} r={0.008} p={[s * 0.06, 0.005 - f * 0.08, fz - 0.015]} s={[1, 1.4, 1]} c="#8fd0f0" />; }) : null}
  </group>;
};
/** Little hand: palm, three fingers and a thumb (curl 0 open .. 1 fist). */
const Hand: React.FC<{ c: string; side: 1 | -1; curl?: number }> = ({ c, side, curl = 0.35 }) => <group>
  <Ball r={0.042} s={[0.85, 1.0, 0.5]} c={c} />
  {[-0.022, 0, 0.022].map((x, i) => <group key={i} position={[x, -0.036, 0]} rotation={[curl * 1.1, 0, 0]}><Pill r={0.0095} len={0.028 - (i === 2 ? 0.006 : 0)} p={[0, -0.016, 0]} c={c} /></group>)}
  <group position={[-side * 0.03, -0.006, 0.012]} rotation={[0.4, 0, side * 0.7]}><Pill r={0.01} len={0.022} p={[0, -0.014, 0]} c={c} /></group>
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
  const crouch = pose.crouch || 0;
  const breath = live ? 0.5 + 0.5 * Math.sin(t * 2.0 + seed * 6) : 0;
  const roll = pose.walk ? step * 0.05 : live ? 0.022 * Math.sin(t * 0.7 + seed * 9) : 0;   // weight over the standing leg
  const drop = crouch * 0.16 * h;                                       // body lowers when the knees bend
  const upper = 0.27 * h, fore = 0.22 * h;
  const sway = pose.walk ? Math.sin(pose.walk * 7 + 1.2) * 0.04 : 0;     // coat hem swing
  const arm = (side: 1 | -1, raise = 0, out = 0, elbow = 0) => (
    <group position={[side * B.shoulderX, B.shoulderY + breath * 0.006, 0]} rotation={[-raise - (pose.walk ? -step * side * 0.5 : 0), 0, side * (0.06 + out * 0.9)]}>
      <Ball r={0.062} s={[1, 1, 0.9]} c={spec.coat} />
      <Limb r1={0.058} r2={0.047} len={upper} c={spec.coat} />
      <Ball r={0.047} p={[0, -upper, 0]} c={spec.coat} />
      <group position={[0, -upper, 0]} rotation={[-0.12 - raise * 0.05 - elbow - (pose.walk ? 0.25 : 0), 0, 0]}>
        <Limb r1={0.046} r2={0.04} len={fore - 0.02} c={spec.coat} />
        <Pill r={0.044} len={0.012} p={[0, -fore + 0.024, 0]} c={darken(spec.coat, 0.82)} />{/* sleeve cuff */}
        <group position={[0, -fore - 0.03, 0.004]}><Hand c={spec.skin} side={side} curl={pose.walk ? 0.6 : 0.35} /></group>
      </group>
    </group>
  );
  const leg = (side: 1 | -1) => {
    const swing = pose.walk ? step * side * 0.5 : 0;
    return <group position={[side * hip * 0.48, legH, 0]} rotation={[swing + crouch * 0.85, 0, 0]}>
      <Limb r1={0.078 + 0.02 * B.b} r2={0.058} len={legH * 0.5} c={spec.pants} />
      <Ball r={0.058} p={[0, -legH * 0.5, 0]} c={spec.pants} />
      <group position={[0, -legH * 0.5, 0]} rotation={[-(pose.walk ? Math.max(0, -step * side) * 0.6 : 0.04) - crouch * 1.7, 0, 0]}>
        <Limb r1={0.056} r2={0.046} len={legH * 0.5 - 0.06} c={spec.pants} />
        <Pill r={0.05} len={0.012} p={[0, -legH * 0.5 + 0.075, 0]} c={darken(spec.pants, 0.8)} />{/* rolled trouser cuff */}
        <group rotation={[crouch * 0.85, 0, 0]} position={[0, -legH * 0.5 + 0.035, 0]}><Ball r={0.06} p={[0, 0, 0.045]} s={[0.85, 0.55, 1.6]} c={spec.shoes || "#3a2a20"} /></group>
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
          <Lathe c={spec.coat} depth={depth} pts={[[hip * 1.04, legH - 0.02], [hip * 1.02, y(0.08)], [waist * 1.03, y(0.32)], [chest, y(0.62)], [chest * 0.98, y(0.8)], [sh * 0.86, y(0.9)], [0.1, y(0.985)], [0.055, y(1.0)], [0, y(1.0)]]} />
          {/* coat hem: a short flared skirt that swings when walking */}
          <group position={[0, legH + 0.01, 0]} rotation={[sway, 0, roll * -0.6]}><Lathe c={darken(spec.coat, 0.93)} depth={depth} side={THREE.DoubleSide} pts={[[hip * 1.06, 0.03], [hip * 1.12, -0.04], [hip * 1.2, -0.11]]} /></group>
          <Ball r={0.06} p={[0, y(0.74), chest * depth * 0.93]} s={[0.9, 2.1, 0.3]} c={spec.shirt || "#efe6d2"} />
          {[0.36, 0.5, 0.64].map((kk) => <Ball key={kk} r={0.013} p={[0, y(kk), (kk < 0.5 ? waist : chest) * depth + 0.008]} c="#6e4a2e" />)}
          {/* soft fold lines at the waist and elbows of the coat */}
          {[1, -1].map((s) => <mesh key={"f" + s} position={[s * waist * 0.55, y(0.3), waist * depth * 0.9]} rotation={[0, s * 0.5, s * 0.35]}><torusGeometry args={[0.035, 0.0035, 6, 16, Math.PI * 0.6]} />{mat(darken(spec.coat, 0.78))}</mesh>)}
        </group></group>
        <mesh position={[0, y(1.0) + 0.012, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, depth + 0.12, 1]}><torusGeometry args={[0.062, 0.016, 10, 28]} />{mat(spec.shirt || "#efe6d2")}</mesh>{/* collar */}
        <Limb r1={0.048} r2={0.055} len={0.09} y0={y(1.0) + 0.07} c={spec.skin} />
        {arm(1, pose.armR, pose.armRSide, pose.elbowR)}{arm(-1, pose.armL, pose.armLSide, pose.elbowL)}
        <group position={[0, legH + bodyH + B.headS * 0.62 + breath * 0.004, 0]} rotation={[(pose.tilt || 0) + (live ? 0.02 * Math.sin(t * 0.9 + seed * 4) : 0), (pose.head || 0), -roll * 0.5]}>
          <Ball r={hr} s={[0.9, 1.06, 0.95]} c={spec.skin} />
          <Ball r={hr * 0.78} p={[0, -0.05, 0.02]} s={[0.92, 0.8, 0.95]} c={spec.skin} />
          <Ball r={0.017} p={[0, -0.022, fz + 0.002]} s={[1, 0.9, 1]} c={spec.skin} />
          {[1, -1].map((s) => <Ball key={"e" + s} r={0.026} p={[s * hr * 0.88, -0.005, -0.005]} s={[0.45, 1, 0.8]} c={spec.skin} />)}
          <ToyFace spec={spec} pose={pose} t={t} hr={hr} fz={fz} />
          {spec.cheeks ? [1, -1].map((s) => <Ball key={"c" + s} r={0.022} p={[s * 0.085, -0.03, fz - 0.035]} s={[1, 0.75, 0.4]} c={spec.cheeks!} />) : null}
          {spec.hairStyle !== "bald" ? <mesh position={[0, 0.03, -0.012]} scale={[hr * 0.96, hr * 1.1, hr * 1.0]} castShadow>
            <sphereGeometry args={[1, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.36]} />{mat(spec.hair)}</mesh> : null}
          {spec.hairStyle !== "bald" ? <Ball r={hr * 0.9} p={[0, 0.02, -0.05]} s={[0.99, 1.05, 0.88]} c={spec.hair} /> : null}
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
