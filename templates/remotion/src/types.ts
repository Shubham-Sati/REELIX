// The contract between the pipeline and the renderer: videos/<slug>/project/timeline.json
export type Motion = "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "pan-up" | "pan-down";
/** engine: image = picture + camera move; parallax = cut-out subject over its background (2.5D);
 *  kinetic = GSAP animated big text over a dimmed picture; custom = a per-video React/Three.js/GSAP component. */
export type Engine = "image" | "parallax" | "kinetic" | "custom";
export type Scene = {
  image: string; start: number; duration: number; motion: Motion; label?: string;
  engine?: Engine;
  fg?: string;                 // parallax: cut-out subject PNG (transparent)
  text?: string; sub?: string; // kinetic: headline + small line
  component?: string;          // custom: file name in project/custom without .tsx
  props?: Record<string, unknown>;
};
export type Word = { text: string; start: number; end: number };
export type Sfx = { file: string; start: number; volume?: number };
export type FontName = "Montserrat" | "Anton" | "BebasNeue" | "Fraunces" | "Caveat" | "BricolageGrotesque";
export type Timeline = {
  width: number; height: number; fps: number; title: string; accent: string; font?: FontName;
  scenes: Scene[]; voice: string; music: string | null; musicVolume?: number; captions: Word[]; durationSec: number;
  sfx?: Sfx[];
};
