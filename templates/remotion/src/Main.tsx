import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { Motion, Scene, Timeline, Word } from "./types";
import { loadFontFamily } from "./fonts";
import { Kinetic } from "./Kinetic";
import { Parallax } from "./Parallax";
import { custom } from "./custom";

let fontFamily = loadFontFamily("Montserrat");
const FADE = 0.45; // seconds of cross-fade between scenes

/** One picture with a slow camera move (Ken Burns), fading in and out at its edges. */
const SceneView: React.FC<{ s: Scene; fps: number; isFirst: boolean; isLast: boolean; accent: string; lines?: Timeline["lines"] }> = ({ s, fps, isFirst, isLast, accent, lines }) => {
  const f = useCurrentFrame();
  const total = Math.round((s.duration + FADE) * fps);
  const C = s.engine === "custom" && s.component ? custom[s.component] : undefined;
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
      {C ? <C {...(s.props || {})} accent={accent} font={fontFamily} duration={s.duration} image={s.image} start={s.start} lines={lines || []} />
        : s.engine === "custom" ? <AbsoluteFill style={{ background: `linear-gradient(180deg, #1d2333, ${accent}55)` }} />
        : s.engine === "clip" && s.clip ? <OffthreadVideo src={staticFile(s.clip)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : s.engine === "kinetic" ? <Kinetic s={s} accent={accent} font={fontFamily} />
        : s.engine === "parallax" && s.fg ? <Parallax s={s} total={total} />
        : <Img src={staticFile(s.image)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${sc}) translate(${x}%, ${y}%)` }} />}
    </AbsoluteFill>
  );
};

/** Text never goes over the animation: labels live in the TOP band, captions in the BOTTOM band, the middle is the shot's.
 *  Top band: video 16:9 = top ~15% (y < 165), short 9:16 = top ~17% (y 150-330, under the Shorts top buttons).
 *  Row 1: the scene label (first shot of a scene, accent chip, e.g. "FRANCE · 1782").
 *  Row 2: the shot's own label from the storyboard (dark chip, e.g. "≈ 600 MILLION YEARS"), fading in just after the cut. */
const TopTags: React.FC<{ label?: string; note?: string; accent: string }> = ({ label, note, accent }) => {
  const f = useCurrentFrame(); const { fps, width, height } = useVideoConfig();
  const wide = width > height;
  const k = spring({ frame: f - 6, fps, config: { damping: 14 } });
  const n = spring({ frame: f - 10, fps, config: { damping: 16 } });
  const L = wide ? { top: 28, size: 34, pad: "10px 24px", gap: 10, note: 38 } : { top: 150, size: 46, pad: "14px 30px", gap: 14, note: 50 };
  if (!label && !note) return null;
  return (
    <div style={{ position: "absolute", top: L.top, left: 40, right: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: L.gap, pointerEvents: "none" }}>
      {label ? <div style={{ fontFamily, fontWeight: 800, fontSize: L.size, letterSpacing: wide ? 5 : 6, color: "#111", background: accent, padding: L.pad, borderRadius: 14,
        transform: `translateY(${(1 - k) * -40}px) scale(${0.8 + 0.2 * k})`, opacity: k, boxShadow: "0 10px 30px rgba(0,0,0,.35)" }}>{label.toUpperCase()}</div> : null}
      {note ? <div style={{ fontFamily, fontWeight: 800, fontSize: L.note, letterSpacing: 2, color: "#fff", background: "rgba(24,22,30,0.82)", padding: L.pad, borderRadius: 16,
        border: `3px solid ${accent}`, opacity: n, transform: `translateY(${(1 - n) * -14}px)`, boxShadow: "0 6px 24px rgba(0,0,0,.35)", maxWidth: "100%", textAlign: "center" }}>{note}</div> : null}
    </div>
  );
};

/** Word-by-word captions: groups of up to 3 words, the spoken word pops in the accent colour.
 *  They sit in the bottom band the shots keep free, never in the middle over the action:
 *  video 16:9 = bottom ~18% (smaller subtitle-sized words), short 9:16 = bottom ~28%, above the Shorts buttons and title. */
const Captions: React.FC<{ words: Word[]; accent: string }> = ({ words, accent }) => {
  const f = useCurrentFrame(); const { fps, width, height } = useVideoConfig(); const t = f / fps;
  const wide = width > height;
  const C = wide ? { bottom: 56, size: 60, stroke: 7, gap: "2px 22px", side: 160 } : { bottom: 340, size: 84, stroke: 9, gap: "4px 30px", side: 60 };
  const groups: Word[][] = [];
  for (const w of words) {
    const g = groups[groups.length - 1];
    if (!g || g.length >= 3 || w.start - g[g.length - 1].end > 0.35 || /[.!?,]$/.test(g[g.length - 1].text)) groups.push([w]); else g.push(w);
  }
  const g = groups.find((g, i) => t >= g[0].start - 0.05 && t < (groups[i + 1]?.[0].start ?? g[g.length - 1].end + 0.6));
  if (!g) return null;
  return (
    <div style={{ position: "absolute", bottom: C.bottom, left: C.side, right: C.side, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: C.gap }}>
      {g.map((w, i) => {
        const on = t >= w.start && t < w.end + 0.08;
        const k = spring({ frame: f - Math.round(w.start * fps), fps, config: { damping: 12, stiffness: 180 } });
        return <span key={i} style={{ fontFamily, fontWeight: 900, fontSize: C.size, lineHeight: 1.15, color: on ? accent : "#fff",
          transform: `scale(${on ? 1 + 0.03 * k : 1})`, transformOrigin: "center bottom", display: "inline-block",
          WebkitTextStroke: `${C.stroke}px #000`, paintOrder: "stroke fill", textShadow: "0 8px 24px rgba(0,0,0,.6)" }}>{w.text.toUpperCase()}</span>;
      })}
    </div>
  );
};

export const Main: React.FC<Timeline> = (t) => {
  const f = useCurrentFrame(); const { fps, durationInFrames } = useVideoConfig();
  fontFamily = loadFontFamily(t.font);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {t.scenes.map((s, i) => (
        <Sequence key={i} from={Math.round(s.start * fps)} durationInFrames={Math.round((s.duration + FADE) * fps)}>
          <SceneView s={s} fps={fps} accent={t.accent} lines={t.lines} isFirst={i === 0} isLast={i === t.scenes.length - 1} />
          {s.engine !== "kinetic" ? <TopTags label={s.label} note={s.note} accent={t.accent} /> : null}
        </Sequence>
      ))}
      {/* cinematic vignette */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,.55) 100%)" }} />
      {t.showCaptions ? <Captions words={t.captions} accent={t.accent} /> : null}
      {/* progress bar */}
      <div style={{ position: "absolute", top: 0, left: 0, height: 10, width: `${(f / durationInFrames) * 100}%`, background: t.accent }} />
      {(t.sfx || []).map((x, i) => (
        <Sequence key={"sfx" + i} from={Math.max(0, Math.round(x.start * fps))}><Audio src={staticFile(x.file)} volume={x.volume ?? 0.5} /></Sequence>
      ))}
      {t.voice ? <Audio src={staticFile(t.voice)} /> : null}
      {t.music ? <Audio src={staticFile(t.music)} volume={(fr) => interpolate(fr, [0, fps, durationInFrames - 2 * fps, durationInFrames], [0, t.musicVolume ?? 0.16, t.musicVolume ?? 0.16, 0], { extrapolateRight: "clamp" })} /> : null}
    </AbsoluteFill>
  );
};
