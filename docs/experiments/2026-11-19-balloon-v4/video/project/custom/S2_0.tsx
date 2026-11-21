// S2_0 — kitchen table, side view: Joseph lights crumpled paper in a dish with a taper, holds the silk box over it; the silk puffs out.
import React from "react";
import { Stage, Room, Fireplace, Table, Toy, SilkBox, Dish, Fire, Smoke, CopperPots, Rope, kf, handPos, useShotTime, CAST, Expr } from "./_kit";

type Props = { lines: { speaker: string; start: number; end: number }[]; start: number; duration: number; accent: string };

const S2_0: React.FC<Props> = () => {
  const t = useShotTime();
  // words (shot time): "lit" 0.15-0.42, "light silk box" 0.85-2.0
  const jo = {
    x: -0.95, z: 0, rotY: Math.PI / 2,
    // far hand holds the box up high; near hand dips the taper to the dish, then both lower the box over the flame
    armR: kf(t, [[0, 1.85], [0.7, 1.85], [1.25, 1.45]]),
    armL: kf(t, [[0, 0.95], [0.3, 0.75], [0.55, 0.8], [0.75, 1.85], [1.25, 1.45]]),
    head: 0.0,
    tilt: kf(t, [[0, 0.35], [0.6, 0.3], [1.3, 0.05], [2.4, -0.05]]),
    lean: kf(t, [[0, 0.12], [0.6, 0.12], [1.3, 0.04]]),
    look: kf(t, [[0, 0], [1.3, 0.6]]),
    mouth: 0, expr: (t < 1.4 ? "neutral" : "joy") as Expr, exprK: kf(t, [[1.4, 0.4], [2.0, 1]]),
  };
  const hl = handPos(CAST.Joseph, jo, -1);
  const hr = handPos(CAST.Joseph, jo, 1);
  const lit = kf(t, [[0.25, 0], [0.5, 1]]);
  const puff = kf(t, [[0.8, 0], [2.3, 1]]);
  const dishX = -0.95 + 0.6 * Math.sin(1.45), dishY = 0.9;
  const boxY = hr[1] - 0.24 + kf(t, [[1.6, 0], [2.4, 0.04]]);
  const tip: [number, number, number] = [hl[0] + 0.75 * (dishX - hl[0]), hl[1] + 0.75 * (dishY + 0.16 - hl[1]), hl[2] * 0.3];
  const taperOn = t < 0.7 ? 1 : 0;
  return (
    <Stage bg="#3a2a22" fog={["#3a2a22", 9, 18]}
      camera={{ pos: [kf(t, [[0, -0.7], [2.5, -0.25]], (x) => x), 1.5, 4.8], look: [kf(t, [[0, -0.6], [2.5, -0.2]], (x) => x), 1.25, 0], fov: 42 }}>
      <Room wall="#e6d2b2" floor="#8a5e3c" depth={-2.6} />
      <Fireplace p={[1.6, 0, -2.3]} t={t} />
      <Smoke p={[1.6, 0.55, -1.95]} t={t + 4} n={8} rise={2.8} spread={0.45} color="#c9c3ba" />
      <CopperPots p={[-1.6, 2.45, -2.4]} />
      <Table p={[dishX + 0.55, 0, 0]} />
      <Dish p={[dishX, dishY + 0.03, 0]} />
      {/* crumpled paper, then its flame */}
      <mesh position={[dishX, dishY + 0.09, 0]} scale={1 - 0.6 * lit}><icosahedronGeometry args={[0.07, 3]} /><meshStandardMaterial color="#f3ead6" /></mesh>
      {lit > 0.01 ? <Fire p={[dishX, dishY + 0.06, 0]} scale={0.32 * lit} t={t} /> : null}
      {lit > 0.5 ? <Smoke p={[dishX, dishY + 0.15, 0]} t={t} n={5} rise={0.35} spread={0.08} color="#e0d8cc" /> : null}
      <SilkBox p={[hr[0], boxY, 0]} puff={puff} glow={lit * (0.6 + 0.4 * puff)} />
      <Toy spec={CAST.Joseph} pose={jo} />
      {/* the taper in the right hand, flame at its tip */}
      {taperOn ? <group>
        <Rope a={hl} b={tip} r={0.014} c="#f2e6c6" />
        <mesh position={[tip[0], tip[1] + 0.03, tip[2]]}><coneGeometry args={[0.025, 0.07, 32]} /><meshStandardMaterial color="#ffb03a" emissive="#ff9a2a" emissiveIntensity={1.5} /></mesh>
      </group> : null}
    </Stage>
  );
};
export default S2_0;
