# Multiplayer Online — Roadmap & Architecture Spec

> **For the coding agent.** Prerequisite: `NETCODE_CRITICAL_FIXES_SPEC.md` is fully
> done (economy in the hash, input-based possession, tick barrier, localTeamId).
> This spec turns the corrected lockstep core into a playable online 1v1. Work the
> phases in order; each phase ends playable and committed. The architecture is
> **deterministic lockstep**: every client runs the full sim; only player commands
> cross the wire; `hashSim` is the referee. The AI commander stays deterministic and
> runs identically on every client — it must never read anything outside sim state.

## Phase M1 — Decouple the sim from the browser frame

`engine/loop.ts` hard-wires sim advancement to `requestAnimationFrame` + wall-clock
accumulator. Lockstep needs the network layer to decide when ticks run.

- Split `GameLoop` into: a render loop (rAF, interpolation alpha, unchanged feel)
  and a **tick driver interface**: single-player uses the existing accumulator;
  networked play uses the LockstepRuntime barrier (advance 0..N ticks per frame as
  packets allow; stall cleanly).
- The sim tick body (`commander.step → stepEconomy → stepSim → stepCombat → vision`)
  moves into one `advanceTick(match)` function callable by either driver — this also
  finally extracts match bootstrap from `main.ts` (`match/createMatch.ts`, long
  overdue per OPUS_CLEANUP_PLAN #26).
- Keep-up rule: if a peer falls behind (tab throttled), it may run several sim ticks
  per frame to catch up; cap at ~8/frame, stall rendering interpolation gracefully.

## Phase M2 — Transport + lobby (friends-link 1v1)

- **Server**: one small Node WebSocket relay (~200 lines, no game logic): rooms keyed
  by 6-char code, max 2 players + broadcast, ping measurement, drop detection.
  Plain `ws` package; deploy target Fly.io/Railway/Render free tier. (Colyseus is
  acceptable if session scaffolding already leans that way — but a dumb relay is
  easier to reason about and debug; the game logic must not live on the server.)
- Keep the existing transport abstraction (in-memory fake for tests, WebSocket for
  production) — the two-peer vitest harness from the fixes spec must keep passing
  against the same interface.
- **Match flow**: Host clicks MULTIPLAYER on the setup screen → gets room code +
  copyable link (`?room=ABC123`) → guest opens link → lobby shows both players +
  ping → host picks seed/settings (guest sees them live) → both READY → 3-2-1 →
  match starts with agreed `{ seed, settings, playerTeams, inputDelay }`.
- **Browser-engine guard** (cross-engine float math is not bit-identical; the sim
  makes ~122 transcendental calls): exchange engine (Chromium/Gecko/WebKit) in the
  lobby; if they differ, show a clear warning "different browsers — desync likely,
  best played on the same browser". Don't block, warn. A deterministic math layer
  (fixed-point or table-based sin/atan2 behind `sim/math.ts`) is the real fix —
  document it as M5, do not attempt it in this phase.
- Input delay: fixed 8 ticks to start; measure ping in lobby and pick 4/8/12
  automatically at match start (never adapt mid-match in this phase).

## Phase M3 — In-match resilience

- **Desync recovery**: on hash mismatch, pause both, host serializes the full match
  state → guest loads it → resume. This requires **match-state serialization**
  (entities incl. all components, projectiles, economies, visibility grids or their
  re-derivation, RNG/tick counters, nav dynamic blockers) with a version field —
  build it as `sim/serialize.ts` with a round-trip test (`serialize → load →
  hashSim identical, then run 100 ticks on both → still identical`). **This same
  module is the save/load feature** (Phase 8 of the build plan) — wire a
  single-player Save/Load menu item in the same phase since it's 90 % shared work.
- **Reconnect**: relay keeps the room alive 60 s after a socket drop; commands
  buffer host-side; on rejoin, snapshot + buffered commands replay. Show
  "connection lost — waiting" to the remaining player with a forfeit-win button.
- **Leaving**: explicit quit = victory banner for the opponent.

## Phase M4 — Multiplayer-aware game rules & UX

- Victory/defeat per player (existing team-based check generalizes); spectate-after-
  death optional (keep rendering, disable command sink).
- Disable/hide in networked matches: `?debug=armies`, test/sandbox starts, the AI
  commander for player-controlled teams (2 humans = no AI; 1v1 vs AI stays
  single-player). Keep pause = both-must-agree (pause command).
- HUD: ping + "behind N ticks" indicator (small, top-left near FPS); desync banner
  already exists from the fixes spec.
- Chat: minimal — 6 canned taunts/messages (Enter → numbers). Free text optional.

## Phase M5 — Hardening (post-first-release)

- Deterministic math layer in `sim/math.ts` (table-based sin/cos/atan2 + integer
  sqrt) to remove the same-browser restriction. Migrate heightfield first (it runs
  from the seed), then movement/combat. Gate behind a match-settings flag; verify
  with cross-engine hash tests (run the two-peer harness in node with different
  --jitless/engine configs as a proxy, plus manual Chrome↔Safari matches).
- Adaptive input delay; command-rate limiting; room passwords.
- Trust stance (document in README): lockstep 1v1 between friends — each client sees
  the whole sim (maphack is technically possible), hash-compare catches modified
  sims. Server-authoritative play is out of scope.

## Non-negotiable invariants (check every phase against these)

1. Sim state changes ONLY via `advanceTick` systems or command application at the
   scheduled tick. No `issueRealtime`-style unordered writes, ever.
2. Everything a command needs is IN the command (resolved producer ids, target
   coords) — never resolved from local-only UI state at apply time.
3. The AI commander, pathfinding, and combat read only sim state — no wall clock,
   no `Math.random`, no render feedback.
4. The two-peer vitest harness (latency, jitter, reorder, stall) stays green in CI
   for every phase; extend it with each new command type.
5. Fog honesty per player: each client renders only its `localTeamId`'s visibility.
   The sim keeps computing all teams' grids (needed for AI + determinism).

## Suggested effort framing

M1+M2 ≈ the "play with a friend via link" milestone (the 2–3 week estimate).
M3 turns it from demo to dependable (and delivers save/load for free).
M4 is small. M5 is open-ended — only start it if cross-browser play matters.
