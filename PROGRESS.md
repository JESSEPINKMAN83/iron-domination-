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
- Adjusted chase/gunner camera targeting so the reticle sits downrange on the shot direction
  instead of over the possessed tank body.
- Added a renderer-independent `PlayerControlled` sim component. Possessed tanks keep moving
  through the normal fixed-step `stepSim` path, while clearing AI move orders and preserving
  deterministic sim ownership.
- Added first-pass tank driving: `W/S` throttle, `A/D` hull turn, and mouse-driven turret/camera
  yaw.
- Added left-click manual cannon fire for possessed tanks using the existing weapon data,
  cooldowns, armor damage, splash, wreck, and combat event/tracer pipeline.
- Split tank weapons into two slots: left-click now fires a fast light cannon, while
  right-click launches a slower-reloading heavy siege bomb with larger splash damage.
- Siege bombs use pitch-to-range aiming in chase mode, so aiming higher sends the shot farther
  and makes long-distance hits require manual range calculation.
- High-angle siege bomb shots now lob out to long range instead of silently clipping to the
  normal weapon range. Close shots stay accurate; long shots get deterministic distance-based
  scatter so the tradeoff is range versus precision.
- Possessed-tank bomb safety now prevents the controlled tank from eating its own shot: manual
  bombs have a minimum arming distance, degenerate aim vectors fall back to turret aim, and AI
  siege bombs are not allowed to target the player-controlled tank during possession.
- AI-controlled tanks now use both weapon slots during combat, firing their quick cannon when
  available and mixing in the heavier bomb on its longer cooldown.
- Replaced bomb tracers with a visible thrown shell: right-click now launches a large bomb mesh
  with nose, fins, glow, and trail that follows the arc until landing.
- Rebalanced tank bombs down to a compact secondary weapon so they do not compete with future
  heavy bombs: lower damage, smaller splash radius, weaker anti-heavy/building modifiers, and a
  smaller/shorter detonation effect.
- Added a restrained layered bomb detonation with modest fireball, smoke, shock ring, scorch
  mark, and debris so nearby units take noticeable but not overwhelming splash damage.
- Tank turret visuals now follow sim turret yaw, so player aim and combat target tracking are
  visible in RTS.
- Added a Phase 5 movement test proving a player-controlled tank advances through the normal sim
  step and clears AI flow-field orders.
- Added a Phase 5 manual-fire test proving player-controlled click fire damages enemies through
  weapon data and records combat events.
- Added a secondary-fire test proving the heavy bomb respects its longer cooldown and damages
  multiple enemies through splash.
- Added a long-range secondary-fire test proving player-controlled bombs fire past the old range
  cap and land with deterministic scatter.
- Added possession bomb-safety tests proving manual bombs land safely away from the firing tank
  and AI siege bombs do not target the possessed tank.
- Browser verification passed on Vite dev server: selected tanks, pressed `V`, saw the camera
  enter chase view with `mode CHASE`, the possessed tank visible, reticle visible, sidebar hidden,
  selection overlays suppressed, then left-clicked fire and verified no new runtime errors.
- Follow-up browser smoke passed after the weapon split: reloaded the Vite page, entered
  `CHASE`, left-click fired without leaving chase mode, right-click produced the larger orange
  bomb blast downrange, and no fresh console errors were reported.
- Follow-up browser smoke passed after bomb-visual polish: reloaded the Vite page, entered
  `CHASE`, right-click fired a clearly visible large shell in flight, and no fresh console
  errors were reported.
- Follow-up browser smoke passed after tank-bomb rebalance: reloaded the Vite page, confirmed
  the canvas/HUD rendered at `sim 30 Hz`, and saw no fresh console errors.
- `npm test` passes (now 16 Vitest tests). `npm run build` passes.

### Known issues / notes
- Phase 5 is only a playable MVP. Full Rapier suspension, reload UI,
  damage indicators, kill feed, death/eject behavior, Tab cycling, audio, and full acceptance
  combat run remain.
- Pointer lock is requested on entry, but browser automation cannot fully verify native pointer
  lock behavior.
- Latest in-app browser high-angle bomb smoke attempts timed out in the automation layer after
  reload/entry, so this specific follow-up is verified by unit coverage plus TypeScript/Vite
  build rather than a completed browser screenshot.

### Next
- Add FPS firing/reload against the existing Phase 4 weapon data, then implement death/eject and
  nearest-friendly Tab swap.

## Quality Uplift — bug fix + spec catch-up ✅ (2026-07-04)

Per QUALITY_PLAN.md. Stopped before Phase 6 at user request — Phase 6 AI is
drafted in `drafts/phase6/` (unwired, see its README).

### Done
- **Fixed: tank destroyed on exiting V mode.** Bombs are now real sim projectiles
  (`sim.projectiles`): they fly at 95 m/s to the aimed *location* and damage on
  impact. The `playerControlled` bomb-immunity hack is deleted — while possessed you
  can be shot at by everything, and you dodge by driving. No rule change on exit,
  so no death cliff. Bomb visuals use the sim's flight duration; the blast VFX fires
  on the sim's `bomb-impact` event, exactly when damage lands.
- Turret traverse: constant-rate slew (`slewAngle`, tank 2.2 rad/s, soldiers 5.5);
  cannons (AI *and* manual fire) only fire within ±7° of the bearing — heavy turrets
  are felt in chase mode. AI turrets return to hull facing when idle.
- Soldiers rebuilt (`render/soldier.ts`): articulated rig — helmet/head, torso with
  vest, two-segment legs with knees, arms holding a rifle; procedural walk cycle
  driven by sim velocity (hip/knee swing, gait bob, forward lean), idle breathing,
  upper-body aiming via the turret-yaw path, crumple-sideways death. Rifle tracers
  now originate at shoulder height.
- Destroyed tanks become scorched wreck husks (material swap + turret sag) for their
  20 s persistence; destroyed buildings darken and slump; building meshes are now
  removed from the scene when wrecks expire (was a leak).
- **Fog of war**: per-team `VisibilityGrid` (128², unexplored/explored/visible),
  updated every sim tick; terrain shroud draped on terrain chunks (soft edges via
  linear filtering); enemy units/health bars hidden in fog; combat VFX suppressed
  when both endpoints are hidden; minimap fogged and hides unseen enemies; buildings
  provide vision. F4 toggles the shroud for debugging.
- Per-team economy: `EconomyState.team` + income multiplier; all build/queue/power
  paths are team-scoped (groundwork Phase 6 needs, no behavior change for team 1).
- AI targeting prefers the player's possessed unit (distance-discounted) — pressure
  per the plan's Phase 5/6 notes.
- Tests: 16 passing, including new ones — turret-gating, ballistic impact/splash
  timing, and "moving possessed tank dodges bombs / standing still is punished".

### Known issues / notes
- Cannons remain hitscan by design (fast flat-trajectory reads fine); only bombs arc.
- Fog shroud doesn't dim the water plane (terrain-draped only) — cosmetic, later.
- Soldier rig is procedural placeholder animation until Phase 7 skeletal GLBs.

### Next
- Phase 6 — Enemy Commander AI: restore `drafts/phase6/` per its README, wire into
  main, small starting armies + victory/defeat, playtest ~12-minute Normal game.

## Phase 6 — Enemy Commander AI ✅ (2026-07-04)

### Done
- **V-mode fixes**: A/D steering was inverted in chase mode (heading math sign) — D now
  turns right; V is a toggle (press again to exit, Escape still works).
