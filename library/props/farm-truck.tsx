// prop category=truck h=2.4
// Toy delivery truck: green cab, white box back with rear doors that open (open 0..1) so cargo inside shows. Faces +z.
// Length ~4.5 m, width 1.9 m (a kit person is ~1.7). wheel = wheel turn angle in radians (pass distance / 0.4 when driving).
// cargo: children placed on the box floor (origin = box floor centre, +z toward the cab).
import React from "react";
import { Box, Ball, mat } from "./_kit";

type P3 = [number, number, number];
const CAB = "#2f9a4a", BOX = "#f4f4f0", DARK = "#2b2b2e", GLASS = "#a9d3ee", TRIM = "#d7d9dc";

const Wheel: React.FC<{ p: P3; a: number }> = ({ p, a }) => <group position={p} rotation={[a, 0, 0]}>
  <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.4, 0.4, 0.3, 40]} />{mat(DARK)}</mesh>
  <mesh rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[0.36, 0.05, 16, 48]} />{mat("#3a3a3e")}</mesh>
  {[1, -1].map((s) => <group key={s}>
    <mesh position={[s * 0.152, 0, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.2, 0.2, 0.012, 32]} />{mat(TRIM)}</mesh>
    {[0, 1, 2, 3].map((i) => <Ball key={i} r={0.03} p={[s * 0.16, Math.cos(i * Math.PI / 2) * 0.11, Math.sin(i * Math.PI / 2) * 0.11]} c="#8a8d92" />)}
  </group>)}
</group>;

const FarmTruck: React.FC<{ p?: P3; rotY?: number; s?: number; wheel?: number; open?: number; cargo?: React.ReactNode; bounce?: number }> = ({ p = [0, 0, 0], rotY = 0, s = 1, wheel = 0, open = 0, cargo, bounce = 0 }) => {
  const door = open * 1.9;
  return <group position={p} rotation={[0, rotY, 0]} scale={s}>
    {[1.5, -1.25].map((z) => [1, -1].map((x) => <Wheel key={z + "_" + x} p={[x * 0.84, 0.4, z]} a={wheel} />))}
    <group position={[0, bounce, 0]}>
      {/* chassis */}
      <Box s={[1.7, 0.22, 4.4]} p={[0, 0.58, 0]} c={DARK} />
      {[1, -1].map((x) => [1.5, -1.25].map((z) => <Box key={x + "_" + z} s={[0.12, 0.3, 1.0]} p={[x * 0.9, 0.86, z]} c={x > 0 ? "#3a3a3e" : "#3a3a3e"} round={0.3} />))}
      {/* cab */}
      <group position={[0, 0, 1.55]}>
        <Box s={[1.86, 1.0, 1.25]} p={[0, 1.18, 0]} c={CAB} round={0.12} />
        <Box s={[1.8, 0.8, 1.05]} p={[0, 2.02, -0.1]} c={CAB} round={0.18} />
        <Box s={[1.6, 0.6, 0.05]} p={[0, 2.05, 0.43]} r={[-0.18, 0, 0]} c={GLASS} />
        {[1, -1].map((x) => <Box key={x} s={[0.05, 0.5, 0.62]} p={[x * 0.905, 2.04, -0.12]} c={GLASS} />)}
        <Box s={[1.9, 0.2, 0.18]} p={[0, 0.78, 0.62]} c={TRIM} />
        {[1, -1].map((x) => <group key={"h" + x}>
          <mesh position={[x * 0.62, 1.22, 0.63]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.12, 0.12, 0.04, 32]} /><meshStandardMaterial color="#fff6cf" emissive="#ffe9a0" emissiveIntensity={0.35} /></mesh>
          <Box s={[0.08, 0.16, 0.24]} p={[x * 0.99, 1.95, 0.2]} c={DARK} />
        </group>)}
        <Box s={[0.9, 0.3, 0.04]} p={[0, 1.2, 0.63]} c="#257a3a" />
      </group>
      {/* box back: floor, two side walls, front wall, roof; open rear with doors */}
      <group position={[0, 0.69, -0.75]}>
        <Box s={[1.9, 0.08, 2.9]} p={[0, 0.04, 0]} c="#b5875a" />
        {[1, -1].map((x) => <Box key={x} s={[0.06, 1.75, 2.9]} p={[x * 0.92, 0.95, 0]} c={BOX} />)}
        <Box s={[1.9, 1.75, 0.06]} p={[0, 0.95, 1.42]} c={BOX} />
        <Box s={[1.96, 0.08, 2.98]} p={[0, 1.86, 0]} c={BOX} />
        {[1, -1].map((x) => <Box key={"st" + x} s={[0.07, 0.22, 2.92]} p={[x * 0.93, 0.3, 0]} c={CAB} />)}
        {[1, -1].map((x) => <group key={"d" + x} position={[x * 0.95, 0.95, -1.45]} rotation={[0, x * -door, 0]}>
          <Box s={[0.95, 1.75, 0.05]} p={[-x * 0.475, 0, -0.03]} c={"#ecece6"} />
          <Box s={[0.04, 0.5, 0.04]} p={[-x * 0.85, 0, -0.07]} c={TRIM} />
        </group>)}
        <group position={[0, 0.08, 0]}>{cargo}</group>
      </group>
    </group>
  </group>;
};
export default FarmTruck;
