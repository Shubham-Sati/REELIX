// Kinetic text scene: one paused GSAP timeline, seeked to the current frame (deterministic for rendering).
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import gsap from "gsap";
import { useMemo } from "react";
import { Scene } from "./types";

export const Kinetic: React.FC<{ s: Scene; accent: string; font: string }> = ({ s, accent, font }) => {
  const f = useCurrentFrame(); const { fps, width } = useVideoConfig();
  const words = (s.text || "").split(/\s+/).filter(Boolean);
  // GSAP tweens plain numbers; React draws from them.
  const { tl, st } = useMemo(() => {
    const st = { bg: 1.25, dim: 0, bar: 0, sub: 0, w: words.map(() => ({ y: 120, o: 0, r: -8 })) };
    const tl = gsap.timeline({ paused: true });
    tl.to(st, { bg: 1.05, duration: s.duration + 0.5, ease: "none" }, 0)
      .to(st, { dim: 0.62, duration: 0.4, ease: "power2.out" }, 0)
      .to(st.w, { y: 0, o: 1, r: 0, duration: 0.55, ease: "back.out(2.2)", stagger: 0.12 }, 0.15)
      .to(st, { bar: 1, duration: 0.5, ease: "power3.inOut" }, 0.25 + words.length * 0.12)
      .to(st, { sub: 1, duration: 0.4, ease: "power2.out" }, 0.45 + words.length * 0.12);
    return { tl, st };
  }, [s.text, s.duration]);
  tl.seek(f / fps, false);
  const size = Math.min(170, (width * 0.82) / Math.max(4, Math.max(...words.map((w) => w.length)) * 0.62));
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#000" }}>
      <Img src={staticFile(s.image)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${st.bg})`, filter: "blur(6px)" }} />
      <AbsoluteFill style={{ background: `rgba(0,0,0,${st.dim})` }} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 70, top: -180 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 28px", maxWidth: width * 0.9 }}>
          {words.map((w, i) => (
            <span key={i} style={{ fontFamily: font, fontWeight: 900, fontSize: size, lineHeight: 1.05, color: i === words.length - 1 ? accent : "#fff",
              transform: `translateY(${st.w[i].y}px) rotate(${st.w[i].r}deg)`, opacity: st.w[i].o, display: "inline-block",
              textShadow: "0 10px 40px rgba(0,0,0,.6)" }}>{w.toUpperCase()}</span>
          ))}
        </div>
        <div style={{ height: 12, width: `${st.bar * 60}%`, background: accent, borderRadius: 6, marginTop: 34 }} />
        {s.sub ? <div style={{ fontFamily: font, fontWeight: 800, fontSize: 52, color: "#fff", marginTop: 28, opacity: st.sub, letterSpacing: 4,
          transform: `translateY(${(1 - st.sub) * 30}px)` }}>{s.sub.toUpperCase()}</div> : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
