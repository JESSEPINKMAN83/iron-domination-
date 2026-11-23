# Code Red missile presentation research and implementation plan

## Goal

Improve the readability, weight, and visual continuity of launches, flight, interception, and explosions in the existing browser game. Review locally before merging the missile work. Treat damage, range, reload, guidance, hit timing, and multiplayer simulation as established gameplay contracts.

## Current stack and observations

The reference revision uses Three.js 0.170, Vite, TypeScript, a deterministic 30 Hz simulation, adaptive visual quality, and a dedicated CombatView. The renderer consumes combat events and renders tactical missiles, strategic missiles, one-way drones, bombs, and shells. Existing effects already include one-draw crossed-ribbon trails, smoke sprites, scorch marks, impact fragments, interception flashes, and falling intercepted strategic wrecks.

Current weaknesses found in source inspection:

- Trail history adds one position per rendered update. Trail length changes with rendering cadence, quality throttling, and game speed.
- Every tactical projectile builds separate body, nose, band, glow, and fin meshes. Strategic missiles have more than a dozen pieces. Creation and destruction allocate and dispose their geometry and materials per launch.
- Rocket exhaust appears as a static glow or cone. Sustained flight lacks a clear ignition, powered-flight, and burnout presentation.
- Missiles and ballistic ordnance share trail machinery. This makes bombs and shells look more rocket-like than their propulsion warrants.
- Tactical AA impact effects are less distinct than ground missile explosions.
- Existing effect caps are valuable. Increasing particle counts would compete with those caps and could obscure important combat feedback.

## Technical research

1. Three.js recommends preallocating BufferGeometry attributes and changing draw ranges for frequently updated geometry. Use fixed trail storage and update existing GPU buffers.
   https://threejs.org/manual/pages/how-to-update-things.html

2. BufferAttribute supports DynamicDrawUsage for changing data. Confirm the API in the installed r170 package, rather than relying only on newer documentation.
   https://threejs.org/docs/pages/BufferAttribute.html

3. Separate geometry groups remain separate draw calls. Merge compatible opaque projectile pieces into a vertex-colored mesh, with a small separate exhaust mesh for animation. Reuse immutable geometries across launches.
   https://threejs.org/docs/pages/BufferGeometry.html

4. Instancing can reduce draw calls for repeated geometry, but mixed missile lifetimes, per-projectile visibility, and independent guidance increase the integration scope. Begin with merged reusable bodies and bounded effects, then measure whether full projectile instancing is justified.
   https://threejs.org/docs/pages/InstancedMesh.html

5. Transparent effects need careful ordering and can suffer artifacts. Keep smoke thin, effects bounded, and crossed ribbons in a single transparent pass. Prefer stylized, restrained atmospheric effects that read from strategy view.
   https://threejs.org/manual/pages/transparency.html
   https://threejs.org/docs/pages/Material.html

These sources describe rendering behavior. Visual and performance recommendations here are engineering judgments for this game, not benchmark results.

## Implementation sequence

### 1. Stable flight trails

Use bounded, reusable trail history sampled at a fixed time interval. Retain the latest head position between samples. Give powered missiles a short bright exhaust core transitioning into a neutral smoke ribbon. Keep the ribbon in its existing single draw call. Avoid adding a rocket flame to bombs, artillery shells, or the propeller-driven Shahed.

### 2. Missile body and exhaust

Reuse geometry within each CombatView and combine compatible opaque parts with vertex colors. Animate a compact exhaust using existing meshes with deterministic visual flicker. Make the strategic rocket's powered phase visibly subside during coast and retain the existing terminal glow on descent. Leave the simulation trajectory authoritative so interceptors meet the visible missile.

### 3. Launch and impact

Animate ignition and nozzle-anchored exhaust; retain the existing quality-scaled launch-smoke emission rather than adding a second particle emitter. Use an airburst for anti-air hits rather than a ground-looking fireball. Preserve ground blast, shock ring, fragments, water ripple, scorch, and strategic aftermath, while making timing and scale distinguish a tactical hit from a heavy strategic impact.

### 4. Local review and performance evidence

Provide a local missile effects range with repeatable launches, impacts, and a stress mode. Reuse the same event fixture to compare the baseline and updated renderer. Measure actual draw calls, triangles, resource counts, and browser frame timing where available. Test all quality tiers, capped event storms, repeated cleanup, and unchanged combat simulation tests. Do not claim identical FPS across hardware from draw-call counts alone.

## Performance acceptance

- Each trail has fixed buffer capacity, with no per-frame geometry recreation.
- Active effect and projectile ceilings remain bounded at every quality tier.
- Repeated launch/impact cycles release transient resources and keep caches bounded.
- Projectile-body draw calls should decrease through geometry consolidation.
- The local stress fixture should record baseline and updated costs with the same camera, quality, event rate, and duration.
- Effects follow the game-speed clock.
- Keep transparent coverage and particle counts controlled. Performance mode must retain useful launch and hit cues.
- Verify a full build and focused rendering/simulation tests, then open a review PR without merging the missile work.

## Implemented result and decisions