- Enemy commander (`src/ai/commander.ts`): scripted build order → dynamic economy
  (power headroom, refinery expansion, factory count, rebuild of lost structures with
  `[ai]` console logs), production caps, wave-based attack squads (max concurrent squads
  per personality), 40%-strength retreats that disband into the defense pool, scouting
  that holds course to start-location hints + ore fields, and honest targeting — squad
  target *selection* only uses the AI's own visibility grid; unit weapons can no longer
  auto-engage beyond their own vision (no shelling into the fog, applies to all teams).
- Guard behavior for every idle combat unit: visible foe out of weapon range → close in
  (fixes defenders dying parked under bombardment).
- Personalities turtle/rusher/balanced (`?ai-style=`), difficulty easy/normal/hard
  (`?ai=`): income multiplier + reaction delay + army caps + start credits — no map hacks.
- Real match start: player yard + 8 tanks vs AI yard + 5 tanks; victory/defeat banner on
  building elimination; `?debug=armies` restores the 120v40 stress sandbox.
- Entity ids are now sim-scoped (`sim.nextEntityId`) — fixed cross-run nondeterminism
  from module-level counters.
- Tests: 19 passing, incl. commander behavior + determinism and a headless acceptance
  run — Normal/balanced defeats a passive player at ~8 min (plan says ~12; tune pacing
  via `attackDelay`/`maxSquads`/caps in `src/content/phase6.ts` after playtesting).

### Known issues / notes
- Passive-player defeat lands ~8 min (single wave can decide it); playtest and retune.
- AI expansion is extra refineries near base (income is per-refinery flat) — real ore
  fields/harvesters land with the economy deepening in Phase 7/8 backlog.
- AI squads path by flow field per order; no kiting/focus-fire micro yet.

### Next
- Playtest Phase 6, file findings, then follow CODEX_PHASES_PLAN.md — next up is Phase 6.4 (C&C-style command sidebar rework), then 6.5 (combat aircraft + aerial possession), then 7–9.

## Phase 6.4 — Command Sidebar Rework ✅ (2026-07-04)

### Done
- Reworked the command sidebar into the Red Alert-style always-visible flow: radar on top,
  four tabs underneath (`BUILDINGS`, `DEFENSE`, `INFANTRY`, `VEHICLES`), and a compact
  3-column command grid that stays visible even when a production building is selected.
- Added a selected-building strip with icon, hull, active/pending queue mini status, rally
  state, and primary producer toggle.
- Moved structures to a single economy construction line: click starts construction in the
  sidebar, the card shows progress, completion becomes `READY`, and clicking the ready card
  enters placement. Escape/right-click while placing returns to ready without refunding.
- Structure placement now spends up front and places complete, with a 1-second scaffold rise
  animation instead of the old map-side construction timer.
- Added full refunds for right-click cancel on the structure line, ready structures, queued
  units, and active unit production.
- Added per-producer queue cap enforcement, visible `xN` card badges, progress sweeps, queue
  full/lockout captions, unaffordable red costs, low-power status tagging, and tab activity
  coloring.
- Added primary Barracks/Factory routing: selected producer clicks queue locally; primary
  producers receive future sidebar clicks; otherwise unit production falls back to least-busy.
- Added rally points for production buildings: select a producer and right-click terrain to
  set a rally marker, then produced units immediately receive a move order to that point.
- Updated the AI commander to use the same structure-line/ready-placement economy path as
  the player.
- Updated F1 help for the new queue/cancel/ready/rally/primary flows.
- Tests now cover structure-line ready placement, refunds, unit cancel, and rally orders.
- Browser smoke passed on Vite dev server: the app booted at `127.0.0.1:5173`, the four-tab
  sidebar rendered with the expected build grid, and no console errors were reported.
- `npm test` passes (20 Vitest tests). `npm run build` passes.

### Known issues / notes
- Defense tab now has first-pass wall and tower content, added during the Phase 6.5
  defense interlude.
- Command card artwork still depends on optional PNGs in `public/assets/ui/command-icons/`;
  text initials remain the fallback for missing art.
- Browser verification was a smoke pass, not a full manual interaction pass through every
  card state. Sim/unit tests cover the risky production logic.

### Next
- Continue CODEX_PHASES_PLAN.md with Phase 6.5: combat aircraft, anti-air behavior, and aerial
  possession controls.

## Phase 6.5 — Combat Aircraft Foundation 🚧 (2026-07-04, started)

### Done
- Improved RTS move-order reliability: right-click commands now tolerate normal pointer jitter,
  retry terrain picking from the original click point, snap blocked ground clicks to a larger
  nearby walkable search radius, and only show an order marker after the sim accepts the order.
- Added regression coverage for issuing a move order onto blocked terrain and still assigning
  selected tanks a valid target immediately.
- Added the first aircraft tech content: `Helipad` structure and `Vulture` aircraft unit, plus
  an `AIRCRAFT` command sidebar tab with a locked empty state until a Helipad is available.
- Added optional altitude to sim transforms and included altitude in deterministic sim hashing.
- Added a `Flight` component and a `spawnVultureAt` factory with cruise altitude, climb limits,
  banking state, vision, health, and flight movement stats.
- Branched `issueMoveOrder` and `stepSim` for flyers: aircraft ignore ground walkability/flow
  fields, fly directly to orders over water/cliffs, maintain terrain-safe altitude, avoid rising
  terrain ahead, bank while turning, and crash if driven below terrain.
- Added Vulture rendering with fuselage, cockpit accent, skids, rocket pods, spinning main/tail
  rotors, banking, and a ground blob shadow.
- Added Helipad building material support.
- Added movement test coverage proving flyers move directly and maintain minimum AGL.
- Enabled V-mode possession for Vultures with a dedicated gunship control path:
  `W/S` thrust/brake, `A/D` yaw trim, mouse nose aim, `Space/Ctrl` climb/descend,
  left-click rocket pods, and right-click AG missile.
- Added a Vulture chase camera using real aircraft altitude, speed-based FOV, hover bob,
  and longer downrange aim so flight reads differently from tank possession.
- Added first-pass aircraft weapon data for rocket pods and AG missiles, plus tests proving
  player-controlled flight moves/climbs and Vulture rockets damage ground targets.
- Added the first defensive-building interlude: `Wall Segment` and `Guard Tower` now live in
  the `DEFENSE` sidebar tab after Power Plant tech is online.
- Defensive structures can register as dynamic ground navigation blockers. Walls and towers
  block tank movement while alive, and destroyed blockers are removed immediately so breaches
  open usable paths.
- Guard Towers use the existing cannon weapon data, acquire nearby enemies automatically, and
  provide their own vision radius.
- Added regression tests proving walls block/unblock navigation and Guard Towers auto-fire at
  nearby enemies.
- Added Red Alert-style right-click hold-drag facing orders: selected movers can be ordered to
  move to the mouse-down point, preview an arrow while dragging, and arrive in a line formation
  facing the chosen direction.
- Added hit-confirmation feedback for combat: damage events now carry source-team and target
  health snapshots, player-fired hidden impacts can briefly show `HIT`/`DESTROYED` cards with
  percentage damage and remaining health, and damaged buildings now show health bars like units.
- Added a temporary test-start mode as the default boot state: player starts with Power Plant,
  Refinery, Barracks, Factory, Helipad, and Guard Tower already placed plus extra credits, so
  infantry/tank/Vulture production and defense builds can be tested immediately. Use
  `?start=normal` to verify the original build-up flow.
- Fixed radar/minimap orientation so terrain, fog, unit dots, focus marker, and radar clicks
  all use the current RTS camera yaw; screen-down movement now reads as down on the radar
  instead of rotating sideways.
- Added a live radar viewport marker: the minimap now draws a compact yellow rectangle over
  the current RTS camera view, updating with pan, zoom, rotation, and radar jumps.
