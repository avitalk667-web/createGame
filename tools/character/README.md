# Player character — model pipeline

The figure every player uses in every PORTAL X game comes from one file:

`client/public/models/characters/portal-x-detective.glb` (set in `client/src/app/world/character/character-config.ts`).

## Source

`PORTAL-X_detective_LOCAL_RIG_V2.glb` (11.7 MB, delivered 2026-11-15, not stored in the repo): Tripo mesh and
textures, a prototype humanoid rig of 26 bones, 4 approximate facial morphs and 4 `TEST_*` clips.

## Web copy (2.5 MB)

```
# textures, from the images inside the source GLB (4096² each)
ffmpeg -i color.jpeg  -vf scale=2048:2048:flags=lanczos -q:v 3 color.jpg     # base colour 4096 → 2048
ffmpeg -i orm.jpeg    -vf scale=1024:1024:flags=lanczos -q:v 3 orm.jpg       # occlusion/roughness/metal → 1024
ffmpeg -i normal.png  -vf scale=2048:2048:flags=lanczos -q:v 2 normal.jpg    # normal map PNG → JPEG 2048
node tools/character/optimize-glb.mjs <source.glb> client/public/models/characters/portal-x-detective.glb color.jpg orm.jpg normal.jpg
```

`optimize-glb.mjs` keeps the mesh, skin, skeleton, material and clips as they are; it drops orphan buffer data and the
facial morph targets. The three 4096² textures cost ~200 MB of GPU memory per page, too much for phones; at 2048/1024
the figure (≈ 300 px tall on screen) keeps its detail — checked visually on the dev page and in all three game
worlds (no side-by-side render against the 4096² original was made).

After replacing the file, bump `modelVersion` in `character-config.ts`.

## Known limits of the delivered rig (not hidden in code)

Measured on the dev page (`/dev/character`, dev build only; `tools/visual-check/character-shots.mjs` makes contact sheets):

- **Rest pose** is neither A- nor T-pose: elbows bent, right hand at the chin, magnifier held up in the left hand.
- **Arm raise**: rotating an upper arm sideways by more than ~0.5 rad tears the separate magnifier away from the left
  hand and bulges the shirt (weights of the prototype rig). The clips never do it; the finale "cheer" is hops plus a
  wave of the free right hand.
- **Magnifier arm**: past ~0.12 rad forward the glass reaches the face; the walk/run swing of the left arm is capped
  (`LEFT_ARM_FORWARD_LIMIT`).
- **Right hand** is a separate piece at the wrist: no clip rotates the hand bones, so the seam stays closed.
- **No finger joints**: hands keep the modelled grip.
- **Facial morphs** (blink/smile/brow) are approximate and removed from the web copy.

A production rig (proper weights at the shoulders, the magnifier skinned to `LeftHand`, an A-pose bind pose, finger
joints, real facial blendshapes) would allow larger arm motion. Fixing it needs Blender, which is not installed here.
