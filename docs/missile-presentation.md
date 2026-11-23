# Code Red missile presentation: research, implementation, and local review

## Scope

Improve the weapons actually fired by tanks, rocket infantry, and aircraft, together with Iranian strategic missiles and Shahed drones. Make launch, exhaust, flight, and impact more readable at strategy-camera distance, with a visibly different explosion sequence. Keep damage, reload, guidance, flight timing, interception rules, and multiplayer simulation unchanged.

The game uses TypeScript, Vite, Three.js r170, a deterministic 30 Hz simulation, adaptive rendering quality, and CombatView events. The original effects used separate meshes for projectile body pieces, render-frame-sampled ribbons, static exhaust, sphere smoke puffs, and layered sphere/ring blasts. Merely changing exhaust/trail settings was too subtle for the requested result.

## Research and design choices

1. **Preallocate flight buffers.** Three recommends preallocated BufferGeometry attributes and draw ranges for frequently updated geometry. Trails reuse bounded vector storage and DynamicDrawUsage position buffers; color/width profiles update only when sample count changes.
   - https://threejs.org/manual/pages/how-to-update-things.html
   - https://threejs.org/docs/pages/BufferAttribute.html

2. **Merge compatible opaque parts.** Geometry groups remain separate draw calls, so compatible body pieces become one vertex-colored mesh. Concurrent weapons share immutable geometry while retaining private materials for exhaust/wreck changes. Shahed wings keep their double-sided material and animated propellers remain separate.
   - https://threejs.org/docs/pages/BufferGeometry.html
   - https://threejs.org/docs/pages/InstancedMesh.html

3. **Replace blast shapes with a shared animation atlas.** One prepainted 768×512 RGBA canvas contains 24 frames of flash, irregular cooling flame, turbulent smoke, and ballistic sparks. SpriteMaterial samples a tile selected by a per-material uniform. Different explosions have independent ages while sharing the texture and shader program. No canvas painting, texture cloning, texture uploads, or particle creation is needed for animation playback.
   - https://threejs.org/docs/pages/SpriteMaterial.html
   - https://threejs.org/docs/pages/CanvasTexture.html

4. **Keep transparency bounded.** A ground missile blast uses one explosion sprite plus one restrained dust/spray plane, replacing several sphere/ring pieces. An airburst uses just the sprite. Alpha testing discards almost transparent atlas pixels; mipmaps are disabled and padded tile sampling avoids frame bleeding. This is an engineering tradeoff: billboards save geometry/draw calls but still have transparent-pixel cost. The matched browser fixture below checks rendering cost; it does not establish universal GPU performance.
   - https://threejs.org/manual/pages/transparency.html
   - https://threejs.org/docs/pages/Material.html

5. **Prepare effects during loading.** Paint the shared atlas once per page lifetime, upload it with initTexture, and await compileAsync using the configured game scene before the match loop starts. A retained warmup material keeps the shader program available for the first impact. This adds one bounded atlas (about 1.5 MiB GPU RGBA storage, without mipmaps), replacing per-impact geometry work rather than adding a new postprocessing pass.
   - https://threejs.org/docs/pages/WebGLRenderer.html

The installed r170 source/types were checked for sprite vMapUv/map_fragment, shader hooks, DynamicDrawUsage, initTexture, and compileAsync. The recommendations are game-specific engineering judgments, not claims made by the documentation.

## Implemented behavior

- All current weapon definitions have an explicit, typed visual family in `projectileVisuals.ts`; see [complete coverage](ordnance-coverage.md). Precision, swarm, upgraded tactical, MLRS, and heavy arc aliases use their full intended body/trail profiles instead of the generic fallback. A new WeaponKind requires a registry entry.
- All explosive projectile impacts now use the shared textured sequence: missiles, rockets, tank shells, artillery, bombs, grenades, live FPV contact hits (`bomb-impact`), and interceptions. Small-arms/laser/rail direct-fire presentation remains role-specific.
- Unpowered bombs, grenades, and shells do not emit rocket flight smoke. Propelled weapon emission cadence stays unchanged; improved aliases do not increase puff frequency.
- CPU-only projectile blueprints are prepared once while loading, never added to a scene or uploaded. Each view deep-clones geometry/materials into its active GPU cache, then concurrent launches share those per-view copies. Final live/wreck references release GPU copies normally. This moves mesh construction out of the first-shot frame while retaining cleanup and view isolation.

