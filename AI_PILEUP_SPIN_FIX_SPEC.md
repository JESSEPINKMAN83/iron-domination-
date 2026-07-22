# AI Pile-Up, Idle Army, and Spinning Fix

## Purpose

Fix the enemy-army behavior where large groups of vehicles accumulate beside a
production building, overlap each other, spin in place, and fail to participate
in attacks.

This work must preserve deterministic simulation and multiplayer lockstep.

## Current Root Causes

### 1. Production exceeds the intended army cap

`EnemyCommander.maintainProduction()` counts completed living units but does not
include active and queued production jobs. Each producer can hold up to 10 jobs,
so multiple factories can create significantly more units than the configured
AI cap.

### 2. Most produced units never receive a strategic role

AI personalities allow only a small fixed number of active squads. Once that
limit is reached, newly produced units remain in the idle pool indefinitely.
An attacking squad is only retired when it falls below 40% strength and
retreats; reaching or destroying an objective does not complete the squad.

### 3. Produced units share the same exit and rally destination

`productionExitPlan()` chooses the first walkable exit without considering
units already occupying or reserving that location. Units produced from the
same factory therefore spawn and rally toward identical coordinates.

### 4. Separation cannot recover a dense pile

Ground separation currently skips units whose centers are exactly coincident.
It also stops applying separation after a unit receives `holdPosition`. Exact
overlaps can therefore remain unresolved forever.

### 5. Vehicle rotation snaps to unstable movement vectors

Non-player ground units immediately set body rotation from their current
velocity. In a dense group, avoidance vectors fluctuate every tick, causing
tanks to rotate sharply or continuously instead of turning naturally.

### 6. AI attacks are position orders, not persistent objective orders

The commander periodically issues an attack-move toward a target's coordinates.
It does not preserve the chosen entity as the squad objective. Reissuing the
move order clears weapon targets, and a moving or temporarily hidden target can
leave the squad without a stable mission.

## Required Solution

### A. Make production cap-aware

- Count completed units, active jobs, and queued jobs when evaluating unit caps.
- Do not queue another unit when the projected total reaches the configured cap.
- Apply the same projected-count rule to vehicles, infantry, and aircraft.
- Preserve the existing difficulty-specific caps.

### B. Give every combat unit a strategic assignment

- Replace the permanent idle pool with explicit roles: active squad, reserve,
  base defense, staging, retreating, or regrouping.
- Keep the personality-specific home guard, but give defenders spaced guard
  positions around important buildings.
- Permit new squads after an earlier squad completes, retreats, is destroyed, or
  becomes too small to remain useful.
- Merge compatible squad remnants instead of leaving isolated units idle.
- Never allow a living combat unit to remain indefinitely at a factory exit.

### C. Add a squad lifecycle

Use clear deterministic states such as:

1. `forming`: units travel to distinct staging positions.
2. `advancing`: squad follows a route toward its objective.
3. `engaging`: units establish weapon-appropriate positions and attack.
4. `regrouping`: scattered or blocked units reform near the squad center.
5. `retreating`: weakened squad returns to a safe base position.
6. `complete`: objective is gone or the squad is disbanded/reassigned.

Each squad should store a persistent objective entity ID when attacking a known
unit or building. If the objective becomes invalid, select a new visible target
or resume scouting.

### D. Reserve unique production exits

- Evaluate unit occupancy as well as navigation walkability.
- Rotate deterministically through several exit lanes and staging slots.
- Reserve a slot while a newly produced unit is moving toward it.
- If every nearby slot is occupied, search outward for another connected slot.
- Assign a new unit a unique rally point before it enters the world when
  practical.

### E. Make separation recover from overlaps

- Resolve exact center overlaps with a deterministic direction derived from
  stable entity IDs. Do not use runtime randomness.
- Continue applying gentle separation around `holdPosition`.
- Treat a held position as an anchor, not an absolute instruction that disables
  collision resolution.
- Add stronger low-speed separation when units have remained blocked for a
  sustained period.
- Ensure units cannot push through buildings, walls, water, or cliffs while
  separating.

### F. Stabilize vehicle steering

- Turn vehicle bodies toward desired movement using a capped turn rate instead
  of assigning rotation directly from velocity every tick.
