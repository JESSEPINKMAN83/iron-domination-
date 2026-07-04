# Codex Handoff - Iron Dominion

Use this file as the first prompt in the next Codex session:

> Read `/Users/danir/Development/iron-dominion/CODEX_HANDOFF.md` and continue exactly from there.

Project folder:

`/Users/danir/Development/iron-dominion`

Current browser URL:

`http://127.0.0.1:5173/?ai=hard&debug=armies`

## Current Game State

This is a local Vite + Three.js RTS prototype called Iron Dominion. It is now well past Phase 1. The game has:

- Terrain, camera controls, minimap/radar, fog/visibility, selectable buildings and units.
- Build panel with buildings, defenses, infantry, vehicles, and aircraft tabs.
- Command Yard, Power Plant, Refinery, Barracks, Factory, Helipad, walls, guard tower, AA tower.
- Multiple soldier, vehicle, and aircraft tiers.
- RTS selection, lasso selection, move orders, attack-move, right-drag facing/spread formation.
- First/third-person V mode for units, including helicopter controls.
- Tank and aircraft primary/secondary weapons, bomb salvos, explosions, damage indicators.
- Building selection glow, producer highlighting, wall chaining, building damage visuals.
- Enemy AI commander with build order, squads, scouting, attacks, retreats, and base response behavior.
- Real economy phase started: refineries spawn ore harvesters, harvesters collect finite ore/oil nodes and return credits.

## Very Recent Work

The latest user request was: "the ore collectors looks like the tanks - make them look different".

Implemented:

- `src/render/unitView.ts`
  - Added a dedicated harvester visual branch for `selectable.type === 'harvester'`.
  - Added `createHarvesterObject(...)`.
  - Harvesters now have a different industrial silhouette:
    - wider chassis
    - cargo bed
    - cab
    - front scoop
    - side tanks
    - wider tracks
    - team-colored ore load/stripe
  - Increased harvester pick radius slightly.

Verified after that change:

- `npm test -- src/sim/economy.test.ts` passed.
- `npm run build` passed.

## Economy Implementation Details

The user asked if there was a way to earn more credits. The current answer is:

1. Build Power Plant.
2. Build Refinery.
3. Refinery automatically spawns an Ore Harvester / Ash Harvester.
4. Harvester drives to finite resource nodes, gathers cargo, returns to refinery, and deposits credits.

Important code:

- `src/sim/components.ts`
  - Added `Harvester` component:
    - `state: 'seeking' | 'to-node' | 'gathering' | 'to-refinery' | 'depositing'`
    - `nodeId`
    - `refineryId`
    - `timer`
  - `Entity` now has optional `harvester`.

- `src/sim/economy.ts`
  - `EconomyState.pendingSpawned` is used so newly spawned refinery harvesters are returned by `stepEconomy(...)` and registered by `UnitView`.
  - `placeStructure(...)` spawns a harvester when a refinery is placed.
  - Removed old passive timed refinery income.
  - `stepHarvesters(...)` handles:
    - find assigned refinery
    - find nearest resource node
    - move to node
    - gather finite ore
    - return to refinery
    - deposit credits through ledger entry `Ore delivered`

- `src/sim/world.ts`
  - Sim hash includes cargo and harvester state for determinism.

- `src/ai/commander.ts`
  - AI excludes harvesters from attack squads so it does not send collectors into combat.

- `src/sim/economy.test.ts`
  - Added tests that verify:
    - no passive credits without collector loop
    - refinery harvester depletes ore and deposits credits

Full verification after economy implementation:

- `npm test` passed: 48 tests.
- `npm run build` passed.
- Browser smoke passed:
  - canvas present
  - HUD/panel visible
  - no browser console errors

## Current Git / Worktree Context

There are many modified files from the ongoing game build. Do not revert anything unless the user explicitly asks.

At the time this handoff was written, `git status --short` showed many modified files, including:

- `PROGRESS.md`
- `src/ai/acceptance.spec.ts`
- `src/ai/commander.test.ts`
- `src/ai/commander.ts`
- `src/content/phase3.ts`
- `src/content/phase4.ts`
- `src/main.ts`
- `src/modes/firstPersonController.ts`
- `src/modes/rtsController.ts`
- `src/render/buildingView.ts`
- `src/render/combatView.ts`
- `src/render/orderMarkerView.ts`
- `src/render/unitView.ts`
- `src/sim/combat.test.ts`
- `src/sim/combat.ts`
- `src/sim/components.ts`
- `src/sim/economy.test.ts`
- `src/sim/economy.ts`
- `src/sim/movement.test.ts`
- `src/sim/world.ts`
- `src/ui/hud.ts`
- `src/ui/sidebar.ts`

Untracked files:

- `src/content/flightModels.ts`
- `src/content/startPositions.ts`
- `src/sim/structureDamage.ts`

These are expected from prior work in this long session. Work with them, do not reset them.

## Likely Next Improvements

The user may continue from the collector/economy feedback. Good next steps:

1. Make ore/economy clearer in the UI:
   - show harvester status in the sidebar or HUD
   - show "Collecting", "Returning $300", "No refinery", "No ore"
   - show visible cargo fullness on the harvester
   - make ore fields easier to identify on terrain/minimap

2. Improve harvester behavior:
   - refinery can replace a destroyed harvester, possibly as a queue item or automatic rebuild
   - harvester should avoid obvious combat if attacked
   - player can select harvester and see cargo/refinery target

3. Balance economy:
   - current harvester constants in `src/sim/economy.ts`:
     - `HARVESTER_CAPACITY = 300`
     - `HARVESTER_GATHER_RATE = 95`
     - `HARVESTER_DEPOSIT_SECONDS = 0.55`
   - Tune only after testing actual game feel.

4. Visual polish for harvester:
   - animate scoop/drill while gathering
   - show cargo bed becoming fuller
   - add dust trail while driving

## Commands To Run After Any Change

Use these from `/Users/danir/Development/iron-dominion`:

```bash
npm test
npm run build
```

For a quicker economy/render-related check:

```bash
npm test -- src/sim/economy.test.ts
npm run build
```

If the browser is already open on localhost, reload it after changes and check for console errors.

## Important User Preferences

- The user wants the game to feel like a playable Red Alert-inspired RTS, but all assets/names must remain original.
- They care a lot about immediate feedback:
  - selection should be obvious
  - orders should show markers
  - damage should be visible on first hit
  - panels should be clear and responsive
- They prefer moving forward phase by phase, but often asks for polish/fixes between phases.
- They will test visually in the in-app browser and report feel/UX issues.

## Do Not Forget

- Work in `/Users/danir/Development/iron-dominion`.
- Do not use `/Users/danir/Documents/New project` even if it appears as the shell cwd.
- Do not revert user or prior-session changes.
- Prefer `rg` for searching.
- Use `apply_patch` for manual edits.
- After frontend/game changes, run tests/build and preferably a browser smoke check.
