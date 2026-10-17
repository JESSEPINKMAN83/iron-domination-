# Code Red modeling preview

Branch: `codex/code-red-phase2-models`, based on Phase 1 commit `0622f9d`.
Local review only; no merge or deployment.

## Preview

- Model gallery: http://127.0.0.1:5183/?code-red-models=1
- Unit lineup: http://127.0.0.1:5183/?start=lineup&armies=2&doctrines=iron-legion,missile-command&time=day&weather=clear
- Defenses: http://127.0.0.1:5183/?start=test&building-showcase=defense&armies=2&doctrines=iron-legion,missile-command&time=day&weather=clear
- Industry: http://127.0.0.1:5183/?start=test&building-showcase=industry&armies=2&doctrines=iron-legion,missile-command&time=day&weather=clear

## Changes

- Cached HQ flags for all eight nation identities (proxy insignia simplified for RTS scale).
- Iron Dome: three inclined twenty-cell launch boxes and mast radar; Khordad-15: truck with twin canisters.
- Arrow-style twin elevated canisters and radar; Phalanx pedestal, radome and six-barrel gun.
- Doctrine-specific Merkava/Karrar, Eitan 8x8/Rakhsh 4x4, Rochev/Fajr-5 silhouettes.
- IDF/IRGC uniform and rifle differentiation; existing role silhouettes and animation rigs retained.
- Cobra/Apache tandem glazing, wings and chin weapons; Apache engine pods and mast radar.
- Delta-wing Shahed with wingtip fins; slimmer Fattah with terminal glow.
- White AA trails and a taller cosmetic missile-defense interception arc. Impact timing and simulation trajectories are unchanged. A render-only launcher-kind field was added to combat events.
- Missile City berm/portal/truck and Aerospace HQ dome/dishes.
- Thirty model-derived WebP cards, doctrine-aware in build and selection panels (252 KB total).
- Local-only model gallery, old-model comparison toggle and visible timing overlay.

## Test checklist

1. Compare both rows in the lineup: silhouettes, faction markings, turn/recoil animation, V mode, upgrades, zoomed-out rendering.
2. Inspect defenses and industry; attack structures to check damage, collapse, and removal.
3. Test four armies to check ally/proxy colors and HQ flags.
4. Stress scene: `?start=battle-test&performance-test=1&seed=7&armies=4&stress-bases=26&stress-infantry=60&combat=manual&time=day&weather=clear&model-timing=1`.
5. Add `&model-baseline=1` for the old armor/building/infantry/helicopter models in the same branch. The visible overlay warms up for 20 seconds and samples the next 20 seconds.

## Validation

- Full test suite: 724 passing across 94 files.
- Production build passes (existing large-bundle warning).
- New tests check all six vehicle variants' detailed versus instanced bounds, turret/recoil contracts, mesh budgets, doctrine-specific geometry caching, and registration of destructible structure assemblies.
- Gallery browser comparison: APC 11 -> 9 draw calls; tank 12 -> 10; howitzer 10 -> 10. APC triangles 856 -> 936, tank 2252 -> 1436, howitzer 1300 -> 1256.
- Initial stress sample: baseline average 10.24 ms / p95 16.90 ms; new models average 10.40 ms / p95 17.00 ms. These are indicative single-machine browser samples, not a guarantee of parity; the new-model run overlapped part of the test run. Repeat without background work before release.
- Browser smoke test: gallery, stress scene and lineup load, no observed console errors. Game cards load the new assets.

## Follow-up after model approval

The handoff explicitly places the landing film re-render after the models land. The existing film remains for this model-review checkpoint; re-render it once silhouettes are approved. No flight model, AI, costs, damage, range, nation labels, or gameplay balance was changed. Hammerhead remains a helicopter.

Phase 1 is not merged. Keep this branch based on Phase 1; do not merge this preview directly into main or deploy it before Dani's play-test.


## Thumbnail refresh and clean performance check

Review: http://127.0.0.1:5183/?code-red-thumbnails=1

- Replaced the initial 30 loosely framed captures with 54 consistently lit, model-derived portraits, covering every unit/building for both doctrines and all eight HQ flags.
- Actual game factories now supply building bodies, dimensions, unit visual scales and materials; no proxy building boxes.
- All portraits are 256 × 192 WebP (same decoded dimensions as legacy PNGs), totaling 198,316 bytes versus the legacy PNG set's 1,151,275 bytes.
- Sidebar and selection cards preserve complete silhouettes and faction colors; removed the old crop and luminosity blend. Card size is unchanged.
- The normal gallery and in-game UI use static images. Offline rendering and performance diagnostics are excluded from the production JS.
- Static helicopter panels are merged per material, retaining independent rotors and reloadable missiles. Three added regression tests cover those contracts.
- Full suite: 727 tests across 95 files pass. Production build passes.

Clean stress comparison, after all builds/tests completed: 149 buildings, 632 units, fixed FULL quality at 1.25× render scale and 1600 × 900 output. Each run used 20 seconds warm-up and 20 seconds sampling.

| Metric | Before models | Current redesign |
| --- | ---: | ---: |
| Average frame time | 10.24 ms | 10.17 ms |
| p95 frame time | 16.80 ms | 16.90 ms |
| Average draw calls | 555 | 537 |
| Average triangles | 2,867,538 | 2,755,610 |
| Resident geometries | 276 | 262 |
| GPU textures | 47 | 47 |

No measurable frame-time regression in this test. The 0.1 ms p95 difference is within ordinary browser timing noise; this is one local paired sample, not a guarantee for every GPU or gameplay state. Graphics quality was not reduced. See `docs/code-red-performance.json` for raw counters.

Local browser verification: all 54 final WebPs load at 256 pixels wide; build and selected-force cards use the new paths with `object-fit: contain` and normal color blending. Aircraft tab shows all three matching silhouettes. No browser console errors observed.
