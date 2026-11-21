// S1_0 — Farm picnic (11 s, crowd test): 4 people (Grandpa, Dad, Mum, Kid) and 3 animals (sheep, duck, rooster) in one frame,
// all moving. Sheep wanders in, duck waddles over, rooster hops on the log and crows, Grandpa laughs, Kid chases the duck.
import React from "react";
import { Stage, Toy, Sheep, Duck, Rooster, Floor, Hill, Tree, Cloud, FireFX, kf, useShotTime, ToySpec, SheepSpec, DuckSpec, RoosterSpec } from "./_kit";

const P = {
  Grandpa: { name: "Grandpa", height: 0.97, build: 0.55, skin: "#f0c6a8", hair: "#ecebe6", hairStyle: "short", coat: "#7a5a3a", shirt: "#efe3c4", pants: "#4a4038", shoes: "#2a2420", beard: true, beardColor: "#ecebe6", cheeks: "#e8a68a" } as ToySpec,
  Dad: { name: "Dad", height: 1.05, build: 0.45, skin: "#d9a07a", hair: "#2a1c14", hairStyle: "short", coat: "#2f5e8f", shirt: "#f3efe4", pants: "#3a3a40", shoes: "#2a2420", hat: "cap", hatColor: "#c4573a" } as ToySpec,
  Mum: { name: "Mum", height: 0.98, build: 0.2, skin: "#e8b48e", hair: "#5a3020", hairStyle: "long", coat: "#c9425a", shirt: "#fbf3e6", pants: "#5a4a6a", shoes: "#3a2420", cheeks: "#e89a8a" } as ToySpec,
  Kid: { name: "Kid", height: 0.68, build: 0.3, skin: "#e2a882", hair: "#1e1410", hairStyle: "short", coat: "#f2b33d", shirt: "#ffffff", pants: "#2f6b3e", shoes: "#c4573a", cheeks: "#ee9a86" } as ToySpec,
};
const A = {
  Sheep: { name: "Sheep", kind: "sheep", wool: "#f4ecd8", face: "#1e1b1a", legs: "#1e1b1a" } as SheepSpec,
  Duck: { name: "Duck", kind: "duck", body: "#fbfaf5", bill: "#f08a24", feet: "#f08a24" } as DuckSpec,
  Rooster: { name: "Rooster", kind: "rooster", body: "#c8642a", tail: "#1f3a2c", comb: "#d8262a", beak: "#f2c230", legs: "#f2c230" } as RoosterSpec,
};
type K = [number, number][];
/** Position on a keyframed path and the direction it is moving (rotY, 0 = facing camera). */
const path = (t: number, xs: K, zs: K, face = 0) => {
  const x = kf(t, xs), z = kf(t, zs), x2 = kf(t + 0.05, xs), z2 = kf(t + 0.05, zs);
  const moving = Math.hypot(x2 - x, z2 - z) > 0.002;
  return { x, z, moving, rotY: moving ? Math.atan2(x2 - x, z2 - z) : face };
};
const lerpAng = (a: number, b: number, k: number) => a + (b - a) * Math.max(0, Math.min(1, k));

