# Time-of-Day & Weather Visual Spec

Add selectable **time of day** (Day / Sunset / Night) and **weather**
(Clear / Rain / Snow) to skirmish matches. Purely visual — no gameplay,
sim, vision, or telemetry changes. The player picks both in the skirmish
setup screen, and can ALSO switch them live from the in-game settings menu
to experiment (single-player at minimum; see multiplayer note).

---

## Current implementation (read before coding)

- `src/content/maps.ts` — each map preset has an `atmosphere` block: `sky`,
  `skyZenith`, `skyHorizon`, `sunGlow`, `sunStrength`, `sunColor`,
  `sunDirection`, `exposure`, `fogNear`, `fogFar`, `hemisphereSky`,
  `hemisphereGround`, `hemisphereIntensity`, `cloudLight`, `cloudShade`,
  `cloudSoftness` (lines ~82, ~142, ~202). Note: the second map's palette is
  already sunset-like — good color reference for the Sunset variant.
- `src/main.ts`
  - `applyMapAtmosphere(ctx, preset)` (~line 2212) — single choke point that
    pushes atmosphere values into scene background, `scene.fog`, hemisphere
    light, and `ctx.setEnvironmentLight(...)`. Extend here.
  - `SkirmishSettings` (~line 143) — settings object built by the setup
    screen; add fields here.
  - `atmosphere.update(time, ctx.camera, ctx.scene.fog, ...)` (~line 3265) —
    per-frame atmosphere/cloud updater; the live transition hooks in near
    this call.
  - `settingsFromRoom(...)` in `boot()` — multiplayer matches derive settings
    from room config; new fields must round-trip through it.
- `src/render/renderer.ts` (~250–290) — scene fog created once
  (`new Fog(skyColor, 650, 1900)`), hemisphere + directional sun lights,
  `mobileSun` variant. `WaterView` receives `scene.fog` and sun direction.
- **Fog of war is separate**: `FogView` (vision) has nothing to do with
  `scene.fog` (atmospheric). Do not touch `FogView` or any `vision` values.
- No particle/precipitation system exists — Rain/Snow needs a new,
  self-contained view (see Phase 3).

## Design: modifiers over map atmosphere, not new maps

Time-of-day and weather are **modifier layers** applied on top of each map's
existing `atmosphere` block, so every map gets all combinations for free:

```
finalAtmosphere = blend(mapAtmosphere, timeOfDayModifier, weatherModifier)
```

- `TimeOfDay = 'day' | 'sunset' | 'night'` — `day` = identity (map renders
  exactly as today).
- `Weather = 'clear' | 'rain' | 'snow'` — `clear` = identity.
- Default `{ day, clear }` must be **pixel-identical to the current game**.

## Phase 1 — Atmosphere modifier system

1. New file `src/content/atmosphereVariants.ts`:
   - `TIME_OF_DAY: Record<TimeOfDay, AtmosphereModifier>` and
     `WEATHER: Record<Weather, AtmosphereModifier>`.
   - An `AtmosphereModifier` provides multipliers/overrides for the existing
     atmosphere fields: color tint + lerp weight for sky/hemisphere/cloud
     colors, multipliers for `sunStrength` / `exposure` /
     `hemisphereIntensity` / fog distances, and an optional `sunDirection`
     override (elevation matters for sunset/night).
   - Starting values (tune visually):
     - **Sunset**: sun elevation lowered (direction y ≈ -0.3, like the
       existing sunset map), sunColor → `#ffbd73`, sky lerped toward
       `#d18a55`, exposure ×1.05, fog ×0.9, long-shadow look.
     - **Night**: sunStrength ×0.22, sunColor → `#9db8ff` (moonlight),
       sky lerped toward `#101a2c`, hemisphere `#31435e` / ground `#1c2230`,
       exposure ×0.9, fogNear ×0.7 — **plus readability compensation, Phase
       4.**
     - **Rain**: sky/hemisphere lerped toward gray (`#77828c`), sunStrength
       ×0.55, fogNear ×0.55 / fogFar ×0.7 (wet haze), cloudShade darker,
       cloudSoftness → 0.2 (heavy cover).
     - **Snow**: sky toward pale `#c9d4dc`, fogNear ×0.5 / fogFar ×0.6
       (white-out haze), hemisphere ground lightened (snow bounce),
       sunStrength ×0.7.
2. `applyMapAtmosphere()` takes the resolved final atmosphere (map blended
   with the two modifiers) instead of the raw map preset. Add a pure helper
   `resolveAtmosphere(mapAtmo, timeOfDay, weather)` in
   `atmosphereVariants.ts` with unit tests (identity for day+clear; night
   darkens; blending is order-stable).
