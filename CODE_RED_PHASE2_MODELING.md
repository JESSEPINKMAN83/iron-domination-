# Code Red — Phase 2: 3D modeling scope

Phase 1 (branch `code-red/phase-1`) re-themed the game without touching any
3D model: names, colors, setup, alerts and copy. Phase 2 is the modeling pass,
scoped so it can be handed off (Astra) and done one asset at a time.

## Ground rules
- One asset per PR; play-test each before the next.
- Keep entity ids, `UnitKind` / `StructureKind` ids, weapon slots, turret
  pivots (`refs.turretPivot`) and footprints unchanged so gameplay, AI and
  multiplayer stay identical.
- Keep team readability: hull/canvas colors come from `FACTION[id]`
  (`src/render/palette.ts`); new meshes must use the team materials from
  `createTeamMaterials` (`src/render/unitView.ts`), never hard-coded colors.
- Budget: a detailed unit stays under ~95 meshes. Distant units render
  from an automatic instanced bake (`src/render/unitBatchLod.ts`). It only
  includes opaque, visible meshes, so muzzle flashes and glows must stay
  transparent or hidden at build time.
- Check every model with `?performance-test=1&seed=7&armies=4&stress-bases=26&stress-infantry=60`
  (dev server only) and compare average frame time with `main`.

## A. Units — per-side silhouettes (same kinds, two looks)
Today both sides share one model per kind; only colors differ. Add a
`doctrine` switch in the model builders (`createVehicleObject`,
`buildSoldier`, `createHarvesterObject` in `src/render/unitView.ts` /
`src/render/soldier.ts`). The bake key must include the doctrine:
`${kind}:${faction}:${doctrine}`.

| Kind | Israel look | Iran look |
|---|---|---|
| `tank` | Merkava Mk4: rear-set wedge turret, front engine deck, chain-ball skirt, Trophy APS boxes | Karrar: T-90-style rounded turret, side skirts, ERA blocks |
| `scout-tank` | Eitan 8×8 wheeled APC | Rakhsh 4×4 wheeled APC |
| `siege-tank` | Rochev (M109) tracked howitzer | Fajr-5 MLRS truck (rocket pod instead of barrel) |
| infantry kits | IDF olive uniform, helmet covers, Tavor rifle | IRGC woodland uniform, AK-pattern rifle |

## B. Aircraft (Israel only)
Phase 1 names follow today's helicopter models: AH-1 Cobra (`wasp`),
AH-64 Apache (`vulture`), Yasur Strike Gunship (`hammerhead`).
- **Modeling only:** reshape `vulture` into a recognizable Apache (tandem
  cockpit, stub wings, chin gun, mast radar) and `wasp` into a Cobra
  (narrow fuselage, stub wings).
- **Modeling + flight work (bigger, separate):** replace `hammerhead` with
  an F-35I Adir jet, and optionally add an F-16I Sufa. Jets need a
  fixed-wing flight model in `src/modes/firstPersonController.ts` and
  aircraft routing; this is gameplay engineering, not just a mesh.

## C. Structures
| Kind | Israel | Iran |
|---|---|---|
| `aa-tower` | Iron Dome: radar on mast plus 3 tilted 20-tube launcher boxes | Khordad-15: truck-mounted twin canisters |
| `missile-defense` | Arrow 3: elevated twin canister launcher plus Green Pine radar panel | — |
| `skylance-ciws` | Phalanx dome; Phase 3 could add an Iron Beam laser (needs a beam VFX) | — |
| `strategic-silo` | — | Missile City: tunnel portal in a hillside with a TEL truck at the mouth |
| `intelligence-center` | — | IRGC Aerospace HQ: domed command building, dishes |
| `helipad` → Air Base | Hangar plus helipad pair, IAF roundel | — |
| Command HQ | Small national flag on a mast (Israel / Iran / Hezbollah / Houthis / US) | same |

## D. Effects (not meshes, but visual)
- Interceptor trails: white smoke for Iron Dome, a tall arcing plume for Arrow 3.
- Shahed silhouette: delta-wing drone mesh with a pusher prop for the
  one-way drone projectile (`src/render/combatView.ts`).
- Fattah: a sleeker re-entry vehicle with a brighter terminal glow.

## E. Marketing assets
- Re-render the landing background video and building/unit card icons
  (`public/assets`). They still show the old Command Yard label and models.

## Suggested order
1. Command HQ flags (small and high identity value)
2. Iron Dome + Arrow 3 launchers
3. Merkava vs Karrar tanks
4. Shahed drone mesh + interceptor trails
5. Missile City portal
6. Apache / Cobra reshape
7. Jets (with the flight work)
8. Landing video + card icons
