
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
      <mesh rotation={[0, Math.PI / 2, 0]} position={[0, 0.0, -0.12]} castShadow><torusGeometry args={[0.13, 0.018 - i * 0.002, 10, 32, Math.PI * 0.9]} />{mat(i % 2 ? spec.tail : "#163024")}</mesh></group>)}
    <Pill r={0.06} len={0.08} p={[0, 0.5, 0.09]} rot={[0.3, 0, 0]} c="#d2802e" />{/* neck ruff */}
    <group position={[0, 0.6, 0.12]} rotation={[pose.tilt || 0, pose.head || 0, 0]}>
      <Ball r={0.065} s={[0.9, 1.05, 1.1]} c={spec.body} />
      {[-0.035, 0, 0.035].map((z, i) => <Ball key={i} r={0.022 + (i === 1 ? 0.006 : 0)} p={[0, 0.07 + (i === 1 ? 0.01 : 0), z]} s={[0.55, 1.1, 1]} c={spec.comb} />)}
      <mesh position={[0, 0.0, 0.075]} rotation={[Math.PI / 2 - (pose.beak || 0) * 0.3, 0, 0]}><coneGeometry args={[0.02, 0.05, 16]} />{mat(spec.beak)}</mesh>
      <mesh position={[0, -0.016, 0.07]} rotation={[Math.PI / 2 + (pose.beak || 0) * 0.5, 0, 0]}><coneGeometry args={[0.014, 0.035, 16]} />{mat(spec.beak)}</mesh>
      <Ball r={0.018} p={[0, -0.05, 0.055]} s={[0.7, 1.5, 0.8]} c={spec.comb} />{/* wattle */}
      {[1, -1].map((s) => <AEye key={s} p={[s * 0.045, 0.015, 0.035]} r={0.011} />)}
    </group>
  </group>;
};
