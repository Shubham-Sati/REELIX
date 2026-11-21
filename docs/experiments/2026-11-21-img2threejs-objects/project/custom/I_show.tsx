// One img2threejs object (the Three.js group its code generator wrote), 3/4 view, same floor, light and camera rule as the
// kit experiment, so the two can be compared fairly. props: obj (name), h (height m), l (length m), bare (green, for silhouettes).
import React, { useMemo } from "react";
import * as THREE from "three";
import { Stage } from "./_kit";
import { MODELS } from "./_models";

export default function I_show({ obj = "car", h = 1.5, l = 4, bare = false, strip = false }: { obj?: string; h?: number; l?: number; bare?: boolean; strip?: boolean }) {
  const group = useMemo(() => {
    const make = MODELS[obj]; if (!make) return null;
    const g = make(); g.traverse((m: any) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; if (strip) m.material = new THREE.MeshBasicMaterial({ color: "#7a7a7a" }); } });   // strip: unlit, no colours (the skill's map-stripped evidence)
    const box = new THREE.Box3().setFromObject(g), c = new THREE.Vector3(); box.getCenter(c);
    const wrap = new THREE.Group(); g.position.set(-c.x, -box.min.y, -c.z); wrap.add(g); return wrap;   // stand it on the ground, centred
  }, [obj, strip]);
  const d = Math.max(h, l * 0.8) * 2.3;
  return <Stage bg={bare ? "#00ff00" : "#dde6ec"} camera={{ pos: [d * 0.62, h * 0.55 + d * 0.22, d * 0.92], look: [0, h * 0.45, 0], fov: 30 }}>
    {bare ? null : <mesh position={[0, -0.005, 0]} receiveShadow><cylinderGeometry args={[Math.max(h, l) * 1.4, Math.max(h, l) * 1.4, 0.01, 64]} /><meshStandardMaterial color="#c9d6c0" roughness={0.9} /></mesh>}
    {group ? <group rotation={[0, -0.5, 0]}><primitive object={group} /></group> : null}
  </Stage>;
}
