// Everything together in one street scene, with a kit person for scale.
import React from "react";
import { Stage, Tree, Toy } from "./_kit";
import * as O from "./_objects";

export default function G_all() {
  return <Stage bg="#cfe2ee" camera={{ pos: [0, 6.5, 24], look: [0, 2, 0], fov: 38 }}>
    <mesh position={[0, -0.005, 0]} receiveShadow><cylinderGeometry args={[40, 40, 0.01, 64]} /><meshStandardMaterial color="#b9cfa8" roughness={0.9} /></mesh>
    <O.Mountain p={[-14, 0, -22]} /><O.Mountain p={[4, 0, -26]} />
    <O.Cottage p={[-9, 0, -6]} /><O.Townhouse p={[-4, 0, -7]} /><O.Hut p={[1, 0, -6]} />
    <O.PineTree p={[5, 0, -7]} /><O.PalmTree p={[8.5, 0, -6]} /><Tree p={[12, 0, -6]} s={2.2} />
    <O.Train p={[-8, 0, 1]} /><O.Bus p={[0, 0, 1]} />
    <O.Car p={[7, 0, 2]} /><O.Boat p={[12, 0, 1]} />
    <O.Bicycle p={[-3, 0, 6]} /><O.Motorbike p={[-1, 0, 6]} /><O.Rocks p={[2.5, 0, 6.5]} /><O.Nest p={[4.5, 0, 7]} />
    <Toy spec={{ name: "Scale", skin: "#f1c9a5", hair: "#3a2a20", coat: "#2a6fd0", pants: "#333a44" }} pose={{ x: 0.8, z: 6.2 }} />
    <O.Plane p={[6, 6, -10]} />
  </Stage>;
}
