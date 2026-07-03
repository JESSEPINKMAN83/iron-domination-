# IRON DOMINION — Full Production Build Plan
### A classic-RTS / first-person hybrid for the web, built in phases with Claude

**Purpose of this document:** a complete, phase-by-phase specification that an AI coding agent
(Claude in Claude Code) can execute to build a high-quality version of the game. Each phase has
concrete deliverables and acceptance criteria. Run **one phase per session**, verify the
acceptance criteria in the browser, commit, then start the next phase with this document plus
the previous code in context.

**Legal note:** all names, art, sounds, and story must be original. The game replicates *genre
conventions* of classic base-building RTS games (sidebar queue, credits/power economy, ore
harvesting) plus unit possession in the spirit of 1998-era hybrid RTS/FPS games — never
Westwood/EA assets, faction names, or audio.

---

## 0. Vision & Design Pillars

1. **Two games, one battlefield.** Every unit in the RTS is simultaneously a drivable vehicle or
   playable soldier. Switching views must feel seamless (< 1s camera transition, no loading).
2. **Readable, stylized art.** Low-poly military with strong silhouettes, team-color accents,
   baked-looking lighting. Consistency beats realism.
3. **The army fights without you.** Possessing a unit never pauses the strategic layer; AI
   squadmates keep executing orders.
4. **Web-native.** Loads in < 10s on a mid laptop, 60 fps with 150 units on screen.

---

## 1. Technology Stack (final)

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Refactor safety across a large codebase |
| Bundler | Vite | Fast dev loop, code-splitting |
| Renderer | Three.js (latest) + WebGL2, optional WebGPU renderer flag | Mature, huge ecosystem |
| Architecture | ECS via `miniplex` (or `bitecs` if perf demands) | Units are data; RTS/FPS are just different systems reading the same components |
| Physics | `@dimforge/rapier3d-compat` | Vehicle raycast suspension, character controller, projectile sweeps |
| Pathfinding | Flow fields on a grid (crowds) + A* fallback (single units) | RA-style group movement at scale |
| Audio | Howler.js + WebAudio positional nodes | 3D sound in FPS mode, mixed bus for RTS |
| UI/HUD | React (or Preact) overlay for sidebar/menus; canvas minimap; in-world HUD via HTML + CSS3D only where needed | Keep game loop free of DOM work |
| State | Zustand store for UI ↔ simulation bridge | Decoupled, testable |
| Assets | GLTF/GLB models, KTX2 compressed textures, Draco meshes | Small downloads |
| VFX | `three-nebula` or custom GPU particles; `postprocessing` lib (bloom, SSAO, vignette) | The "quality" gap is mostly VFX + lighting |
| Netcode (Phase 9) | Colyseus rooms, server-authoritative sim at 20 Hz, client interpolation | Standard for web RTS |
| Testing | Vitest for sim logic (deterministic tick), Playwright smoke tests | Sim must be renderer-independent |

**Project layout**

```
/src
  /engine        loop, time, input, events, save/load
  /sim           ECS world: components/, systems/, blueprints/   ← no three.js imports allowed here
  /render        mesh factories, instancing, terrain, vfx, cameras
  /modes         rtsController.ts, fpsController.ts, transition.ts
  /ai            playerAI (enemy commander), unitBrains, flowfield
  /ui            react sidebar, minimap, hud, menus
  /audio         buses, positional, music
  /content       units.json, buildings.json, weapons.json, maps/
/public/assets   models/, textures/, sfx/
```

**Golden rule:** the simulation (`/sim`) runs on a fixed 30 Hz tick, fully deterministic, with
zero rendering dependencies. Rendering interpolates between ticks. This single decision enables
replays, testing, and future multiplayer.

---

## 2. Phase Plan

### Phase 1 — Engine Skeleton & Terrain *(foundation)*
- Vite + TS project, fixed-timestep loop (30 Hz sim / uncapped render with interpolation).
- Heightmap terrain (512×512 grid) with splat-mapped textures (grass/dirt/rock/ore-stained),
  cliffs that block movement, water plane with simple shader.
- Day lighting rig: hemisphere + directional sun with cascaded shadow maps; `postprocessing`
  chain: SMAA, SSAO, subtle bloom, color grading LUT.