- Swapped Vulture secondary fire onto the same visible ballistic bomb pipeline as tanks:
  right-click now launches a bomb from aircraft altitude, while rocket pods remain left-click.
- Smoothed aircraft V-mode chase camera by preserving altitude in transform history, using
  render-interpolated aircraft positions, damping the camera anchor, and removing render-time
  bob that made the helicopter read as flaky.
- Stabilized Vulture V-mode steering: `A/D` now yaw the aircraft heading directly, reverse
  thrust no longer flips the hull around through velocity-facing logic, and player-controlled
  aircraft bank from steering input instead of velocity snaps.
- Rebalanced shared tank/Vulture bombs downward: lower direct damage, smaller splash radius,
  longer reload, and a smaller/shorter explosion effect so these are tactical secondary
  weapons rather than heavy super-bombs.
- Split bomb visuals by launch platform: tank bombs keep the arcing lob, while Vulture bombs
  render as a downward air-drop path from aircraft altitude.
- Added air-target combat rules so rifles/cannons can still chip aircraft, but with reduced
  range and damage; ordinary ground bomb splash now only grazes Vultures instead of deleting
  them from near misses.
- Added `AA Missile Tower` to the `DEFENSE` tab with a dedicated `aaMissile` weapon, long
  anti-air range, and aircraft-height hit events so anti-air fire travels up to airborne
  targets.
- Added regression tests proving normal tank fire damages Vultures slowly, ground bomb splash
  barely affects aircraft, and AA missile towers are the intended hard counter.
- Improved building selection UX: selected buildings now get a pulsing golden footprint glow
  under the structure, and the right panel selected-building card shows compact capability
  chips such as structures, power, credits, blockers, and defense role.
- Fixed sidebar context switching so selecting a Command Yard/Barracks/Factory/Helipad still
  jumps to its useful build tab once, but manual tab clicks remain responsive while the
  building stays selected.
- Added wall-chain placement: when placing a ready Wall Segment near an existing friendly wall
  in a straight/near-straight line, the placement preview now shows every missing segment and
  confirmation builds the full connecting run while charging extra in-between wall costs.
- Added regression coverage proving a wall anchor plus a second placed endpoint auto-fills the
  missing segments and charges the extra line cost.
- Updated F1 help with Vulture controls.
- Browser smoke passed on Vite dev server: `AIRCRAFT` tab rendered, `HELIPAD REQUIRED` empty
  state appeared, Helipad content was present, and no console errors were reported.
- Follow-up browser smoke passed after Vulture V-mode wiring: app reloaded, `AIRCRAFT` tab
  opened, and no console errors were reported.
- Follow-up browser smoke passed after radar orientation fix: radar canvas loaded, radar click
  navigation executed successfully, and no console errors were reported.
- Follow-up browser smoke passed after radar viewport marker: app reloaded, the top-right
  radar rendered a compact view rectangle over the visible base area, and runtime stayed clean.
- Follow-up browser smoke passed after aircraft bomb/smoothing work: produced a Vulture from
  the aircraft tab, drag-selected it, entered `CHASE Vulture`, and right-clicked in chase mode.
- Follow-up browser smoke passed after Vulture steering/drop fix: produced a Vulture,
  drag-selected it, entered `CHASE Vulture`, tapped `D`/`S`, right-clicked a bomb, and saw no
  new console errors.
- Follow-up browser smoke passed after building-selection UX: Defense tab stayed responsive,
  a selected Refinery showed the new footprint glow and capability chips, and selected-building
  context remained visible while switching tabs.
- Follow-up browser smoke passed after wall-chain placement: Defense tab opened, Wall Segment
  entered READY state, and the sidebar stayed responsive.
- Follow-up improvement: buildings under direct or splash attack now alert nearby friendly
  mobile defenders. Idle defenders temporarily target and move toward the attacker even when
  the shooter is bombarding from outside their normal idle engagement, so bases no longer sit
  passive while being shelled from afar.
- Follow-up camera UX fix: holding Space now puts the RTS camera into grab-pan mode for mouse
  movement/dragging, while Command/Ctrl + left-drag remains the saved free-look camera angle
  control and plain right-drag stays available for unit-facing orders.
- Follow-up wall-chain fix: wall previews now snap from open wall ends only, not from middle
  side segments, so extending a wall from its left/right/top/bottom edge no longer latches to
  the wrong side of an existing run.
- Follow-up roster expansion: added Grenadier and Rocket Team infantry, Jackal Scout and
  Mauler Siege tanks, plus Wasp Scout and Hammerhead aircraft. Each has distinct weapon,
  health, speed/vision, production cost/time, and first-pass visual scale; the enemy commander
  now mixes these roles into its army through the same production queues.
- Follow-up V-mode flight-feel rework: aircraft now use data-driven flight models
  (`gunship`/`jet`/`drone`) and the Vulture uses an attitude-driven gunship integrator:
  pitch/roll drive acceleration, velocity drifts with quadratic drag, Q/E strafes, A/D
  yaw preserves the D-turns-right convention, Space/Ctrl commands vertical velocity, and
  low-speed terrain clips bounce instead of always crashing.
- Added aircraft gun-gimbal behavior and a drift-aware chase camera: mouse aim can move
  inside a yaw cone before the hull chases it, the camera follows velocity blended with
  heading, FOV scales to speed, and camera roll follows aircraft roll lightly.
- Aircraft visuals now pitch/roll from sim attitude state with rotor speed responding to
  speed/collective, and flight attitude/vertical velocity are included in deterministic
  `hashSim` coverage.
- Added a 600-tick possessed-gunship flight tape regression proving strafe, climb, turn,
  attitude, and sim hashing stay deterministic.
- Follow-up browser smoke passed after the flight-feel rework: app reloaded at
  `127.0.0.1:5173`, title rendered as Iron Dominion, and no console errors were reported.
- Follow-up building-damage visual rework: buildings now own deterministic localized
  `structureDamage` grids in the sim, with direct hits, splash, and bomb impacts damaging
  the struck facade/roof cells instead of only reducing whole-building HP.
- Building rendering now uses a procedural block grid matched to the damage cells, so
  individual sections can scorch, crack, shrink, breach, reveal dark interiors, catch fire,
  smoke, sag, lean, and collapse into rubble while selection glows and health bars still work.
- Follow-up first-hit visibility tuning: the first real hit on a building now guarantees
  an immediate visible localized scar on the struck cell, lowers first-stage crack/deform
  thresholds, and spawns a small smoke cue instead of waiting for repeated hits.
- Follow-up V-mode camera controls: possessed tank and aircraft chase cameras now support
  mouse-wheel zoom, and Command + left-drag orbits the camera around the controlled unit
  without changing weapon aim, helping when the unit body blocks the target.
- Follow-up single-click selection reliability: unit clicks now use a generous screen-space
  hit test before terrain/building fallback, unit pick radii are larger, fogged/hidden units
  are ignored, and visible units no longer lose clicks as easily to nearby building footprints.
- Follow-up squad possession: selecting multiple possessable units and pressing `V` now
  controls one deterministic squad leader while the rest follow in formation, `Tab` cycles
  the controlled leader, and wingmen fire at the same target point when the leader fires.
- Structure damage cells are included in `hashSim`, and regression tests now prove facade
  locality, first-hit visibility, top-tier arcing damage, splash spread, support bleed, and
  deterministic hashing.
- Follow-up browser smoke passed after the building damage rework: app reloaded at
  `127.0.0.1:5173`, canvases/sidebar rendered, and no console errors were reported.
- Latest browser smoke after squad possession: app reloaded at `127.0.0.1:5173`, HUD/canvases
  rendered, F1 help exposed the squad shortcut, and no console errors were reported.
- `npm test` passes (43 Vitest tests). `npm run build` passes.

