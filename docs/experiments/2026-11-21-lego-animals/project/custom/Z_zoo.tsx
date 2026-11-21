// All test animals together at real relative size (plus the kit's Sheep, Duck, Rooster), a wide group shot.
import React from "react";
import { Stage, Sheep, Duck, Rooster, Quad, Bird, Fish, Turtle, ANIMALS as ZOO } from "./_kit";

export default function Z_zoo() {
  const Z: any = ZOO;
  return <Stage bg="#dde6ec" camera={{ pos: [0.2, 2.4, 7.6], look: [0, 0.75, 0], fov: 34 }}>
    <mesh position={[0, -0.005, 0]} receiveShadow><cylinderGeometry args={[9, 9, 0.01, 64]} /><meshStandardMaterial color="#c9d6c0" roughness={0.9} /></mesh>
    {/* back row: the big ones */}
    <Quad spec={Z.giraffe} pose={{ x: -2.6, z: -1.6, rotY: 0.5 }} />
    <Quad spec={Z.elephant} pose={{ x: -0.6, z: -1.5, rotY: 0.35 }} />
    <Quad spec={Z.horse} pose={{ x: 1.4, z: -1.4, rotY: -0.4 }} />
    <Quad spec={Z.cow} pose={{ x: 3.0, z: -1.2, rotY: -0.6 }} />
    {/* middle row */}
    <Quad spec={Z.lion} pose={{ x: -2.9, z: 0.1, rotY: 0.6 }} />
    <Quad spec={Z.bear} pose={{ x: -1.5, z: 0.2, rotY: 0.3 }} />
    <Quad spec={Z.pig} pose={{ x: -0.2, z: 0.3, rotY: 0.1 }} />
    <Quad spec={Z.dog} pose={{ x: 1.0, z: 0.4, rotY: -0.3 }} />
    <Sheep spec={{ name: "Sheep", kind: "sheep", wool: "#f3efe6", face: "#2b2522", legs: "#2b2522" }} pose={{ x: 2.2, z: 0.3, rotY: -0.5 }} />
    <Turtle spec={Z.turtle} pose={{ x: 3.3, z: 0.4, rotY: -0.7 }} />
    {/* front row: the small ones */}
    <Quad spec={Z.cat} pose={{ x: -2.75, z: 2.0, rotY: 0.6 }} />
    <Quad spec={Z.rabbit} pose={{ x: -1.75, z: 2.0, rotY: 0.35 }} />
    <Bird spec={Z.penguin} pose={{ x: -0.7, z: 1.8, rotY: 0.2 }} />
    <Bird spec={Z.owl} pose={{ x: 0.0, z: 1.9, rotY: 0 }} />
    <Bird spec={Z.parrot} pose={{ x: 0.7, z: 1.8, rotY: -0.2 }} />
    <Duck spec={{ name: "Duck", kind: "duck", body: "#f4f1e8", bill: "#f0a030", feet: "#f0a030" }} pose={{ x: 1.4, z: 1.8, rotY: -0.3 }} />
    <Rooster spec={{ name: "Rooster", kind: "rooster", body: "#c4602a", tail: "#1f4a3a", comb: "#d8282a", beak: "#e8b040", legs: "#e8b040" }} pose={{ x: 2.1, z: 1.7, rotY: -0.4 }} />
    <Fish spec={Z.fish} pose={{ x: 2.7, y: 0.4, z: 2.3, rotY: -1.1 }} />
  </Stage>;
}
