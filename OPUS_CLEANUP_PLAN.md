# Codebase Cleanup & Hardening Plan (for Claude Opus)

> **How to work this plan.** Execute the passes **in order**, one pass = one commit,
> `npm test` + `npm run build` green after every pass. This is a *cleanup* plan:
> **zero gameplay/balance changes** — when a finding says "move numbers to content",
> copy values verbatim. Findings below come from a full audit (2026-07-05, 56 tests
> green at baseline) and carry file:line anchors — line numbers may drift a few lines;
> the code patterns are exact. Keep every invariant in `CODEX_PHASES_PLAN.md`
> (deterministic 30 Hz sim, no three.js in `/src/sim`, vision-honest targeting,
> D-turns-right, V toggles).

## Pass 0 — Checkpoint (5 min)

The repo has ~29 modified + 3 untracked files of working, tested Codex output that
was never committed. First action: `git add -A && git commit` as a checkpoint
("codex phases: harvester economy, walls/defenses, structure damage, flight models —
pre-cleanup checkpoint"). Every later pass must be separately revertable.

## Pass 1 — Correctness & fog-honesty bugs (the real bugs; do these carefully)

1. **AA fires beyond its own vision** — `src/sim/combat.ts` ~572
   (`effectiveRangeForTarget`): for air targets it returns `def.airRange ?? range`,
   discarding the vision clamp computed at the call site. A rocket team (vision 94)
   engages aircraft at 145. Fix: air range must also be clamped by attacker vision.
   Add a regression test: low-vision unit does NOT auto-engage air beyond vision.
2. **Aircraft `weapon` vs `weapons.primary` are two different objects** —
   `src/sim/world.ts` ~348 (`spawnAircraftAt`): two separately-constructed weapon
   objects; only `weapons` is ticked, `weapon` is a stale diverging copy (tanks share
   one reference; aircraft don't). Fix as part of #14 in Pass 5 (delete `Entity.weapon`
   for units) or minimally: share the same object reference now.
3. **Enemy buildings visible through fog** — `src/render/buildingView.ts` ~137–152:
   `root.visible` is never fog-gated, so unscouted enemy structures render (poking
   through the shroud). Damage *dressing* is already fog-frozen; the mesh isn't.
   Fix: hide team≠1 building roots until first seen (track "everSeen" per building
   from the visibility predicate; RTS convention: once seen, keep a frozen ghost).
4. **Enemy building health bars & refinery dock activity update through fog** —
   `src/render/buildingView.ts` ~151 (`updateHealthBar`), ~325–345
   (`updateRefineryDock`): live intel leaks while fogged. Freeze/hide when fogged.
5. **Review `defenseAlert` honesty** — `src/sim/combat.ts` ~74–101 + `world.ts`
   ~508: economy-defense alerts move defenders toward attackers they cannot see
   (fire stays vision-gated). Decide + document: this is acceptable "base alarm"
   behavior — add a code comment saying so explicitly, or clamp alert radius to
   defender vision. Don't leave it ambiguous.

## Pass 2 — Make the determinism hash actually catch desyncs

6. **`hashSim` hashes enum strings by `.length`** — `src/sim/world.ts` ~848–860:
   `harvester.state.length` ('seeking' vs 'to-node' — both 7 — collide), same for
   `projectile.kind.length`. Replace with stable numeric codes (fixed lookup arrays).
7. **`hashSim` omits live combat state** — turret yaw, weapon cooldowns/targetIds,
   mover target/engage, velocities are unhashed; a desync there is invisible. Fold
   them in (rounded).
8. **Hash sensitivity tests**: for each newly hashed field, a test that mutates one
   instance of it and asserts the hash changes. Keep the existing two-run equality
   tests as-is.

## Pass 3 — Memory/GPU leaks (a long match must not grow unbounded)

9. **`UnitView` never evicts dead entities** — `src/render/unitView.ts` ~84–161: no
   removal path; 9 entity-keyed Maps + the `entities` array grow forever; every
   frame iterates all-time units; per-entity Ring/Plane/Circle geometries never
   disposed. Fix: eviction sweep when the wreck window expires (entity gone from
   `sim.world`), dispose per-entity geometries, delete from every map. Share static
   geometries (selection ring, health-bar planes, air shadow) as module constants.
10. **`BuildingView` sweep leaks** — ~96–109: on removal it forgets to dispose the
    accent geometry, the per-building label `CanvasTexture`+plane+material
    (~611–654), selection glows, health-bar geometry, refinery dock, and skips
    `clearEffects`. Dispose all; verify with `renderer.info.memory` stable across a
    build-destroy-rebuild loop.
11. **Leak test ritual**: add a manual QA note + cheap assertion hook — after a 5-min
    AI-vs-AI headless run there must be no growth in unitView map sizes beyond live
    entities; in browser, `renderer.info.memory.geometries/textures` flat across
    repeated building kills.

## Pass 4 — Per-tick / per-frame performance

12. **O(n) entity lookup in hot loops** — `src/sim/combat.ts` ~443 (`validTarget`),
    ~504 (`entityById`): `Array.from(world.entities).find(...)` per weapon/projectile
    per tick. Add an `id → Entity` Map on `GameSim` (maintained on add/remove — one
    place each) and use it everywhere.
13. **Repeated full-world scans per tick** — `stepCombat` combatant filter (~32),
    `alertEconomyDefenders` scanning all entities per damaging hit inside splash
    loops (~511→620), `economy.buildings()` rebuilt many times per tick (~370, and
    per-harvester via `findAssignedRefinery`). Fix: miniplex queries
    (`world.with('building')`, combatant query) computed once per tick and passed
    down. A full spatial grid is optional — only if profiling still shows need.
14. **Sidebar `bodyKey()` builds JSON strings every frame** — `src/ui/sidebar.ts`
    ~135, 584–623. Gate on `sim.tick` change (it only changes 30×/s max) and replace
    JSON.stringify with a numeric accumulator hash.
15. **Radar allocates `ImageData` per redraw** — ~741–756: cache one ImageData and
    reuse; keep redraw at ≤10 Hz.
16. **Per-frame allocations in camera/pose code** — `firstPersonController.ts`
    ~222–274, 407–445: `new Vector3`/clones each frame; reuse scratch vectors and a
    preallocated pose. Same in `combatView.ts` ~227–232, 505–517 (bezier, quaternion,
    `position.clone()` into trails) — scratch objects + ring-buffer trail.
17. **`getObjectByName` every frame** — `unitView.ts` ~187, 248–274 (turret, rotors,
    cargo, beacon): resolve once at `addEntity`, cache child refs in the per-entity
    record.
18. **`crushNear` string keys** — `main.ts` ~461 iterates all entities each tick and
    `scatter.ts` ~122 builds `"gx:gz"` strings per probe. Iterate only live tanks and
    use numeric keys (`gz*width+gx`).

## Pass 5 — Structure, duplication, dead code

19. **Delete vestigial `Entity.weapon`** (units) — `components.ts` ~171,
    `combat.ts` ~663–671: give buildings a `weapons` rack and remove the dual-field
    trap (fixes Pass 1 #2 permanently). Migration: one sweep over spawn sites.
20. **Fold `bomb` into the generic projectile system** — `combat.ts`: `launchBomb`
    is a parallel one-off next to `launchWeaponProjectile` (grenade/atRocket/
    agMissile/aaMissile). One launcher, one projectile def table; removes the
    `def.kind === 'bomb'` special cases and the dead `attacker.flight ? 'flat' :
    'flat'` ternaries (~154, 423, 618).
21. **Strip render strings from sim events** — `CombatEvent.targetLabel/targetType`
    built per shot in `summarizeHit`: emit `targetId` only; HUD resolves names at
    display time.
22. **Move tuning numbers into `src/content/`** (verbatim values, no rebalance):
    tank/aircraft variant blocks (`world.ts` ~178–304), infantry configs
    (`economy.ts` ~654), `HARVESTER_*` (~427), `BOMB_SPEED`/`DEFENSE_ALERT_*`
    (`combat.ts` ~10), splash-multiplier ternary → `WeaponDef.splashMultiplier`
    (~585), structureDamage magic numbers (4.8 scale, floor 28, tier falloff).
23. **One math module** — new `src/sim/math.ts` (clamp, lerp, damp, dist); delete
    the copies in `world.ts` ~11, `structureDamage.ts` ~3, `unitView.ts` ~592,
    plus import `sim/angles.ts` in `rtsCamera.ts` ~204 and
    `firstPersonController.ts` ~451 instead of local re-definitions.
24. **Shared terrain raycast** — the coarse-march + bisection against `sampleHeight`
    exists twice (`rtsController.ts` ~302, `firstPersonController.ts` ~328): extract
    `raycastTerrain(hf, origin, dir, maxDist)` (render-side helper is fine).
25. **`pushCombatEvent(sim, …)` helper** — the 5+ hand-built `sim.events.push({...})`
    blocks in combat.ts.
26. **Split the monoliths** (mechanical moves, no behavior change):
    `main.ts` (~737) → `ui/menus.ts` (setup screen, game menu, restart dialog,
    outcome banner ~300 lines) + `match/createMatch.ts` (sim/economy/AI/views
    bootstrap), leaving `main.ts` as orchestration;
    `sidebar.ts` (~946) → extract `ui/radar.ts` (all radar draw/interaction,
    ~625–802); `buildingView.ts` (~757) → `render/buildingDressing.ts` (damage
    dressing ~475–609) + `render/buildingParts.ts` (label/dock/glow factories).
27. **Dead code**: `Builder` component (unused, `components.ts` ~100),
    `structureDamage.ts` ~10 no-op ternary (`? 2 : 2` — implement 3 tiers for big
    footprints or simplify to `2` with a TODO), orderMarkerView detached `pin`
    group (~187), stale `terrainPoint` comment in firstPersonController (~324, the
    function IS used by `flightBombTarget`), `void assets` in main (~272 — keep the
    pipeline but construct it where it's used, or add a comment it's Phase-7 prep),
    unit-name suffix from `entities.length` (`economy.ts` ~413 — collides after
    removals; derive from `entity.id`), marker-color ternary ×4 in orderMarkerView →
    `markerColor(kind)`, combatView inline weapon-kind lists (~520–534) → derive
    launch/impact/trail metadata from `WEAPONS` defs.

## Pass 6 — Test coverage for untested systems

28. New unit tests: `VisibilityGrid` (stamp/decay/explored semantics),
    `applyStructureDamage` (facade locality, arc→top-tier bias, ≥200 upward bleed),
    homing missile fizzle (target dies mid-flight; target escapes fizzleRange),
    plus the Pass 1 air-vision regression and Pass 2 hash-sensitivity tests.
29. Keep the suite fast: everything above is pure-sim, no browser needed.

## Definition of done

- All passes committed separately, `npm test` (≥56 + new tests) and `npm run build`
  green each time; final `npx tsc --noEmit` clean.
- Browser smoke after Passes 3–5: play 3 minutes, kill buildings/units, check
  `renderer.info.memory` stable, no console errors, fog hides unscouted enemy base,
  V-mode tank + helicopter still feel identical to before.
- `PROGRESS.md` gets a "Cleanup & hardening" entry summarizing what changed and the
  new test count. No spec files need updating (no behavior changed).
