# Unit Roster, Roles & Combat Economy — Spec

> **For the coding agent.** Today the three units per category are near-clones with
> different price tags. This spec turns them into a real roster: every unit has a
> distinct battlefield role, an explicit counter, a special capability, and a price
> that buys *power with a weakness* — never a strict upgrade. Includes the missing
> **anti-air infantry with lock-on missiles**. Keep all standing invariants
> (deterministic sim, no three.js in `/src/sim`, vision-capped auto-engagement,
> possessed units obey identical rules).

## 1. Design laws (apply to every change)

1. **Counters over upgrades.** Cost buys role-power, not raw efficiency. The $1250
   aircraft must die embarrassingly to $240 rocket teams it can't shoot back at.
   Rock-paper-scissors: swarm infantry ⟶ beaten by splash · armor ⟶ beaten by
   rockets/air · air ⟶ beaten by dedicated AA · AA ⟶ beaten by ground assault.
2. **DPS-per-credit stays roughly flat** (±25 %) across the roster *in each unit's
   favored matchup*; expensive units buy range, burst, durability, and reach (air) —
   not more damage per dollar. Cheap units win per-credit in their niche; that's why
   mixed armies beat single-unit spam.
3. **Every difference must be visible**: distinct silhouette, distinct weapon VFX,
   and stat pips on the build card. If a player can't *see* it, it doesn't exist.
4. **Air combat becomes explicit.** Delete the hidden `AIR_DIRECT/SPLASH/RANGE`
   multiplier tables in `combat.ts`. `ArmorClass` gains `'air'`; every `WeaponDef`
   gets a `vs.air` value, an optional `airRange`, and `canTargetAir: boolean`.
   Aircraft entities get `armor: 'air'`. One source of truth in `content/phase4.ts`.

## 2. The roster (9 units — final stats)

### Infantry (Barracks)

| | **Rifle Team** | **Grenadier** | **Rocket Team** |
|---|---|---|---|
| Cost / build | $100 / 4 s | $160 / 5 s | $240 / 6 s |
| HP / speed / vision | 45 / 12 / 78 | 52 / 11 / 82 | 50 / 10 / 94 |
| Role | anti-infantry screen, cheap scout | cheap siege: buildings & clumps | **dedicated anti-armor + ANTI-AIR** |
| Primary | rifle (hitscan) | grenade — **arcing projectile**, speed 26, splash 3.6, **min range 10** | AT rocket — flat projectile, speed 70 |
| Secondary | — | — | **`aaMissile` — homing lock-on vs aircraft** (§3) |
| Strong vs | infantry | buildings (vs.building → 0.45), grouped infantry | heavy armor, **all aircraft** |
| Helpless vs | armor, air | air, anything at min range | infantry (vs.infantry 0.30), fast harass |
| Visual identity | rifle rig (current) | bulky vest, stubby launcher, lobbed tracer arc | shoulder tube + backpack, smoke-trail missiles |

### Vehicles (Factory)

| | **Jackal Scout** | **M-17 Tank** | **Mauler Siege** |
|---|---|---|---|
| Cost / build | $360 / 7 s | $550 / 9 s | $820 / 12 s |
| HP / speed / vision | 72 / 24 / 142 | 100 / 18 / 120 | 138 / 13 / 132 |
| Role | harass, scouting, anti-infantry escort, *soft* AA screen | line workhorse, all-rounder | long-range artillery vs armor/buildings |
| Weapons | autocannon (`canTargetAir`, vs.air 0.28 — deterrent, not an answer) | cannon + short siege bomb (current) | heavyCannon **+ min range 26** + long bomb (range 176) |
| Strong vs | infantry, light, chasing Wasps away | balanced | buildings, heavy, static defenses |
| Helpless vs | heavy armor, buildings | dedicated counters | **anything inside 26 m**, all aircraft |

### Aircraft (Helipad)

| | **Wasp Scout** | **Vulture** | **Hammerhead** |
|---|---|---|---|
| Cost / build | $650 / 9 s | $950 / 12 s | $1250 / 15 s |
| HP / speed / vision | 90 / 60 / 170 | 160 / 46 / 150 | 230 / 34 / 140 |
| Role | recon + **air superiority** (the anti-Vulture) | gunship generalist | heavy strike platform vs buildings/armor |
| Weapons | autocannon, `canTargetAir`, vs.air 0.9 | rocketPod + agMissile ×4 ammo, rearm at pad | **agMissile ×8 ripple** + no gun — pure ordnance |
| Strong vs | other aircraft, infantry | vehicles, mixed ground | buildings (one sortie ≈ one refinery), heavy |
| Helpless vs | AA of all kinds, armor | massed AA | **cannot shoot air at all**; rocket teams eat it |

The intended metagame sentence — put it in code comments and the F1 card:
*"Rifles screen Grenadiers; Rockets guard the sky; Jackals scout for M-17s; Maulers
crack bases behind them; Wasps hunt Vultures; Hammerheads end sieges — if the
Rocket Teams are dead."*

## 3. New mechanic: homing missiles (the AA soldier's weapon)

Extend the projectile system (`sim.projectiles`) — bombs stay location-targeted;
missiles get a **homing** variant:

```ts
interface Projectile {
  // …existing…
  kind: 'bomb' | 'aaMissile' | 'agMissile' | 'grenade' | 'atRocket';
  x: number; z: number; y: number;      // live position (homing needs real state)
  homing?: { targetId: number; speed: number; fizzleRange: number };
}
```

