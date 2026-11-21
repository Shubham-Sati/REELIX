// S3_0 — high sky over a grassy hilltop: the brothers look up at the empty sky; Etienne scratches his head, Joseph takes a huge breath and holds his chest ("could anything breathe up there?").
import React from "react";
import { Stage, Toy, Cloud, Town, kf, useShotTime, CAST, Expr } from "./_kit";

type Props = { lines: { speaker: string; start: number; end: number }[]; start: number; duration: number; accent: string };

const S3_0: React.FC<Props> = () => {
  const t = useShotTime();
  // words (shot time): "could anything" 0.14-0.58, "breathe" 0.58-0.95, "up there?" 0.95-1.5, "So at Versailles" 2.0+
  const breath = kf(t, [[0.45, 0], [0.6, -0.15], [1.05, 1], [2.0, 0.9], [2.4, 0.2]]);   // dip, big inhale, hold, let out
  const jo = {
    x: -0.5, z: 0.1, rotY: 0.25,
    head: kf(t, [[0, 0.1], [1.0, 0.25]]),
    tilt: kf(t, [[0, -0.45], [0.6, -0.3], [1.05, -0.65], [2.3, -0.5]]),
    lean: -0.18 * Math.max(0, breath),
    armL: kf(t, [[0.5, 0.1], [0.95, 1.25], [2.6, 1.2]]),           // hand to chest
    armLSide: kf(t, [[0.5, 0], [0.95, -0.55]]),
    armR: kf(t, [[0.5, 0.1], [1.0, 0.35]]),
    mouth: kf(t, [[2.2, 0], [2.45, 0.4]]),
    look: 1, expr: (t < 0.5 ? "neutral" : t < 1.4 ? "surprised" : "fear") as Expr,
  };
  const scratch = kf(t, [[0.25, 0], [0.65, 1], [2.3, 1], [2.6, 0.6]]);
  const et = {
    x: 0.5, z: 0.0, rotY: -0.3,
    head: kf(t, [[0, -0.05], [0.9, -0.3], [1.6, -0.1]]),
    tilt: kf(t, [[0, -0.5], [1.0, -0.35], [2.0, -0.55]]) + 0.08 * scratch * Math.sin(t * 3),
    armR: 2.75 * scratch + Math.sin(t * 22) * 0.07 * scratch,
    armRSide: -0.2 * scratch,
    armL: kf(t, [[0, 0.1], [1.0, 0.2]]),
    look: 1,
    mouth: 0, expr: (t < 0.3 ? "neutral" : "sad") as Expr,
  };
  const drift = -t * 0.35;
  return (
    <Stage bg="#8ec8ee" fog={["#b7dcf3", 18, 46]}
      camera={{ pos: [kf(t, [[0, 1.3], [1.4, 0.15], [2.7, 0]]), kf(t, [[0, 2.5], [1.3, 1.55], [2.7, 1.5]]), 6.2], look: [kf(t, [[0, 1.4], [1.4, 0.15], [2.7, 0]]), kf(t, [[0, 3.3], [1.3, 1.25], [2.7, 1.2]]), 0], fov: 42 }}>
      {/* grassy hilltop: a flat-topped mound */}
      <mesh position={[0, -0.6, 0]} receiveShadow castShadow><cylinderGeometry args={[2.4, 4.2, 1.2, 32]} /><meshStandardMaterial color="#7fb55a" roughness={0.9} /></mesh>
      <mesh position={[0, -2.2, -1]} receiveShadow><cylinderGeometry args={[4.2, 7, 2, 32]} /><meshStandardMaterial color="#6aa24a" roughness={0.9} /></mesh>
      {/* tiny toy rooftops far below */}
      <group position={[0, -9, -22]} scale={0.8}><Town rows={4} cols={18} p={[-11, 0, 0]} seed={12} /></group>
      <ambientLight intensity={0.9} color="#eaf4ff" />
      <Cloud p={[3.0 + drift, 5.2, -9]} s={0.9} /><Cloud p={[-1.6 + drift, 6.4, -11]} s={1.1} /><Cloud p={[4.6 + drift, 3.4, -12]} s={1.0} />
      <Cloud p={[-3.6 + drift, 3.0, -12]} s={0.9} /><Cloud p={[0.8 + drift, 3.6, -14]} s={1.2} />
      <Toy spec={CAST.Joseph} pose={jo} />
      <Toy spec={CAST.Etienne} pose={et} />
    </Stage>
  );
};
export default S3_0;
