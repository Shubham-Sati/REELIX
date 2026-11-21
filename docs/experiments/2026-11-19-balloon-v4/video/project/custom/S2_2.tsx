// S2_2 — Annonay square, June: the huge beige balloon swells over a smoky fire; Joseph and Etienne let go together; it climbs over the town, the crowd cheers and hats fly.
import React from "react";
import { Stage, Toy, MBalloon, Platform, Fire, Smoke, Town, Hill, Crowd, Cloud, Rope, Floor, kf, handPos, useShotTime, CAST, jump, Expr } from "./_kit";

type Props = { lines: { speaker: string; start: number; end: number }[]; start: number; duration: number; accent: string };

const S2_2: React.FC<Props> = () => {
  const t = useShotTime();
  // words (shot time): "huge balloon" 0.44-1.1, "over their town" 1.37-2.24
  const rel = kf(t, [[0.5, 0], [0.75, 1]]);                       // ropes let go
  const s = 0.72;
  const by = 1.5 + kf(t, [[0.55, 0], [2.6, 2.6]], (x) => x * x * 0.7 + x * 0.3); // neck height, accelerating climb
  const bx = kf(t, [[0.55, 0], [2.6, 0.25]]);
  const sway = Math.sin(t * 2.2) * 0.04 * rel;
  const jo = {
    x: -0.72, z: 0.45, rotY: 0.45,
    armR: kf(t, [[0, 1.15], [0.45, 1.0], [0.6, 1.3], [1.0, 2.6]]) + Math.sin(t * 10) * 0.07 * rel,
    armL: kf(t, [[0, 0.2], [0.7, 0.3], [1.1, 2.4]]) + Math.cos(t * 10) * 0.07 * rel,
    armLSide: kf(t, [[0.7, 0], [1.1, 0.25]]),
    head: 0.15, tilt: kf(t, [[0, -0.35], [0.8, -0.55], [2.5, -0.65]]), look: 1,
    lean: kf(t, [[0.3, 0], [0.5, 0.08], [0.8, -0.1]]),
    mouth: 0, ...jump(t, 1.5, 0.25, 0.45), expr: (t < 0.7 ? "neutral" : t < 1.2 ? "surprised" : "laugh") as Expr,
  };
  const et = {
    x: 0.72, z: 0.45, rotY: -0.45,
    armL: kf(t, [[0, 1.15], [0.45, 1.0], [0.6, 1.3], [1.05, 2.65]]) + Math.cos(t * 9) * 0.07 * rel,
    armR: kf(t, [[0, 0.2], [0.75, 0.3], [1.15, 2.4]]) + Math.sin(t * 9) * 0.07 * rel,
    armRSide: kf(t, [[0.75, 0], [1.15, 0.25]]),
    head: -0.15, tilt: kf(t, [[0, -0.35], [0.85, -0.55], [2.5, -0.65]]), look: 1,
    lean: kf(t, [[0.3, 0], [0.5, 0.08], [0.8, -0.1]]),
    mouth: 0, ...jump(t, 1.7, 0.22, 0.45), expr: (t < 0.75 ? "neutral" : "joy") as Expr,
  };
  const hj = handPos(CAST.Joseph, jo, 1), he = handPos(CAST.Etienne, et, -1);
  const tieL: [number, number, number] = [bx - 0.45 * s, by + 0.45 * s, 0], tieR: [number, number, number] = [bx + 0.45 * s, by + 0.45 * s, 0];
  const mix = (a: number[], b: number[], k: number) => a.map((v, i) => v + (b[i] - v) * k) as [number, number, number];
  const endL = mix(hj, [tieL[0] - 0.15, tieL[1] - 1.1, 0.1], rel), endR = mix(he, [tieR[0] + 0.15, tieR[1] - 1.1, 0.1], rel);
  const cheer = kf(t, [[0.8, 0], [1.4, 1]]);
  const hats = kf(t, [[1.15, 0], [2.6, 1.3]], (x) => x);
  return (
    <Stage bg="#a9d6f2" fog={["#bfe0f4", 16, 40]}
      camera={{ pos: [0, kf(t, [[0, 1.45], [2.5, 2.4]]), kf(t, [[0, 4.6], [2.5, 11.5]])], look: [0, kf(t, [[0, 1.65], [2.5, 2.3]]), kf(t, [[0, 0], [2.5, -1]])], fov: 45 }}>
      <Floor c="#d8c49a" planks={false} size={60} />
      <Hill p={[-6, -1.2, -16]} s={[8, 3.2, 4]} /><Hill p={[5, -1.4, -18]} s={[9, 3.8, 4]} c="#6fa44e" /><Hill p={[0, -1.6, -22]} s={[12, 4.2, 4]} c="#88bd62" />
      <Town rows={3} cols={6} p={[-6.4, 0, -3.2]} seed={3} />
      <Town rows={3} cols={6} p={[3.2, 0, -3.2]} seed={6} />
      <Town rows={2} cols={14} p={[-8.1, 0, -8]} seed={9} />
      <Cloud p={[-3, 7.5, -12]} s={1.3} /><Cloud p={[3.5, 8.6, -14]} s={1.6} />
      <Crowd n={9} x={[-3.4, -1.5]} z={[-0.6, -2.4]} seed={4} cheer={cheer} hats={hats} t={t} s={0.48} face={0.2} />
      <Crowd n={9} x={[1.5, 3.4]} z={[-0.6, -2.4]} seed={8} cheer={cheer} hats={hats} t={t} s={0.48} face={-0.2} />
      <Platform p={[0, 0, 0]} w={1.5} d={1.2} h={0.3} />
      <Fire p={[0, 0.3, 0]} scale={0.75} t={t} />
      <mesh position={[0, 0.36, 0]}><cylinderGeometry args={[0.38, 0.45, 0.14, 32]} /><meshStandardMaterial color="#d8b860" /></mesh>
      <Smoke p={[0, 0.6, 0]} t={t} n={8} rise={kf(t, [[0.5, 1.0], [1.2, 2.6]])} spread={0.3} color="#bdb6aa" />
      <MBalloon p={[bx, by, 0]} s={s} body="#e9d8b2" trim="#b07a3e" basket="none" inflate={kf(t, [[0, 0.82], [0.5, 1]])} rot={[sway, 0, sway * 0.6]} />
      <Rope a={tieL} b={endL} r={0.015} /><Rope a={tieR} b={endR} r={0.015} />
      <Toy spec={CAST.Joseph} pose={jo} />
      <Toy spec={CAST.Etienne} pose={et} />
    </Stage>
  );
};
export default S2_2;
