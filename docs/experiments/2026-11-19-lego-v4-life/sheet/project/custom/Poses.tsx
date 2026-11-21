// Character sheet, section 3: running, jumping mid-air, laughing, crying.
import React from "react";
import { Stage, Toy, Floor } from "./_kit";
import { BOY } from "./_boy";
const Poses: React.FC = () => <Stage bg="#a7a9ab" camera={{ pos: [0, 0.9, 8.5], look: [0, 0.75, 0], fov: 15 }}>
  <Floor c="#a7a9ab" planks={false} />
  <Toy spec={BOY} pose={{ x: -1.65, rotY: 1.0, walk: 0.11, lean: 0.25, expr: "joy", armL: 0.5, armR: -0.4, still: true }} />
  <Toy spec={BOY} pose={{ x: -0.55, y: 0.32, armL: 2.6, armR: 2.6, armLSide: 0.5, armRSide: 0.5, expr: "laugh", still: true }} />
  <Toy spec={BOY} pose={{ x: 0.55, rotY: -0.3, lean: -0.15, armR: 0.5, elbowR: 1.2, armL: 0.4, elbowL: 1.1, expr: "laugh", tilt: -0.15, still: true }} />
  <Toy spec={BOY} pose={{ x: 1.65, crouch: 1, expr: "cry", tilt: 0.35, still: true, armL: 2.7, armR: 2.7, elbowL: 2.5, elbowR: 2.5, armLSide: -0.05, armRSide: -0.05 }} />
</Stage>;
export default Poses;