const S1_0: React.FC = () => {
  const t = useShotTime();
  const ROOST = [1.45, 0.4] as const;                       // log top where the rooster lands
  const lookRooster = kf(t, [[5.2, 0], [5.6, 1], [7.4, 1], [7.8, 0]]);
  const crow = t > 5.9 && t < 7.0;

  // people
  const dadTalk = t < 2.4 ? Math.abs(Math.sin(t * 11)) * 0.8 : 0;
  const mumTalk = t > 2.4 && t < 4.4 ? Math.abs(Math.sin(t * 12)) * 0.8 : 0;
  const laugh = t > 6.0 && t < 8.6 ? 0.5 + 0.5 * Math.abs(Math.sin(t * 16)) : 0;
  const kidP = path(t, [[0, -0.15], [7.3, -0.15], [8.3, 0.55], [9.3, -0.25], [10.3, -0.95], [11, -1.2]], [[0, 0.9], [7.3, 0.9], [8.3, 1.25], [9.3, 1.55], [10.3, 1.2], [11, 0.95]], 0);

  // animals
  const sheep = path(t, [[0, -3.4], [0.6, -3.4], [3.0, -1.45], [7.6, -1.45], [9.6, -0.9], [11, -0.2]], [[0, 0.9], [3.0, 0.75], [7.6, 0.75], [9.6, 0.4], [11, 0.0]], 0.6);
  const duck = path(t, [[0, 3.2], [2.2, 3.2], [4.4, 1.05], [7.5, 1.05], [8.6, 0.25], [9.6, -0.55], [10.6, -1.35], [11, -1.6]], [[2.2, 1.35], [4.4, 1.2], [7.5, 1.2], [8.6, 1.55], [9.6, 1.75], [10.6, 1.45], [11, 1.3]], -0.5);
  const rHop = Math.max(0, Math.min(1, (t - 4.6) / 0.55));
  const rx = kf(t, [[3.8, 3.0], [4.6, 2.2], [5.15, ROOST[0]]]), rz = kf(t, [[3.8, 0.1], [4.6, 0.3], [5.15, ROOST[1]]]);
  const ry = 4 * 0.35 * rHop * (1 - rHop) + (t >= 5.15 ? 0.25 : 0.25 * rHop);

  // camera: slow orbit round the group
  const ang = kf(t, [[0, -0.32], [11, 0.32]], (k) => k), R = 8.6;
  const cam: [number, number, number] = [Math.sin(ang) * R, 2.6, Math.cos(ang) * R + 0.3];

  return (
    <Stage bg="#a9d4ec" fog={["#a9d4ec", 14, 30]} camera={{ pos: cam, look: [0, 0.75, 0.2], fov: 40 }}>
      <Floor c="#8cc068" planks={false} />
      <Hill p={[-5, 0, -8]} s={[6, 1.6, 3]} /><Hill p={[5, 0, -9]} s={[7, 2.0, 3]} c="#76a94e" />
      <Tree p={[-3.2, 0, -3.5]} s={1.2} /><Tree p={[3.6, 0, -3.0]} s={1.0} /><Tree p={[-1.4, 0, -5.5]} s={1.4} />
      <Cloud p={[-2.5, 6.5, -10]} s={1.4} /><Cloud p={[3, 7.2, -12]} s={1.8} />

      {/* campfire with stones and logs */}
      <group position={[0.1, 0, -0.5]}>
        {Array.from({ length: 8 }, (_, i) => { const a = i / 8 * Math.PI * 2; return <mesh key={i} position={[Math.cos(a) * 0.42, 0.06, Math.sin(a) * 0.42]} scale={[1, 0.7, 1]} castShadow><sphereGeometry args={[0.1, 24, 16]} /><meshStandardMaterial color="#9a958c" roughness={0.8} /></mesh>; })}
        {[0.5, -0.5, 1.6].map((r, i) => <mesh key={i} position={[0, 0.07, 0]} rotation={[0, r, Math.PI / 2]} castShadow><cylinderGeometry args={[0.05, 0.05, 0.6, 24]} /><meshStandardMaterial color="#6a4428" roughness={0.9} /></mesh>)}
        <FireFX p={[0, 0.08, 0]} scale={0.7} t={t} light={5} seed={3} />
      </group>
      {/* log seat the rooster lands on */}
      <mesh position={[ROOST[0], 0.13, ROOST[1]]} rotation={[0, 0.3, Math.PI / 2]} castShadow receiveShadow><cylinderGeometry args={[0.13, 0.13, 0.9, 32]} /><meshStandardMaterial color="#7a5232" roughness={0.9} /></mesh>

      {/* people */}
      <Toy spec={P.Dad} pose={{ x: -0.95, z: -0.05, rotY: lerpAng(0.55, 1.2, lookRooster) + (t > 8 ? -0.6 : 0), mouth: dadTalk,
        armR: t < 2.4 ? 0.5 + 0.25 * Math.sin(t * 5) : kf(t, [[7.8, 0], [8.2, 1.5], [9.5, 1.5], [9.9, 0]]), armRSide: kf(t, [[7.8, 0], [8.2, 0.4]]),
        armL: kf(t, [[7.8, 0], [8.2, 1.5], [9.5, 1.5], [9.9, 0]]), armLSide: kf(t, [[7.8, 0], [8.2, 0.4]]), head: lookRooster * 0.3 }} />
      <Toy spec={P.Mum} pose={{ x: 0.85, z: -0.35, rotY: lerpAng(-0.6, -0.1, kf(t, [[3.4, 0], [4.0, 1]])) + lookRooster * 0.3, mouth: mumTalk + laugh * 0.4,
        armR: kf(t, [[3.4, 0], [3.8, 1.1], [5.0, 1.1], [5.4, 0.2]]), armRSide: kf(t, [[3.4, 0], [3.8, 0.25]]), head: kf(t, [[3.4, 0], [3.9, -0.3], [5.2, 0.4]]) }} />
      <Toy spec={P.Grandpa} pose={{ x: -0.35, z: -1.55, rotY: 0.15 + lookRooster * 0.5, mouth: laugh,
        lean: t > 6.0 && t < 8.6 ? -0.12 - 0.05 * Math.sin(t * 16) : kf(t, [[0, 0.1], [2, 0.1]]),
        armL: laugh ? 0.35 : 0.15, armR: laugh ? 0.35 : 0.15, armLSide: 0.15, armRSide: 0.15, tilt: laugh ? -0.25 : 0 }} />
      <Toy spec={P.Kid} pose={{ x: kidP.x, z: kidP.z, rotY: kidP.moving ? kidP.rotY : lerpAng(-0.4, -0.9, kf(t, [[0.8, 0], [1.5, 1]])) + lookRooster * 1.2,
        walk: kidP.moving ? t * 1.7 : 0, lean: kidP.moving ? 0.18 : 0, mouth: t > 7.3 ? 0.4 + 0.4 * Math.abs(Math.sin(t * 9)) : 0,
        armR: kidP.moving ? 0.4 : kf(t, [[1.2, 0], [1.6, 1.6], [2.6, 1.6], [3.0, 0]]), armRSide: kidP.moving ? 0 : 0.3 + 0.2 * Math.sin(t * 14) }} />

      {/* animals */}
      <Sheep spec={A.Sheep} pose={{ x: sheep.x, z: sheep.z, rotY: sheep.rotY, walk: sheep.moving ? t : 0, s: 1.05,
        head: sheep.moving ? 0 : 0.3 * Math.sin(t * 1.5), tilt: !sheep.moving && t < 6 ? 0.35 : lookRooster * -0.2 }} />
      <Duck spec={A.Duck} pose={{ x: duck.x, z: duck.z, rotY: duck.rotY, walk: duck.moving ? t * (t > 7.5 ? 1.8 : 1) : 0, s: 1.25,
        flap: t > 7.6 ? 0.5 + 0.5 * Math.sin(t * 30) : 0, head: duck.moving ? 0 : 0.4 * Math.sin(t * 3), tilt: !duck.moving ? 0.25 * Math.sin(t * 5) : 0 }} />
      <Rooster spec={A.Rooster} pose={{ x: rx, z: rz, y: ry, rotY: t < 5.15 ? -1.4 : lerpAng(-1.4, 0.2, (t - 5.15) / 0.4), s: 1.15,
        walk: t > 3.8 && t < 4.6 ? t : 0, flap: (t > 4.6 && t < 5.2) || crow ? 0.6 + 0.4 * Math.sin(t * 34) : 0,
        tilt: crow ? -0.6 : 0, beak: crow ? 1 : 0, puff: crow ? 1 : 0 }} />
    </Stage>
  );
};
export default S1_0;
