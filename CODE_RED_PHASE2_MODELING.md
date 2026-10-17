# Code Red — Phase 2: 3D modeling handoff

You are picking up the visual modeling pass for **Code Red**, an Israel vs
Iran re-theme of the three.js RTS "Iron Dominion". Phase 1 (branch
`code-red/phase-1`) changed only names, colors, setup, alerts and copy. **No
3D model has changed yet.** This phase makes units and structures look like
their new names. Do not change gameplay.

## 1. Start here
- Repo: `JESSEPINKMAN83/iron-domination-` (private hobby project).
- Base branch: **`code-red/phase-1`**, not `main`, because Phase 1 is not
  merged yet. Create your own branch and worktree, e.g.
  `codex/code-red-hq-flags`, one asset per branch/PR. If Phase 1 has merged
  by the time you start, branch from `main` instead.
- Follow `LIVE_GAME_DELIVERY_WORKFLOW.md`: draft PR, `quality-gate` CI, Dani
  play-tests before merge, never deploy a branch.
- Node ≥ 20 (CI uses 22). `npm ci`. Known trap on Node 24: npm can print
  "Exit handler never called" and still exit 0 with an incomplete
  `node_modules`. Check that `node_modules/.bin/vite` exists, and re-run
  with Node 22 if it doesn't.
- Dev server: `./node_modules/.bin/vite --port 5182 --host 127.0.0.1`
  (`npx vite` can hang).
- Checks: `npm test` (vitest; add `--maxWorkers=2` on laptops) and `npm run build`.

## 2. Preview URLs (local dev only; ignored on public hosts)
| URL params | Shows |
|---|---|
| `?start=lineup` | every unit kind lined up near your base: Israel row (team 1) facing an Iran row (team 2) |
| `?building-showcase=industry` / `=defense` | structures staged for close inspection |
| `?fortress-preview=guard` / `=aa` | Border Outpost / Iron Dome tower close-up |
| `?performance-test=1&seed=7&armies=4&stress-bases=26&stress-infantry=60` | late-game stress: 4 armies, ~150 buildings, ~600 units |
| `...&code-red-preview=1` (with the stress URL) | Iran fires a Fattah missile + Shahed drone at you every 25 s |
| `?armies=4&sides=1,2,3,4&seed=7` | normal match: Israel vs Iran, Hezbollah, Houthis |

In dev builds, `window.__iron` exposes `{ ctx, sim, unitView, buildingView, combatView, armies }`.

## 3. How a model knows its side
- Nations live in `src/content/nations.ts`. `nationForTeam(team)` returns
  `{ id, name, doctrine }`. Doctrine `'iron-legion'` = Israel side
  (Israel, United States, United Kingdom, France); `'missile-command'` = Iran
  side (Iran, Hezbollah, Houthis, Iraqi Militias). Use **doctrine** to choose
  a silhouette, and **nation id** only for flags.
- Team colors come from `FACTION[factionId(team)]` (`src/render/palette.ts`):
  Israel blue on Sinai-grey armor, Iran red, Hezbollah yellow, Houthis green.
  Always build from the shared team materials (`createTeamMaterials` in
  `src/render/unitView.ts`; the `accentMaterial` passed to building
  details), never hard-coded team colors, or allies/enemies become unreadable.
- Display names (Merkava Mk4, Karrar, Iron Dome…) are in
  `src/content/sideLabels.ts`. Don't change labels in this phase.

## 4. Code map
**Units** — `src/render/unitView.ts`
- `UnitView.addEntity` (~line 709) builds each unit, then bakes it for
  distant rendering (~line 760). Today the key is `` `${kind}:${factionId(team)}` ``.
  **When a kind gets per-side models, add the doctrine to this key**
  (`${kind}:${faction}:${doctrine}`), or the far batch will draw the wrong side's model.
- `createVehicleObject` (~line 2643): tanks, APCs, howitzer. `refs.turretPivot`
  must remain the turret root; the far batch poses it separately.
- `createAircraftObject` (~line 3021): all three aircraft are **helicopters**
  today: `wasp` (AH-1 Cobra), `vulture` (AH-64 Apache), `hammerhead` (Yasur).
  Rotors are animated through `refs`.
- `createHarvesterObject` (~line 2865).
- Infantry: `buildSoldier` / `applyKit` in `src/render/soldier.ts`.
- `visualScaleForEntity` scales by **entity name** (`'Jackal'`, `'Mauler'`…).
  Entity names are internal; never rename them.

