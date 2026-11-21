// S4_0 — woodland meadow: the basket bumps down and tips over, the blue balloon sags onto the grass; Sheep trots out and shakes, Duck waddles out flapping, Rooster hops onto the basket and puffs his chest. All alive.
import React from "react";
import { Stage, MBalloon, WickerBasket, Sheep, Duck, Rooster, Floor, Tree, Hill, Cloud, Rope, kf, useShotTime, CAST } from "./_kit";

type Props = { lines: { speaker: string; start: number; end: number }[]; start: number; duration: number; accent: string };

const hop = (t: number, t0: number, t1: number, h: number) => { const u = Math.max(0, Math.min(1, (t - t0) / (t1 - t0))); return 4 * h * u * (1 - u); };

const S4_0: React.FC<Props> = () => {
  const t = useShotTime();
  // words (shot time): "landed" 0.88-1.42, "All three" 1.78-2.08, "alive" 2.21-2.74
  const bs = 1.25, r = 0.44 * bs, h = 0.4 * bs;
  const bx = 0.45, bz = -0.55;
  const by = kf(t, [[0, 2.5], [0.95, 0]], (x) => 1 - (1 - x) * (1 - x) * 0.4 - 0.6 * (1 - x) * (1 - x) * (1 - x)) + hop(t, 0.95, 1.12, 0.07);
  const tip = kf(t, [[1.0, 0], [1.3, 1]], (x) => x * x);
  const lie = kf(t, [[0.95, 0], [2.2, 1]]);
  const out = (t0: number, t1: number) => kf(t, [[t0, 0], [t1, 1]]);
  const mouthZ = bz + r + h;                       // front of the tipped basket
  const ride = (ox: number, oz: number) => [bx + ox * bs, by + 0.2 * bs, bz + oz * bs] as const;
  // Sheep: rides, slides to the mouth during the tip, trots out left, shakes its wool on "alive"
  const sO = out(1.25, 1.85);
  const sR = ride(-0.16, -0.05);
  const sheep = {
    x: t < 1.0 ? sR[0] : kf(t, [[1.0, sR[0]], [1.25, bx - 0.15], [1.85, -0.5]]),
    y: t < 1.0 ? sR[1] : kf(t, [[1.0, sR[1]], [1.25, 0.02], [1.3, 0]]),
    z: t < 1.0 ? sR[2] : kf(t, [[1.0, sR[2]], [1.25, mouthZ - 0.2], [1.85, 0.55]]),
    s: 0.78, rotY: kf(t, [[1.2, 0.2], [1.35, -0.7], [1.85, -0.3], [2.1, 0.15]]),
    walk: sO > 0 && sO < 1 ? t : 0,
    shake: Math.sin(t * 30) * 0.18 * kf(t, [[1.95, 0], [2.1, 1], [2.55, 1], [2.75, 0]]),
    head: kf(t, [[2.6, 0], [2.85, 0.35], [3.1, 0.2]]),
  };
  // Duck: waddles out to the centre, flapping
  const dR = ride(0.15, 0.08);
  const dO = out(1.35, 1.95);
  const duck = {
    x: t < 1.0 ? dR[0] : kf(t, [[1.0, dR[0]], [1.3, bx + 0.05], [1.95, 0.0]]),
    y: t < 1.0 ? dR[1] : kf(t, [[1.0, dR[1]], [1.3, 0.02], [1.35, 0]]),
    z: t < 1.0 ? dR[2] : kf(t, [[1.0, dR[2]], [1.3, mouthZ - 0.15], [1.95, 0.85]]),
    s: 0.95, rotY: kf(t, [[1.3, 0.3], [1.95, -0.2], [2.2, 0.0]]),
    walk: dO > 0 && dO < 1 ? t : 0,
    flap: kf(t, [[1.6, 0], [1.75, 1]]) * (0.5 + 0.5 * Math.sin(t * 34)) * kf(t, [[2.5, 1], [2.7, 0.1]]),
    head: kf(t, [[2.4, 0], [2.7, -0.4], [3.1, 0.2]]),
  };
  // Rooster: hops out, then up onto the tipped basket, crows and puffs his chest
  const rR = ride(0.0, -0.25);
  const top = 2 * r;
  const rooster = {
    x: t < 1.0 ? rR[0] : kf(t, [[1.0, rR[0]], [1.3, bx + 0.25], [1.7, bx + 0.6], [2.1, bx + 0.05]]),
    y: t < 1.0 ? rR[1] : kf(t, [[1.0, rR[1]], [1.3, 0.0], [1.8, 0], [2.1, top - 0.02]]) + hop(t, 1.8, 2.1, 0.3),
    z: t < 1.0 ? rR[2] : kf(t, [[1.0, rR[2]], [1.3, mouthZ - 0.1], [1.7, mouthZ + 0.05], [2.1, bz + r + h * 0.45]]),
    s: 0.85, rotY: kf(t, [[1.3, 0.6], [1.75, -0.9], [2.1, -0.25]]),
    walk: t > 1.3 && t < 1.75 ? t : 0,
    flap: t > 1.78 && t < 2.15 ? 0.5 + 0.5 * Math.sin(t * 36) : kf(t, [[2.2, 0], [2.35, 0.8], [2.8, 0.8], [3.0, 0.1]]),
    puff: kf(t, [[2.15, 0], [2.4, 1]]),
    tilt: kf(t, [[2.2, 0], [2.4, -0.55], [2.85, -0.55], [3.05, 0]]),
    beak: kf(t, [[2.25, 0], [2.4, 1], [2.85, 1], [2.95, 0]]),
  };
  return (
    <Stage bg="#9fd2f0" fog={["#c4e4f2", 14, 34]}
      camera={{ pos: [kf(t, [[0, 0.4], [1.4, 0.2]]), kf(t, [[0, 2.8], [1.3, 1.0]]), kf(t, [[0, 6.6], [1.4, 6.0], [3.2, 5.7]])], look: [kf(t, [[0, 0.45], [1.4, 0.2]]), kf(t, [[0, 2.6], [1.3, 0.7], [3.2, 0.68]]), 0], fov: 42 }}>
      <Floor c="#86bf5e" planks={false} size={60} />
      <ambientLight intensity={0.6} color="#eef6ff" />
      <Hill p={[-5, -1.4, -14]} s={[7, 3, 4]} c="#6faa4c" /><Hill p={[5, -1.6, -16]} s={[8, 3.4, 4]} c="#7fb55a" />
      <Tree p={[-1.8, 0, -2.6]} s={1.2} /><Tree p={[2.2, 0, -3.2]} s={1.4} c="#4f8a3e" /><Tree p={[-3.0, 0, -4.5]} s={1.5} c="#5a9446" />
      <Tree p={[0.6, 0, -5.5]} s={1.6} c="#4f8a3e" /><Tree p={[3.6, 0, -5.8]} s={1.3} /><Tree p={[-1.0, 0, -7.0]} s={1.7} c="#5a9446" />
      <Cloud p={[-2.2, 5.4, -10]} s={1.1} /><Cloud p={[2.8, 6.4, -12]} s={1.3} />
      {/* envelope: sags and falls back onto the grass after touchdown */}
      <MBalloon p={[bx - 0.45 * lie, by + 1.15 - 0.85 * lie, bz - 0.15 - 1.0 * lie]} s={0.95} basket="none"
        inflate={1 - 0.75 * lie} rot={[-0.3 * lie, 0.4 * lie, 1.35 * lie]} />
      {t < 0.97 ? [0, 1, 2, 3].map((i) => { const a = i * Math.PI / 2 + Math.PI / 4; return <Rope key={i} a={[bx + Math.cos(a) * 0.3, by + 1.15, bz - 0.15 + Math.sin(a) * 0.3]} b={[bx + Math.cos(a) * r * 0.9, by + h, bz + Math.sin(a) * r * 0.9]} />; }) : null}
      {/* basket: upright while flying, tips forward about its front-bottom edge */}
      <group position={[bx, by, bz + r]}><group rotation={[tip * Math.PI / 2, 0, 0]}><group position={[0, 0, -r]} scale={bs}><WickerBasket r={0.44} h={0.4} /></group></group></group>
      <Sheep spec={CAST.Sheep} pose={sheep} />
      <Duck spec={CAST.Duck} pose={duck} />
      <Rooster spec={CAST.Rooster} pose={rooster} />
    </Stage>
  );
};
export default S4_0;
