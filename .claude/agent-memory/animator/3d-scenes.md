# animator: 3D scenes

- Rendering: 3D scenes need --gl=angle (already in tools/render.sh). Multiple custom scenes render fine now; if one goes missing, check the generated custom/index.ts.
- Build job: the brief3d lives in <video>/storyboard.json (project/timeline.json may not exist yet), so type-check by copying the file into templates/remotion/src temporarily and delete it afterwards.
- Camera: set it inside a useThree child component from props, not with useFrame.
- Wrong-era FLUX images (e.g. modern basket balloon): the animator can't run FLUX redos, so replace the shot with a custom 3D scene instead of leaving it.
- Layout: keep the subject below the scene-label band (top ~25%) and above the captions (y>1200); in S4_0 the label sat on the balloon and the caption hid the arrow.
- Contrast particles (cool blue) must stay fully outside the subject/envelope.
- Look: flat-shaded 3D looked plain next to painted FLUX shots; use lit materials, warm rim light and some texture so the 3D shot matches the set.
