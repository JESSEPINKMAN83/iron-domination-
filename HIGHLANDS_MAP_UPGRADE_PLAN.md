# Highlands map: research and execution handoff

Prepared 5 September 2026. Scope: improve the default map, one measurable visual change at a time. This document is a plan; no game code was changed for this research.

## Recommendation

Give Highlands the character of a fictional Mediterranean upland reservoir: blue-green water, pale limestone, warm dry soil, silvery olive groves, irregular pine silhouettes and sparse shoreline vegetation. Use the natural landscape of the Carmel/Galilee region as inspiration, while retaining a fictional battlefield and controllable procedural generation. [Mount Carmel landscape reference](https://en.parks.org.il/reserve-park/mount-carmel-national-park-and-nature-reserve/).

The visible transformation should come from materials, silhouettes and deliberate placement. Start with the lake. Keep its footprint and gameplay unchanged in the first release; introduce tactical terrain changes as a separate, tested milestone.

## What the current code actually does

Paths below are relative to this repository. Findings come from source inspection, not a new GPU benchmark.

| Area | Current implementation | Implication |
| --- | --- | --- |
| Stack | Three.js `^0.170.0`, TypeScript, Vite; WebGL renderer with postprocessing and N8AO. | Keep the engine and dependencies. Existing rendering capabilities are sufficient. |
| Default map | `src/content/maps.ts`: `highlands`, medium, 512 cells at 2 m; nominal 1024 m square. Seed/settings can override the preset. | Explicitly select Highlands and record seed, relief, size and resource abundance for comparisons. |
| Ground | `src/render/terrainMesh.ts`: 16 chunks, about 524,288 surface triangles at medium size, plus skirt. Procedural grass/dirt/rock/ore textures, splat blending, macro tint and detail normal. | Already substantial geometry. Improve material art within the existing blend system; do not increase mesh resolution. |
| Lake | `src/render/water.ts`: one map-wide transparent plane, 96×96 subdivisions, procedural waves and height-based shore/depth shading. Highlands deep color is almost black. | Dark centers and the continuous pale rim match the screenshot. A better depth palette, sky-colored surface response and broken shoreline treatment can visibly improve this without another rendering pass. |
| Water precision | Height lookup uses one 8-bit channel across an 80 m range: about 0.31 m steps. | Inspect shallow-water banding. If visible, compare a portable higher-precision encoding; verify filtering around byte boundaries. Do not assume this is the sole shoreline defect. |
| Vegetation | `src/render/scatter.ts` and `instancing.ts`: merged procedural tree geometry, instanced by type; seeded placement, crush/fall behavior, shader-driven grass wind. Many tree types cast shadows. | Replace silhouettes and distribution within existing budgets. Instancing is already present; adding more trees is not automatically cheap. |
| Resources | `TerrainView.buildOreGlow/updateResources`: additive circular markers, small rigs, and individually rendered/materialized glowing crystals. Updates occur when the simulation tick changes. | The gold disks dominate the screenshot. Later reduce visual dominance and batch fragments while preserving discovery and depletion cues. |
| Asset support | `src/render/assets.ts` has GLTF/Draco/KTX2 loaders; current terrain/scatter is procedural. | Optimized authored assets are possible later. Verify decoder files and loading failures before using this unused path. |
| Safety system | `src/render/renderer.ts`: adaptive quality responds to sustained frame pressure above roughly 38 ms; severe pressure above 70 ms. Explicit quality settings can lock adaptation. | A locked-quality test alone cannot prove automatic quality remains stable. Test both modes. |

The existing simulation performance tests do not render WebGL. Passing those tests, build checks or triangle budgets is insufficient evidence of GPU performance. `renderer.info.autoReset` is already disabled; use the existing frame reset/cumulative counters correctly rather than adding another reset inside a pass.

## Art direction and implementation sequence

Each step gets a separate reviewable commit and comparison capture. Do not accumulate a complete environment redesign before checking performance.

### 0. Establish a trustworthy baseline

Inspect the actual checkout first. The rollback on main is `200b5e9`, following PR #74; it restores the pre-redesign tracked tree. Do not reintroduce PR #72/#73. There is unrelated uncommitted gameplay/audio/UI work in this workspace: preserve it and use an isolated `codex/` branch/worktree for implementation. Record the exact baseline SHA and configuration.

Use a production build. Add only a small development measurement harness if needed, disabled during normal play. Capture the lake, starting base, a tree-heavy area, a resource-heavy area and a repeatable busy battle. Record viewport, DPR, hardware/browser, camera poses, map settings and army counts. Keep an identical camera route and scenario for A/B runs.

### 1. Lake only — first implementation and local review

Primary files: `src/render/water.ts`, Highlands water configuration in `src/content/maps.ts`; minimal constructor wiring if a Highlands-specific style flag is required.

- Replace near-black depth with muted blue-green; show warmer shallow sediment and a gradual depth transition.
- Add a restrained analytical sky-color/Fresnel response to the existing shader. Keep ripples subtle at RTS distance and highlights broad enough to avoid glitter during camera movement.
- Replace the continuous white rim with irregular, low-contrast shallow edges. A sheltered reservoir should not have an ocean-surf ring.
- Audit shader color space/tone mapping against the installed renderer before changing it. Compare shoreline precision only if captures show banding.
- Keep one water pass, existing mesh resolution, water level, lake shape and walkability. No real-time reflection camera, refraction buffer, extra bloom or new light.

Success: the screenshot's dark pools visibly become a coherent reservoir at close, normal RTS and horizon views; no floating water sheet, edge flicker or loss of unit readability. Other maps retain their water style. Present paired screenshots and measurements locally before step 2.

### 2. Ground and shore materials

Primary files: `src/render/textures.ts`, `terrainMesh.ts`; Highlands-specific visual parameters.

Create convincing pale fractured limestone, dry earth with larger tonal variation, and patchy grass. Use existing slope/depth information to place rock on steep banks, darker damp soil near water and warmer open ground inland. Bake static variation once; avoid extra per-frame CPU work. Start within the current texture dimensions and sampler count. Any authored texture replacement must have an explicit decoded-memory and download budget.

Do not change the simulation heightfield just to repaint it. Avoid painted roads across water or impassable slopes. Success is stronger terrain structure at normal zoom, without obvious repeated stamps or noisy detail that hides units.

### 3. Trees, rocks and ground cover

Primary files: `src/render/scatter.ts`, existing instancing helpers only where necessary.

Replace selected Highlands tree archetypes with forked olive trunks and irregular silver-green crowns, plus broader pine canopies. Shape existing rock instances as limestone clusters. Redistribute the existing population into groves, bare clearings and restrained wet-edge patches. Replace instances rather than simply increasing density; retain resource/deployment clearance and vehicle crushing.

Keep shared materials and merged archetype geometry. Set a measured triangle/shadow budget before adding silhouette detail. Avoid dense transparent leaf layers. Consider chunked instance culling or distance simplification only if profiling identifies that cost; both add complexity and can increase draw calls. Preserve the existing reduced-quality grass behavior.

### 4. Resource presentation

Primary file: `src/render/terrainMesh.ts`.

Reduce the giant luminous circles and replace scattered bright confetti with mineral-toned deposits and restrained amber cues. Preserve resource locations, quantities, depleted state and easy discovery at gameplay zoom. Batch repeated fragments; update depletion attributes when values change and move decorative motion into a shared shader only if needed. Do not redesign buildings or rigs in this scope.

### 5. Strategic terrain — separate milestone after visual acceptance

The simulation already uses height/water for navigation and terrain line of sight. Explore a ridge overlooking the reservoir, a constrained shoreline route and an alternate inland flank using those existing rules. First document current routes, then propose a specific layout; decorative trees must not be described as granting cover.

Any heightfield changes require deterministic regeneration, deployment and expansion access, ground-unit connectivity, resource fairness, AI routing, projectile line-of-sight and multiplayer consistency checks. Keep visual and tactical-map representations aligned. Mud speed penalties, vegetation concealment, destructible bridges, flooding and fire are later mechanics work, not incidental additions to the art pass.

## Performance and release gates

These are proposed acceptance limits, not measured results or a guarantee for every device.

1. Warm up 30 seconds, then record at least 60 seconds per scenario, three repetitions for baseline and candidate. Capture frame-time median/p95/p99, counts above 50/100 ms, full-frame draw calls/triangles, texture/geometry counts, render scale, quality tier and context-loss events. Report loading/first-visit hitches separately. Texture counts are not GPU memory measurements.
2. At identical fixed quality and render scale, require median and p95 frame time within 5% of baseline; investigate p99/long-frame regressions rather than hiding them in average FPS. Rerun inconclusive noisy comparisons. Target 60 FPS where the baseline/device already supports it.
3. Run the normal automatic-quality mode as well. Require no additional pressure-driven downgrades, safe-mode entries or WebGL context losses. Distinguish deliberate fast-camera quality changes from performance degradation. Do not change thresholds or lower default quality to pass.
4. First lake slice: no added geometry, rendering passes or routine CPU animation loops. Subsequent slices: total draw calls/triangles should remain within the measured baseline envelope; any exception requires explicit measured justification before proceeding.
5. Run relevant tests and production build after each slice. Before release, run a 10-minute automatic-quality play session with movement, combat, lake views and camera sweeps on Dani's machine; include a lower-powered device if available. Check the other two maps for shared-renderer regressions.
6. If a slice fails, reduce or revert that slice. Do not proceed to the next slice until it passes. Local user testing comes before a separately authorized PR/deployment; this research task does not authorize publishing new map changes.

## Sources and limits

Three.js recommends reducing separate objects/draw submissions through merging where appropriate; this supports retaining the existing batched approach, not a claim that geometry or pixel cost disappears. [Official optimization guide](https://threejs.org/manual/en/optimize-lots-of-objects.html).

KTX2 supports GPU compressed textures with renderer capability detection. Check compatibility with the installed r170 APIs, since current documentation may describe newer versions. [Official KTX2Loader documentation](https://threejs.org/docs/pages/KTX2Loader.html). Asset candidates can come from [Poly Haven's CC0 library](https://polyhaven.com/license), after selecting a strict size budget; no asset downloads are required for the first slice.

No new rendering benchmarks were run during this research. The identified costs are source-level observations, not proof of the previous regression's precise cause.

## Starting instruction for GPT-5.6 Sol

Read this plan and the applicable repository instructions. Preserve existing unrelated changes. Implement steps 0 and 1 only on an isolated `codex/` branch: establish a production-rendering baseline, then significantly improve Highlands water using the existing pass. Keep simulation state, other maps, buildings, units and adaptive-quality policy unchanged. Return paired local screenshots, frame-time results and a local test URL. If actual browser/GPU measurement is unavailable, report that limitation and do not claim performance is validated. Stop for local visual review before ground, vegetation or resource work. Do not deploy.
