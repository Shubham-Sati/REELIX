// 2.5D parallax: background drifts slowly (slightly blurred), the cut-out subject moves more and scales up, with a soft shadow.
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Scene } from "./types";

export const Parallax: React.FC<{ s: Scene; total: number }> = ({ s, total }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [0, total], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.sin) });
  const dir = s.motion === "pan-left" ? -1 : s.motion === "pan-right" ? 1 : 0;
  const zoomOut = s.motion === "zoom-out";
  const bgS = zoomOut ? 1.22 - 0.06 * p : 1.12 + 0.06 * p, fgS = zoomOut ? 1.18 - 0.14 * p : 1.0 + 0.14 * p;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Img src={staticFile(s.image)} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "blur(3px) brightness(.85)",
        transform: `scale(${bgS}) translateX(${dir * (-2 + 4 * p)}%)` }} />
      {s.fg ? <Img src={staticFile(s.fg)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
        transform: `scale(${fgS}) translateX(${dir * (3 - 6 * p)}%) translateY(${-1.5 * p}%)`, transformOrigin: "center 60%",
        filter: "drop-shadow(0 30px 40px rgba(0,0,0,.55))" }} /> : null}
    </AbsoluteFill>
  );
};
