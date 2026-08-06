# Defense Tower Visual Upgrade Spec

Make the two defense structures — `guard-tower` (Fortress Guard Tower) and
`aa-tower` (AA Missile Tower) — look professional and proportional to the rest
of the game. Today they read as giant flat warehouses with toy launchers on
top. Target: slender, layered military towers that sit believably next to
tanks, soldiers, and trees.

**Rendering only. Do not change sim behavior**: footprint, collider, range,
health, costs, and placement rules stay exactly as they are.

---

## Current implementation (read before coding)

- `src/render/buildingView.ts`
  - `createBuildingObject()` (~line 273): every building's body is a grid of
    uniform damage blocks filling the FULL footprint at FULL height.
    `fullW = footprint.w * cellSize * 2` → towers get **16 × 16 world units**
    (footprint `{w:4,h:4}` in `src/content/phase3.ts`, `cellSize = 2`).
  - `heightForStructure()` (~line 822): towers = **7.2** units tall.
  - Guard tower details: ~lines 1209–1261. AA tower details: ~lines 1262–1300.
    All detail dimensions are fractions of the 16-unit width.
  - `structureDamageFor()` (~line 702): damage grid (cols/rows/tiers) drives
    the destruction/collapse animation — the body blocks ARE the damage system.
- Scale references (for proportion targets):
  - Heavy tank hull: 3.82 wide × 7.12 long (`src/render/unitView.ts` ~2377).
  - Scout tank hull: 2.72 × 4.45 (~2336). Soldier ≈ 1.7 tall.
- Possession (V-mode): `FORTRESS_TOWER.socketHeight = 25.5` in
  `src/content/fortress.ts` — the first-person camera socket when a player
  possesses a tower. If deck height changes, verify/adjust this.

## Problems to fix

1. **Massive slab base.** A "tower" renders as a 16×16×7.2 solid box — the same
   body as a factory. Nothing about the silhouette says tower.
2. **Toy-scale weapon parts.** Missile tubes are `width * 0.055` radius ≈ 0.9u
   → **1.8u-diameter missiles**, thicker than a soldier. Nose cones similar.
3. **Permanent fake muzzle flash.** Guard tower adds an always-on translucent
   "spotlight" cone (`width*0.28` radius × `depth*0.78` long, ~lines
   1252–1256). At RTS zoom it looks like a giant frozen golden explosion.
4. **No mid-frequency detail.** The base box has zero surface features — no
   panels, doors, vents, ladders — so it reads as an untextured placeholder.

---

## Phase 1 — Tower silhouette (the big win)

Give towers a tapered, layered body instead of the uniform slab, while keeping
the damage-block system working.

1. In `createBuildingObject()`, add an optional per-kind **body profile**: an
   array of per-tier `{ widthScale, depthScale, heightShare }` factors used
   when computing block positions/scales. Default profile (all 1.0, equal
   shares) keeps every other building pixel-identical.
2. Tower profile (3 tiers — bump `structureDamage` tiers for towers if
   currently 2, keeping total cell count reasonable):
   - **Tier 0 — plinth**: scale 1.0 × 1.0, height share 0.2 (a low, wide
     armored foundation, ~2.1u tall).
   - **Tier 1 — shaft**: scale 0.42, height share 0.45 (the slender concrete
     tower core, ~7.5u × 6.7 wide).
   - **Tier 2 — head**: scale 0.58, height share 0.35 (crew/machinery level,
     slightly wider than the shaft for a classic watchtower overhang).
3. Raise `heightForStructure()` for both towers from 7.2 → **10.5**. Combined
   with the narrower profile, the towers become vertical instead of squat.
4. Verify the destruction/collapse animation still looks right with scaled
   tiers (blocks fall/shrink per tier as before; `applyDamageDressing` must
   use the same per-tier scales as construction).
5. Keep selection glow, accent plate, and label working — reposition the
   accent/label to the plinth front edge (roof is now narrow).

## Phase 2 — Weapon and turret proportions

Guard tower (~1209–1261):
- Launcher deck sits on the tier-2 head, not floating above a cone roof.
- Missile tubes: radius **0.34u** (`width * 0.021`), length ~5.5u, 2×2 layout
  in an armored box housing (housing ~2.8 × 1.6 × 3.4) with a rear blast
  shield plate. Nose cones radius 0.36u, length 0.9u.
