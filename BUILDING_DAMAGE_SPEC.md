# Localized, Progressive Building Destruction — Spec

> **For the coding agent.** Buildings must damage *where they are hit*, in real time:
> a missile into the left face visibly breaks the left face; more hits escalate that
> area from scorched → cracked → holed → collapsed. Ten distinct visual damage levels,
> localized per building section. Buildings only (units keep their wreck swap).
> Obey the standing invariants (`CODEX_PHASES_PLAN.md`): deterministic 30 Hz sim, no
> three.js imports in `/src/sim`, render only *reads* sim state.

## 1. Architecture: sim owns "what is broken", render owns "how broken looks"

The single most important decision: **damage locality is sim data, not a render
effect.** Every hit writes into a per-building damage grid inside the sim (so it is
deterministic, hashable, save/load-able, and identical for AI and player buildings);
the render layer turns that grid into visuals.

### 1.1 Sim: the damage grid (`src/sim/structureDamage.ts`, new)

Each building gets a coarse 3-D grid of damage cells covering its bounding box:

```ts
interface StructureDamage {
  cols: number;   // along footprint w: clamp(round(w/2), 3, 6)
  rows: number;   // along footprint h: clamp(round(h/2), 3, 6)
  tiers: number;  // vertical: 2 (lower / upper) — 3 for tall buildings later
  cells: Uint8Array;      // cols×rows×tiers, 0=intact … 255=obliterated
  version: number;        // bump on every change; render diffs on this
}
// Entity gains: structureDamage?: StructureDamage (created on building spawn)
```

`applyStructureDamage(building, hitX, hitZ, hitY, fromX, fromZ, amount, splashRadius)`
— pure function, fully deterministic:

1. Convert the impact point to building-local grid space (account for `transform.rot`
   if buildings ever rotate; today rot=0).
2. If the impact point is *outside* the footprint (direct fire striking a wall),
   project it onto the nearest facade and damage the **facade cells nearest the
   attacker's bearing** — this is what makes "hit from the left → left side breaks"
   work for hitscan weapons whose recorded hit is the building center. Use
   `atan2(fromX-bx, fromZ-bz)` to pick the facade when no better point exists.
3. `hitY` (bombs/missiles fall from above, rockets fly flat) selects the tier:
   arcing ordnance (`trajectory: 'arc'`) biases the **top** tier, flat trajectories
   the tier at impact height (lower tier for tanks, upper for aircraft rockets).
4. Distribute `amount` into cells with radial falloff: nearest cell gets
   `amount × k` (k≈2.2 scaled so cell damage roughly tracks health loss), neighbors
   within `splashRadius` get falloff shares. Clamp at 255. Bump `version`.
5. **Structural spread**: when a cell reaches ≥200, bleed 25 % of further damage into
   the cell above it (things collapse downward-from-above visually because the
   support below is gone — cheap but reads as structural logic).

Wire it in `src/sim/combat.ts` at every point damage is applied to an entity with
`building` — direct hitscan hits, projectile impacts, and splash — the impact
coordinates and attacker position are already available at all three call sites.
Include the cells in `hashSim` (mix every byte) and add a determinism test.

**Overall damage level** (the "ten levels") is derived, not stored:
`level = ceil(10 × (1 − health.current/health.max))`, clamped 0–10. Locality comes
from the grid; *severity dressing* comes from the level. Both drive the visuals.

## 2. The ten visual damage levels (whole-building dressing)

Render each building as a **grid of sub-blocks matching the damage cells** (§3), then
apply this ladder. Levels stack — level 6 includes everything from 1–5 in worse form.

| Level (hp lost) | Visual state |
|---|---|
| **1** (≤10 %) | Scorch: hit cells' blocks darken 20 %, soot streak (dark decal quad) on the struck facade. Nothing structural. |
| **2** | Cracks: struck blocks get crack seams (thin dark box-edges overlay or a canvas crack texture on that block), accent stripe flickers once. |
| **3** | First wisps: thin gray smoke sprite rising from the worst cell; small debris chips (3–4 tiny dark boxes) scattered at the base of the struck facade. |
| **4** | Panel loss: worst blocks (≥120) shrink 6 % with random skew and expose a darker "inner wall" box behind them; window/accent elements on that facade go dark. |
| **5** | First breach: any cell ≥170 → its block is **replaced by a rubble wedge** (half-height irregular chunk) — a visible bite out of the silhouette on the damaged side. Persistent gray smoke column. |
| **6** | Open hole: cells ≥200 are **removed entirely**; a black interior box (slightly inset, `colorWrite` dark material) is revealed with a faint ember-orange emissive flicker inside. Rubble spills outside the footprint below the hole. |
| **7** | Fire: the two worst cells emit fire sprites (billboard flames, additive) + smoke turns black; upper-tier blocks above holes sag — lower them 15 % and tilt 3–5°. |
| **8** | Corner collapse: if a corner column (both tiers) is ≥200, the whole corner drops into a rubble pile; building gains a permanent 2° lean toward its most damaged side; wide debris field. |
| **9** | Ruin: >60 % of upper-tier cells broken → the roofline is ragged (most upper blocks gone or sagged), 2–3 fires, heavy black smoke, all accents dead. Silhouette must read as "about to die" from across the map. |
| **10** (destroyed) | Collapse sequence (§4): remaining blocks tumble inward/down over ~1.2 s with a dust burst, leaving a smoking rubble mound on the footprint until the entity expires. |