- Tank main-gun shell impacts also use a compact single-sprite blast, while heavy tank guns retain a larger dust/pressure treatment. Ballistic shell flight remains unpowered.
- Tank/scout/anti-tank, infantry rocket-launcher, aircraft rocket-pod, precision/air-to-ground, anti-air, MLRS, swarm, tactical warhead, and strategic missile families use the upgraded launch/flight treatment.
- Infantry and aircraft rockets now receive the textured impact too; their shared `atRocket-impact` path previously fell through to the generic small sphere.
- Short ignition flashes, nozzle-anchored animated exhaust cones, and soft smoke sprites replace static glows and many smoke spheres. Existing quality-dependent emission rates and smoke ceilings remain authoritative.
- Strategic rocket exhaust and smoke emission burn out partway through the existing authoritative trajectory. This is a visual powered/coast phase, not a physical missile model. Terminal glow, interception alignment, health bars, and falling wrecks remain intact.
- Trails sample at 30 Hz of effect/game time and retain a live head. Bounded vectors and buffers are reused, so trail age remains consistent at 30/60/144 rendering Hz and follows 1×/2×/3× effect time.
- Tactical, strategic, and Shahed impacts share a staged white-hot flash → irregular orange flame → dark rising smoke sequence. Ground impacts include dust or water spray; anti-air hits remain elevated without a ground dust plane. Existing scorch marks, damage feedback, fragments, and aftermath remain bounded.
- Shahed keeps its broad aircraft silhouette, rotating pusher propellers, and thin soft trail. It has no rocket flame or glowing engine orb. Most opaque body parts are consolidated, lowering its draw cost while preserving wings and propellers.
- Live GPU body geometry is cached only while projectiles or falling wrecks reference it; off-scene CPU blueprints remain for reuse. Materials stay private; the final reference releases GPU resources. The shared atlas/warmup material are intentionally bounded for the page lifetime.
- No lights, dynamic shadows, dependencies, external image downloads, network fields, damage/range/reload changes, or simulation/guidance changes.

## Local review

Run `npm run dev -- --host 127.0.0.1 --port 5191`.

- Review range: http://127.0.0.1:5191/missile-lab.html?review=5
- Actual units: http://127.0.0.1:5191/?start=weapons-lab&armies=2&seed=231128&doctrines=expeditionary-force,missile-command&combat=manual
- Full battlefield with ready armies/launchers: http://127.0.0.1:5191/?start=sound-test&armies=2&seed=231127&doctrines=expeditionary-force,missile-command
- Playable Iranian silo/Shahed scenario: http://127.0.0.1:5191/?start=missile-test&armies=2&seed=231126
- Matched impact sample: http://127.0.0.1:5191/missile-lab.html?mode=impacts&snapshot=0.18

The range offers Standard, Upgrades / MLRS, and Bombs / shells / FPV sets, covering all projectile and drone-contact weapons. The actual-unit weapons lab provides selectable platforms: choose a unit, press V, then use LMB for primary and RMB for secondary fire. Special missile upgrades are available through the normal upgrade UI. Click **Explosions** to compare all seven impacts; **Close view** moves nearer. Drag to orbit and scroll to zoom. Stress, quality, and 1×/2×/3× controls exercise effect budgets. Damage labels are hidden only in this inspection tool so they do not cover the explosions. The default production build omits the standalone lab entry; the real game uses the same CombatView and atlas module.

## Performance evidence — November 23, 2026

Baseline is merged main `ddedde222b99ed4da7922b2e80b89bd46e905246`. Updated is this branch. These are local engineering fixtures, not universal FPS guarantees.