- Keep the brass optic/sight, scale to ~0.3u radius.
- Add small recoil rails under the tubes and one cable conduit running from
  the deck down the shaft (thin box, 0.18 × 0.18).

AA tower (~1262–1300):
- Rails: radius **0.22u**, missiles slightly slimmer than the guard tower's
  (AA = fast/small), 4 rails as today.
- Keep the radar dish + rotating sweep arm (good feature); mount it on a short
  lattice mast (2–3 thin crossed boxes) instead of floating.
- The whole launcher assembly should visually weigh ~1/3 of the head tier —
  the tower carries the weapon, the weapon doesn't dwarf the tower.

Both:
- `turretPivot` must remain the parent of every aiming part (tubes, housing,
  noses, sight) so yaw tracking is unchanged (`object.turretPivot.rotation.y`
  logic at ~line 197).
- After deck height changes, check V-mode: possess each tower and confirm the
  camera at `FORTRESS_TOWER.socketHeight` still sits at/above the launcher
  deck; adjust that constant if needed (sim-adjacent but camera-only).

## Phase 3 — Surface detail pass (greebles)

Reuse the existing shared materials (`concrete`, `metal`, `dark`, `warning`,
`glass`, `signal`, `brass`) — no new textures needed. Add, per tower:

- Plinth: inset access **door** (dark, ~1.2 × 1.8) on the front face, 2–3
  flat armor panels per side (0.08 thick, slightly proud of the surface),
  **warning-stripe chamfer** along the top edge of the plinth.
- Shaft: a **ladder** (two thin rails + 6–8 rungs, or a simple ladder-like
  box strip) from plinth to head, 2 small vent grilles (dark inset boxes),
  faction accent band near the top of the shaft.
- Head: perimeter **railing** (thin boxes, 0.08 radius equivalents) around the
  deck, 1 antenna whip (0.06 radius cylinder, 2.2 tall) with a `signal`
  blinking tip reusing the existing `activity(..., 'pulse', ...)` helper,
  small floodlight box aimed down-forward.
- Budget: ≤ ~25 extra meshes per tower, shared geometry where possible
  (`sharedBoxGeometry`/`sharedCylinderGeometry` pattern from unitView, or the
  local `box`/`cyl` helpers already in `createBuildingDetails`).

## Phase 4 — Effects fixes

1. **Delete the permanent spotlight cone** on the guard tower (~1252–1256), or
   replace it with a real searchlight: narrow cone (radius ≤ 0.9u, length ≤
   4u, opacity ≤ 0.18) angled 25° downward, slowly sweeping via the existing
   `activity` system — never aligned with the tubes (so it can't read as
   muzzle flash).
2. If there is a firing hook available in the view layer (weapon cooldown
   state on the entity), add a brief real muzzle flash on fire: scale a small
   cone at the tube mouths from 1 → 0 over ~120 ms. If no clean hook exists,
   skip — do NOT fake it with an always-on mesh.
3. Keep the AA radar sweep and lock-light pulse as-is (they read well).

---

## Acceptance criteria

Verify each item with in-game screenshots at default RTS zoom, with a heavy
tank and a few trees in frame for scale:

1. Tower base (plinth) is visually ≤ footprint size, and the shaft is clearly
   narrower — silhouette reads "tower", not "warehouse".
2. Total height ≈ 12–14u — noticeably taller than long (opposite of today).
3. Missile diameter ≤ 0.8u — clearly smaller than a soldier's width.
4. No permanent yellow cone anywhere in the idle state.
5. Turret still tracks targets (yaw follows `entity.turret.yaw`).
6. Destruction: damage states and the collapse animation work at every tier;
   no floating debris or z-fighting.
7. V-mode possession camera unchanged or improved (not inside geometry).
8. Placement ghost, selection glow, health bar, label, and team accent all
   render correctly.
9. No new textures; poly/mesh budget within ~2× the current tower detail
   count; `yarn`/`npm test` and typecheck pass.

## Out of scope

- Any sim/gameplay change (footprint, collider, range, damage, cost).
- Other buildings (factory, refinery, etc.) must render pixel-identical —
  the body-profile mechanism defaults to the current behavior.
- New art assets/textures.