### Known issues / notes
- Vulture V-mode now has the core gunship flight feel, but ammo/rearm, visible
  rocket/missile projectile trails, AI air usage, the F6 flight debug overlay, and the
  velocity-vector reticle dot are still pending.
- Right-click AG missile is a first-pass instant manual shot through weapon data; the planned
  hold-to-preview ground-impact marker and travel-time missile come next.
- Wall chaining is click-to-anchor based. Drag-to-place wall painting and richer wall-line UI
  messaging are still future UX polish.
- Browser automation cannot issue a true right-button drag, so the facing-order gesture is
  covered by sim tests plus a browser load/runtime smoke pass.
- Hidden hit confirmations are intentionally temporary indicators, not fog reveal; the target
  disappears again unless normal vision sees it.
- Building upgrade actions are intentionally not stubbed as fake buttons yet; the selected
  building card now has the visual/capability area where real upgrade actions can be added once
  upgrade data and effects exist.
- Building damage visuals are still procedural blockout art, not final GLB/designed rubble
  assets; the important localized damage data model is now in place for the later art pass.

### Next
- Continue into Phase 6.6: real oil economy, harvester collection/deposit loop, depletion,
  and AI economy raids.

## Phase 6.6 Foundation — Resource Nodes 🚧 (2026-07-04)

### Done
- Added gameplay-visible `ResourceNode` sim data seeded deterministically from the map's
  existing ore fields. Nodes are finite oil sources with id, position, radius, capacity,
  and remaining stored value.
- Included resource nodes in `hashSim`, so future harvester collection/depletion changes are
  covered by the deterministic sim hash instead of living as hidden side state.
- Added regression coverage proving oil nodes are deterministic, finite, mapped one-to-one
  from terrain ore fields, and included in the sim hash.
- Browser smoke passed on Vite dev server: app reloaded at `127.0.0.1:5173`, the canvas/HUD
  and command sidebar rendered, and no new app runtime errors were introduced.
- Latest verification after the building-damage follow-up: `npm test` passes (42 Vitest tests).
  `npm run build` passes.
- Follow-up V-mode direct-fire aiming fix: left-click cannon/rocket shots now preserve the
  3D reticle aim height instead of snapping tracer endpoints down to terrain when aiming
  toward the horizon or above ground. Helicopter primary fire also keeps its aimed flight
  vector height while still clamping below-ground shots above terrain.
- Latest verification after V-mode aiming fix: `npm test` passes (43 Vitest tests).
  `npm run build` passes. Browser smoke reloaded `127.0.0.1:5173` as Iron Dominion with no
  console errors.
- Follow-up command-sidebar producer highlight: switching Buildings/Defense/Infantry/Vehicles/
  Aircraft tabs now highlights the relevant source building on the map with a teal producer
  glow. Unit tabs prefer the selected producer, then the primary producer, then the least-loaded
  available producer.
- Latest verification after producer highlight: `npm test` passes (43 Vitest tests).
  `npm run build` passes. Browser smoke reloaded the app and clicked through all five command
  tabs with no console errors.
- Follow-up move-order accuracy fix: right-click terrain orders now preserve exact walkable
  click positions instead of snapping every order to the center of a nav cell, and ground units
  no longer clear close-range move orders while still far from the requested point.
- Latest verification after move-order accuracy fix: `npm test` passes (45 Vitest tests).
  `npm run build` passes. Browser smoke reloaded `127.0.0.1:5173` as Iron Dominion with no
  console errors.
- Follow-up building readability pass: structures are now taller by type, with walls kept low
  and towers/major production buildings raised, and each top color strip now renders the
  building name in dark text for quick map readability.
- Latest verification after building readability pass: `npm test` passes (45 Vitest tests).
  `npm run build` passes. Browser smoke reloaded cleanly and a visual screenshot confirmed
  taller buildings plus readable roof-strip labels.
- Pre-Netlify new-game front door: fresh visits now open a skirmish setup screen with
  difficulty, enemy commander personality, map seed, randomize, condensed controls, and
  Enter/START launch. Settings persist in `localStorage`, URL params still override and
  auto-boot, terrain/scatter derive from the chosen seed without mutating `MAP01`, and
  reload-based restart paths use a tiny session autostart flag.
- Added in-game `MENU` with Restart Match / Back To Setup / Cancel, plus victory/defeat
  PLAY AGAIN and SETUP buttons. All restart/setup actions persist settings and reload
  instead of trying in-place teardown.
- Latest verification after new-game front door: `npm test` passes (45 Vitest tests).
  `npm run build` passes. Browser acceptance covered setup screen -> START -> match,
  in-game MENU dialog, and `?ai=hard&debug=armies` URL-param auto-boot with no console
  errors.
- Follow-up public-build HUD cleanup: the top-left stats card and bottom-left controls card
  are now collapsed by default, F1 toggles both together, and a small `i` button beside MENU
  shows/hides them without stealing focus or map clicks.
- Latest verification after HUD cleanup: `npm test` passes (45 Vitest tests). `npm run build`
  passes. Browser acceptance confirmed both panels start hidden, the `i` button toggles both
  visible/hidden, and no console errors were reported.
- Follow-up `UNIT_ROSTER_SPEC.md` implementation: added explicit `air` armor class, removed
  hidden anti-air multiplier behavior from combat targeting/damage, expanded weapon definitions
  with `vs.air`, `canTargetAir`, `airRange`, minimum ranges, and projectile metadata. Wasp now
  uses a high-AA autocannon, Rocket Teams carry secondary AA missiles, Vulture/Hammerhead use
  air-to-ground missiles, and aircraft spawn as true air armor.
- Added live projectile simulation for grenades, anti-tank rockets, AG missiles, and homing AA
  missiles, including launch/impact events and deterministic projectile position hashing.
  Combat visuals now render those projectile launches/impacts instead of treating them as
  invisible hitscan.
- Build cards now show unit role captions plus compact stat/counter pips, and F1 help includes
  a small counter cheat sheet. Enemy commander production ratios now mix more scouts, rocket
  teams, Wasps, and heavy air to exercise the counter roster.
- Latest verification after unit-roster pass: `npm test` passes (45 Vitest tests). `npm run build`
  passes. Browser smoke reloaded `http://127.0.0.1:5173/?ai=hard&debug=armies`, confirmed the
  vehicle roster cards render role text, canvas is present, and no console errors were reported.
- Follow-up roster differentiation pass: all vehicles and aircraft now carry bomb secondaries
  with tiered salvo counts. Jackal/Wasp fire one bomb, M-17/Vulture fire twin bombs, and
  Mauler/Hammerhead fire four-bomb salvos, while infantry remains unchanged. Bomb salvos use
  deterministic impact spacing and slight stagger so higher tiers feel visibly stronger.
- Latest verification after salvo pass: `npm test` passes (45 Vitest tests). `npm run build`
  passes. Browser smoke reloaded `?ai=hard&debug=armies`, confirmed the Aircraft tab shows
  single/twin/four-bomb roles, and no console errors were reported.
- Follow-up tactical formation pass: right-click hold/drag facing orders now use the drag
  distance as formation spread. Selected units prefer a single firing line perpendicular to
  the facing arrow, with short drags making tight lines and longer drags making wider lines.
  The facing arrow preview/final marker supports longer visual arrows to match the new spread
  control, and F1 help documents the gesture.
- Latest verification after formation-spread pass: `npm test` passes (46 Vitest tests).
  `npm run build` passes. Browser smoke reloaded `?ai=hard&debug=armies`, confirmed the canvas
  boots, and no console errors were reported.
