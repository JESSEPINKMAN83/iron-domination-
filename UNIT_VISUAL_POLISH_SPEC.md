# Unit Visual Polish — Distinct, Readable Units at Every Zoom

> **For the coding agent.** Today every tank variant renders as the same scaled box
> mesh, every aircraft as the same Vulture, and all three infantry as the identical
> soldier rig (`unitView.ts` branches only on `selectable.type`: infantry / vulture /
> harvester / tank). This spec makes each of the 9 combat units + harvester instantly
> tellable apart by **silhouette first, team color second, detail last** — with zero
> sim/balance changes. Render-only work, plus one debug URL mode.

## 0. Ground rules

- **No sim changes.** Unit identity is derived render-side:
  `unitVisualKind(entity)` in a new `src/render/unitKinds.ts` maps
  `selectable.type` + primary/secondary weapon kinds → a visual kind:
  `rifle | grenadier | rocket | jackal | m17 | mauler | wasp | vulture | hammerhead |
  harvester` (infantry: rifle→`rifle`, grenade→`grenadier`, rocketLauncher→`rocket`;
  tanks: autocannon→`jackal`, cannon→`m17`, heavyCannon→`mauler`; aircraft:
  autocannon→`wasp`, rocketPod→`vulture`, agMissile-primary→`hammerhead`). Unknown
  combos fall back to the class default — future units never crash the view.
- **Readability laws** (check every design against all four):
  1. *Silhouette test*: at max RTS zoom-out, each unit's outline alone identifies its
     class — no color needed.
  2. *Team test*: at any zoom, 100 % certainty of friend vs foe within ~0.2 s.
  3. *Value hierarchy*: hull mid-tone, weapon darker, team accent brightest — the eye
     finds the accent, then reads the shape.
  4. *Motion tells*: a unit's signature part moves (rotor, pump, barrel, backpack
     antenna) so life reads even in peripheral vision.
- **Perf discipline** (matches the cleanup pass): every geometry built **once per
  visual kind** in a module-level cache and shared across all instances; per-frame
  code uses cached child refs captured at build time (no `getObjectByName` in
  `update` — extend the existing pattern); shared materials from one palette module;
  no new per-frame allocations. Target: unit meshes ≤ ~24 parts each.

## 1. Faction identity — one palette module

New `src/render/palette.ts`, the **only** place unit/building team colors live
(buildingView + unitView + soldier all import it; delete their local color literals):

```ts
export const FACTION = {
  1: { // Meridian Command — disciplined steel + gold
    accent: 0xf0c85a, accentEmissive: 0x2b1d00,
    hull: 0x65787f, hullDark: 0x3f535a, canvas: 0x55603f,
    lightBar: 0xffe9a8, // emissive strip — reads in fog dimness
  },
  2: { // Ash Legion — scorched iron + blood-rust
    accent: 0xd65b46, accentEmissive: 0x2a0600,
    hull: 0x5c5350, hullDark: 0x3a3230, canvas: 0x4a3f38,
    lightBar: 0xff8f6a,
  },
} as const;
```

- **Enemy hulls change too**, not just the accent: Ash Legion units are warm
  gray-brown vs Meridian cool blue-gray. Team read must survive even where the accent
  is occluded. (Today both teams share identical hull materials — fix that.)
- **Accent placement standard**, same spot per class so the eye learns it: tanks =
  full turret band + front glacis chevron; aircraft = tail fin + wingtip/skid tips;
  infantry = helmet band + backpack patch; harvester = cab roof + bed rim stripe.
- Add a small **emissive light bar** per unit (tank rear, aircraft tail tip, soldier
  helmet dot) using `lightBar` — cheap emissive material, sells team + aliveness at
  distance and in dim fog edges. Accents are yellow-vs-red-orange (colorblind-safe
  pair by luminance: gold is much lighter — verify in grayscale).

## 2. Silhouette specs (per unit)

### Infantry — one shared rig, three gear kits (extend `soldier.ts`)
`buildSoldier(materials, kit: 'rifle' | 'grenadier' | 'rocket')`. Shared skeleton and
animations; kits swap gear meshes and proportions. All gear parts come from the
existing box/cylinder vocabulary — ~6–10 extra parts each:

- **Rifle Team** (baseline, mostly as-is): slim, long rifle held across; small
  backpack; helmet band accent. The "ordinary infantry" read.
- **Grenadier** (wide + heavy): 15 % wider torso via bulky armored vest plates,
  drum-shaped grenade launcher (short fat tube + under-drum) held low at the hip,
  round-domed helmet with face guard, grenade bandolier boxes across the chest.
  Stance: feet wider apart (hips splayed ~8°). Reads: *stocky artillery man*.
- **Rocket Team** (tall + back-heavy): shoulder-carried launch tube (long cylinder
  past the head), tall boxy backpack with **two visible spare rockets** + whip
  antenna (slight sway in walk cycle = motion tell), narrower silhouette, kneepads.
  Optional polish: when its weapon cooldown is active (just fired), tilt the tube up
  briefly — visible AA launch pose.
- Walk cycle stays shared; per-kit posture offsets applied once at build.
- (No sniper exists in the roster; when one is added, this kit system is the pattern:
  prone-capable long rifle + ghillie fringe. Note this in code comments.)

### Vehicles — three distinct hulls (split `createTankObject` into per-kind builders)
- **Jackal Scout** (fast = light + open): smaller hull on **6 visible wheels**
  (cylinders, no track skirts — instantly non-tank), open-top turret ring with twin
  thin autocannon barrels + ammo box, roll cage, rear radio antenna (motion tell:
  slight whip). Long-nosed wedge profile.
