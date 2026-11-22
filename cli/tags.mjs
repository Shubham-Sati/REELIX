// Top-band tags (scene label + shot "label" note, drawn by templates/remotion/src/Main.tsx TopTags) are kept RARE: the user, 22 Nov 2026:
// "in almost every scene I have the title-like thing over the image ... this can be in the start or on special things only".
// Since 21 Nov the storyboard gave every shot a label, so every shot had a tag. buildTimeline (cli/pipeline.mjs) now keeps only:
//   - the opening shot's tags (the hook);
//   - shots the storyboard marks special ("special": true), or, in older storyboards without that field, labels with a number (83%, 1907);
//   - in a long video (16:9) the scene labels too: they are chapter titles;
// and at most one kept tag per GAP seconds after the opening, MAX_PER_MIN per minute.
const GAP = 10, MAX_PER_MIN = 4;

/** scenes: timeline scenes (start, duration, label, note), shotMeta: the storyboard shot for each (same order), wide: a 16:9 video. */
export function sparseTags(scenes, shotMeta, wide) {
  const marked = shotMeta.some((s) => s && "special" in s);   // a storyboard written with the new rule
  const special = (i) => (marked ? shotMeta[i]?.special === true : /\d/.test(String(scenes[i].note || "")));
  const total = scenes.reduce((m, s) => Math.max(m, s.start + s.duration), 0);
  let budget = Math.max(1, Math.floor((total / 60) * MAX_PER_MIN)), last = -Infinity;
  return scenes.map((s, i) => {
    if (i === 0) { last = s.start; return s; }   // the hook keeps its tags
    const keepLabel = wide && Boolean(s.label);   // chapter titles in a long video
    const keepNote = Boolean(s.note) && special(i) && budget > 0 && s.start - last >= GAP;
    const out = { ...s };
    if (!keepLabel) delete out.label;
    if (!keepNote) delete out.note; else { budget--; last = s.start; }
    return out;
  });
}
