# IRON DOMINION — Continuation Plan for Codex (Phase 6.5 → 9)

> **How to use this file:** read it fully, then execute **one phase per session**, in
> order. After each phase: run `npm test` + `npm run build`, playtest in the browser,
> update `PROGRESS.md` (done / known issues / next), and commit. This file supersedes
> `CODEX_HANDOFF.md`. The original vision doc is `IRON_DOMINION_BUILD_PLAN.md`;
> `QUALITY_PLAN.md` records the quality uplift that already happened.

## Current state (verified 2026-07-04, commit `2b346eb`)

Phases 1–6 are done: terrain/render pipeline, deterministic 30 Hz ECS sim (miniplex),
flow-field movement, economy/production/sidebar, combat with **ballistic bombs**
(real sim projectiles in `sim.projectiles`, damage on impact), turret traverse with
fire gating, fog of war (`VisibilityGrid` per team + terrain shroud + fogged minimap),
articulated procedural soldiers, wreck husks, chase-cam tank possession (V toggles
in/out, Escape exits), and the Phase 6 enemy commander (build order + rebuild/expand,
wave squads, 40% retreats, personalities/difficulties via `?ai-style=` / `?ai=`,
victory/defeat banner). 19 Vitest tests pass, including sim determinism and a headless
AI acceptance match.

**Invariants you must not break:**
1. `/src/sim` has **zero three.js imports**. Rendering interpolates sim state.
2. Everything in the sim is deterministic: fixed 30 Hz tick, seeded RNG only
   (`sim/noise.ts`), entity ids from `sim.nextEntityId` (never module-level counters),
   stable iteration order. `hashSim` equality across two identical runs is tested.
3. Units may only auto-engage targets within their **own vision radius** (no shooting
   into fog). AI decisions use its own `VisibilityGrid` — no map hacks.
4. Possession never pauses the sim, and possessed units obey identical combat rules
   (no immunity hacks — the ballistic travel time is what makes dodging possible).
5. In chase/V mode the heading convention is `(sin rot, cos rot)`; **positive turn =
   screen-left**, so D must apply negative turn. Do not regress the A/D fix.
6. V toggles possession; Escape also exits.

---

## Phase 6.5 — ★ Combat Aircraft & Aerial Possession (CRUCIAL — biggest budget)

The user's headline feature: combat aircraft that fight in the RTS layer **and fly
beautifully in V mode**. Feel target: arcade gunship — easy to fly in 10 seconds,
satisfying for hours. Do the helicopter-style gunship first ("Vulture"); a fixed-wing
jet is a stretch goal at the end of the phase, only if the Vulture feels great.

### 6.5.1 Sim: third dimension for flyers

- Add `y` (altitude, meters above sea level, absolute not AGL) to `Transform` and
  `previousTransform`; ground units keep `y` glued to `sampleHeight` each tick so
  nothing else changes for them. Include `y` in `hashSim` (round ×100).
- New component `Flight`:
  ```ts
  interface Flight {
    cruiseAltitude: number;   // desired height above ground, e.g. 28
    minAGL: number;           // 6  — terrain-hug floor in V mode
    maxAltitude: number;      // 90 absolute ceiling
    climbRate: number;        // 14 m/s
    bank: number;             // render-only lean, computed in sim for determinism
    verticalVelocity: number;
  }
  ```
- Movement: flyers **ignore walkability/flow fields** — straight-line steering toward
  `mover.target` with arrival slowdown; separation only against other flyers.
  Terrain avoidance: each tick clamp `y ≥ sampleHeight(x,z) + minAGL`, and climb ahead
  of rising ground (sample height ~1.5 s ahead at current velocity).
- Collision with terrain (possessed flight can dive): if `y < ground + 1` → crash:
  apply full self-damage, spawn `destroyed`, event `kind: 'crash'`.
- `stepSim` currently assumes all movers collide with nav grid — branch on
  `entity.flight` before the walkability checks.

### 6.5.2 Air/ground combat rules

