// S1_0 — Versailles courtyard: the royal balloon lifts off with Sheep in the basket; the King looks up, amazed.
import React from "react";
import { Stage, Toy, RoyalTrim, MBalloon, Sheep, Palace, Floor, Crowd, Cloud, kf, useShotTime, CAST, turn, kfA, Expr } from "./_kit";

type Props = { lines: { speaker: string; start: number; end: number }[]; start: number; duration: number; accent: string };

const S1_0: React.FC<Props> = () => {
  const t = useShotTime();
  // balloon is already rising at frame 0 and keeps climbing
  const by = kf(t, [[0, 1.3], [3.6, 3.0]], (x) => x);
  const sway = Math.sin(t * 1.6) * 0.04;
  // King: notices (head leads), anticipation dip, hand up to shade eyes, mouth opens on "king watched"
  const king = {
    x: -0.55, z: 0.8, ...turn(t, [[0, 0.3], [0.5, 0.95]]),
    expr: (t < 0.4 ? "neutral" : t < 1.8 ? "surprised" : "joy") as Expr,
    tilt: kf(t, [[0, -0.15], [0.6, -0.5], [3.4, -0.62]]),
    armR: kfA(t, [[0.3, 0.05], [1.0, 2.4], [3.6, 2.4]]),
    armRSide: kf(t, [[0.4, 0], [1.0, -0.25]]),
    armL: kf(t, [[0.6, 0.05], [1.3, 0.35]]),
    mouth: 0,
    lean: kf(t, [[0, 0], [1.2, -0.08]]),
    look: kf(t, [[0, 0.3], [0.8, 1]]),
  };
  return (
    <Stage bg="#a9d6f2" fog={["#bfe0f4", 14, 34]}
      camera={{ pos: [kf(t, [[0, -0.1], [3.6, 0.3]]), kf(t, [[0, 1.2], [3.6, 2.0]]), 4.0], look: [0.35, kf(t, [[0, 1.5], [3.6, 2.5]]), 0], fov: 42 }}>
      <Floor c="#ddd0b4" planks={false} />
      <Palace p={[0, 0, -7.5]} width={20} />
      <Crowd n={8} x={[-3.6, -1.9]} z={[-2.5, -5]} seed={4} cheer={kf(t, [[0.8, 0], [1.8, 1]])} t={t} s={0.42} />
      <Crowd n={8} x={[1.9, 3.6]} z={[-2.5, -5]} seed={8} cheer={kf(t, [[1.0, 0], [2.0, 1]])} t={t} s={0.42} />
      <Cloud p={[-2.4, 5.6, -9]} s={1.2} /><Cloud p={[3.0, 6.4, -11]} s={1.4} />
      <MBalloon p={[0.75, by, -1.4]} s={0.68} rot={[sway, 0, sway * 0.5]} spin={t * 0.15}>
        <Sheep spec={CAST.Sheep} pose={{ s: 0.72, y: 0.32, rotY: 0.5, tilt: kf(t, [[0, 0.1], [1.4, 0.45]]), head: Math.sin(t * 1.8) * 0.25 }} />
      </MBalloon>
      <Toy spec={CAST.King} pose={king} />
      <RoyalTrim spec={CAST.King} pose={king} />
    </Stage>
  );
};
export default S1_0;