- RTS camera rig: pan (edge/WASD/arrows), **right-drag pan, Space-drag pan**, wheel zoom
  (28–140 units), Q/E rotate 90°, smooth damping.
- Asset pipeline: GLB loader with KTX2/Draco, instanced-mesh registry.
- **Accept:** 60 fps orbiting a lit, textured 1 km² map with 5,000 instanced trees/rocks.

### Phase 2 — ECS Simulation Core & Movement
- Components: `Transform, Velocity, Health, Team, Selectable, Mover, Weapon, Turret, Vision,
  Cargo, Builder, Possessable, Collider`.
- Flow-field pathfinding over a walkability grid derived from terrain + building footprints;
  local avoidance (RVO-lite or boids separation); formation offsets for group orders.
- Selection: click, shift-add, drag-box, double-click select-type-on-screen, control groups 1–9,
  right-click move/attack-move (A+click), stop (S), rally points on production buildings.
- **Accept:** 120 tanks ordered across the map flow around cliffs and each other without jitter;
  unit tests prove deterministic sim (same seed → identical state hash after 10k ticks).

### Phase 3 — Economy, Construction & Production
- Ore fields that visually deplete; harvester state machine (seek → gather with animation →
  return → dock into refinery with a docking animation → deposit).
- Power grid: production vs. drain, brownout slows production and disables defenses.
- Sidebar (React): STRUCTURES / DEFENSE / INFANTRY / VEHICLES tabs, build cards with cost,
  progress radial, **parallel lines = one per production building**, queue up to 5 per line,
  cancel/refund, hold-to-repeat.
- Building placement: grid-snapped ghost, footprint validity (proximity, terrain slope, overlap),
  construction animation (scaffold rises), sell & repair tools.
- Tech tree: Refinery→Factory, Radar→Turret Mk2 etc. Cards show lock reasons on hover.
- **Accept:** full build order Con-Yard → Power → Refinery → Barracks → 2× Factory works; two
  factories provably produce two tanks in parallel; income/expenditure ledger matches unit tests.

### Phase 4 — Combat
- Weapons as data (`weapons.json`): projectile vs hitscan vs beam, damage vs armor-class matrix
  (infantry/light/heavy/building), splash radius, turret traverse speed, min/max range.
- Ballistic shells with arcs, tracers, muzzle flash lights, impact decals, damage states on
  buildings (smoke → fire), wreck husks that persist 20 s.
- Veterancy (3 ranks: +10 % dmg/HP each), target priority AI, attack-move, guard mode.
- Fog of war: per-team visibility grid, shroud + explored dimming, minimap integration, units
  reveal by `Vision` radius; stealth flag for a future unit.
- **Accept:** 40 v 40 tank battle at 60 fps with tracers, explosions, and fog; damage matrix
  verified by tests (e.g., rifle does 20 % to heavy armor).

### Phase 5 — ★ First-Person Possession (the signature feature, full functionality)
This phase gets the biggest budget. Target feel: a lightweight vehicle-sim / arcade FPS.

- **Transition:** press V (or HUD button) → camera flies from RTS pose to the unit's eye socket
  along a curve in 0.6 s with FOV shift (50°→75°) and a soft HUD crossfade. ESC reverses it.
  Pointer-lock acquired at flight end. No teleport cuts.
- **Tank (and vehicle) driving:** Rapier raycast-suspension vehicle — engine curve, per-track
  torque (A/D counter-rotate in place), terrain slopes affect speed, collision knocks;
  turret slews toward crosshair at its real traverse speed (you *feel* heavy turrets);
  first-person gunner sight with reticle, right-click zoom ×3, shell drop, reload bar,
  coax MG on middle-mouse; optional third-person chase cam on C.
- **Infantry:** Rapier character controller (capsule): walk/sprint (Shift + stamina), jump,
  crouch (Ctrl, improves accuracy), lean Q/E, ADS on right-click, recoil + bloom pattern,
  hip vs ADS spread, grenade on G with arc preview.
- **Harvester:** drivable transport — manual gathering (hold F near ore) for players who want to
  roleplay the economy.