- Add armor class `'air'` to `content/phase4.ts`; every weapon's `vs` map gains an
  `air` multiplier. Only weapons with `canTargetAir: true` may acquire flyers:
  - New weapon `aaGun` (AA turret + Vulture's nose gun can dogfight): hitscan,
    range 70, good vs air, weak vs armor.
  - New weapon `rocketPod` (Vulture primary): fast projectile **with travel time**
    like bombs but flat/quick (speed 160, tiny arc), splash 3, good vs light/heavy,
    cannot target air.
  - New weapon `agMissile` (Vulture secondary): slower projectile, splash 6, high
    damage vs building/heavy, **limited ammo** (see rearm).
  - Existing rifles get `vs.air: 0.15`, `canTargetAir: true` (small-arms plinking);
    cannon/bomb get `canTargetAir: false`.
- Targeting stays 2D distance (deterministic, simple) — verticality is flavor; only
  `canTargetAir` gates who can hit flyers. Splash never hits flyers unless the
  detonation was an AA weapon.
- **Ammo + rearm loop** (crucial for balance): `Ammo { rockets: 24; missiles: 4 }`.
  Empty → auto **return to helipad**, land (descend to pad), reload over 6 s, resume
  last order. This is the genre-classic sortie rhythm — do not skip it.
- New structures in `content/phase3.ts`:
  - `helipad` (produces + rearms aircraft; producer tab `aircraft`; requires factory;
    power 10; cost 500).
  - `aa-turret` (defense: aaGun, vision 100, requires power-plant; cost 600; disabled
    during power brownout — wire `powered` from the economy into `stepCombat`).
- Sidebar: new AIRCRAFT tab; Vulture card (cost 950, buildTime 12, requires helipad).

### 6.5.3 RTS layer for aircraft

- `unitView`: Vulture placeholder model — fuselage box, tail boom, cockpit accent,
  **spinning main rotor + tail rotor** (rotor speed ∝ throttle), skids. Banking/lean
  from `flight.bank`. Fake blob shadow (dark transparent circle draped at ground
  height, radius ∝ altitude) — cheap and reads perfectly.
- Selection & orders work like tanks (move anywhere — water/cliffs included,
  attack-move, stop). Selection ring + health bar render at **ground level** under
  the aircraft so they stay clickable/readable.
- `pickAt`/screen-rect selection: project using the flyer's real altitude.
- Vision radius 150 (scout role). Minimap: flyer dots get a 1px white ring.

### 6.5.4 ★ V-mode flight (make this feel GREAT — iterate here the longest)

Controls (keep the tank grammar):

| Input | Action |
|---|---|
| W / S | pitch nose down/up = accelerate forward / brake–reverse |
| A / D | yaw left / right (D = right! see invariant 5) |
| mouse | aim rotor-nose & camera, like tank turret but the *hull* follows aim yaw at 2.8 rad/s |
| Space / Ctrl | climb / descend (clamped to minAGL / maxAltitude) |
| left-click | rocket pods (crosshair-converged, slight spread) |
| right-click | AG missile — hold to see ground-impact marker, release to fire |
| Tab | cycle possession to nearest friendly aircraft |
| V / Escape | exit (same transition as tank) |

- Camera: chase cam 16 m back / 6 m up with **lag + springiness** (position damped at
  λ≈5, look-target λ≈9) so turns feel banked; FOV 62→68 with speed; subtle camera
  shake on rocket volleys. Reuse `FirstPersonController`'s pose/transition machinery —
  refactor it into `possessionController.ts` with per-class drive models
  (`driveTank`, `flyGunship`) rather than forking the file.
- Flight feel numbers to start from (tune by hand): max speed 46 m/s, accel 18,
  drag quadratic, yaw rate 1.9 rad/s + mouse-follow, bank = clamp(yawRate·speed·0.05,
  ±0.45 rad) + strafe lean; hover bob (±0.15 m sine) when idle.
- HUD in flight: altitude AGL bar, speed, rocket/missile ammo, rearm prompt when
  empty, compass strip (already exists for tank — extend).
- Crash: hitting terrain/water at speed = death spiral (0.6 s) → explosion → eject to
  RTS (reuse tank death-eject flow).
- **Cross-mode integrity:** identical weapons/ammo/vision as AI-controlled Vultures;
  squadmates keep orders; the AI treats your possessed aircraft as high-value (it
  already prefers `playerControlled` targets — verify it works with flyers + AA).

### 6.5.5 AI integration

- Commander: personalities gain `wantsAir` (balanced/rusher true): build helipad after
  first factory, keep 2–4 Vultures (difficulty-scaled cap), use them as a **harass
  squad** targeting refineries/harvest income and retreating from AA; build 1–3
  `aa-turret`s (turtle builds more, earlier) once it has *seen* enemy aircraft.
- Guard behavior: AA turrets are static — exempt from `engage` movement.

### 6.5.6 Acceptance (all must pass before ending the phase)

1. Build helipad → Vulture; order it across cliffs/water — it flies straight, banks,
   climbs terrain, blob shadow tracks it. 60 fps maintained.
2. Possess with V: fly to the enemy base, rocket a tank, missile a building, run dry,
   get the rearm prompt, land at pad, rearm, take off — all without leaving V mode.
3. Crash into a cliff on purpose → spiral + explosion + clean eject to RTS.
4. AA turret shreds a hovering Vulture but a fast strafing run survives (travel-time
   dodge — same principle as tank bombs).
5. Enemy AI fields Vultures that harass your economy and builds AA after seeing yours.
6. Determinism tests still pass with aircraft in the world (add one: 20 Vultures with
   mixed orders, 5k ticks, same hash). All prior tests stay green.
7. A/D in flight: D turns right. V toggles out.

---

## Phase 7 — Presentation & Content Pass (now includes aircraft)

As specified in `IRON_DOMINION_BUILD_PLAN.md` §Phase 7, plus:
- GLB art set additions: Vulture gunship (rotor as separate node for spin), helipad,
  AA turret with tracking barrel; rotor-wash dust VFX when low, missile smoke trails,
  crash fireball; engine/rotor loops pitch-shifted by throttle in V mode.
- Replace the procedural soldier with skeletal GLB (idle/run/aim/die) — the procedural
  rig in `render/soldier.ts` defined the pose/animation targets.
- Keep placement/scale identical so sim data doesn't change (art-only phase; the
  determinism tests are your regression harness).

