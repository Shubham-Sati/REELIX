// S1_2 — Annonay kitchen: Joseph on a stool by the fire watches the smoke rise, leans in, and an idea lands (finger up, smile).
import React from "react";
import { Stage, Room, Fireplace, Smoke, Seated, CopperPots, Table, kf, handPos, useShotTime, CAST, RoundGeo, Expr } from "./_kit";

type Props = { lines: { speaker: string; start: number; end: number }[]; start: number; duration: number; accent: string };

const S1_2: React.FC<Props> = () => {
  const t = useShotTime();
  // words (shot time): "Joseph" 0.26, "watched" 1.2, "rise" 1.8, "fire" 2.56
  const jo = {
    x: 0.3, z: -1.1, rotY: -0.5,
    head: kf(t, [[0, -0.15], [0.4, -0.55], [1.9, -0.45], [2.35, 0.05]]),
    tilt: kf(t, [[0, 0.05], [0.5, -0.1], [1.7, -0.45], [2.2, -0.35], [2.6, -0.1]]),
    lean: kf(t, [[0, 0.02], [1.1, 0.04], [1.6, 0.28], [2.0, 0.22], [2.3, 0.05]]),
    armL: kf(t, [[0, 0.75], [1.5, 0.95], [2.3, 0.75]]),
    // anticipation dip, then the finger goes up on "fire"
    armR: kf(t, [[0, 0.75], [1.5, 0.95], [1.95, 0.6], [2.35, 2.35], [2.5, 2.25], [3.2, 2.3]]),
    look: kf(t, [[0, 0.2], [1.6, 1], [2.4, 0.4]]),
    expr: (t < 1.6 ? "neutral" : t < 2.2 ? "surprised" : "joy") as Expr, exprK: t < 2.2 ? 0.7 : 1,
    mouth: 0,
  };
  const seatY = 0.46, legH = 0.62 * (CAST.Joseph.height ?? 1);
  const hand = handPos(CAST.Joseph, jo, 1);
  const finger: [number, number, number] = [hand[0], hand[1] + (seatY + 0.09 - legH) + 0.1, hand[2]];
  const fingerOn = kf(t, [[2.05, 0], [2.3, 1]]);
  return (
    <Stage bg="#3a2a22" fog={["#3a2a22", 9, 18]}
      camera={{ pos: [kf(t, [[0, -0.7], [3.2, -0.35]]), kf(t, [[0, 1.55], [3.2, 1.55]]), kf(t, [[0, 4.6], [3.2, 3.3]])], look: [kf(t, [[0, -0.15], [3.2, 0.1]]), kf(t, [[0, 1.2], [3.2, 1.3]]), -1.3], fov: 42 }}>
      <Room wall="#e6d2b2" floor="#8a5e3c" depth={-2.6} />
      <Fireplace p={[-0.75, 0, -2.3]} t={t} />
      <Smoke p={[-0.75, 0.55, -1.95]} t={t + 1.3} n={11} rise={3.2} spread={0.55} color="#c9c3ba" />
      <CopperPots p={[1.6, 2.45, -2.4]} />
      <Table p={[2.1, 0, -1.9]} />
      <Seated spec={CAST.Joseph} pose={jo} seatY={seatY} />
      <mesh position={finger} scale={[1, fingerOn, 1]}><RoundGeo args={[0.04, 0.12, 0.04]} /><meshStandardMaterial color={CAST.Joseph.skin} /></mesh>
    </Stage>
  );
};
export default S1_2;
