# Netcode Critical Fixes — Do This BEFORE Any More Multiplayer Work

> **For the coding agent.** An audit (2026-07-09) found 5 correctness bugs in the
> lockstep foundation (`net/commands.ts` + call sites). They must be fixed before any
> feature is built on top — every one of them causes silent desyncs or wrong fog in a
> real 2-player match. Work the fixes **in order, one commit each**, tests green after
> each. Baseline: 83 tests green.
>
> **Coordination note:** another agent is currently implementing
> `SOLDIER_VISUAL_UPGRADE_SPEC.md` in `render/soldier.ts` + `render/unitView.ts`.
> Fixes 1–4 touch only sim/net/modes files — safe in parallel. Fix 5 touches render
> views: do it LAST, after the soldier work lands, to avoid conflicts.

## Fix 1 — `hashSim` must cover the economy (desyncs are currently invisible)

`sim/world.ts` (~line 984): the hash covers transforms/combat/harvesters but **never
reads building, producer, or EconomyState** — credits, build progress, production
queues, rally points are all unhashed. The `sim-hash` desync check
(`net/commands.ts` ~176) can't see half the game.

- Hash per building entity: `building.buildProgress` (round ×1000), `building.complete`
  (0/1), and for producers: `active?.remaining` (round ×1000), active kind code, queue
  length + each queued kind code, `rally.x/z` (round ×10).
- Hash per-mover fields still missing: `faceYaw` (round ×10000), `attackMove` (0/1),
  `defenseAlert` (targetId + `ttl` ×1000), `aiCombat.nextAcquireTick` if present.
- `EconomyState` lives outside the world — add `hashEconomy(economy)` (credits
  rounded, incomeMultiplier ×1000, `structureLine` kind code + remaining ×1000,
  `readyStructure` code, `harvesterReplacementTimers` entries) and fold both teams'
  economy hashes into the exchanged match hash (`combinedHash = mix(hashSim, hashEconomy(p1), hashEconomy(p2))`).
  Do NOT hash `primaryProducerIds` / `selectedStructure` / `placement` — those are
  local UI state (see Fix 3 note on producer routing).
- Extend `src/sim/hash.test.ts` with sensitivity tests for EVERY new field (mutate
  one instance → hash changes). Use stable numeric codes for enum/kind strings —
  never `.length`, never raw strings.

## Fix 2 — Possession must send INPUTS, not positions

`net/commands.ts` (~210): `possess-control` broadcasts the possessing client's
locally computed `transform.x/z/y/rot` + `velocity` and applies them on arrival via
`issueRealtime` — out of tick order, client-authoritative, guaranteed desync.

- Replace with a tick-scheduled `possess-input` command:
  `{ tick, entityId, throttle, turn, strafe, climb, aimYaw, aimPitch, boost }`
  (whatever `PlayerControlled` consumes — nothing derived, nothing positional).
- Applied like every other command at its scheduled tick, writing ONLY into
  `entity.playerControlled`; both peers then derive identical physics in `stepSim`.
- Delete the transform/velocity injection path and `issueRealtime` for possession
  (audit `issueRealtime` for other users; goal is zero unordered sim writes).
- Local feel: the possessing player's own inputs also go through the same delayed
  command queue (8 ticks ≈ 266 ms). To hide the delay for camera only, the chase
  camera may read raw inputs immediately — but the SIM must only see the scheduled
  command. Do not add client-side prediction of the unit itself in this pass.
- `modes/firstPersonController.ts` (~203): `simTick` currently writes
  `possessed.playerControlled` directly every tick — route through the command sink
  when networked (single-player fallback stays direct, same pattern as
  `rtsController`'s `?? issueX` fallbacks).

## Fix 3 — Network the missing commands (possessed fire, wingmen, squad-follow)

`modes/firstPersonController.ts`: `manualFireAt` at ~378 (and the wingman fire at
~382), squad follow-me `issueMoveOrder` at ~614, and `playerControlled` set/delete at
~272/549/557 all mutate the local sim directly and are never sent to the other peer.

- Add command types (or extend existing ones): `possess-fire { tick, entityId, slot,
  targetX, targetZ, targetY? }`, `wingman-fire { ... }` (or fold into possess-fire
  with a list), `squad-follow { tick, entityIds, targetX, targetZ }`, and make
  possess/release themselves tick-ordered commands.
- Also: `queue-unit` must carry the **resolved producer entity id** chosen by the
  issuing client (primary-producer preference is local UI — Fix 1 excludes it from
  the hash, so routing must not depend on it at apply time).
- Rule to enforce everywhere and then assert in review: **in a networked match, the
  only writers to sim state are (a) `stepSim/stepCombat/stepEconomy/commander` and
  (b) command application at its scheduled tick.** Selection (`selectable.selected`)
  is the one allowed local exception (unhashed, cosmetic).

## Fix 4 — Real lockstep: tick barrier + late-command rejection

`net/commands.ts` (~108): the sim advances on wall-clock regardless of whether the
remote peer's inputs for the current tick have arrived; late commands are applied at
whatever tick the sim happens to be on.

- Every peer sends one **tick packet per sim tick** for `T + INPUT_DELAY_TICKS`
  (commands or an explicit empty packet — the packet itself is the "I'm alive,
  nothing this tick" signal).
- The sim may execute tick T **only when tick-T packets from all peers are present**.
  Otherwise the loop stalls the sim (render keeps running on the last state; after
  ~500 ms show a "waiting for player…" indicator; hide on resume).
- Within a tick, apply commands in deterministic order: sort by (playerIndex,
  per-player sequence number). Reject duplicates and any packet for a tick < the
  next unexecuted tick (log loudly — after the barrier exists this indicates a bug).
- Exchange `combinedHash` (Fix 1) every 30 ticks piggybacked on a tick packet; on
  mismatch pause both sims and show a desync banner with the tick number (recovery
  is Phase B in `MULTIPLAYER_SPEC.md` — for now, honest failure beats silent drift).

## Fix 5 — `localTeamId` in the render views (do LAST — see coordination note)

Views hardcode team 1 as "the local player" in 6 places; playing as team 2 reveals
enemies through fog and fogs your own army:
- `render/unitView.ts` ~335, ~579 · `render/buildingView.ts` ~176
- `render/combatView.ts` ~102, ~500 · `render/economyFxView.ts` ~74

Pass `localTeamId` into each view's constructor (main already has it — the sidebar
and controllers take it) and replace every `=== 1` / `!== 1` literal. Grep for
`team?.id === 1|team?.id !== 1|sourceTeamId === 1|sourceTeamId !== 1` under
`src/render` afterward — must be zero hits.

## Verification (all of it, before calling this spec done)

1. **Two-peer harness test** (new — this is the core deliverable):
   `src/net/lockstep.test.ts` — create TWO full sims from the same seed, connect two
   `LockstepRuntime`s through an in-memory fake transport with configurable latency/
   jitter/reorder. Script ~2 sim-minutes of commands from both sides (moves, queue,
   place, possess-input with fire). Assert `combinedHash` equal every 30 ticks.
   Then rerun with latency > input delay and assert the barrier **stalls without
   desyncing** (hashes still equal afterward), and that a reordered packet doesn't
   change the outcome.
2. Hash sensitivity tests for every Fix-1 field.
3. All existing tests green; `npm run build` clean.
4. Manual: two browser tabs (same browser), full match — build, fight, possess a
   tank AND an aircraft in both tabs at different times, kill buildings. No desync
   banner for a 10-minute match; team-2 tab shows correct fog everywhere.
