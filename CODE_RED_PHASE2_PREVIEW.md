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