- Tactical missile bodies render as one opaque vertex-colored mesh plus one animated exhaust cone. Strategic missiles retain two exhaust cones and their terminal glow, with one merged opaque body.
- Concurrent missiles of the same weapon and projectile kind share immutable geometry. Materials remain private so exhaust animation and wreck darkening cannot change another missile. References survive interception; the last live missile/wreck releases the template geometry and materials. No persistent GPU cache is retained between volleys.
- Exhaust grows at ignition, flickers deterministically, and remains attached to the nozzle as its length changes. Strategic exhaust and smoke emission burn out around the middle of the existing flight. This is a presentation phase, not a physical missile-performance model.
- Trails sample at 30 Hz of effect/game time, keep a live head, reuse a bounded vector pool, and update preallocated dynamic position buffers. Neutral translucent smoke transitions into a hot narrow head. Color buffers and width profiles are recalculated only when the sample count changes.
- Bombs and ballistic shells no longer get a rocket exhaust glow. Guided precision munitions, MLRS rockets, and heavy arc missiles remain powered visual families; Shahed's propeller mesh is preserved.
- Ground missile blasts receive a short white-hot core inside the existing fire/smoke/shock effect. Aircraft missile hits receive an elevated flash and expanding smoke puff. Water ripples, strategic aftermath, interception pulses, health bars, and falling wrecks remain in place.
- Existing projectile, smoke, event, and total drawable budgets remain authoritative at every quality tier. No lights, dynamic shadows, new textures, or postprocessing passes were added.
- Simulation files, damage, guidance, reload, range, interception rules, and network messages are unchanged. Visible paths and hit timing remain driven by existing combat events.

## Local review

Run `npm run dev -- --host 127.0.0.1 --port 5191`.

- Effects range: http://127.0.0.1:5191/missile-lab.html
- Playable silo scenario: http://127.0.0.1:5191/?start=missile-test&armies=2&seed=231125
- Repeatable frozen sample: http://127.0.0.1:5191/missile-lab.html?stress=1&snapshot=1

The range launches strategic, siege, anti-air, air-to-ground, and anti-tank missiles automatically. Launch wave adds a volley; Stress repeats larger volleys. Quality and Speed exercise all three visual tiers and 1×/2×/3× effect time. This standalone dev entry is omitted from the default production bundle; the actual CombatView changes are shared by the game.

## Measurements — November 23, 2026

Baseline: merged main `ddedde222b99ed4da7922b2e80b89bd46e905246`. Updated: this branch. These are engineering measurements on this machine, not universal FPS guarantees.

### Browser rendering fixture

Same copied lab, camera, 1280×720 viewport, high quality, 1× time, 25 missiles across five families, frozen at 1.0 seconds. Baseline served on port 5192; updated served on port 5191. Stats read from Three.js renderer.info and CombatView.effectStats. Background browser tabs and display refresh can influence timing.

| Metric | Baseline | Updated |
| --- | ---: | ---: |
| Render draw calls | 358 | 173 |
| Rendered triangles | 22,148 | 20,148 |
| Live GPU geometries | 331 | 102 |
| Textures | 1 | 1 |
| Active missiles | 25 | 25 |
| Smoke objects | 91 | 91 |
| Frozen-scene frame p50 | 11.1 ms | 11.1 ms |
| Frozen-scene frame p95 | 16.7 ms | 16.7 ms |

The frozen-scene timing measures rendering of an established scene, not launch/update CPU cost or a full battle. Draw calls fell about 52%; geometry counts fell about 69%. No particle-count increase produced these gains.

### CPU fixture

Vitest/Node, same generated heightfield, 25 missiles (five per family), identical launch coordinates, 6-second duration, followed by 120 updates at 1/60 second. Alternate baseline/head order across 14 trials, discard the first four, report the upper middle sample of ten retained timings. No WebGL renderer is involved. Raw samples and temporary fixture source are exported beside this plan.

| Work | Baseline median | Updated median |
| --- | ---: | ---: |
| Create 25 launches | 2.29 ms | 1.72 ms |
| 120 effect updates | 17.71 ms | 14.94 ms |

This comparison exposed a trail-shading CPU regression during development; caching invariant trail colors/widths removed it before submission. Single-launch cold compilation, GPU first-use shader stalls, low-end phones, and sustained full-army battle FPS are not established by this fixture.

## Verification and remaining limits

- Full suite: 941 tests across 127 files passed. Build passed with the existing large-bundle advisory.
- Regression checks cover trail age at 30/60/144 Hz, bounded reused vector storage through stalls, dynamic-buffer reuse, finite exhaust transforms, merged draw count, flight endpoints, strategic burnout, airburst height/cleanup, shared geometry/material isolation, last-wreck disposal, and event storms at all three quality tiers.
- Browser: successful strategic launch in the playable scenario, no console errors, high-quality matched fixture, sustained Performance-quality stress above 60 seconds of fixture time, and 3× speed/Medium quality controls exercised. Existing FX budgets stayed bounded.
- The range is a repeatable review tool, not a representative whole-game performance benchmark. Mobile-device performance and responsive range layout have not been validated on real hardware.
- Full instancing, textured volumetric plumes, dynamic illumination, and expensive fragment simulations are deferred. They add complexity or overdraw without evidence they are needed for the current scale.
- Missile branch is for local review and a draft PR only; do not merge or deploy until reviewed.