**Structures** — `src/render/buildingView.ts`
- `createBuildingDetails` (~line 1401) has one branch per kind: `command-yard`
  1534, `helipad` 1599, `intelligence-center` 1624, `strategic-silo` 1659,
  `missile-defense` 1694, `aa-tower` 1864. Towers share setup around 1100 and 1520.
- Build parts with the local `box(name, …, material, fragility)` and
  `activity(…)` helpers. Fragility drives the existing damage and destruction
  system (`src/sim/structureDamage.ts`); raw `new Mesh` parts won't break apart.
- Intact hulls and walls are batched (`buildingHullBatch.ts`, `wallBatch.ts`).
  Keep footprints identical.

**Projectiles / effects** — `src/render/combatView.ts`
- Strategic threats branch on `weaponKind === 'strategicMissile'` (Fattah) vs
  `'emberDrone'` (Shahed) around lines 311, 522 and 731.

**2D assets**
- Build-card icons: `public/assets/ui/command-icons/<kind>.png`
  (`skylance-ciws` reuses `missile-defense.png`; see `src/ui/sidebar.ts:1874`).
- Landing background: `public/assets/landing/home-page-bg-38.mp4` + `.jpg`
  (referenced in `src/landing.ts`).

## 5. Performance rules (a late-game frame-rate fix just shipped)
- Keep a detailed unit at about 95 meshes or fewer; reuse shared geometries.
- Distant ground units draw from an instanced bake (`src/render/unitBatchLod.ts`)
  that includes only **opaque, visible** meshes at build time. Muzzle flashes,
  glows and smoke must be transparent or hidden when the unit is built.
- Before/after each asset, run the stress URL and compare average frame time
  with the base branch. Compare detailed vs batched in the same frame:
  `__iron.unitView.batchRangeScale = 1e6` (all detailed) vs `= 0` (all batched).
  They must look the same apart from animation.

## 6. Assets, in order
1. **Command HQ flags.** Small flag on a mast per nation (Israel, US, UK,
   France, Iran, Hezbollah, Houthis, Iraqi Militias), from `nationForTeam`.
   Canvas texture is fine.
2. **Iron Dome** (`aa-tower`, Israel side): radar on a mast plus 3 tilted
   20-tube launcher boxes. **Khordad-15** (`aa-tower`, Iran side): truck with
   twin canisters.
3. **Arrow 3** (`missile-defense`, Israel only): elevated twin canisters plus
   a Green Pine radar panel. Phalanx (`skylance-ciws`): a dome on a pedestal.
4. **Tanks** (`tank`). Merkava Mk4: rear-set wedge turret, front engine deck,
   chain-ball skirt, Trophy APS boxes. Karrar: rounded T-90-style turret, ERA
   blocks.
5. **Shahed-136 drone** mesh (delta wing, pusher prop) and **interceptor trails**
   (white Iron Dome smoke, tall Arrow 3 arc). Fattah: sleeker re-entry body
   with a brighter terminal glow.
6. **Missile City** (`strategic-silo`): tunnel portal in a berm with a
   launcher truck at the mouth. **IRGC Aerospace HQ** (`intelligence-center`):
   domed command building with dishes.
7. **APCs / artillery.** Eitan 8×8 vs Rakhsh 4×4 (`scout-tank`); Rochev
   tracked howitzer vs Fajr-5 rocket truck (`siege-tank`).
8. **Infantry kits.** IDF olive uniforms with Tavor rifles vs IRGC woodland
   uniforms with AK-pattern rifles.
9. **Helicopters.** Reshape `vulture` as an Apache (tandem cockpit, stub
   wings, chin gun, mast radar) and `wasp` as a Cobra.
10. **Landing video and build-card icons.** Re-render after the models land
    (they still show the old Command Yard).

## 7. Out of scope (needs a separate engineering task)
- **Jets (F-16I Sufa / F-35I Adir).** They need a fixed-wing flight model in
  `src/modes/firstPersonController.ts` and AI routing, not just a mesh.
  Leave `hammerhead` as a helicopter.
- Iron Beam laser (new weapon behavior plus beam VFX).
- Any balance, weapon, AI, multiplayer or label change.

## 8. Definition of done (per asset)
- Visible in the lineup/showcase preview on both sides, with team colors
  intact.
- Detailed vs batched look identical in the same frame.
- Stress-URL average frame time no worse than the base branch (note the numbers in the PR).
- Damage and destruction still work for buildings (see `?building-showcase=defense`).
- `npm test` and `npm run build` pass; the PR includes before/after screenshots.
