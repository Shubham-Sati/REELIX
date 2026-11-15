// 2.5D parallax without a ghost: the background picture still contains the person (no inpainting),
// so the cut-out must always cover that copy. Both layers share one anchor point and never slide sideways
// relative to each other; the cut-out is always scaled at least as much as the background, so it grows
// "toward the camera" over its own copy. Depth comes from the different zoom speeds + blur + shadow.
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Scene } from "./types";

export const Parallax: React.FC<{ s: Scene; total: number }> = ({ s, total }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [0, total], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.sin) });
  const out = s.motion === "zoom-out";
  const bgS = out ? 1.16 - 0.06 * p : 1.06 + 0.06 * p;          // background: slow
  const fgS = bgS * (out ? 1.12 - 0.1 * p : 1.02 + 0.1 * p);     // subject: always >= background, so the copy behind stays hidden
  const dir = s.motion === "pan-left" ? -1 : s.motion === "pan-right" ? 1 : 0;
  const shift = `translateX(${dir * (-1.5 + 3 * p)}%)`;           // the SAME shift for both layers
  const origin = "50% 58%";
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Img src={staticFile(s.image)} style={{ width: "100%", height: "100%", objectFit: "cover", transformOrigin: origin,
        filter: "blur(2.5px) brightness(.82)", transform: `${shift} scale(${bgS})` }} />
      {s.fg ? <Img src={staticFile(s.fg)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transformOrigin: origin,
        transform: `${shift} scale(${fgS})`, filter: "drop-shadow(0 24px 34px rgba(0,0,0,.55))" }} /> : null}
    </AbsoluteFill>
  );
};
