# IRON DOMINION — Progress Log

## Phase 1 — Engine Skeleton & Terrain ✅ (2026-07-03, verified)

### Done
- Vite + TypeScript (strict) project; `npm run dev / build / test`.
- Dependencies installed from the public npm registry; postinstall copies Draco/Basis
  decoders to `public/libs/`.
- Fixed-timestep loop: 30 Hz simulation with accumulator + render interpolation alpha
  (`src/engine/loop.ts`). Sim layer (`/src/sim`) has zero three.js imports; heightfield
  generation is seed-deterministic and covered by Vitest determinism tests, including
  visible water basins that block movement.
- Heightmap terrain: 512×512 cells (2 m/cell ≈ 1 km²), fbm continent + terraced plateaus
  → cliffs; 4-way splat material (grass/dirt/rock/ore-stained) injected into
  MeshStandardMaterial via onBeforeCompile, composed with CSM shadow patching.
- Walkability grid derived from slope + water; cliffs and water are blocked. Debug
  overlay on F3 (red = blocked cliffs/water, faint green = walkable); F3 temporarily
  hides the water plane so blocked basins read clearly.
- Water plane with custom shader: vertex swell, procedural wave normals, sun specular,
  shore fade + animated foam from a heightfield texture, fog-matched.
- Lighting: hemisphere + directional sun via three CSM (3 cascades, 2048 px, fade).
- Postprocessing (`postprocessing` + `n8ao`): N8AO SSAO, SMAA, subtle bloom,
  procedural warm color-grading LUT, vignette. ACES tone mapping.
- RTS camera rig: WASD/arrows/edge pan, right-drag + Space-drag grab pan, wheel zoom
  clamped 28–140 with pitch curve, Q/E 90° rotation, exponential damping, terrain-height
  following, map-bounds clamping.
- Asset pipeline: GLTFLoader + DRACOLoader + KTX2Loader (decoders auto-copied to
  `public/libs` on postinstall). InstancedMesh registry.
- 5,000 instanced props (2,200 pine + 1,300 broadleaf + 800 + 700 rocks), seeded
  placement respecting water/slope/ore fields, per-instance tint + shadows.
- Debug HUD: fps / draw calls / triangles / sim Hz / instance count / zoom / yaw (F1 help).
- Browser verification passed on Vite dev server: HUD showed 5,000 instances, fixed
  `sim 30 Hz`, wheel clamp near 28–140, Q/E 90° rotation, F1 help toggle, F3 overlay,
  edge pan, visible lit terrain/water/props, and >60 fps while panning/orbiting.
- `npm test` passes (5 Vitest tests). `npm run build` passes.

### Known issues / notes
- Art is procedural placeholder (canvas textures, primitive trees) until Phase 7.
- Terrain does not cast shadows (receives only) — cheap, revisit if cliff shadows are missed.
- Water has no reflections/refraction by design ("simple shader").
- Ramps between plateau levels exist where noise gradients are gentle but are not
  guaranteed per plateau; revisit when Phase 2 pathfinding needs connectivity.
- `npm audit` reports upstream dependency vulnerabilities; not addressed in Phase 1 because
  the available fix path suggests breaking upgrades and the app/test/build are clean.

### Next
- Phase 2 — ECS simulation core & movement (miniplex, flow fields, selection).

## Phase 2 — ECS Simulation Core & Movement ✅ (2026-07-04, verified)

### Done
- Added `miniplex` ECS and Phase 2 components: `Transform`, `Velocity`, `Health`,
  `Team`, `Selectable`, `Mover`, `Weapon`, `Turret`, `Vision`, `Cargo`, `Builder`,
  `Possessable`, and `Collider`.
- Added renderer-independent navigation in `/src/sim`: walkability-derived
  `NavigationGrid`, deterministic `FlowField`, group move orders, formation offsets,
  stop orders, local separation, terrain-edge sliding, and sim hashing.
- Added 120 placeholder tanks spawned into the fixed 30 Hz sim; render interpolation
  uses previous/current transforms.
- Added browser RTS controls: click select, shift-add, drag-box selection, double-click
  select visible type, right-click move, S stop, and control groups 1–9 with Cmd/Ctrl+number.
- Added simple low-poly tank rendering with selection rings and HUD counts for units/selected.
- Added user-requested saved RTS camera free look: Cmd + left-drag adjusts yaw side-to-side
  and pitch up/down, persisting both preferences in `localStorage`.
- Fixed camera startup drift by disabling edge pan until the pointer has actually entered/moved.
- Browser verification passed on Vite dev server: visible 120-unit company, drag-selected
  113 units in view, right-click move order flowed the group out of formation, HUD stayed at
  fixed `sim 30 Hz`, and frame rate remained above 60 fps during verification.
- `npm test` passes (7 Vitest tests). `npm run build` passes.

### Known issues / notes
- Tank art is still procedural placeholder and intentionally not final.
- Unit rendering is currently individual meshes, so draw calls are high when all 120 selected;
  performance was still above 60 fps in verification, but a later phase should batch/instance
  units once the visual language settles.
- Attack-move records the order flag but combat/targeting are Phase 4, so it behaves like move.
- Rally points on production buildings are not visible yet because buildings/production start
  in Phase 3.
- Automated browser tooling did not deliver a real Cmd modifier for the camera free-look gesture;
  the implementation handles both keyboard Meta state and mouse-event `metaKey`, and the HUD
  exposes pitch for manual verification.

### Next
- Phase 3 — Economy, construction, production, building placement, power, and sidebar.
