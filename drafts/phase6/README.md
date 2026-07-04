# Phase 6 drafts (NOT active)

Prepared but intentionally unwired — the user asked to stop before Phase 6.

When starting Phase 6, restore these (they compiled clean against the current sim):

- `commander.ts.draft` → `src/ai/commander.ts` — utility enemy commander: build
  order + rebuild/expand, production caps, squads with 40%-strength retreat,
  honest targeting via its own `VisibilityGrid`, possessed-unit pressure, `[ai]` logs.
- `phase6.ts.draft` → `src/content/phase6.ts` — personality (turtle/rusher/balanced)
  and difficulty (easy/normal/hard: income handicap + reaction delay + caps) data.
- `commander.test.ts.draft` → `src/ai/commander.test.ts` — behavior + determinism tests.

Also needed when re-wiring `main.ts` (see git history of this session's work):
enemy `createEconomy(2, …)` + `createInitialBase(sim, hf, enemyEconomy, hf.size*0.18, hf.size*0.08)`,
an AI `VisibilityGrid(hf, 2)`, `commander.step(1/SIM_HZ)` in the sim tick,
`stepEconomy` for the enemy economy (add spawned units to `unitView`),
victory/defeat check on `buildings(sim, team).length === 0`, and small starting
armies instead of the 120/40 debug spawns. The per-team economy refactor these
depend on is already merged and active.
