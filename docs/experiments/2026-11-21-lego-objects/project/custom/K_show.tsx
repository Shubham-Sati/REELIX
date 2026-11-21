// One kit model, 3/4 front view, same camera rule and floor as O_show. props: file (in the assets folder), h (height, m), l (length, m), bare, smooth.
import React from "react";
import { Stage } from "./_kit";
import { Model } from "./_model";

export default function K_show({ file = "models/q/car.glb", h = 1.5, l = 4, bare = false, smooth = false, body, flip = false }: { file?: string; h?: number; l?: number; bare?: boolean; smooth?: boolean; body?: string; flip?: boolean }) {
  const d = Math.max(h, l * 0.8) * 2.3;
  return <Stage bg={bare ? "#00ff00" : "#dde6ec"} camera={{ pos: [d * 0.62, h * 0.55 + d * 0.22, d * 0.92], look: [0, h * 0.45, 0], fov: 30 }}>
    {bare ? null : <mesh position={[0, -0.005, 0]} receiveShadow><cylinderGeometry args={[Math.max(h, l) * 1.4, Math.max(h, l) * 1.4, 0.01, 64]} /><meshStandardMaterial color="#c9d6c0" roughness={0.9} /></mesh>}
    <Model file={file} h={h} smooth={smooth} body={body} rotY={-0.5 + (flip ? Math.PI : 0)} />
  </Stage>;
}
