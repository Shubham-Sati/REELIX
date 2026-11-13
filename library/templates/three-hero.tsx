// REELIX 3D scene template (engine: "custom"). Copy to <video>/project/custom/<Name>.tsx and change the object.
// Rules that make 3D render correctly in Remotion:
//  - Everything is driven by useCurrentFrame(); never use useFrame/clock (the render would drift or flicker).
//  - Use <ThreeCanvas> from @remotion/three with width/height from useVideoConfig().
//  - Portrait 9:16: keep the object in the middle band (top 15% and bottom 30% stay free for labels and captions); pull the camera back.
//  - Props you always get: accent (hex), font, duration (s), image (the scene picture, usable as a backdrop).
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";

export default function ThreeHero({ accent = "#FFB703", image }: { accent?: string; image?: string }) {
  const f = useCurrentFrame(); const { fps, width, height, durationInFrames } = useVideoConfig();
  const t = f / fps;
  const rise = spring({ frame: f, fps, config: { damping: 18, mass: 1.4 } });     // entrance
  const spin = interpolate(f, [0, durationInFrames], [0, Math.PI * 0.8]);          // slow turn
  const camZ = interpolate(f, [0, 90], [9, 7], { extrapolateRight: "clamp" });    // gentle dolly-in
  return (
    <AbsoluteFill style={{ background: "#0b0b14" }}>
      {image ? <Img src={staticFile(image)} style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", filter: "blur(14px) brightness(.45)" }} /> : null}
      <ThreeCanvas width={width} height={height} camera={{ fov: 40, position: [0, 0.6, camZ + 3] }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[4, 6, 5]} intensity={2.2} />
        <pointLight position={[-4, -2, 3]} intensity={30} color={accent} />
        <group position={[0, -2.2 + 2.4 * rise + Math.sin(t * 1.6) * 0.08, 0]} rotation={[0, spin, 0]}>
          {/* envelope */}
          <mesh position={[0, 1.1, 0]} scale={[1, 1.15, 1]}>
            <sphereGeometry args={[1.25, 64, 64]} />
            <meshStandardMaterial color={accent} roughness={0.45} metalness={0.1} />
          </mesh>
          {/* ropes */}
          {[-0.5, 0.5].map((x) => <mesh key={x} position={[x * 0.9, -0.35, 0]}><cylinderGeometry args={[0.02, 0.02, 1.2]} /><meshStandardMaterial color="#ddd" /></mesh>)}
          {/* basket */}
          <mesh position={[0, -1.05, 0]}><boxGeometry args={[0.8, 0.5, 0.8]} /><meshStandardMaterial color="#8a5a2b" roughness={0.9} /></mesh>
        </group>
        {/* contact shadow stand-in */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.6, 0]}><circleGeometry args={[1.6, 48]} /><meshBasicMaterial color="#000" transparent opacity={0.35 * rise} /></mesh>
      </ThreeCanvas>
    </AbsoluteFill>
  );
}