- **Rule of thumb: ground-targeted ordnance chases a *location* (dodge by moving);
  air-targeted missiles chase the *entity* (dodge by breaking the tether).**
- `aaMissile` (Rocket Team + existing aa-tower — port the tower to this system):
  each tick move `speed·dt` (110 m/s) toward the target's live x/z/y. Impact within
  2.5 m → full damage + small air-only splash. **Fizzle**: if the target gets
  farther than `fizzleRange` (160 m) from the *launch point*, or dies, the missile
  detonates harmlessly — that's the pilot's counterplay: turn and burn out of the
  envelope. Deterministic: pure pursuit, no randomness, no turn-rate solver.
- `grenade` / `atRocket`: location-targeted like bombs but with their own speed/arc
  (`trajectory: 'arc'` for grenades, flat for rockets) — grenades become visibly
  lobbed and dodgeable; rockets are fast enough to rarely miss stationary armor.
- Events: `<kind>` on launch (with duration/trajectory), `<kind>-impact` on hit —
  same contract `combatView` already renders; add a thin smoke trail for missiles
  and a lock-warning flash on the HUD when *your possessed aircraft* is tracked.
- `hashSim`: include live projectile positions (round ×100).

## 4. V-mode mapping (possession must showcase each role)

| Unit | Left click | Right click |
|---|---|---|
| Rifle Team | rifle burst | — |
| Grenadier | lobbed grenade — **pitch aims distance** (reuse the tank-bomb pitch mechanic) | — |
| Rocket Team | dumbfire AT rocket | **hold on an aircraft ≈0.6 s to lock (reticle closes + tone), release = homing missile** |
| Jackal / M-17 / Mauler | main gun (existing gating) | bomb (existing); Mauler shows its min-range ring |
| Wasp | autocannon with a **lead reticle** vs moving aircraft | — |
| Vulture | rocket pods (existing) | AG missile (existing ammo loop) |
| Hammerhead | single AG missile at locked ground point | **ripple-fire remaining rack** (long cooldown) |

## 5. Economy discipline (tune to these, don't wing it)

Reference DPS in favored matchup (damage ÷ cooldown × vs): Rifle→infantry ≈ 15.3;
Grenadier→building target ≈ 6.5 (+splash); RocketTeam→heavy ≈ 11.5, →air ≈ 15 (salvo
cycle); Jackal→infantry ≈ 52; M-17→heavy ≈ 15.2; Mauler→building ≈ 7 (+bomb);
Wasp→air ≈ 45; Vulture→vehicles ≈ 65 burst; Hammerhead→building ≈ 11.3/missile ×8.
**Golden tests** (integration, deterministic): assert TTK windows —
- 2 Rocket Teams kill an M-17 in 8–14 s (unscreened); an M-17 kills a Rocket Team in ≤4 s at range.
- 3 Rocket Teams delete a Vulture in ≤2 salvo cycles; a Vulture never kills a Rocket Team hiding among 4 Rifle Teams before losing half HP.
- 1 Wasp beats 1 Vulture in the air; loses to 2 ground AA missiles.
- Mauler outranges guard-tower and wins alone; dies to 3 Rifle Teams inside min range.
- Hammerhead kills a refinery in one 8-missile sortie ±1 missile.

## 6. UI: make the differences legible

- Build cards get **stat pips**: four micro-rows `INF ▮▮▮ · VEH ▮▮ · BLD ▮ · AIR —`
  (0–3 filled, derived from the vs-matrix at build time, never hand-maintained) plus
  a 3–5 word role caption ("Anti-air missiles", "Base breaker").
- Selected-unit strip shows weapon names + range; Mauler selection draws its
  min-range circle; Rocket Team shows an AA-range circle when air is on the map.
- F1 gains a one-screen counters cheat-sheet.

## 7. AI commander

- Squad composition by ratio, per personality (balanced: 4 line tanks + 2 rocket
  teams + 1 jackal; rusher: jackals + rifles early; turtle: +grenadiers, +AA).
- Reactive AA rule (mirror of the aa-tower rule): once the AI's vision has *seen* an
  enemy aircraft, its next squads include ≥2 Rocket Teams and it queues an extra
  aa-tower. Hard difficulty escorts Hammerhead strikes with Wasps.
- AI never buys a unit whose counter it just watched wipe the previous squad twice
  in a row (track last-squad cause-of-death by armor class — one small heuristic,
  big perceived intelligence).

## 8. Order of work

1. `phase4.ts`: add `'air'` armor class + `vs.air`/`airRange`/`canTargetAir`; delete
   the `AIR_*` tables in `combat.ts`; aircraft get `armor:'air'`. Retune matrix per §2.
2. Projectile rework (§3) + combatView trails + tests (homing determinism, fizzle).
3. Roster stats + Rocket Team dual weapon + Mauler min range + Grenadier arc.
4. V-mode mappings (§4) incl. AA lock loop + lock-warning HUD.
5. Stat pips + captions + range circles (§6). 6. AI composition (§7).
7. Golden TTK tests (§5); all existing tests green; update `PROGRESS.md`.
- Soldier visual variants: reuse the `soldier.ts` rig with per-kind gear swaps
  (launcher tube, backpack, vest bulk) — 30 lines each, not new rigs.
- Everything data-driven from `content/` — zero balance numbers inline in systems.