## Phase 8 — Meta, Balance, Polish

Per build plan §Phase 8, with aircraft-aware additions: save/load must serialize
`Flight`/`Ammo`/projectiles; balance harness runs AI-vs-AI with and without air;
keybind remapping covers flight controls; graphics tiers scale fog texture res and
shadow cascades.

## Phase 9 (optional) — Multiplayer

Per build plan §Phase 9. The deterministic core (including aircraft) is the payoff:
possessed flight inputs are just another input stream.

---

## Working notes / gotchas for Codex

- `stepCombat` order: projectiles advance first, then firing, then guard behavior,
  then destroyed-ticking. Bomb visuals in `combatView` take flight `duration` from the
  launch event and explode on the separate `bomb-impact` event — copy this pattern for
  rockets/missiles (`rocket`, `rocket-impact`, `missile`, `missile-impact`).
- `unitView.update(alpha, dt, camera)` — dt drives walk cycles/rotors; entities are
  hidden when fogged (`team !== 1 && !isVisible`). Flyers must use sim `y`, not
  `sampleHeight`, for their mesh (health bar/ring stay at ground height).
- `economy.ts` is per-team; AI difficulty sets `incomeMultiplier`. New structures need
  entries in `STRUCTURES`, a material in `buildingView`, and a command icon fallback
  (icons auto-fallback to initials — fine for now).
- Pacing knobs live in `content/phase6.ts` (`attackDelay`, `maxSquads`, caps). The
  headless acceptance test (`src/ai/acceptance.spec.ts`) currently records ~8 min vs a
  passive player — keep it passing; retune if aircraft shift the balance.
- Playtest findings from the user arrive as bullet lists at session start — fix those
  **before** starting the next phase's work.
