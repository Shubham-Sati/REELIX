// S4_0: cutaway balloon, hot orange air spreads, cool blue stays packed, smoke fades, balloon lifts. Frame-driven only.
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

const rnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const R = 1.5, SY = 1.15, CY = 1.6;

export default function S4_0({ accent = "#E8A33D", image }: { accent?: string; font?: string; duration?: number; image?: string }) {
  const f = useCurrentFrame(); const { fps, width, height, durationInFrames } = useVideoConfig();
  const t = f / fps;
  const heat = interpolate(f, [0, durationInFrames * 0.7], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) });
  const lift = interpolate(f, [durationInFrames * 0.3, durationInFrames], [0, 1.6], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const appear = interpolate(f, [0, 18], [0, 1], { extrapolateRight: "clamp" });
  const orbit = interpolate(f, [0, durationInFrames], [-0.45, 0.45]);
  const camR = 12.5;
  const gores = 12, cut = [0, 1]; // two gores omitted = cutaway window
  const colors = ["#c99a5b", "#a9773d"];

  const hot = Array.from({ length: 70 }, (_, i) => {
    const a = rnd(i) * Math.PI * 2, b = Math.acos(2 * rnd(i + 99) - 1), r = Math.cbrt(rnd(i + 7));
    const spread = 0.35 + 0.6 * heat, speed = 0.8 + 3.5 * heat;
    const w = (k: number) => Math.sin(t * speed * (0.6 + rnd(i + k)) + rnd(i + k * 3) * 20);
    const x = Math.sin(b) * Math.cos(a) * r * (R - 0.25) * spread + w(1) * 0.12 * (0.3 + heat);
    const y = Math.cos(b) * r * (R * SY - 0.3) * spread * 0.9 - 0.3 * (1 - heat) + w(2) * 0.12 * (0.3 + heat);
    const z = Math.sin(b) * Math.sin(a) * r * (R - 0.25) * spread + w(3) * 0.12 * (0.3 + heat);
    return <mesh key={i} position={[x, y, z]}><sphereGeometry args={[0.06 + 0.03 * heat, 10, 10]} /><meshBasicMaterial color={heat > 0.5 ? "#ff8a1f" : "#ffb25a"} /></mesh>;
  });
  const cool = Array.from({ length: 60 }, (_, i) => {
    const a = rnd(i + 500) * Math.PI * 2, y0 = (rnd(i + 600) - 0.2) * 3.2;
    const rr = R * 1.7 + rnd(i + 700) * 0.35;
    const x = Math.cos(a) * rr + Math.sin(t * 1.2 + i) * 0.03, z = Math.sin(a) * rr + Math.cos(t * 1.1 + i) * 0.03;
    return <mesh key={i} position={[x, CY - 1.4 + y0, z]}><sphereGeometry args={[0.055, 10, 10]} /><meshBasicMaterial color="#5aa9ff" /></mesh>;
  });
  const smoke = Array.from({ length: 16 }, (_, i) => {
    const life = (t * 0.45 + i / 16) % 1;
    const x = Math.sin(i * 2.3 + life * 4) * 0.25 * (0.4 + life), z = Math.cos(i * 1.7 + life * 3) * 0.25 * life;
    const y = -SY * R * 0.95 + life * 2.6;
    return <mesh key={i} position={[x, y, z]} scale={0.7 + life * 1.8}><sphereGeometry args={[0.17, 12, 12]} /><meshBasicMaterial color="#8a8a90" transparent opacity={0.45 * (1 - life) * appear} depthWrite={false} /></mesh>;
  });

  return (
    <AbsoluteFill style={{ background: "#10131f" }}>
      {image ? <Img src={staticFile(image)} style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", filter: "brightness(.7)" }} /> : null}
      <ThreeCanvas width={width} height={height} camera={{ fov: 40, position: [Math.sin(orbit) * camR, 1.2, Math.cos(orbit) * camR], near: 0.1, far: 60 }}>
        <CamLook orbit={orbit} camR={camR} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[4, 6, 5]} intensity={1.8} />
        <pointLight position={[0, -2.5, 1]} intensity={40 * (0.4 + heat)} color="#ff8a1f" />
        <group scale={appear}>
          {/* fire (stays on the ground) */}
          <group position={[0, -2.1, 0]}>
            {[0, 1, 2].map((i) => {
              const fl = 0.8 + 0.25 * Math.sin(t * 9 + i * 2);
              return <mesh key={i} position={[(i - 1) * 0.12, 0.25 * fl, 0]} scale={[1, fl * (1.3 - i * 0.2), 1]}><coneGeometry args={[0.28 - i * 0.05, 0.8, 16]} /><meshBasicMaterial color={["#ff5a14", "#ff9a1f", "#ffd35a"][i]} /></mesh>;
            })}
            <mesh position={[0, -0.12, 0]}><cylinderGeometry args={[0.5, 0.6, 0.15, 20]} /><meshStandardMaterial color="#3a2a20" /></mesh>
          </group>
          {/* balloon + contents lift together */}
          <group position={[0, CY + lift, 0]}>
            <group position={[0, 0, 0]} scale={[1, SY, 1]}>
              {Array.from({ length: gores }, (_, i) => cut.includes(i) ? null : (
                <mesh key={i} rotation={[0, 0, 0]}>
                  <sphereGeometry args={[R, 24, 32, (i * Math.PI * 2) / gores + 0.015, (Math.PI * 2) / gores - 0.03, 0, 2.55]} />
                  <meshStandardMaterial color={colors[i % 2]} roughness={0.85} side={THREE.DoubleSide} transparent opacity={0.9} />
                </mesh>
              ))}
              {/* neck ring */}
              <mesh position={[0, R * Math.cos(2.55), 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[R * Math.sin(2.55), 0.04, 8, 40]} /><meshStandardMaterial color="#5a3b1e" />
              </mesh>
            </group>
            <group position={[0, 0, 0]}>{hot}</group>
            <group position={[0, 0, 0]}>{smoke}</group>
            <mesh position={[0, 0, 0]} scale={[1, SY, 1]}>
              <sphereGeometry args={[R * 0.92, 24, 24]} />
              <meshBasicMaterial color="#ff8a1f" transparent opacity={0.12 * heat} depthWrite={false} />
            </mesh>
            {/* lift arrow glow */}
            <group position={[0, -SY * R - 0.9 + Math.sin(t * 3) * 0.08, 0]} scale={heat}>
              <mesh><coneGeometry args={[0.35, 0.6, 20]} /><meshBasicMaterial color={accent} transparent opacity={0.55} /></mesh>
              <mesh position={[0, -0.5, 0]}><cylinderGeometry args={[0.1, 0.1, 0.5, 12]} /><meshBasicMaterial color={accent} transparent opacity={0.4} /></mesh>
            </group>
          </group>
          {/* cool air stays packed on the outside, relative to the balloon centre */}
          <group position={[0, 0, 0]}>{cool}</group>
        </group>
      </ThreeCanvas>
    </AbsoluteFill>
  );
}

function CamLook({ orbit, camR }: { orbit: number; camR: number }) {
  // frame-driven: camera position is set from props each render, so just aim it
  const { camera } = useThree();
  camera.position.set(Math.sin(orbit) * camR, 1.2, Math.cos(orbit) * camR);
  camera.lookAt(0, 1.3, 0);
  camera.updateProjectionMatrix();
  return null;
}
