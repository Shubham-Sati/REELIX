// Loads a ready-made 3D model (.glb from a free CC0 kit) into a Lego shot (experiment 2026-11-21-lego-objects).
// - waits for the file before Remotion draws the frame (delayRender), so no empty frames;
// - sizes it to a real height in metres (1 unit = 1 m; a kit person is about 1.75) and stands it on the ground, centred;
// - repaints every part in the Lego V5 satin plastic (same colour, roughness 0.55, no metal), keeping the kit's colours;
//   smooth = true also rounds the low-poly facets (smooth normals).
import React, { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { continueRender, delayRender, staticFile } from "remotion";

const cache = new Map<string, Promise<THREE.Object3D>>();
function load(file: string) {
  if (!cache.has(file)) cache.set(file, new Promise((ok, fail) => {
    if (file.endsWith(".obj")) {   // OBJ + its .mtl next to it (colours per part)
      new MTLLoader().load(staticFile(file.replace(/\.obj$/, ".mtl")), (mtl) => { mtl.preload(); new OBJLoader().setMaterials(mtl).load(staticFile(file), ok, undefined, fail); }, undefined,
        () => new OBJLoader().load(staticFile(file), ok, undefined, fail));
    } else new GLTFLoader().load(staticFile(file), (g) => ok(g.scene), undefined, fail);
  }));
  return cache.get(file)!;
}
/** Part colours by material NAME, for model files that kept only names (Quaternius OBJ: every Kd is the default grey).
 *  body = the main paint colour of this object. */
const byName = (name: string, body: string) => {
  const n = name.toLowerCase();
  if (/window|glass/.test(n)) return "#9cc6e8";
  if (/light|lamp/.test(n)) return "#fff1b8";
  if (/wheel|tire|tyre|bottom|rubber/.test(n)) return "#2a2a2a";
  if (/bumper|metal|chrome|handle|details|frame/.test(n)) return "#9a9a9a";
  if (/yellow/.test(n)) return "#f2b632";
  return body;   // Top, Bike, Material...: the body paint
};
export const Model: React.FC<{ file: string; h: number; p?: [number, number, number]; rotY?: number; smooth?: boolean; plastic?: boolean; body?: string }> = ({ file, h, p = [0, 0, 0], rotY = 0, smooth = false, plastic = true, body }) => {
  const [scene, setScene] = useState<THREE.Object3D | null>(null);
  const [handle] = useState(() => delayRender("model " + file));
  useEffect(() => { load(file).then((s) => { setScene(s); continueRender(handle); }).catch((e) => { console.error(e); continueRender(handle); }); }, [file, handle]);
  const obj = useMemo(() => {
    if (!scene) return null;
    const o = scene.clone(true);
    o.traverse((m: any) => {
      if (!m.isMesh) return;
      m.castShadow = true; m.receiveShadow = true;
      if (smooth) { const g = m.geometry.clone(); g.deleteAttribute("normal"); m.geometry = mergeVertices(g, 1e-4); m.geometry.computeVertexNormals(); }   // shared corners get one averaged normal: round shading
      if (plastic) {
        const src = Array.isArray(m.material) ? m.material : [m.material];
        const out = src.map((s: any) => new THREE.MeshStandardMaterial({ color: body ? new THREE.Color(byName(s.name || "", body)) : s.color ? s.color.clone() : new THREE.Color("#cccccc"), map: body ? null : s.map || null, roughness: 0.55, metalness: 0, flatShading: false,
          // keep leaf cut-outs (alpha maps) and two-sided cards, or leafy trees turn into speckled blocks
          alphaMap: s.alphaMap || null, transparent: !!s.transparent, alphaTest: s.alphaTest || (s.map && s.transparent ? 0.5 : 0), side: s.side ?? THREE.FrontSide, opacity: s.opacity ?? 1 }));
        m.material = Array.isArray(m.material) ? out : out[0];
      }
    });
    const box = new THREE.Box3().setFromObject(o), size = new THREE.Vector3(), c = new THREE.Vector3();
    box.getSize(size); box.getCenter(c);
    const k = size.y > 0 ? h / size.y : 1;
    const wrap = new THREE.Group(); o.position.set(-c.x, -box.min.y, -c.z); wrap.add(o); wrap.scale.setScalar(k);
    return wrap;
  }, [scene, h, smooth, plastic, body]);
  return obj ? <group position={p} rotation={[0, rotY, 0]}><primitive object={obj} /></group> : null;
};
