import { AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { loadFont } from "@remotion/google-fonts/Montserrat";
import { Motion, Scene, Timeline, Word } from "./types";

const { fontFamily } = loadFont("normal", { weights: ["800", "900"], subsets: ["latin"] });
const FADE = 0.45; // seconds of cross-fade between scenes

/** One picture with a slow camera move (Ken Burns), fading in and out at its edges. */
const SceneView: React.FC<{ s: Scene; fps: number; isFirst: boolean; isLast: boolean }> = ({ s, fps, isFirst, isLast }) => {
  const f = useCurrentFrame();
  const total = Math.round((s.duration + FADE) * fps);
  const p = interpolate(f, [0, total], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.sin) });
  const moves: Record<Motion, [number, number, number]> = {
    "zoom-in": [1.05 + 0.15 * p, 0, 0], "zoom-out": [1.22 - 0.15 * p, 0, 0],
    "pan-left": [1.2, 6 - 12 * p, 0], "pan-right": [1.2, -6 + 12 * p, 0],
    "pan-up": [1.2, 0, 6 - 12 * p], "pan-down": [1.2, 0, -6 + 12 * p],
  };
  const [sc, x, y] = moves[s.motion] ?? moves["zoom-in"];
  const fadeF = FADE * fps;
  const opacity = Math.min(
    isFirst ? 1 : interpolate(f, [0, fadeF], [0, 1], { extrapolateRight: "clamp" }),
    isLast ? 1 : interpolate(f, [total - fadeF, total], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  );
  return (
    <AbsoluteFill style={{ opacity, overflow: "hidden" }}>
      <Img src={staticFile(s.image)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${sc}) translate(${x}%, ${y}%)` }} />
    </AbsoluteFill>
  );
};

/** Small kinetic label that slides in at the top of a scene (e.g. "FRANCE · 1782"). */
const Label: React.FC<{ text: string; accent: string }> = ({ text, accent }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const k = spring({ frame: f - 6, fps, config: { damping: 14 } });
  return (
    <div style={{ position: "absolute", top: 230, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
      <div style={{ fontFamily, fontWeight: 800, fontSize: 46, letterSpacing: 6, color: "#111", background: accent, padding: "14px 30px", borderRadius: 14,
        transform: `translateY(${(1 - k) * -60}px) scale(${0.8 + 0.2 * k})`, opacity: k, boxShadow: "0 10px 30px rgba(0,0,0,.35)" }}>{text.toUpperCase()}</div>
    </div>
  );
};

/** Word-by-word captions: groups of up to 3 words, the spoken word pops in the accent colour. */
const Captions: React.FC<{ words: Word[]; accent: string }> = ({ words, accent }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig(); const t = f / fps;
  const groups: Word[][] = [];
  for (const w of words) {
    const g = groups[groups.length - 1];
    if (!g || g.length >= 3 || w.start - g[g.length - 1].end > 0.35 || /[.!?,]$/.test(g[g.length - 1].text)) groups.push([w]); else g.push(w);
  }
  const g = groups.find((g, i) => t >= g[0].start - 0.05 && t < (groups[i + 1]?.[0].start ?? g[g.length - 1].end + 0.6));
  if (!g) return null;
  return (
    <div style={{ position: "absolute", bottom: 430, left: 60, right: 60, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "4px 34px" }}>
      {g.map((w, i) => {
        const on = t >= w.start && t < w.end + 0.08;
        const k = spring({ frame: f - Math.round(w.start * fps), fps, config: { damping: 12, stiffness: 180 } });
        return <span key={i} style={{ fontFamily, fontWeight: 900, fontSize: 92, lineHeight: 1.15, color: on ? accent : "#fff",
          transform: `scale(${on ? 1 + 0.08 * k : 1})`, transformOrigin: "center bottom", display: "inline-block",
          WebkitTextStroke: "10px #000", paintOrder: "stroke fill", textShadow: "0 8px 24px rgba(0,0,0,.6)" }}>{w.text.toUpperCase()}</span>;
      })}
    </div>
  );
};

export const Main: React.FC<Timeline> = (t) => {
  const f = useCurrentFrame(); const { fps, durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {t.scenes.map((s, i) => (
        <Sequence key={i} from={Math.round(s.start * fps)} durationInFrames={Math.round((s.duration + FADE) * fps)}>
          <SceneView s={s} fps={fps} isFirst={i === 0} isLast={i === t.scenes.length - 1} />
          {s.label ? <Label text={s.label} accent={t.accent} /> : null}
        </Sequence>
      ))}
      {/* cinematic vignette */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,.55) 100%)" }} />
      <Captions words={t.captions} accent={t.accent} />
      {/* progress bar */}
      <div style={{ position: "absolute", top: 0, left: 0, height: 10, width: `${(f / durationInFrames) * 100}%`, background: t.accent }} />
      {t.voice ? <Audio src={staticFile(t.voice)} /> : null}
      {t.music ? <Audio src={staticFile(t.music)} volume={(fr) => interpolate(fr, [0, fps, durationInFrames - 2 * fps, durationInFrames], [0, t.musicVolume ?? 0.16, t.musicVolume ?? 0.16, 0], { extrapolateRight: "clamp" })} /> : null}
    </AbsoluteFill>
  );
};
