// One animal, 3/4 front view, on a soft round floor. props: animal (key of ZOO), bare (green screen, no floor: for the silhouette check).
import React from "react";
import { Stage, useShotTime, Quad, Bird, Fish, Turtle, ANIMALS as ZOO } from "./_kit";

const FRAME: Record<string, [number, number, number]> = {   // [height, length, lift] of each animal, to frame the camera
  dog: [0.62, 0.95, 0], cat: [0.5, 0.95, 0], horse: [1.65, 1.5, 0], cow: [1.2, 1.4, 0], pig: [0.6, 1.0, 0], elephant: [1.65, 1.9, 0],
  giraffe: [2.75, 1.6, 0], lion: [1.05, 1.5, 0], bear: [0.95, 1.2, 0], rabbit: [0.55, 0.55, 0], penguin: [0.7, 0.45, 0], owl: [0.65, 0.45, 0],
  parrot: [0.6, 0.7, 0], fish: [0.4, 0.75, 0.32], turtle: [0.38, 0.85, 0],
};
export default function A_show({ animal = "dog", bare = false }: { animal?: keyof typeof ZOO; bare?: boolean }) {
  const t = useShotTime();
  const [h, l, lift] = FRAME[animal] || [1, 1, 0], d = Math.max(h, l) * 2.25, spec: any = ZOO[animal];
  const pose = { y: lift, rotY: -0.25 + Math.sin(t * 0.8) * 0.05 };
  const body = "neckLen" in spec ? <Quad spec={spec} pose={pose} /> : "upright" in spec ? <Bird spec={spec} pose={pose} />
    : "deep" in spec ? <Fish spec={spec} pose={{ ...pose, swim: t }} /> : <Turtle spec={spec} pose={pose} />;
  return <Stage bg={bare ? "#00ff00" : "#dde6ec"} camera={{ pos: [d * 0.62, h * 0.55 + d * 0.22, d * 0.92], look: [0, h * 0.48 + lift * 0.3, 0], fov: 30 }}>
    {bare ? null : <mesh position={[0, -0.005, 0]} receiveShadow><cylinderGeometry args={[Math.max(h, l) * 1.4, Math.max(h, l) * 1.4, 0.01, 64]} /><meshStandardMaterial color="#c9d6c0" roughness={0.9} /></mesh>}
    {body}
  </Stage>;
}
