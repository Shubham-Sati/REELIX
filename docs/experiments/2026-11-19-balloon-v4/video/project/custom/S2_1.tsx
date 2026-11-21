// S2_1 — the silk box floats out of Joseph's hands and bumps the ceiling beams; Joseph steps back, hands up, beaming.
import React from "react";
import { Stage, Room, Ceiling, Table, Toy, SilkBox, Dish, Fire, CopperPots, kf, useShotTime, CAST, jump, Expr } from "./_kit";

type Props = { lines: { speaker: string; start: number; end: number }[]; start: number; duration: number; accent: string };

const S2_1: React.FC<Props> = () => {
  const t = useShotTime();
  // words (shot time): "hit" 0.18, "ceiling" 0.4-1.07
  const beam = 2.68; // underside of the ceiling beam above the box
  const top = kf(t, [[0, 1.75], [0.5, beam], [0.72, beam - 0.16], [0.95, beam - 0.01], [1.2, beam - 0.07], [1.45, beam - 0.01], [2.5, beam - 0.03]], (x) => x * x * (3 - 2 * x));
  const wob = Math.sin(t * 11) * 0.12 * Math.exp(-Math.max(0, t - 0.5) * 2.2) * (t > 0.5 ? 1 : 0.4);
  const backStep = kf(t, [[0.25, 0], [0.9, 1]]);
  const jo = {
    x: -0.3 - 0.3 * backStep, z: 0.25, rotY: 0.55 - 0.15 * backStep,
    walk: t > 0.25 && t < 0.9 ? -(t - 0.25) * 0.9 : 0,
    armL: kf(t, [[0, 1.6], [0.35, 1.3], [0.9, 2.6], [1.1, 2.5]]) + Math.sin(t * 9) * 0.06 * backStep,
    armR: kf(t, [[0, 1.6], [0.4, 1.3], [0.95, 2.6], [1.15, 2.5]]) + Math.cos(t * 9) * 0.06 * backStep,
    armLSide: kf(t, [[0.4, 0], [1.0, 0.3]]), armRSide: kf(t, [[0.4, 0], [1.0, 0.3]]),
    head: kf(t, [[0, 0.3], [1.2, 0.1]]),
    tilt: kf(t, [[0, -0.2], [0.5, -0.55], [1.5, -0.4]]),
    lean: kf(t, [[0.3, 0], [0.8, -0.12], [1.4, -0.06]]),
    look: 1, mouth: 0, ...jump(t, 1.35, 0.18, 0.4),
    expr: (t < 0.45 ? "joy" : t < 1.0 ? "surprised" : "laugh") as Expr,
  };
  return (
    <Stage bg="#3a2a22" fog={["#3a2a22", 9, 18]}
      camera={{ pos: [kf(t, [[0, 0.2], [2.5, 0.0]]), 0.95, 4.3], look: [kf(t, [[0, -0.2], [2.5, -0.3]]), kf(t, [[0, 1.45], [0.6, 1.95], [2.5, 2.0]]), -0.2], fov: 48 }}>
      <Room wall="#e6d2b2" floor="#8a5e3c" depth={-2.6} />
      <Ceiling y={2.9} c="#d9c4a0" />
      <CopperPots p={[-1.4, 2.3, -2.4]} />
      <Table p={[0.6, 0, -0.2]} />
      <Dish p={[0.4, 0.93, -0.2]} />
      <Fire p={[0.4, 0.96, -0.2]} scale={kf(t, [[0, 0.3], [1.5, 0.1]])} t={t} />
      <SilkBox p={[0.4, top - 0.52, -0.2]} puff={1} glow={kf(t, [[0, 0.7], [2, 0.3]])} rot={[wob * 0.5, 0, wob]} />
      <Toy spec={CAST.Joseph} pose={jo} />
    </Stage>
  );
};
export default S2_1;
