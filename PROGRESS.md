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

## Phase 3 — Economy, Construction & Production ✅ (2026-07-04, verified)

### Done
- Added Phase 3 content definitions for buildable structures and trainable units:
  Power Plant, Refinery, Barracks, Factory, Rifle Team, and M-17 tank production.
- Added renderer-independent economy systems in `/src/sim`: credits, ledger entries,
  prerequisite checks, placement validation, construction progress, power production/use,
  refinery income ticks, producer queues, brownout production slowdown, and unit spawning.
- Added a starting Command Yard with 20 power and a renderable building footprint.
- Added building placement mode from the browser RTS controller: sidebar structure button
  enters placement, terrain hover previews footprint validity, left-click confirms, Escape
  cancels, and invalid overlaps/terrain are rejected without spending credits.
- Added placeholder building rendering with construction-growth scale and green/red placement
  ghost feedback.
- Added a right-side Phase 3 sidebar with structure/infantry/vehicle tabs, credits, power,
  ledger status, prerequisite lockouts, and producer progress lines.
- Added dynamic unit rendering for produced units, including infantry placeholders, and HUD
  unit counts now include every rendered unit rather than only the initial tanks.
- Stabilized sidebar DOM updates so buttons are not destroyed and recreated every frame.
- Added an economy integration test covering build order, construction completion, power,
  refinery income, two-Factory tank production, ledger totals, and spawned entities.
- Browser verification passed on Vite dev server: Phase 3 help/sidebar rendered, starting
  state showed 4600 credits and +20 power, invalid overlap placement stayed blocked, valid
  Power Plant placement charged 300 credits, completed after build time, raised power to
  +60, and unlocked Refinery/Barracks while Factory stayed locked behind Refinery.
- `npm test` passes (8 Vitest tests). `npm run build` passes.

### Known issues / notes
- Building art is primitive blockout geometry and intentionally not final.
- Placement feedback is functional but still basic; there is no rotated footprint, build grid
  decal, or explicit textual reason near the cursor yet.
- Production queues work, but rally-point visuals and building-specific spawn doors are still
  future polish.
- Refineries generate simplified periodic income without harvesters or ore depletion.

### Follow-up improvement added
- Building selection now prioritizes building footprints over nearby units, so clicking the
  Command Yard immediately selects the structure even when tanks are parked around it.
- The sidebar now switches into a contextual selected-building command panel with original
  illustrated build cards in a retro military-console style. Command Yard shows structure
  options immediately; Barracks/Factory route production to the selected producer.

## Phase 4 — Combat, Targeting & Weapons 🚧 (2026-07-04, started)

### Done
- Added original Phase 4 weapon data for rifle and cannon weapons, including cooldowns, ranges,
  splash radius, target classes, and an armor damage matrix.
- Added `Armor` and temporary `Destroyed` sim components while keeping `/src/sim`
  renderer-independent.
- Added deterministic combat stepping: target acquisition, cooldowns, turret yaw toward target,
  damage application, splash damage, death state, 20-second wreck lifetime, and combat events.
- Added `A` then right-click attack-move command queuing.
- Added 40 opposing placeholder tanks with red team accents so the map now has a hostile force.
- Added transient tracer and impact rendering driven by sim combat events.
- Added Phase 4 tests for damage-matrix values and deterministic tank engagements.
- Reworked the command sidebar to match the classic RTS reference structure: radar/minimap
  first, build-type tabs underneath, then a compact 3-column command grid.
- Added a command icon asset contract at `public/assets/ui/command-icons/`; uploaded PNGs named
  after each item automatically replace the text placeholders in the grid.
- Radar/minimap clicks now jump the RTS camera to the clicked world location and briefly mark
  the chosen point on the radar.
- Tanks now crush tree instances as they drive over them; crushed trees tip over and darken so
  the path of destruction remains visible.
- Move and attack-move orders now show a transient world-space destination pin/ring on the
  exact walkable cell the selected units were ordered to use.
- Added Phase 4 unit health bars for selected or damaged combatants, with color shifting from
  green to amber/red as health drops.
- Browser verification passed on Vite dev server: Phase 4 HUD rendered, 160 total units loaded,
  the radar/tabs/grid sidebar appeared in the expected order, and clicking the Command Yard
  showed the selected-building contextual build menu within the same grid layout. Radar click
  navigation was also verified by jumping from base view to an ore/water edge location. Tree
  crushing was verified by ordering a selected tank group through a tree line and observing
  fallen/darkened tree instances along the path. Order feedback was verified by box-selecting
  tanks, right-clicking a destination, and seeing the green command pin; attack-move was also
  spot-checked with `A` then right-click.
- `npm test` passes (10 Vitest tests). `npm run build` passes.

### Known issues / notes
- Phase 4 is not complete yet: fog of war, full minimap camera/frustum controls, veterancy, guard mode, full
  40v40 battle balancing, building smoke/fire damage states, and polished wreck art remain.
- Combat visuals are lightweight placeholder tracers/impact flashes.
- Enemy units are spawned as a static opposing force; commander AI remains Phase 6.

### Next
- Continue Phase 4 toward full combat acceptance: target-priority AI, fog/shroud, stronger VFX,
  damage states, and a verified 40v40 engagement scenario.

## Phase 5 — First-Person Possession 🚧 (2026-07-04, started)

### Done
- Added a first playable possession mode: select a possessable tank and press `V` to fly the
  camera into its driver/gunner socket; `Escape` exits back to RTS.
- Reworked possession from the initial first-person socket into a third-person chase/gunner
  camera so the controlled tank remains visible while aiming.
- Added a renderer-side `FirstPersonController` that owns FPS camera transition, mouse aim,
  right-click zoom FOV, reticle visibility, RTS sidebar hiding, and RTS control lockout while
  possessed.
- Possession now hides the OS cursor over the canvas and suppresses RTS selection overlays so
  the reticle/target view stays clean.
- Added a renderer-independent `PlayerControlled` sim component. Possessed tanks keep moving
  through the normal fixed-step `stepSim` path, while clearing AI move orders and preserving
  deterministic sim ownership.
- Added first-pass tank driving: `W/S` throttle, `A/D` hull turn, and mouse-driven turret/camera
  yaw.
- Added left-click manual cannon fire for possessed tanks using the existing weapon data,
  cooldowns, armor damage, splash, wreck, and combat event/tracer pipeline.
- Tank turret visuals now follow sim turret yaw, so player aim and combat target tracking are
  visible in RTS.
- Added a Phase 5 movement test proving a player-controlled tank advances through the normal sim
  step and clears AI flow-field orders.
- Added a Phase 5 manual-fire test proving player-controlled click fire damages enemies through
  weapon data and records combat events.
- Browser verification passed on Vite dev server: selected tanks, pressed `V`, saw the camera
  enter chase view with `mode CHASE`, the possessed tank visible, reticle visible, sidebar hidden,
  selection overlays suppressed, then left-clicked fire and verified no new runtime errors.
- `npm test` passes (now 12 Vitest tests). `npm run build` passes.

### Known issues / notes
- Phase 5 is only a playable MVP. Full Rapier suspension, weapon firing from FPS, reload UI,
  damage indicators, kill feed, death/eject behavior, Tab cycling, audio, and full acceptance
  combat run remain.
- Pointer lock is requested on entry, but browser automation cannot fully verify native pointer
  lock behavior.

### Next
- Add FPS firing/reload against the existing Phase 4 weapon data, then implement death/eject and
  nearest-friendly Tab swap.