- Follow-up start-position pass: default player and enemy starts now use shared map-relative
  anchors in opposite quadrants (`team 1` southwest, `team 2` northeast) at 22% of map size,
  with starting armies mustered slightly inward from those bases. This increases default army
  separation substantially while preserving buildable opening space and AI attack timing.
- Latest verification after start-position pass: `npm test` passes (46 Vitest tests).
  `npm run build` passes. Browser smoke reloaded `?ai=hard&debug=armies`, confirmed the canvas
  boots, and no console errors were reported.
- Follow-up live-match default start: ordinary launches now start with only the Command Yard,
  normal credits/power, two starting tanks per side, and a small rifle/rocket infantry escort
  per side. The previous all-tech/base-seeded sandbox is now explicit via `?start=test`, and
  the large stress-army setup is explicit via `?start=armies`; stale `debug=armies` URLs no
  longer force the giant-army/default sandbox start.
- Latest verification after default-start pass: `npm test` passes (46 Vitest tests).
  `npm run build` passes. Browser smoke reloaded the current
  `?ai=hard&debug=armies` URL, confirmed the normal build-up state (`$4600`, `PWR +20`,
  only Command Yard tech unlocked), and no console errors were reported.

## Phase 6.6 — Real Resource Economy 🚧 (2026-07-04, in progress)

### Done
- Replaced temporary flat refinery income with a real collector loop. Refineries spawn an
  Ore Harvester/Ash Harvester; harvesters seek finite resource nodes, gather cargo, return to
  a live friendly refinery, deposit credits through the ledger, then repeat.
- Resource nodes are deterministic sim objects with finite `remaining` values and are included
  in `hashSim`; harvester cargo/state is also hashed for determinism.
- Added dedicated harvester rendering so collectors no longer look like tanks: industrial
  body, cargo bed, cab, front scoop, side tanks, wide tracks, and team-colored cargo/stripe.
- Added cargo/scoop visual feedback: cargo load scales with carried ore, and the scoop animates
  while gathering.
- Added economy sidebar feedback: current refineries, collectors, cargo, remaining ore, and
  selected-harvester state/cargo bar.
- Added bright ore-field glow markers on terrain and radar; terrain glow now fades/scales down
  as a node depletes.
- Added player controls for collectors: right-click ore with selected harvesters to resume
  gathering; right-click a friendly refinery to return/deposit.
- Refineries now automatically replace a lost assigned harvester after a short delay, using the
  same deterministic rule for player and AI economies.
- Produced units now spawn outside their producer footprint and automatically move clear when no
  rally is set, so new units do not appear hidden under the building.
- Enemy commander excludes harvesters from combat squads so it does not accidentally attack with
  its economy units.
- Enemy commander now treats visible enemy collectors and refineries as economy-raid targets,
  preferring them over ordinary buildings unless the player-possessed unit is visible.
- Enemy refinery placement now searches live resource nodes first, avoiding already-served ore
  fields and expanding from existing structures toward unclaimed ore instead of only circling
  the main base.
- Added commander regression coverage for visible economy raids and resource-biased refinery
  placement.
- Damaged harvesters now enter a temporary threatened state, recall to their assigned refinery,
  and pause there briefly before resuming collection. Threat state is included in `hashSim`.
- Friendly combat units near a hit harvester now receive the same temporary defense alert used
  for shelled buildings, so collector raids trigger a local response instead of being ignored.
- Added regression coverage for harvester recall under fire and defender response to collector
  attacks.
- Latest verification after this Phase 6.6 slice: `npm test` passes (55 Vitest tests).
  `npm run build` passes. Browser smoke reloaded the local app, launched a match from setup,
  confirmed the game canvases/sidebar rendered, and reported no console errors.

### Known issues / notes
- AI uses the same collector/refinery rules and now raids/expands around the economy. Collector
  retreat/local-defense response exists, but dedicated escort assignment is still not a full
  tactical behavior.
- Route-blocking and refinery-blocked feedback need deeper testing and UI states.

### Next
- Continue Phase 6.6 with clearer blocked-route/refinery feedback, then move toward Phase 7's
  presentation/content pass once the economy UX is legible enough for playtesting.

## Phase 7 — Presentation & Content Pass 🚧 (2026-07-04, started)

### Done
- Started the Phase 7 art/readability pass with economy-focused presentation, since the real
  resource loop is now central gameplay.
- Oil/resource nodes now render as small active oil-field sites instead of only terrain glow:
  pump-jack/derrick hardware, pipes, storage tanks, and a colored status light sit on each
  field. The rigs animate while resources remain and fade/desaturate as nodes deplete.
- Harvester retreat/readability improved: collectors recently damaged by raids now show a
  pulsing red beacon while their deterministic threat timer is active.
- Refineries now have a visible dock/pump cue. When an assigned collector is returning or
  depositing, the dock ring lights up, the hose appears, and the pump animates.
- Latest verification after this Phase 7 slice: `npm test` passes (55 Vitest tests).
  `npm run build` passes. Browser smoke loaded `http://127.0.0.1:5173/?start=test`, confirmed
  the active economy sidebar/game canvases rendered, and reported no console errors.
- Follow-up combat/air presentation pass: projectile launches now use differentiated bodies
  for bombs, grenades, rockets, AG missiles, and AA missiles, with color-coded tracer cores
  and fading smoke puffs along the flight path.
- Crash events now render a heavier blast with a shock ring and expanding smoke instead of
  falling through the generic tracer/impact path.
- Low-flying aircraft now kick up a subtle rotor-wash dust ring at ground level, scaling with
  altitude and speed so Vulture movement reads more connected to the terrain.
- Latest verification after combat/air presentation: `npm test` passes (55 Vitest tests).
  `npm run build` passes. Browser smoke loaded `http://127.0.0.1:5173/?start=test`, confirmed
  active game canvases/sidebar rendered, and reported no console errors.
- Follow-up V-mode flight control fix: player-controlled gunships now suppress velocity
  weathervane during hard aim reversals, boost mouse-follow for large 180-degree turns, and
  shift the chase camera back toward the look direction when turning against current velocity.
  This makes it much easier to fly past a target, turn around, and re-engage without exiting
  V-mode.
- Added a regression test proving a fast player-controlled Vulture can rotate through a
  180-degree aim reversal while airborne.
- Latest verification after flight U-turn fix: `npm test` passes (56 Vitest tests).
  `npm run build` passes. Browser smoke loaded `http://127.0.0.1:5173/?start=test`, confirmed
  active game canvases/sidebar rendered, and reported no console errors.
- Follow-up control/content polish: Space grab-pan now only moves while Space plus a held mouse
  button is active, so holding Space alone no longer makes bare mouse movement shake the map.
- Added a buildable Sniper infantry unit with a long-range scoped rifle, a distinct longer
  rifle/scope silhouette, light AI usage, a starting test-map sniper, and V-mode scoped controls:
  right-click toggles scoped aim, mouse wheel zooms the scope, and left-click fires.
- Added regression coverage for sniper production and long-range manual anti-infantry fire.
- Latest verification after sniper/control polish: `npm test` passes (63 Vitest tests).
  `npm run build` passes. Browser smoke loaded `http://127.0.0.1:5173/?start=test`, confirmed
  active game canvases/sidebar rendered, confirmed the scope overlay exists, and reported no
  console errors.
- Sniper scope alignment fix: entering scope now preserves the world point already under the
  reticle, the scoped camera sits on the rifle line, and scoped shots use the scoped camera
  direction plus sniper muzzle height so the tracer and impact line match the zoomed reticle.
- Sniper lethality/reach pass: scoped rifle range increased from medium skirmish distance to
  320 map units, sniper vision increased to match, anti-infantry damage raised well above
  rifle fire, and the sniper tracer lingers longer for readability.
