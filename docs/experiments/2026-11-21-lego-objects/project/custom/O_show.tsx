// One object, 3/4 front view, on a soft round floor. props: obj (name), bare (green screen, no floor: silhouette check).
import React from "react";
import { Stage, Tree, Hill, Town } from "./_kit";
import * as O from "./_objects";

// [component, height, length]: the camera frames each object from its size
const LIST: Record<string, [React.ReactNode, number, number]> = {
  "kit-tree": [<Tree p={[0, 0, 0]} s={2.2} />, 3.6, 2.6], "kit-hill": [<Hill p={[0, 0, 0]} s={[4, 1.6, 3]} />, 1.6, 8], "kit-house": [<Town rows={1} cols={1} p={[0.6, 0, 0]} />, 1.6, 1.4],
  rocks: [<O.Rocks />, 0.7, 1.6], mountain: [<O.Mountain />, 6.2, 10], pine: [<O.PineTree />, 4.4, 2.6], palm: [<O.PalmTree />, 5.8, 4.4], nest: [<O.Nest />, 0.25, 0.5],
  cottage: [<O.Cottage />, 4.6, 4.6], townhouse: [<O.Townhouse />, 6.6, 3.4], hut: [<O.Hut />, 3.8, 4],
  car: [<O.Car />, 1.5, 4.2], bus: [<O.Bus />, 2.9, 8.2], train: [<O.Train />, 3.2, 6.2], bicycle: [<O.Bicycle />, 1.0, 1.5], motorbike: [<O.Motorbike />, 1.1, 1.9],
  boat: [<O.Boat />, 4.2, 4.2], plane: [<O.Plane />, 3, 8],
};
export const NAMES = Object.keys(LIST);
export default function O_show({ obj = "car", bare = false }: { obj?: string; bare?: boolean }) {
  const [node, h, l] = LIST[obj] || LIST.car, d = Math.max(h, l * 0.8) * 2.3;
  return <Stage bg={bare ? "#00ff00" : "#dde6ec"} camera={{ pos: [d * 0.62, h * 0.55 + d * 0.22, d * 0.92], look: [0, h * 0.45, 0], fov: 30 }}>
    {bare ? null : <mesh position={[0, -0.005, 0]} receiveShadow><cylinderGeometry args={[Math.max(h, l) * 1.4, Math.max(h, l) * 1.4, 0.01, 64]} /><meshStandardMaterial color="#c9d6c0" roughness={0.9} /></mesh>}
    {node}
  </Stage>;
}
