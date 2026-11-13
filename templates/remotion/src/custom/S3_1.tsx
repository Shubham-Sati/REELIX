// S3_1 / S4_2: the real 1783 Annonay balloon: round sackcloth-and-paper sphere, open neck, NO basket, nothing hanging. Frame-driven only.
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

export default function S3_1({ accent = "#E8A33D", image, mode = "rise" }: { accent?: string; font?: string; duration?: number; image?: string; mode?: string }) {
  const f = useCurrentFrame(); const { width, height, durationInFrames } = useVideoConfig();
  const p = interpolate(f, [0, durationInFrames], [0, 1], { easing: Easing.inOut(Easing.sin), extrapolateRight: "clamp" });
  const float = mode === "float";
  const y = float ? 1.2 + p * 0.5 : -1.5 + p * 3.2;
  const spin = p * 0.9;
  const camY = float ? 0.4 : -2.2; // rise: look up from below
  const bands = Array.from({ length: 10 }, (_, i) => i);
  return (
    <AbsoluteFill style={{ background: "linear-gradient(180deg,#f2b66a 0%,#f7d9a0 55%,#e9c48a 100%)" }}>
      {image && !float ? <Img src={staticFile(image)} style={{ position: "absolute", width: "100%", height: "35%", bottom: 0, objectFit: "cover", objectPosition: "bottom", opacity: 0 }} /> : null}
      {/* far town silhouette (rise mode) */}
      {!float ? <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "20%", background: "linear-gradient(180deg,#3b2a1e,#1c130d)", clipPath: "polygon(0 40%,8% 40%,8% 22%,14% 22%,14% 38%,22% 38%,22% 30%,30% 30%,30% 45%,40% 45%,40% 18%,44% 8%,48% 18%,48% 42%,58% 42%,58% 28%,66% 28%,66% 40%,76% 40%,76% 25%,84% 25%,84% 44%,100% 44%,100% 100%,0 100%)" }} /> : null}
      <ThreeCanvas width={width} height={height} camera={{ fov: 40, position: [0, camY, 12], near: 0.1, far: 60 }}>
        <Look y={camY} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[4, 6, 5]} intensity={2} color="#fff1d6" />
        <group position={[0, y, 0]} rotation={[0, spin, 0]}>
          <mesh scale={[1, 1.05, 1]}>
            <sphereGeometry args={[1.6, 48, 48, 0, Math.PI * 2, 0, 2.7]} />
            <meshStandardMaterial color="#d9c29a" roughness={0.95} side={THREE.DoubleSide} />
          </mesh>
          {bands.map((i) => (
            <mesh key={i} rotation={[0, (i / bands.length) * Math.PI * 2, 0]} scale={[1.005, 1.055, 1.005]}>
              <sphereGeometry args={[1.6, 8, 48, 0, 0.05, 0, 2.7]} />
              <meshStandardMaterial color="#8a5a2b" roughness={0.9} side={THREE.DoubleSide} />
            </mesh>
          ))}
          <mesh position={[0, -1.6 * 1.05 * Math.cos(2.7) * -1, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.6 * Math.sin(2.7), 0.05, 8, 40]} />
            <meshStandardMaterial color="#5a3b1e" />
          </mesh>
        </group>
      </ThreeCanvas>
    </AbsoluteFill>
  );
}
function Look({ y }: { y: number }) {
  const { camera } = useThree();
  camera.position.set(0, y, 12); camera.lookAt(0, 0.4, 0); camera.updateProjectionMatrix();
  return null;
}