- Suppress orientation changes when movement speed is nearly zero.
- Smooth rapidly alternating avoidance directions.
- Keep turret rotation independent from hull steering.
- Impact reactions may temporarily disturb a vehicle, but surviving units must
  settle upright and regain normal control promptly.

### G. Use weapon-aware engagement positions

- When attacking a building or unit, calculate distinct slots around the target
  based on each unit's usable weapon range and radius.
- Do not send every squad or every vehicle to the same center point.
- Keep direct-fire units with a clear firing line.
- Keep artillery farther back and prevent minimum-range dead zones.
- Recalculate slots only when the objective moves materially, is destroyed, or
  terrain makes the assigned position unreachable.

### H. Avoid destructive order churn

- Do not clear a valid weapon target whenever the commander refreshes an
  unchanged squad order.
- Do not rebuild identical flow fields and destinations every four seconds.
- Reissue an order only when the objective, route, formation, or tactical state
  has materially changed.
- Preserve deterministic ordering by sorting units and candidate slots by stable
  entity IDs.

## Behavioral Expectations

- A newly produced army leaves factory exits cleanly and stages in readable
  formations.
- The configured unit cap includes units currently being produced.
- Home defenders visibly guard useful positions instead of forming a heap.
- New squads can launch after earlier squads finish or fail.
- Attack squads remain focused on their selected objective until it is invalid.
- Tanks approach buildings at useful firing distances and never occupy the
  building footprint.
- Dense groups resolve overlaps without teleporting, vibrating, or spinning.
- Stationary vehicles retain a stable hull direction while turrets track foes.
- The same commands and simulation state produce identical results on every
  multiplayer client.

## Required Tests

### Production tests

- Two factories with full queues never cause projected vehicle count to exceed
  the difficulty cap.
- Destroyed units permit replacements without permanently overfilling queues.
- Infantry and aircraft apply the same projected-cap behavior.

### Spawn and staging tests

- Produce at least 30 vehicles from one factory and verify unique, collision-safe
  staging positions.
- Verify no two living units remain exactly coincident after a short grace period.
- Verify staging remains on connected, walkable terrain.

### Squad lifecycle tests

- A completed squad releases its slot so another squad can launch.
- Survivors from undersized squads are merged or reassigned.
- Reserve and home-guard units have explicit destinations away from producer
  exits.
- Destroying the current objective causes deterministic retargeting.

### Combat tests

- A mixed squad attacks the selected building rather than a nearby alternative.
- Vehicles occupy distinct weapon-aware positions around the objective.
- Units fire once aligned and in range instead of circling indefinitely.

### Movement tests

- Exact-overlap units separate deterministically.
- Held units yield enough to avoid overlap and return toward their anchors.
- A dense group near a building does not enter blocked cells.
- Vehicle hull rotation changes at a bounded rate and does not spin at low speed.

### Long-running acceptance test

Run a 20- to 30-minute deterministic simulation on every map size and map type.
Track these invariants:

- no excessive unit-cap overshoot;
- no factory-exit pile lasting longer than a short threshold;
- no combat unit unassigned for an extended period;
- no vehicle accumulating continuous full rotations while nearly stationary;
- at least one later attack wave launches after the first wave resolves;
- repeated runs finish with identical simulation hashes.

## Implementation Order

1. Add projected production counts and tests.
2. Add unique production staging slots and overlap recovery.
3. Add bounded vehicle steering.
4. Implement squad lifecycle and explicit reserve/defense roles.
5. Add persistent objectives and weapon-aware engagement slots.
6. Reduce repeated order churn.
7. Run long deterministic single-player and multiplayer simulations.

## Constraints

- Do not introduce nondeterministic randomness, wall-clock decisions, or
  frame-rate-dependent behavior into the simulation.
- Do not weaken player-issued direct attack orders or formation controls.
- Do not allow AI target selection through fog of war.
- Do not change existing unit costs, weapon damage, or difficulty balance unless
  a test demonstrates that the behavior fix requires it.
- Do not overwrite recent multiplayer, movement, combat, or visual-polish work.
- Keep changes divided into reviewable steps with focused tests after each step.

## Definition of Done

The work is complete when a hard-difficulty AI can maintain and deploy its full
army for a long match without visible factory piles, exact overlaps, idle combat
units, or spinning vehicles, while deterministic hashes and multiplayer
lockstep remain stable.
