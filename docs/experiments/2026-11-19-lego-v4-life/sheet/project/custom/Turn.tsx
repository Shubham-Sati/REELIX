// Character sheet, section 1: front, profile, back.
import React from "react";
import { Stage, Toy, Floor } from "./_kit";
import { BOY } from "./_boy";
const Turn: React.FC = () => <Stage bg="#a7a9ab" camera={{ pos: [0, 0.75, 7.5], look: [0, 0.68, 0], fov: 16 }}>
  <Floor c="#a7a9ab" planks={false} />
  <Toy spec={BOY} pose={{ x: -1.05, rotY: 0, still: true, armR: 1.9, elbowR: 1.9, armRSide: 0.1, expr: "neutral" }} />
  <Toy spec={BOY} pose={{ x: 0, rotY: Math.PI / 2, still: true }} />
  <Toy spec={BOY} pose={{ x: 1.05, rotY: Math.PI, still: true }} />
</Stage>;
export default Turn;
