// S3_1 — Versailles launch platform: on "a sheep, a duck and a rooster" each animal hops into the basket in turn; the rooster crows on the rim, the balloon tugs up; the King leans on his balcony and claps.
import React from "react";
import { Stage, Toy, RoyalTrim, MBalloon, Sheep, Duck, Rooster, Palace, Platform, Floor, Crowd, Cloud, kf, useShotTime, CAST, Expr } from "./_kit";

type Props = { lines: { speaker: string; start: number; end: number }[]; start: number; duration: number; accent: string };

const hop = (t: number, t0: number, t1: number, h: number) => { const u = Math.max(0, Math.min(1, (t - t0) / (t1 - t0))); return 4 * h * u * (1 - u); };

const S3_1: React.FC<Props> = () => {
  const t = useShotTime();
  // words (shot time): "sheep" -0.05-0.41, "duck" 0.47-0.74, "rooster" 0.99-1.62, "went first" 1.62-2.37
  const s = 1.15;
  const tug = kf(t, [[1.6, 0], [1.85, 0.12], [2.05, 0.06], [2.3, 0.14], [2.7, 0.1]]);
  const by = 0.3 + 0.9 * s + tug;
  const sway = Math.sin(t * 2.4) * 0.03 * kf(t, [[1.5, 0], [2, 1]]);
  // positions are in basket space (origin = basket floor, units scaled by s)
  const sheep = {
    x: kf(t, [[0, -0.8], [0.4, -0.16]]), z: -0.05, y: hop(t, 0, 0.4, 0.42) + kf(t, [[0.25, 0], [0.4, 0.22]]),
    s: 0.62, rotY: kf(t, [[0, 1.2], [0.4, 0.5], [0.9, 0.05]]), walk: t < 0.4 ? t : 0,
    head: kf(t, [[0.5, 0], [0.9, 0.3], [1.5, -0.2], [2.4, 0.15]]), tilt: kf(t, [[1.6, 0], [1.9, -0.2]]),
  };
  const duck = {
    x: kf(t, [[0.42, 0.85], [0.8, 0.12]]), z: kf(t, [[0.42, 0.3], [0.8, 0.14]]), y: hop(t, 0.42, 0.8, 0.5) + kf(t, [[0.65, 0], [0.8, 0.22]]),
    s: 0.85, rotY: kf(t, [[0.42, -1.3], [0.8, -0.4], [1.3, 0.1]]),
    flap: t > 0.4 && t < 0.95 ? 0.5 + 0.5 * Math.sin(t * 40) : 0.08 * Math.sin(t * 6),
    head: kf(t, [[1.0, 0], [1.3, 0.5], [2.0, 0.1]]),
  };
  const rx = kf(t, [[0.95, 0.95], [1.3, 0.34]]), rz = kf(t, [[0.95, 0.35], [1.3, 0.22]]);
  const rooster = {
    x: rx, z: rz, y: kf(t, [[0.95, 0], [1.3, 0.4]]) + hop(t, 0.95, 1.3, 0.25),
    s: 0.72, rotY: kf(t, [[0.95, -1.2], [1.3, -0.3], [1.5, 0.15]]),
    flap: t > 0.9 && t < 1.35 ? 0.5 + 0.5 * Math.sin(t * 34) : kf(t, [[1.45, 0], [1.6, 0.7], [2.1, 0.7], [2.3, 0.1]]),
    tilt: kf(t, [[1.4, 0], [1.6, -0.6], [2.1, -0.6], [2.3, -0.1]]),
    beak: kf(t, [[1.45, 0], [1.6, 1], [2.1, 1], [2.25, 0]]),
    puff: kf(t, [[1.4, 0], [1.6, 1], [2.3, 0.6]]),
  };
  const clap = kf(t, [[1.3, 0], [1.6, 1]]);
  const king = {
    x: 1.6, z: -4.75, rotY: -0.25,
    lean: kf(t, [[1.2, 0], [1.6, 0.22]]),
    armL: kf(t, [[1.2, 0.15], [1.6, 1.15]]), armR: kf(t, [[1.2, 0.15], [1.6, 1.15]]),
    armLSide: -clap * (0.2 + 0.2 * Math.sin(t * 20)), armRSide: -clap * (0.2 + 0.2 * Math.sin(t * 20)),
    tilt: kf(t, [[0, -0.1], [1.6, 0.1]]), head: -0.15,
    mouth: 0, look: 0.3, expr: (t < 1.0 ? "surprised" : "laugh") as Expr,
  };
  return (
    <Stage bg="#a9d6f2" fog={["#bfe0f4", 14, 34]}
      camera={{ pos: [kf(t, [[0, 0.15], [2.7, 0.3]]), kf(t, [[0, 1.05], [2.7, 1.0]]), kf(t, [[0, 5.6], [2.7, 4.0]])], look: [kf(t, [[0, 0.4], [2.7, 0.45]]), kf(t, [[0, 1.3], [2.7, 1.2]]), -1], fov: 42 }}>
      <Floor c="#ddd0b4" planks={false} size={50} />
      <Palace p={[1.6, 0, -6]} width={20} balcony />
      <Crowd n={7} x={[-3.4, -1.6]} z={[-2, -3.6]} seed={5} cheer={kf(t, [[1.4, 0.2], [2.0, 1]])} t={t} s={0.42} />
      <Crowd n={6} x={[1.9, 3.5]} z={[-1.4, -3]} seed={11} cheer={kf(t, [[1.5, 0.2], [2.1, 1]])} t={t} s={0.42} face={-0.3} />
      <Cloud p={[-2.6, 6.2, -10]} s={1.2} />
      <ambientLight intensity={0.35} />
      <Platform p={[0, 0, 0]} w={2.4} d={2.0} h={0.3} />
      <MBalloon p={[0, by, 0]} s={s} inflate={kf(t, [[0, 0.93], [1.6, 1]])} rot={[sway, 0, sway * 0.5]}>
        <Sheep spec={CAST.Sheep} pose={sheep} />
        <Duck spec={CAST.Duck} pose={duck} />
        <Rooster spec={CAST.Rooster} pose={rooster} />
      </MBalloon>
      <group position={[0, 1.2, 0]}>
        <Toy spec={CAST.King} pose={king} />
        <RoyalTrim spec={CAST.King} pose={king} />
      </group>
    </Stage>
  );
};
export default S3_1;
