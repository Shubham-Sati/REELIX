// S4_1 — Paris at golden hour, 21 Nov 1783: a sky-blue and gold balloon drifts across with two small passengers waving their hats from the ring gallery; crowds below wave back; the camera pulls back to the glowing city.
import React from "react";
import { Stage, Toy, MBalloon, Town, Crowd, Cloud, Floor, kf, handPos, useShotTime, ToySpec, Pose, kfA, Expr } from "./_kit";

type Props = { lines: { speaker: string; start: number; end: number }[]; start: number; duration: number; accent: string };

// two generic passengers (deliberately NOT Joseph or Etienne): different coats, hats in hand
const P1: ToySpec = { name: "Passenger1", height: 1.0, build: 0.4, skin: "#f2c7a5", hair: "#5a3a22", hairStyle: "ponytail", coat: "#b8402e", shirt: "#f1e6cc", pants: "#3a2c24", shoes: "#1c1a18", hat: "none" };
const P2: ToySpec = { name: "Passenger2", height: 0.95, build: 0.55, skin: "#e8b48e", hair: "#2a201a", hairStyle: "short", coat: "#3a5a8a", shirt: "#f1e6cc", pants: "#2a2a2a", shoes: "#1c1a18", hat: "none" };

const Tricorn: React.FC<{ p: [number, number, number]; r?: number }> = ({ p, r = 0 }) => (
  <group position={p} rotation={[0.3, r, 0.2]}>
    <mesh><cylinderGeometry args={[0.3, 0.3, 0.05, 3]} /><meshStandardMaterial color="#22201e" /></mesh>
    <mesh position={[0, 0.09, 0]}><cylinderGeometry args={[0.15, 0.17, 0.16, 32]} /><meshStandardMaterial color="#22201e" /></mesh>
  </group>
);

const Passenger: React.FC<{ spec: ToySpec; pose: Pose; p: [number, number, number]; s: number }> = ({ spec, pose, p, s }) => {
  const hand = handPos(spec, pose, 1);
  return <group position={p} scale={s}>
    <Toy spec={spec} pose={pose} />
    <Tricorn p={[hand[0], hand[1] + 0.12, hand[2]]} r={pose.armR || 0} />
  </group>;
};

const S4_1: React.FC<Props> = () => {
  const t = useShotTime();
  // words (shot time): "Two months after that" 0-0.92, "people flew" 0.92-1.87
  const bx = kf(t, [[0, -0.35], [3.2, 0.55]], (x) => x), by = 5.2 + Math.sin(t * 1.3) * 0.06;
  const wave = (ph: number) => kfA(t, [[0.2, 0.3], [0.75, 2.55]]) + Math.sin(t * 9 + ph) * 0.3 * kf(t, [[0.5, 0], [0.8, 1]]);
  const a = { rotY: 0.25, armR: wave(0), armL: 0.6, head: 0.2, tilt: 0.2, mouth: 0, look: 0, expr: "laugh" as Expr };
  const b = { rotY: -0.25, armR: wave(1.7), armL: 0.5, head: -0.2, tilt: 0.25, mouth: 0, look: 0, expr: "joy" as Expr };
  const cheer = kf(t, [[0.6, 0.2], [1.3, 1]]);
  return (
    <Stage bg="#f3bf7c" fog={["#f0c48a", 16, 46]}
      camera={{ pos: [kf(t, [[0, bx], [3.2, 0.1]]), kf(t, [[0, 5.75], [3.2, 7.6]]), kf(t, [[0, 3.1], [3.2, 14.5]])], look: [kf(t, [[0, bx], [3.2, 0.1]]), kf(t, [[0, 5.55], [3.2, 3.9]]), kf(t, [[0, 0], [3.2, -2]])], fov: 42 }}>
      <directionalLight position={[-8, 3, 4]} intensity={1.1} color="#ffb060" />
      <ambientLight intensity={0.25} color="#ffd8a8" />
      <mesh position={[-7, 4.5, -30]}><circleGeometry args={[2.2, 48]} /><meshBasicMaterial color="#ffe08a" /></mesh>
      <Floor c="#c9a46a" planks={false} size={80} />
      {/* the Seine: a blue ribbon between the two banks of toy houses */}
      <mesh position={[0, 0.01, -3.2]} rotation={[-Math.PI / 2, 0, 0.08]}><planeGeometry args={[60, 1.7]} /><meshStandardMaterial color="#4f8fc8" roughness={0.5} /></mesh>
      <Town rows={5} cols={18} p={[0.3, 0, 4.2]} seed={21} />
      <Town rows={6} cols={20} p={[0, 0, -4.8]} seed={22} />
      <Crowd n={10} x={[-3, 3]} z={[-1.9, -2.2]} seed={31} cheer={cheer} t={t} s={0.42} />
      <Cloud p={[-4.5, 7.6, -14]} s={1.4} /><Cloud p={[4.6, 8.4, -16]} s={1.7} /><Cloud p={[1.0, 9.6, -20]} s={2.0} />
      <MBalloon p={[bx, by, 0]} s={1.0} body="#7cc0ea" trim="#e8b53a" basket="gallery" rot={[0, 0, Math.sin(t * 1.1) * 0.03]} spin={t * 0.1}>
        <Passenger spec={P1} pose={a} p={[-0.42, 0, 0.62]} s={0.42} />
        <Passenger spec={P2} pose={b} p={[0.42, 0, 0.62]} s={0.42} />
      </MBalloon>
    </Stage>
  );
};
export default S4_1;