- Sniper V-mode repeat-fire fix: reload is now a playable 1.35s, scope UI shows READY or
  remaining reload time, premature clicks flash RELOADING, and combat coverage proves a
  player-controlled sniper can fire again after the reload.
- Sidebar selection roster: the right command panel now shows a grouped grid of the current
  selection below the selected building/collector strip. Each bucket shows the unit/building
  type, count, and average health, and clicking a bucket narrows the live game selection to
  only those entities.
- Selection safety/readability fix: player selection is now team-gated in the sim, so lasso,
  click, control groups, and sidebar filtering cannot select or command enemy units even if
  an enemy is inside the gesture. Unit selection rings are brighter/thicker with a subtle
  pulse, and building selection glows are stronger.
- V-mode HUD cue: entering first-person now slides in a top command banner that says
  FIRST-PERSON VIEW and shows the V/Escape exit hint, then animates away when returning to
  command view.
- Facing-order formation preview: right-click hold/drag no longer draws a terrain-clipped
  ground arrow. It now shows elevated formation slots spread perpendicular to the facing
  direction, using the selected mover count and the drag length so the preview matches the
  line the units will form when the order is released.
- Sniper scope toggle stability correction: sniper regular aim and scoped aim now share the
  same rifle/eye camera origin and aim vector. Right-click scope toggling only changes the
  overlay/FOV, avoiding the terrain-anchor/parallax drift that moved the target between
  normal and scoped views.
- V-mode exit polish: leaving first-person now eases to a nearby command-view camera from
  the current viewing side, instead of forcing a fixed RTS pose that could spin through a
  large rotation. The transition is a gentler zoom/tilt back to command view.
- Unit visual polish pass per `UNIT_VISUAL_POLISH_SPEC.md`: added a shared faction palette
  with different friendly/enemy hull tones plus bright accent/light-bar materials, and a
  render-only `unitVisualKind` mapper so silhouettes derive from existing weapon/loadout data.
- Infantry now uses one soldier rig with readable gear kits: rifle baseline, stockier
  grenadier with drum launcher/armor, tall rocket team with backpack rockets/antenna, and a
  longer scoped sniper rifle kit.
- Vehicles now have distinct procedural silhouettes: Jackal scout has a lighter six-wheel
  body and twin autocannons, M-17 keeps the baseline tank shape with track skirts/chevrons,
  Mauler is longer/lower with a braced siege barrel, and harvesters keep a clear industrial
  scoop/cargo-bed profile.
- Aircraft now have differentiated airframes: Wasp is a small scout gunship, Vulture is the
  baseline rotor gunship with pods/tail cues, and Hammerhead is a heavy twin-rotor platform
  with visible missile racks.
- Unit render updates now store cached refs for turrets, barrels, rotors, racks, cargo,
  scoops, and antennas instead of per-frame `getObjectByName` lookups. Box/cylinder/ring
  primitives are shared through module-level geometry caches for the new unit visuals.
- Added `?start=lineup` QA mode, which spawns one of every combat unit plus harvester for
  both teams in two facing rows, disables AI/combat, reveals the scene, and jumps the camera
  to the lineup for visual review.
- Latest verification after unit visual polish: `npm test` passes (65 Vitest tests).
  `npm run build` passes. `git diff --check` is clean. Browser smoke loaded
  `http://127.0.0.1:5173/?start=lineup`, confirmed game canvases rendered, and reported no
  console errors.
- Follow-up V-mode vehicle firing fix: lineup mode now runs combat in passive mode, so manual
  vehicle/aircraft shots, projectile flight, and weapon cooldowns keep ticking while
  auto-targeting stays disabled. This fixes possessed vehicles getting stuck after one
  left-click and one right-click shot in `?start=lineup`.
- Latest verification after vehicle firing fix: `npm test` passes (67 Vitest tests).
  `npm run build` passes. Browser smoke reloaded `http://127.0.0.1:5173/?start=lineup`,
  confirmed canvases rendered, and reported no console errors.
- Follow-up V-mode 360-degree turn fix: first-person look yaw now accumulates continuously
  instead of wrapping at `-180/180`, so soldiers, ground vehicles, and aircraft can keep
  spinning toward enemies without hitting a yaw seam. V-mode clicks also re-request pointer
  lock, so a lost mouse capture does not make turning stop at the screen edge.
- Latest verification after continuous-turn fix: `npm test` passes (68 Vitest tests).
  `npm run build` passes.
- Follow-up aircraft aim-down fix: flying units can now pitch V-mode aim much farther downward
  and steep aircraft shots raycast from the aircraft toward terrain, so helicopters/gunships can
  aim and fire at targets nearly directly below. Aircraft bombs can drop straight underneath,
  while tanks keep their minimum safe bomb throw distance.
- Latest verification after aircraft aim-down fix: `npm test` passes (69 Vitest tests).
  `npm run build` passes.
- Follow-up aircraft hard-turn controls: possessed aircraft now use `Q/E` for stronger left/right
  yaw turns while `A/D` remain the normal steering trim, making tight U-turns and quick attack
  re-approaches much easier in V-mode.
- Latest verification after aircraft hard-turn controls: `npm test` passes (70 Vitest tests).
  `npm run build` passes. `git diff --check` is clean. Browser smoke reloaded
  `http://127.0.0.1:5173/?start=lineup`, confirmed canvases rendered, and reported no console
  errors.

## Phase 7.5 — Public Playtest / Netlify Readiness ✅ (2026-07-05)

- Added `netlify.toml` so Git-based Netlify deploys run `npm run build`, publish `dist`,
  and route all paths back to `index.html`.
- Added `NETLIFY_DEPLOY.md` with the practical split: manual Netlify Drop should upload
  `dist/`, while connected Netlify projects should use the repo root.
- Updated the default setup screen from a pre-Netlify/dev label to public playtest framing:
  the default `/` route opens skirmish setup, debug/test modes remain hidden behind URL params,
  and the setup copy explains seed sharing.
- Reworked the in-game bottom-right chrome into public `HELP` and `MENU` actions. `HELP`
  opens a field guide, `MENU` pauses simulation while open and exposes Resume, Help, Copy
  Match Link, Restart Match, and Back to Setup. The old debug stats remain available on `F2`;
  `F1` now opens the player guide.
- Added command-panel unit thumbnails cropped from the provided low-poly unit sheet for
  infantry, sniper, grenadier, rocket infantry, scout/tank/siege vehicles, Wasp, Vulture,
  Hammerhead, and the harvester placeholder.
- Added command-panel building/defense thumbnails cropped from the provided structure sheet
  for Power Plant, Refinery, Barracks, Factory, Helipad, Wall, Guard Tower, and AA Missile
  Tower. Command Yard temporarily reuses the Factory thumbnail until a dedicated base icon
  is designed.
- Stabilized the command panel rendering: production progress, economy status, and producer
  summary rows now update live in place instead of forcing full card rebuilds every time ore,
  cargo, credits, or progress numbers change. This removes the thumbnail/card shake and gives
  active build progress a smoother top progress bar.
- Moved the selected-force summary out of the right command panel into a separate bottom-center
  selection bar. Economy now stays directly under the command tabs, while selected groups spread
  horizontally at the bottom of the screen and still support click-to-filter by unit type.
- Latest verification after Phase 7.5: `npm test` passes (70 Vitest tests). `npm run build`
  passes. `git diff --check` is clean. Browser smoke confirmed `/` setup, START SKIRMISH,
  HELP/MENU dialogs, and hidden `?start=lineup` QA mode all render with no console errors.

### Known issues / notes
- This is still procedural art, not final GLB content. It establishes the gameplay-readable
  visual language and can be replaced with asset files later without changing sim data.
