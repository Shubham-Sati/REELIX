// Character sheet, section 2: facial expressions (close-up row). Props: set = 0 or 1 picks 4 expressions.
import React from "react";
import { Stage, Toy, Floor, Expr } from "./_kit";
import { BOY } from "./_boy";
const SETS: Expr[][] = [["neutral", "joy", "sad", "angry"], ["surprised", "fear", "laugh", "cry"]];
const Faces: React.FC<{ set?: number }> = ({ set = 0 }) => <Stage bg="#a7a9ab" camera={{ pos: [0, 1.15, 4.2], look: [0, 1.13, 0], fov: 12 }}>
  <Floor c="#a7a9ab" planks={false} />
  {SETS[set].map((e, i) => <Toy key={e} spec={BOY} pose={{ x: (i - 1.5) * 0.45, still: true, expr: e }} />)}
</Stage>;
export default Faces;