The key inspection test: **two buildings at the same health but hit from different
sides must look different** — one broken on its left, one on its right.

## 3. Render implementation (`src/render/buildingView.ts` rework)

- Replace the single `BoxGeometry` per building with a **block grid**: cols×rows×tiers
  boxes (≤ 6×6×2 = 72, typically ~24) sized to fill the same bounding box, tiny gaps
  (2 cm) so cracks/holes read. Keep the per-kind material on all blocks; keep the
  accent stripe and construction scaffold behavior.
- Per-building `DamageDressing` object caching: block meshes indexed by cell, current
  applied `version`, and active effect sprites. Each frame, if
  `entity.structureDamage.version !== applied`, re-dress **only that building**:
  walk cells, map byte ranges to block states (intact / scorched / cracked / shrunk /
  wedge / removed) per the table. All state changes are idempotent functions of
  (cells, level) — never accumulate, so re-dress is safe and repair (future) works
  for free.
- Deterministic "randomness": all jitter/skew/tilt comes from `hash2i(cellIndex,
  entity.id, seed)` (`sim/noise.ts` is importable by render) — no `Math.random()`, so
  visuals are stable across frames and identical across clients.
- Rubble wedges: pre-build 3 shared low-poly chunk geometries (jittered, flattened
  icosahedra like `scatter.ts` rocks) reused everywhere with varied scale/rotation.
- Smoke/fire/dust: follow the existing `combatView` pattern (billboard `Mesh` +
  `MeshBasicMaterial`, ttl fade, dispose on removal). Fire = 2 stacked additive
  flame quads with sine flicker; smoke = soft dark circles rising ~2.5 m/s, spawn
  rate by level (L3: 1/2 s → L9: 4/s across sources). Budget: hard-cap ~12 active
  sprites per building, ~120 globally; recycle oldest.
- Fog: enemy buildings inside fog must not update their dressing (that leaks intel).
  Apply the same `isVisible` predicate used by `unitView`: if fogged, freeze at the
  last-seen `version` (do not re-dress until visible again).
- Perf acceptance: 20 damaged buildings on screen at 60 fps; dressing rebuilds are
  event-driven (version bump), never per-frame.

## 4. Death: the collapse sequence (replaces the current wreck-material slump)

On `entity.destroyed` (first frame observed):
1. Kill all accents/lights; every intact block switches to the scorched material.
2. Over 1.2 s (drive from `destroyed.remaining`, which counts down deterministically):
   upper-tier blocks fall first (y drops with ~9.8-ish accel, random small x/z drift +
   tumble rotation from `hash2i`), lower blocks shrink/tip outward; each block that
   "lands" swaps into the shared rubble-chunk geometry.
3. One dust burst (expanding soft disc + 6 debris chips, like `spawnBombBlast`) and a
   final rubble mound: 5–8 rubble chunks + persistent smoke, kept until the sim
   removes the entity (existing 20 s timer), then fade out over 2 s.
4. The sim is untouched by any of this — it's all render, driven by `destroyed.remaining`.

## 5. Order of work, tests, acceptance

1. `sim/structureDamage.ts` + component + wiring in `combat.ts` + `hashSim`.
   **Tests**: same hit sequence → identical cell hash twice; a hit from the west
   damages only west-facade cells; arcing bomb biases top tier; splash spreads to
   neighbors; spread rule (≥200 bleeds upward).
2. Block-grid buildingView + cell dressing (levels 1–6 states).
3. Level dressing effects (smoke/fire/sag/lean, 7–9) + fog freeze.
4. Collapse sequence (level 10).
5. Playtest acceptance:
   - Fire a tank bomb at the left face of an enemy refinery: scorch → cracks →
     breach appear **on the left face**, right face stays clean.
   - Keep hitting the same face: hole opens, fire starts, corner collapses — clearly
     passing through distinct stages (users should be able to name ~10 steps).
   - Hit the roof with arcing bombs → top tier breaks before walls.
   - Destroy it: collapse animation + rubble mound, no leftover meshes/materials
     (check `renderer.info` for leaks after the 20 s cleanup).
   - Two same-type buildings hit from opposite sides look mirrored, not identical.
   - All prior tests green; determinism suite includes the new damage-grid test.

## 6. Phase 7 note (art pass)

Keep this exact data model when GLB buildings arrive: the damage grid and level
ladder stay; only the dressing swaps (per-cell damage mesh variants / decal sheets /
baked rubble instead of procedural blocks). Do not bake damage into monolithic
"damaged building" model swaps — per-cell locality is the feature.