- The first Phase 7 passes focused on economy/resource presentation and combat/air feedback.
  Richer soldier/vehicle GLB-style art, audio, rotor loop sound, and hand-authored explosion
  assets remain pending.
- Netlify readiness here means public single-player skirmish against AI. Live multiplayer is
  still Phase 9 and would require a server/lobby/input-sync layer beyond static Netlify hosting.

### Next
- Deploy `dist/` to Netlify for a real public playtest, then either continue Phase 7 asset/audio
  polish or move into Phase 8 balance/settings based on what breaks first in play.

## Phase 8A — Balance & Public Match Polish 🚧 (2026-07-05, started)

- Added explicit difficulty-facing setup copy for Easy/Normal/Hard and enemy commander
  personalities, so public players understand the pacing tradeoffs before starting a match.
- Added difficulty-specific first-attack timing. Normal remains the baseline, Easy delays the
  first attack longer, and Hard pressures earlier while keeping the existing honest economy and
  visibility rules.
- Added a short in-match mission briefing toast after skirmish start with the objective and
  selected AI profile, without leaving another permanent HUD card on the screen.
- Expanded the match menu into a useful pause/status screen: elapsed time, current credits,
  player/enemy buildings and units, collector counts, AI pressure summary, Resume, Help, Copy
  Match Link, Restart, and Back to Setup.
- Expanded victory/defeat recap with match time, remaining forces, credits, collector count,
  AI attacks launched, and AI rebuild count.
- Latest verification after this Phase 8A slice: `npm test` passes (70 Vitest tests), including
  the Normal/balanced passive-player acceptance at 13.2 sim-minutes. `npm run build` passes.
  Browser smoke confirmed setup copy, START SKIRMISH, mission briefing, match-menu live stats,
  and no console errors.

### Next
- Continue Phase 8 with playtest balance passes: unit cost/time tuning, AI wave composition by
  difficulty, clearer power/low-credit failure states, and optional lightweight graphics/audio
  toggles for public machines.

## Phase 9A — Multiplayer Foundation 🚧 (2026-07-06, started)

- Added a dependency-free Node multiplayer relay at `server/multiplayer-server.mjs`. It exposes
  room creation, join, leave, event stream, health, and future command relay endpoints.
- Added `npm run multiplayer` for the relay alone and `npm run dev:multiplayer` to run the
  relay and Vite app together for local two-window/two-machine testing.
- Added a typed browser multiplayer client in `src/net/multiplayer.ts` using `fetch` plus
  `EventSource`, so the static Vite client can connect to a separately hosted relay.
- Added Multiplayer controls to the setup screen: server URL, room code, Host Room, Join Room,
  room status, player assignment, and synchronized match start when a second player joins.
- Added `MULTIPLAYER.md` with local/LAN/public-hosting instructions, and updated
  `NETLIFY_DEPLOY.md` to clarify that Netlify can host the client but not the live relay.
- Server smoke verified: `/health`, room host, second-player join, player indexes 1/2, and
  automatic transition to `in-game`.

### Known issues / notes
- This is a networking foundation slice, not finished gameplay multiplayer. Both clients can
  join and boot the same room settings, but live RTS orders and V-mode inputs are not synced yet.
- Selection and command ownership still assume local team 1 in several paths. Phase 9B should
  make local player team configurable before enabling real 1v1 command sync.

### Next
- Phase 9B: local-team ownership, AI-off 1v1 room mode, deterministic command messages with
  target ticks, command replay on both clients, and periodic sim-hash desync checks.

## Phase 9B — 1v1 Command Sync MVP 🚧 (2026-07-06)

- Added local-team ownership through the RTS selection path, selection bar, sidebar, radar, and
  V-mode entry. Host remains green/team 1; guest controls red/team 2.
- Multiplayer rooms now disable the enemy commander and keep both economies fair at normal
  starting credits instead of giving the red side AI difficulty income/start bonuses.
- Added a lockstep command runtime in `src/net/commands.ts`. It schedules commands with a small
  input delay, applies them by entity id, and ignores commands for units not owned by the
  issuing player.
- Routed core multiplayer actions through the command relay: move, attack-move, stop,
  harvester collect/return, producer rally, structure build/place/cancel, unit queue/cancel,
  and primary producer selection.
- Added periodic sim-hash messages for desync detection. The current slice reports mismatches;
  it does not yet repair them.
- Relaxed relay room cleanup so rooms survive temporary EventSource/browser disconnects until
  the normal room TTL instead of closing immediately.
- Added regression coverage proving a delayed team-2 lockstep move command controls only
  team-2 units even if a team-1 id is included.
- Fixed a multiplayer command-freeze bug where a temporary EventSource interruption could stop
  the lockstep queue from applying already issued local movement orders. Local queued commands
  now continue to resolve while the stream reconnects, and the runtime marks itself connected
  again when command events resume.
- Added regression coverage proving local queued commands still apply even when the stream is
  currently interrupted.
- Updated `MULTIPLAYER.md` to describe the Phase 9B flow and remaining limitations.
- Latest verification after Phase 9B: `npm test` passes (72 tests). `npm run build` passes.
  `git diff --check` is clean. Relay smoke verified host/join, delayed reconnect-tolerant join,
  and `/command` acceptance. Browser smoke confirmed the setup screen renders Phase 9B controls
  with no console errors.

### Known issues / notes
- V-mode possession inputs are not yet network-synced. Players should use RTS orders for the
  first multiplayer tests.
- The MVP reports sim-hash mismatches but does not pause, snapshot, or recover the match.
- The Codex in-app browser exposed only one usable tab during this run, so full two-window
  browser gameplay was not automated here. Relay endpoint tests and setup UI smoke both passed.

### Next
- Phase 9C: V-mode input sync, visible multiplayer connection/status overlay, pause-on-disconnect,
  desync diagnostics UI, and public Node relay deployment instructions.

## Phase 9C — Multiplayer Hardening 🚧 (2026-07-06)

- Added a short relay-side `starting` countdown before match start. Rooms now broadcast a
  countdown state when the second player joins, then send `match-start` after the countdown.
- Added in-match multiplayer status UI. Multiplayer games show an online/warning strip at the
  top with connection, opponent, pause, and desync messages instead of relying only on console
  logs.
- Added pause-on-disconnect behavior. If the room closes, the stream interrupts, a command send
  fails, or the opponent disconnects, multiplayer sim ticks pause until a connected state is
  observed again.
- Added realtime V-mode possession mirroring. Drive/fly control state, manual fire targets, and
  release events are sent through the multiplayer command stream so the opponent can see and
  resolve possessed unit actions.
- Added regression coverage proving realtime remote possession commands affect only the owning
  team, trigger weapon cooldown on fire, and clear control on release.
- Updated `MULTIPLAYER.md` to mark Phase 9C as the current slice and move the next online work
  into Phase 9D.
- Latest verification after Phase 9C: `npm test` passes (73 tests). `npm run build` passes.
  `git diff --check` is clean. Relay smoke on a temporary port verified host/join, `starting`
  countdown with `startsAt`, and transition to `in-game`.

### Known issues / notes
- V-mode sync is realtime mirroring, not rollback netcode. It should make public play feel much
  better, but high-latency internet play may still need snapshot repair or a stricter
  server-authoritative model later.
- Desyncs are surfaced in the multiplayer overlay but are not automatically repaired yet.

### Next
- Phase 9D: deploy the relay to a public Node host, add reconnect-with-same-player-id after
  page refresh, add snapshot/desync recovery tooling, and improve the room/lobby UX.

## Phase 9D — Online Deploy Readiness 🚧 (2026-07-06)

