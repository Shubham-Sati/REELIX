// The contract between the pipeline and the renderer: videos/<slug>/project/timeline.json
export type Motion = "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "pan-up" | "pan-down";
export type Scene = { image: string; start: number; duration: number; motion: Motion; label?: string };
export type Word = { text: string; start: number; end: number };
export type Timeline = {
  width: number; height: number; fps: number; title: string; accent: string;
  scenes: Scene[]; voice: string; music: string | null; musicVolume?: number; captions: Word[]; durationSec: number;
};
