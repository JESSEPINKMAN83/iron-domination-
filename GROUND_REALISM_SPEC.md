# Ground Realism Spec

Make the terrain ground read as natural and detailed instead of a flat green
sheet — at RTS zoom and in V-mode — with near-zero performance cost. Pure
rendering; no heightfield, splat-data, sim, or gameplay changes.

---

## Current implementation (read before coding)

- `src/render/terrainMesh.ts`
  - `createSplatMaterial()` (~line 384): ONE `MeshStandardMaterial`
    (roughness 0.96) for all terrain chunks, patched via `onBeforeCompile`
    (composes with CSM shadows). Fragment patch blends 4 detail textures
    (grass/dirt/rock/ore) by `hf.splat` weights from a `DataTexture`,
    tiled at `hf.size / 9` (one tile per 9 m).
  - Terrain is chunked (`terrain.chunkGeometries`), one material shared.
- `src/render/textures.ts`: detail textures are **256 px canvas-procedural**
  (blobs/ellipses), per-style (`temperate` / `desert` / `snow` via
  `terrainTextureStyle()`).
- `src/render/scatter.ts`: 5,000 instanced low-poly trees + rocks
  (`InstancedMesh`, deformed icosahedron rocks, vertex-painted), with a
  crushable-tree grid. Good pattern to reuse for ground clutter.
- Lighting: CSM shadow-mapped sun + hemisphere (see renderer.ts); terrain
  receives real shadows already.

## Why it looks flat today

1. No **macro variation** — every grass texel is the same green family, so
   at RTS zoom the field averages into one color.
2. 256 px low-contrast detail textures at 9 m tiling — soft mush up close,
   visible repetition at distance.
3. No normal/roughness detail — sun grazes the ground without any surface
   response.
4. No ground clutter between scatter props — nothing lives between rock
   piles.
5. Props/buildings meet the ground with a hard edge — no contact darkening.

All fixes below slot into the existing splat `onBeforeCompile` patch or the
existing instancing system. Target budget: **+1 texture fetch tier in the
terrain shader, +2 draw calls total, +~3 MB texture memory, zero per-frame
allocations.**

---

## Phase 1 — Macro variation layer (biggest visual win)

1. Generate once at map load a **macro tint texture** (512×512 canvas,
   seeded by map seed, style-aware):
   - 2–3 octaves of low-frequency value noise → subtle hue/brightness
     patches (dry yellow-green, richer dark green, faint brown scars),
     amplitude ±8–12% around neutral.
   - Darken slightly toward water level (moisture band) using the
     heightfield — sample heights when painting the canvas (CPU, one-time).
2. Add to the splat fragment patch: sample macro texture at **map scale**
   (plain `vUv`, no tiling) and multiply into `splatCol`. One extra fetch.
3. Per-style palettes: temperate (green ranges), desert (sand/ochre), snow
   (blue-white/grey patches).

Result: the single flat green becomes broad natural patches — visible from
every zoom level, essentially free.

## Phase 2 — Better detail textures + anti-tiling

1. Upgrade `createGrassTexture()`: 256 → **512 px**, replace blob-ellipses
   with short directional strokes (2–4 px, slight hue jitter, two pass
   layers: dark base strokes + sparse lighter highlight strokes). Same for
   dirt (granular speckle + cracks) and rock (angular facets + veins).
   Keep them canvas-procedural — no downloaded assets.
2. **Anti-tiling** in the splat patch: sample each detail texture twice —
   `tUv` and `tUv * 0.37 + offset` (rotated/scaled second tap) — and blend
   50/50, or blend by a cheap hash of the tile id. Kills the 9 m repeat
   pattern for ~1 extra fetch per layer actually used.
   - Optimization: since splat weights are normalized, skip texture taps
     whose weight < 0.02 (branch on weight) — most pixels pay for 1–2
     layers, not 4.

## Phase 3 — Surface response to light (normal + roughness)

1. At load, derive a **normal map** from each detail canvas (treat luminance
   as height, Sobel → normal, pack to a second canvas; one-time CPU work,
   ~10 ms). Grass gets a gentle normal (strength ~0.35), dirt/rock stronger
   (~0.7).
2. Patch the normal into the material (`normal_fragment_maps` replacement
   blending detail normals by the same splat weights). If patching all
   4 layers is heavy, a single shared "ground detail normal" for
   grass+dirt and one for rock is visually sufficient (2 fetches).
3. Roughness variation: modulate `roughnessFactor` by the macro texture
   value (±0.08) so dry patches catch sun slightly differently. One line in
   the patch, no new fetch (reuse macro sample).

This is what makes sunset/night lighting (TIME_WEATHER_VISUAL_SPEC) actually
show on the ground — grazing light finally has something to graze.

## Phase 4 — Ground clutter (grass tufts)

1. New instanced layer in `scatter.ts` style: **grass tuft cards** — two
   crossed alpha-cutout quads (~0.5 u tall), canvas-painted blades texture,
   vertex-colored to match the local macro tint (sample the macro canvas at
   spawn time on CPU).
2. Placement: on cells whose splat is grass-dominant (weight > 0.6) and
   walkable; density ~1 tuft / 25 m² capped at **6,000 instances**, ONE
   InstancedMesh, ONE draw call.
3. Wind: tiny vertex-shader sway (time uniform, amplitude scaled by height)
   — reuse the pattern from any existing animated shader, or a minimal
   `onBeforeCompile` on the tuft material.
4. Distance handling: fade instances beyond ~220 u from camera focus via
   material opacity by distance in the vertex shader (no per-frame CPU
   culling). V-mode benefits the most — the ground stops being empty.
5. Mobile / low-quality: halve or disable (same convention as `mobileSun`).
6. Do NOT make tufts crushable/interactive (out of scope; rocks/trees keep
   their existing behavior).

## Phase 5 — Grounding decals (contact darkening)

1. One InstancedMesh of soft radial-gradient discs (64 px canvas, alpha),
   placed under: scattered rock piles and trees (at scatter time) and under
   completed buildings (slightly larger than footprint, alpha ~0.25).
   Polygon-offset / small y-lift to avoid z-fighting; renderOrder below
   units.
2. Cap ~5,500 instances, one draw call. This removes the "props pasted on
   green" look visible around rock clusters today.

## Explicit non-goals / guardrails

- No downloaded texture assets — everything stays canvas-procedural and
  seed-stable (multiplayer determinism of visuals per seed).
- No heightfield/geometry changes, no tessellation, no triplanar mapping.
- No per-frame texture uploads; all canvases generated once at map load.
- FPS budget: within ~1 ms/frame of current on the desktop target; verify
  with the in-game debug stats at max zoom-out (worst case: full terrain in
  frustum) and in V-mode among tufts.
- Ore-field glow rings, walk overlay, fog of war, placement ghosts:
  unchanged.

## Acceptance criteria

1. Side-by-side screenshots (same seed, same camera) before/after at:
   full zoom-out, standard RTS zoom, V-mode ground level — ground shows
   patch-scale color variation, no visible 9 m tiling, and light-responsive
   detail in all three.
2. Grass tufts visible and swaying in V-mode; density fades with distance;
   zero visible popping at RTS zoom.
3. Rocks/trees/buildings sit "in" the ground (contact darkening visible).
4. Desert and snow styles get equivalent treatment (macro palettes + detail
   textures), not just temperate.
5. Frame time regression ≤ 1 ms at worst-case zoom-out on desktop; mobile
   fallback path renders without the clutter layers.
6. Draw call count increase ≤ 2; `yarn test`/typecheck pass; terrain chunk
   count and geometry unchanged.
