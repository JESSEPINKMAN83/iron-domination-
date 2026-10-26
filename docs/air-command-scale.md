# Air command and large-map rendering trial

Local branch: `codex/air-command-and-scale`, based on production main after PR #109. Not deployed.

## Rendering and navigation

Terrain and fog share distance-selected index buffers. Near chunks retain full geometry; distant chunks use 2-cell or 4-cell interiors. Every chunk boundary retains its original vertices, including Extra Large's 226-cell chunks, so mixed detail does not open cracks. Vertex attributes and bounds are shared. Hysteresis avoids repeated switches during small camera movements. Simulation heights, collision, visibility, and navigation resolution remain unchanged.

Navigation keeps six recent flow fields per grid, invalidating the cache when blockers change. A single integer scratch queue replaces two newly allocated coordinate queues on each build. Unchanged destinations reuse their existing distances. Tests compare route distances against fresh builds and verify blocker invalidation.

Focused local benchmark against `origin/main`: 24 orders to four repeating destinations on a fully walkable 904 × 904 grid took 816 ms before and 153 ms after in one run. This is not an end-to-end FPS comparison. Extra Large terrain alone has 1,634,432 full-detail triangles; all distant chunks use 121,952. Total frame geometry also includes units, scenery, shadows and effects.

## AI

Normal and above fund an early Israeli Air Base. Aircraft purchases precede discretionary ground spending, with a ground-force threshold after the first aircraft. Pending jobs count toward caps; a procurement sequence keeps mixed aircraft types after losses. Mixed ground/air forces may launch without waiting for one extra ground unit.

Fighters intercept visible enemy aircraft, including while attached to a ground squad. Unassigned strike aircraft scout known deployment sectors and raid visible economy/production. Wounded aircraft return toward home. Hard's air cap is 12; Extra Hard's is 18. No hidden entity positions are used to select targets.

Extra Hard keeps Hard's combat accuracy/reload and sniper restrictions. It adds larger waves, more concurrent squads, defense-first air targeting and two Israeli air bases. It has a disclosed 2× ore-income handicap and 10,000 starting credits. Iran retains its own doctrine and buys missile accuracy, drone quantity, missile level and drone warhead upgrades after prerequisites, reserve funds and opening time permit.

Local links use `ai=extra-hard`, `ai-coordination-test=1` for staged combat, and `scale-metrics=1` for frame/air-order counters. Test-only staging does not prove a full-match win rate. Balance still needs human playtesting.
