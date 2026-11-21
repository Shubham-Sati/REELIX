# Props built for REELIX videos

Objects a video needed that no kit in library/models had. The set-builder writes one as
`<video>/project/custom/_prop_<name>.tsx` (first line `// prop category=<category> h=<height m>`), and the render step
(saveNewProps in cli/pipeline.mjs) copies new ones here and re-indexes the catalog (tools/model_library.py index), so the
next video reuses them: copy `library/props/<name>.tsx` into the video as `_prop_<name>.tsx`. Existing props are never overwritten.