- **Cross-mode integrity:** possessed unit is flagged `PlayerControlled`; its brain system is
  bypassed but *everything else identical* — same weapon data, same damage, same fog rules
  (you can only see what the unit sees!). Squadmates keep executing prior orders; T opens a
  radial command menu to issue "follow me / hold / attack my target" without leaving FPS.
- **FPS HUD:** unit name/rank, hull-health silhouette, ammo & reload, compass strip with pinged
  objectives, minimap corner (from that unit's vision), damage-direction indicators, kill feed.
- **Death & swap:** unit destroyed → slow-mo 0.5 s, camera ejects to RTS; Tab while in FPS
  cycles possession to the nearest friendly unit of the same class.
- **Audio:** engine loop pitch-shifted by throttle, interior muffling filter, positional gunfire,
  shell whistle, hit thunks by armor class.
- **Accept:** drive a tank from base to enemy lines, fight from the turret, eject on death, and
  the RTS battle state is byte-identical to a run where the same unit was AI-controlled with the
  same inputs (determinism preserved). Input latency < 50 ms; transition never drops below 50 fps.

### Phase 6 — Enemy Commander AI
- Utility-based AI with personalities (Turtle / Rusher / Balanced): build-order scripts →
  dynamic economy management, expansion to new ore fields, base layout templates.
- Squad system: composes attack groups by threat assessment, retreats at 40 % strength, harasses
  harvesters, responds to the *player's possessed unit* as a high-value target (fun pressure).
- Difficulty tiers = resource handicaps + reaction delays, never map hacks on Normal.
- **Accept:** Normal AI defeats a passive player in ~12 min but loses to a competent rush; logs
  show it rebuilding harvesters and expanding.

### Phase 7 — Presentation & Content Pass *(this is where "wow" lives)*
- Commission/produce the GLB art set (12 buildings, 10 units × 2 factions, props) with team-color
  masks, PBR trims, damage variants; skeletal animations for infantry (idle/run/aim/die).
- VFX library: ore shimmer, refinery smoke, factory sparks, EMP, airstrike, tesla-style defense
  (original design), weather (drifting dust, light fog).
- UI skin: diegetic military console — scanline sidebar, radar sweep minimap, EVA-style original
  voice lines ("Unit ready", "Base under attack") recorded or synthesized.
- Music: 3 original tracks (calm-build / combat / defeat-victory stingers) with adaptive
  crossfade driven by combat intensity.
- Two more maps (chokepoint valley, island bridges) + skirmish setup screen (map, AI count,
  difficulty, starting credits).
- **Accept:** a 90-second gameplay capture looks like a finished indie game; no placeholder art.

### Phase 8 — Meta, Balance, Polish
- Save/load (serialize ECS world), pause menu, settings (graphics tiers, keybinds, sensitivity),
  tutorial mission with scripted triggers, victory/defeat cinematics (camera flythrough).
- Balance sheet in `/content` with a headless simulation harness: run 500 automated AI-vs-AI
  games overnight, chart win rates per faction/strategy.
- Performance: instanced rendering everywhere, LOD swaps, GPU particle budget, object pools for
  projectiles; target 60 fps @ 200 units on a 2020 laptop.
- Accessibility: remappable keys, colorblind team palettes, camera-shake toggle, subtitles.

### Phase 9 (optional) — Multiplayer
- Colyseus server-authoritative sim (the deterministic core pays off here), lockstep with input
  delay OR state-sync at 20 Hz + interpolation; 1v1 skirmish, possession fully supported
  (possessed inputs are just another input stream), reconnect, basic lobby.

---

## 3. How to Run This Plan with Claude

1. Use **Claude Code** with the strongest available model, one phase per session:
   *"Read IRON_DOMINION_BUILD_PLAN.md. Execute Phase N only. Do not start the next phase.
   When done, run the dev server, list the acceptance criteria, and tell me how to verify each."*
2. Keep a `PROGRESS.md` the agent updates each phase (what's done, known issues, next).
3. After each phase, actually play it and file findings as a bullet list — feed that list back
   at the start of the next session ("fix these before starting Phase N+1").
4. Commit per phase; never let the agent refactor across phase boundaries without asking.

**Why phases instead of one prompt:** a one-prompt game optimizes for a flashy first impression;
the polish you're asking for (vehicle feel, fog of war, AI, netcode-ready determinism) comes from
verified iteration. Same model, radically better outcome.
