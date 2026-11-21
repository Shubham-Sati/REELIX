// The kit objects together in one street scene, with a kit person for scale (same layout as round 1's G_all).
import React from "react";
import { Stage, Toy } from "./_kit";
import { Model } from "./_model";
const q = (f: string) => "models/q/" + f;
export default function K_street() {
  return <Stage bg="#cfe2ee" camera={{ pos: [0, 6.5, 24], look: [0, 2, 0], fov: 38 }}>
    <mesh position={[0, -0.005, 0]} receiveShadow><cylinderGeometry args={[40, 40, 0.01, 64]} /><meshStandardMaterial color="#b9cfa8" roughness={0.9} /></mesh>
    <Model file={q("mountain-group.glb")} h={11} p={[-12, 0, -24]} /><Model file={q("mountain.glb")} h={9} p={[6, 0, -27]} />
    <Model file={q("house.glb")} h={5} p={[-9, 0, -6]} rotY={0.3} /><Model file={q("townhouse.glb")} h={7} p={[-3.5, 0, -7]} /><Model file={q("hut.glb")} h={3.5} p={[1.5, 0, -6]} rotY={-0.2} />
    <Model file={q("pine.glb")} h={5} p={[5, 0, -7]} /><Model file={q("palm.glb")} h={5.5} p={[8.5, 0, -6]} /><Model file={q("tree.glb")} h={4.5} p={[12, 0, -6]} />
    <Model file={q("train-front.glb")} h={3.6} p={[-9, 0, 1]} rotY={Math.PI / 2} /><Model file={q("Bus.obj")} h={3} p={[0, 0, 1]} rotY={Math.PI / 2} body="#d8402e" />
    <Model file={q("car.glb")} h={1.5} p={[7, 0, 2]} rotY={-0.4} /><Model file={q("sailboat.glb")} h={4.5} p={[12, 0, 1]} rotY={-0.6} />
    <Model file={q("Bicycle.obj")} h={1.05} p={[-3, 0, 6]} rotY={0.6} body="#2a6fd0" /><Model file={q("rocks.glb")} h={0.7} p={[3, 0, 6.5]} />
    <Toy spec={{ name: "Scale", skin: "#f1c9a5", hair: "#3a2a20", coat: "#2a6fd0", pants: "#333a44" }} pose={{ x: 0.5, z: 6.2 }} />
  </Stage>;
}