### Seven-family browser impact fixture

Same copied lab, initial wide camera, 1280×720 viewport, high quality, 1× time, damage labels disabled. Seven impacts (Iranian strategic/Shahed, infantry launcher, aircraft rocket pod/precision/AA, tank missile), frozen after 11 updates at 1/60 second (about 0.18s). Baseline on port 5192, updated on 5191. Three renderer.info plus CombatView.effectStats:

| Metric | Baseline | Updated |
| --- | ---: | ---: |
| Draw calls | 192 | 158 |
| Triangles | 12,570 | 8,632 |
| Live GPU geometries | 117 | 86 |
| Textures | 5 | 6 |
| Smoke objects | 61 | 61 |
| Total FX drawables | 180 | 156 |

This is about 18% fewer draw calls and 31% fewer triangles during the impact scene. The texture count grows by one shared 1.5 MiB atlas. The close-up screenshots alongside this document use the same close camera on both revisions; their draw counts differ from the wide-camera table because frustum culling changes.

Browser frame timing remained refresh-limited in the established frozen scenes. Multiple local game tabs, refresh pacing, shader compilation during startup, and other work affect frame timing; do not infer whole-battle or low-end/mobile FPS from these counts. No GPU timer-query measurement was made. Atlas upload/program preparation now happens during match loading rather than the first visible impact.

### Matched CPU fixtures — complete ordnance set

Vitest/Node, same generated heightfield, all 22 weapons with projectile or manual-bomb flight paths. Impact fixture includes those 22 plus the live FPV contact event, for 23 impact types. Alternate baseline/head order for 14 trials, discard four warmups, report the upper-middle sample of ten timings. Shared atlas/CPU blueprints prepare during view/loading setup outside the timed combat operations. No WebGL renderer is involved.

| Work | Baseline median | Updated median |
| --- | ---: | ---: |
| Create 22 distinct launches | 1.52 ms | 1.28 ms |
| 120 flight updates at 1/60s | 10.01 ms | 6.48 ms |
| Create all 23 impact types | 4.69 ms | 3.54 ms |
| 120 aftermath updates at 1/60s | 2.27 ms | 2.20 ms |

The broader unique-weapon fixture caught first-shot geometry preparation overhead; off-scene CPU blueprints move that work into loading. The active GPU copies remain independent and are disposed after their last launch/wreck reference. The fixed CPU blueprint cache and atlas preparation are loading/memory tradeoffs, not zero-cost work. Initial loading latency and real low-end phone frame budgets are separate from these warmed combat measurements. Raw current logs and fixture sources use the `ordnance-cpu-*` names alongside this document.

Original smoke/fragment/event/total drawable caps still govern broad event storms. Full instancing and raymarched smoke remain deferred; the atlas is a compact billboard approximation, not volumetric simulation.

## Validation

- Full suite: 989 tests / 128 files passed; production build passed with the existing bundle-size advisory.
- Regression tests cover 30/60/144 Hz trail age, bounded reusable vectors/buffers, finite exhaust transforms, merged body draw counts, flight endpoints, burnout, airburst height/cleanup, private materials/shared geometry, last-wreck disposal, effect storms at all three quality tiers, all six ground-impact weapon paths, and rotating Shahed propellers without rocket exhaust.
- Independent review checked shader tile orientation/uniform isolation, Three r170 compatibility, shared atlas lifetime, burst cleanup, drone geometry ownership, and budget accounting; no blockers.
- Browser verified real match loading and a successful Shahed launch with no console errors. The seven-family range renders the new shader and supports close inspection. Performance-tier/3× stress and medium-quality controls were exercised.
- Desktop/local review is ready. Real mobile hardware, sustained full-army battle FPS, and exact GPU timing remain unmeasured.
- PR remains a draft for local review; missile changes have not been merged or deployed to production.

## Target damage extension

See [target impact review](target-impact-review.md) for directional scars, material-specific debris, building batching, updated validation and measurements against the previous missile-only PR revision.
