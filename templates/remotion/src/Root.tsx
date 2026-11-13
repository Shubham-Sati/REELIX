import { Composition } from "remotion";
import { Main } from "./Main";
import { Timeline } from "./types";

const demo: Timeline = { width: 1080, height: 1920, fps: 30, title: "Demo", accent: "#FFB703", scenes: [], voice: "", music: null, captions: [], durationSec: 3 };

export const Root = () => (
  <Composition
    id="Main"
    component={Main as any}
    defaultProps={demo as any}
    width={1080} height={1920} fps={30} durationInFrames={90}
    calculateMetadata={({ props }) => {
      const t = props as unknown as Timeline;
      return { width: t.width, height: t.height, fps: t.fps, durationInFrames: Math.ceil(t.durationSec * t.fps) };
    }}
  />
);