3. Water: `WaterView` already consumes `scene.fog` + sun — verify it picks up
   changes; if it caches colors at construction, add a cheap
   `water.refreshAtmosphere()` hook.

## Phase 2 — UI: setup screen + live switcher

1. **Setup screen**: add `timeOfDay` and `weather` to `SkirmishSettings`
   (defaults `'day'` / `'clear'`), with two segmented pickers in the skirmish
   setup UI next to the existing map controls (reuse the existing control
   styling — same pattern as map size / ore amount). Persist like other
   settings if they persist; include in the match config.
2. **In-game settings menu**: add the same two pickers to the in-game
   settings/pause menu, applying live via a transition:
   - Lerp all resolved atmosphere values over **1.8 s** (ease-in-out) from
     current to target — sun color/strength/direction, hemisphere, fog
     near/far/color, background, exposure.
   - Implement as a tiny `AtmosphereTransition` updated next to the existing
     `atmosphere.update(...)` call in the main loop.
   - Weather particles (Phase 3) fade in/out over the same window.
3. **Multiplayer**: `timeOfDay`/`weather` ride the room config through
   `settingsFromRoom()` so both players start with the same look. The live
   switcher stays **local-only cosmetic** in multiplayer (each player may
   re-style their own view; it syncs nothing) — simplest correct behavior.

## Phase 3 — Precipitation layer (rain & snow)

New self-contained `src/render/weatherView.ts`, instantiated in `boot()`:

1. One `Points`/instanced mesh of **~1,400 particles** (rain) / **~900**
   (snow), recycled inside a camera-following box (~90 × 55 × 90 world
   units centered ahead of the camera) — the classic local-volume trick, so
   it works at every zoom and in V-mode without map-wide cost.
2. **Rain**: thin vertical streaks (stretched quads or `LineSegments`),
   fall speed ~55 u/s with slight wind shear; additive-free, alpha ~0.35,
   color tinted from the resolved fog color so streaks never glow at night.
3. **Snow**: small soft quads (~0.12 u), fall speed ~6 u/s with per-flake
   sinusoidal drift; alpha ~0.8.
4. Respect the transition: density scales 0→1 with the Phase 2 fade.
5. Performance budget: one draw call per weather type, zero allocations in
   the frame loop (pre-allocated buffers, position recycling), auto-disabled
   when weather is `clear`. Must hold 60 fps on the current desktop target
   and follow the existing mobile-fallback pattern (`mobileSun` precedent —
   halve particle counts on mobile).
6. Optional polish (only if cheap): during `rain`, nudge terrain/building
   material roughness down slightly via a global uniform if one exists —
   skip if it requires touching many materials.

## Phase 4 — Night readability compensation

Night must stay perfectly playable at RTS zoom:

1. Selection glows, health bars, HUD, placement ghosts, tactical map:
   **unchanged intensity** (verify none inherit scene lighting).
2. Boost team-accent emissives at night: the building accent plates and unit
   `own`-team emissive (see `emissiveIntensity` in
   `src/render/unitView.ts` ~1861) get a night multiplier (~×2.2) applied
   via the same resolved-atmosphere hook.
3. Existing `signal` blinking lights and (post tower-spec) floodlights carry
   the ambiance — no extra work, but screenshot-verify they read well.
4. Unit silhouettes must remain distinguishable: if night hides them, raise
   hemisphere intensity floor rather than sun (flat moonlight look is fine).

## Acceptance criteria

1. Setup screen offers Day/Sunset/Night and Clear/Rain/Snow; chosen combo is
   what the match renders. Default day+clear is pixel-identical to today.
2. In-game settings switcher transitions any→any smoothly in ~1.8 s with no
   pops, at 60 fps, including while zoomed into V-mode.
3. All 9 combinations look coherent on every map (screenshot matrix: 3 maps
   × 9 combos at RTS zoom + 1 V-mode shot each for night-rain and day-snow).
4. Night: units, health bars, selection, and tactical map clearly readable;
   team colors identifiable at a glance.
5. Rain/snow visible at RTS zoom AND inside V-mode; no particles below the
   terrain or inside the fog-of-war shroud logic (they are pure overlay).
6. Fog of war (`FogView`), vision radii, sim behavior, and multiplayer
   determinism untouched — `yarn test`/typecheck pass; no new failures.
7. Multiplayer: room round-trips the two new settings; joining a night-rain
   room renders night-rain for both players.

## Out of scope

- No telemetry events for this feature (may be added later).
- No gameplay effects from weather (no vision/speed/accuracy changes).
- No dynamic day/night cycle (static setting per switch; cycle is a possible
  follow-up once presets look good).
- No thunder/lightning audio-visuals, puddles, or snow accumulation.