- Added `VITE_MULTIPLAYER_SERVER_URL` support so Netlify builds can default the Multiplayer
  server input to a public relay URL instead of `http://127.0.0.1:8787`.
- Added `.env.example` documenting the client relay URL and relay-side `ALLOWED_ORIGINS`.
- Added per relay+room player ID persistence in local storage. Rejoining the same room can now
  reuse the same player identity while the room is alive, and host identity is remembered for
  future hosted rooms.
- Improved setup-screen multiplayer errors for unreachable servers, expired rooms, full rooms,
  expired player sessions, missing room codes, and relay origin rejection.
- Added relay CORS hardening. By default local/private tests still allow all origins; deployed
  relays can set `ALLOWED_ORIGINS=https://your-site.netlify.app` to restrict browser access.
- Expanded `NETLIFY_DEPLOY.md` and `MULTIPLAYER.md` with the two-host deployment checklist:
  Netlify for the Vite client, a Node host for the relay, and the env vars that connect them.
- Added persistent ground impact scorch marks for bombs, grenades, rockets, and missiles. Terrain
  hits now leave irregular darkened craters with dusty rims and small cracks that fade over time;
  airborne AA hits are ignored so they do not create fake marks on the ground below.
- Added the first contextual audio layer with procedural Web Audio SFX: distance-panned rifle,
  sniper, cannon/autocannon, bomb/rocket/missile launch, explosion, debris, crash, and UI command
  ticks. Audio unlocks on the first click/key press, stays local-only for multiplayer, and `M`
  toggles mute.
- Replaced the generic build beep on final structure placement with a spatial construction cue.
  Buildings now play a heavier machinery/clank/thud layer, while wall segments use a shorter
  metal assembly variant from the placement location.
- Rebalanced Easy AI combat so it is less perfect in actual fights, not just slower in economy:
  Easy now reacts slower, fires with longer cooldowns, has deterministic aim scatter/misses,
  and is less eager to dogpile the player-possessed unit. Normal keeps only tiny variance;
  Hard stays sharp.
- Added a setup-screen Combat Mode rule for multiplayer/lobbies. `Assisted` keeps the classic
  auto-acquire and base-defense behavior; `Manual` disables idle auto-attack and automatic
  defender rallying, while still allowing explicit attack-move and V-mode firing. The selected
  rule is saved locally, accepted through `?combat=manual`, carried by hosted rooms, and included
  in the multiplayer desync hash.
- Added economy feedback effects for the ore loop. Harvesters now emit subtle dust and floating
  dollar signs while gathering in an ore field, and refinery deposits spawn a clear `+$amount`
  "ORE DELIVERED" popup with coin particles. Deposit events use the same delivered amount that is
  added to credits, and combat rendering ignores the economy event so no fake weapon tracers appear.
- Added enemy hover targeting feedback for command mode. When friendly armed units are selected,
  hovering an enemy unit or building now shows a prominent red target reticle, and right-clicking
  that target issues an attack-style order instead of an ambiguous move order.
- Improved progressive damage visuals. Building hits now force a stronger first visible damage
  floor, use more gradual local block states, and add scar/ember overlays from the first struck
  cells. Vehicles, tanks, harvesters, and aircraft now reveal staged scorch, crack, and ember
  patches as health drops instead of looking clean until they become wrecks.

### Next
- Public-host the relay, set the Netlify environment variable, run a two-computer online test,
  then decide whether Phase 9E should focus on desync snapshot recovery or lobby UX.

## Phase M2 — Friends-Link Lobby Relay ✅ (2026-07-10)

- Reworked the multiplayer relay around WebSockets (`ws`) with room host/join, player reconnect
  identity, lobby room-state broadcasts, ping measurement, ready/unready state, and a 3-second
  countdown before `match-start`.
- Updated the setup multiplayer panel with copied `?room=ABC123` links, room-code prefill,
  ready/unready controls, live settings sync from host to guest, ping/input-delay display, and
  browser-engine mismatch warnings.
- Documented the Netlify/static-client plus separate Node relay deployment split in
  `NETLIFY_DEPLOY.md` and `MULTIPLAYER.md`.
- Fixed the infantry visual regression where soldier animation overwrote world height and buried
  bodies under terrain while selection rings/health bars stayed visible.
- Latest verification after M2: `npm run build` passes. `npm test` passes (83 tests).

## Phase M3 — Match Serialization, Save/Load & Snapshot Recovery 🚧 (2026-07-10, started)

- Added versioned match-state serialization in `src/sim/serialize.ts` for sim tick/entity ids,
  entities, projectiles, combat events, resource nodes, rules, dynamic navigation blockers, and
  per-team economy state.
- Added navigation-grid snapshot/restore for dynamic blockers so saved wall/building blockers are
  preserved instead of silently changing pathfinding after load.
- Restored derived movement flow fields from saved mover targets, keeping units in transit after a
  load.
- Added single-player Save Game / Load Saved Game actions to the in-match MENU. Saves are stored in
  localStorage and loaded by rebooting into the saved state before Three.js render views are
  constructed.
- Added `serialize.test.ts`, which verifies `serialize -> load -> hashSim` equality and then runs
  both original/restored sims for 100 ticks to prove determinism continues.
- Added multiplayer snapshot repair for detected host/guest hash drift. The host emits a serialized
  match snapshot, the guest restores sim/economy state immediately, stale queued commands are
  discarded, and unit render objects reconcile against the restored entity list.
- Added explicit multiplayer forfeit. The match menu exposes a guarded Forfeit action, the relay
  broadcasts `player-forfeit`, the opponent sees a victory message, and server-initiated room
  closure no longer overwrites that outcome with a generic disconnect warning.
- Added lockstep tests proving the host sends a recovery snapshot on mismatch and the guest restores
  to the host hash, plus a forfeit/victory pause test.
- Latest verification after this M3 recovery slice: `npm run build` passes. `npm test` passes
  (87 tests).

### Known issues / notes
- Snapshot repair is not full rollback netcode. It restores to the host state and keeps future
  queued commands, but does not replay a detailed historical command buffer across a rollback window.
- AI commander internal strategy state is not serialized yet. Save/load restores the deterministic
  sim and economies; future desync recovery should add commander-state serialization before claiming
  complete mid-match AI recovery.

### Next
- Continue M3 with reconnect UX polish and public-relay deployment validation.

## Phase M3 — Reconnect & Relay Hardening ✅ (2026-07-10)

- Added automatic WebSocket reconnect with exponential backoff. A reconnecting browser reclaims
  its existing player id and army slot instead of creating another commander.
- Scoped active-room identity to tab session storage so two tabs on one computer can host/join
  without the guest accidentally reusing the host player id; reloads in each tab still reclaim.
- Added a 60-second relay grace period for interrupted in-game players. Both simulations pause;
  reconnect restores play, while expiry closes the room as a disconnect defeat/victory.
- Added a snapshot acknowledgement handshake. Reconnected matches stay paused until the guest has
  loaded the host snapshot and confirmed the exact tick and hash.
- Cancelled a lobby countdown if a player disconnects while the match is starting.
- Bound commands to the authenticated socket/player pair, added a per-socket command rate limit,
  capped WebSocket payloads, replaced predictable room generation, and hid `/rooms` by default.
- Added graceful relay shutdown and an included `render.yaml` Blueprint for public Node hosting.
- Added a real WebSocket integration test covering match start, identity-spoof rejection, valid
  command relay, player-slot reconnect, and disconnect-timeout room closure.
- Latest verification: targeted multiplayer tests pass and `npm run build` passes.

### Next
- Deploy the relay and static client, run a two-computer same-browser recovery test, then continue
  with M4 multiplayer victory/spectator/chat polish or M5 cross-browser deterministic math.