- **M-17** (the baseline tank, refined not replaced): keep current proportions; add
  side track skirts, turret bustle rack, short-cropped barrel with muzzle brace,
  front glacis chevron accent, commander hatch. This is the "average" everything else
  deviates from.
- **Mauler Siege** (long + low + braced): stretched hull (~1.35× length), **very long
  barrel with muzzle brake** extending past the hull front, recoil spade plates at
  the rear, side armor skirts to the track tops, low flat turret set back on the
  hull. Barrel visibly **elevates a few degrees when firing bombs** (turret pivot
  already exists — add elevation pivot ref). Reads: *artillery, keep it far away*.
- **Harvester** (already distinct — align it): keep the industrial silhouette, move
  its colors to the palette, add the cab-roof accent + working strobe (existing
  beacon) and make the **cargo bed visibly fill** (existing `cargoLoad` ref —
  scale/brighten by `entity.cargo.amount / capacity`).

### Aircraft — three airframes (split `createVultureObject`)
- **Wasp** (small + agile): slim tadpole fuselage ~60 % of Vulture size, **bubble
  canopy** (glossy dark sphere segment), single main rotor + high tail boom with
  T-tail, skids, chin autocannon pod. Reads: *scout/dogfighter*.
- **Vulture** (the baseline gunship, refined): keep current airframe; add stub wings
  with **visible rocket pods** (two cylinder clusters), tail fin accent, nose sensor
  ball.
- **Hammerhead** (heavy + wide): **twin side-by-side rotors on outriggers** (tandem
  silhouette is unmistakable at any zoom), wide flat body with a hammer-blunt nose,
  **external missile racks with 8 visible missiles that disappear as ammo is spent**
  (drive count from the secondary weapon's remaining salvo/ammo state exposed on the
  entity — render-side read only), twin tail fins. Reads: *strike platform*.
- All three: rotor spin + attitude tilt already work via named refs — the new
  builders must return those same refs (`mainRotor`, `tailRotor` or both outrigger
  rotors mapped into an array).

## 3. Implementation architecture

- New `src/render/units/` folder: `palette.ts` (or keep at `render/palette.ts`),
  `unitKinds.ts`, `infantryKits.ts`, `vehicleMeshes.ts`, `aircraftMeshes.ts`, each
  exporting `build<Kind>(materials) → { root, refs }` where `refs` is a typed record
  of animatable children (turretPivot, barrel, rotors, cargoLoad, antenna…).
  `unitView.addEntity` switches on `unitVisualKind(entity)` and stores `refs` in the
  per-entity record (this also completes the "no getObjectByName per frame" cleanup
  item for units).
- Geometry sharing: module-level `Map<visualKind, BufferGeometry[]>`-style caches or
  simply build each part geometry once as constants; materials come from palette +
  the existing shared lit materials. **Two teams × 10 kinds must not mean 20 material
  sets** — hull/accent materials per team (≈8 materials total), geometries shared
  across teams.
- Wrecks/death: material-swap to wreck material must keep working for every new
  builder (traverse-based — verify rotors/wheels/pods all darken).
- Fog ghost, selection rings, health bars, air shadows: unchanged APIs.

## 4. `?start=lineup` — visual QA mode (build this FIRST)

Extend the existing `?start=` handling in `main.ts`: `lineup` spawns **one of every
unit kind for both teams** in two facing rows near the player camera (no AI economy
activity, no attacks — spawn only; reuse `?start=test` scaffolding), camera jumped to
frame them. This is the reviewing surface for every change in this spec, and the
user's screenshot surface for feedback. Cheap: one function, spawns via existing
spawn functions.

## 5. Acceptance (verify in `?start=lineup`, then a real match)

1. Screenshot the lineup at close, mid, and **max zoom-out**: at max zoom every class
   is identifiable by outline alone; the two teams are unmistakable at every zoom.
2. Grayscale the mid-zoom screenshot (any tool): teams still distinguishable by hull
   value + accent luminance (colorblind proxy check).
3. Grenadier vs Rocket vs Rifle: a first-time viewer can match name→soldier without
   hovering. Same for Jackal/M-17/Mauler and Wasp/Vulture/Hammerhead.
4. Hammerhead's visible missiles deplete as it fires and restore after rearm;
   harvester bed visibly fills; Mauler barrel elevates on bomb shots; antennas sway.
5. Wreck states, fog ghosting, selection rings, health bars, possession (V) and
   rotor/attitude animation all still work on every new mesh.
6. Perf: draw calls in a 60-unit battle within +10 % of before; no `getObjectByName`
   in any per-frame path for units; geometries shared (spawning 20 M-17s adds no new
   geometry allocations after the first).
7. `npm test` green (nothing in sim changed — if a sim file changed, this spec was
   implemented wrong); `npm run build` clean; PROGRESS.md updated.

## 6. Order of work

1. `?start=lineup` QA mode → screenshot baseline.
2. `palette.ts` + team-hull materials + accent/light-bar standard applied to
   *existing* meshes (biggest read-improvement per line of code).
3. `unitKinds.ts` + infantry kits. 4. Vehicle builders. 5. Aircraft builders.
6. Mechanic tells (missile racks, cargo fill, barrel elevation, antenna sway).
7. Lineup re-screenshot vs baseline; run the acceptance list; commit per step.
