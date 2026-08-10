# Multiplayer Stability and Four-Player Office Test

## Goal

Run one four-player office match while all four browsers stay on the same simulation timeline and the existing Wix Headless telemetry appears in the dashboard under one shared `matchId`.

## Findings from the stability audit

1. The relay connection and reconnect path already had real WebSocket integration coverage.
2. The client called the system “lockstep” but advanced from each browser's animation clock without waiting for a no-input/input packet from every connected player. A faster computer could therefore pass a command's scheduled tick before the command arrived.
3. Desync hashes omitted credits, construction, production queues, rally points, and several control fields. Two clients could disagree about visible progress without the recovery path noticing.
4. The network tick driver authorized a batch of up to eight ticks from one readiness check, which would bypass a per-tick barrier.

## Implemented stabilization

- Every player closes each future simulation tick with a `tick-ready` packet.
- A tick advances only after packets from every currently connected player are present.
- Commands are sent before that player's `tick-ready` packet for the same scheduled tick; WebSocket ordering makes the packet a deterministic end-of-tick marker.
- The network driver runs at most one simulation tick per render frame so readiness is rechecked between ticks.
- Match hashes now include economy, building construction, producer queues, rally points, player-control inputs, team, death timer, and missing mover/AI fields.
- Snapshot recovery compares the same full match hash and resets/primes the tick barrier before play resumes.
- Automated coverage now includes two peers with delayed delivery and unequal frame rates plus four real WebSocket clients relaying tick packets.

## Automated release gate

Run before an office build:

```sh
npm test
npm run build
```

The required multiplayer checks are:

- `src/net/lockstep.test.ts`: delayed two-peer transport, faster/slower clocks, deterministic convergence.
- `src/net/commands.test.ts`: command ownership, late-command recovery, snapshot acknowledgement, reconnect pause/resume.
- `server/multiplayer-server.test.ts`: four-player lobby/start and all-to-all `tick-ready` relay.
- `src/sim/hash.test.ts`: simulation/economy hash sensitivity.
- `src/sim/serialize.test.ts`: snapshot round trip and continued deterministic advancement.

## Four-player office test

### Preparation

1. Use four current Chrome/Chromium installations. Cross-engine deterministic math is still a separate hardening phase.
2. Keep all laptops on power and disable sleep for the test.
3. Deploy the game and relay from the same commit. Do not mix an older cached client with the new tick-packet protocol.
4. Confirm the relay `/health` endpoint returns `{ ok: true, transport: "websocket" }`.
5. Confirm one browser page load creates a `session-start` row in Wix before inviting the remaining players.

### Match flow

1. Host a room with four controllers and assign either 2v2 or four armies.
2. Join the same room from the other three computers.
3. Verify all four players show connected, use the same browser engine, and become ready.
4. Start the match and record the room code and shared match ID.
5. For at least 15 minutes, have every player issue movement and combat orders. Include construction, unit production, rally changes, possessed movement/fire, and one intentional Wi-Fi interruption/reconnect.
6. The pass condition is that no machine shows different credits, queues, buildings, deaths, or match outcome after all clients reach the same tick. A temporary “Waiting for player input” state is acceptable; silent divergence is not.

### Wix Headless dashboard checks

The game already emits `match-start`, two-minute `heartbeat`, and `match-end` through `/api/wix-submit`. During the match verify:

- four `match-start` rows share one `matchId` and room code;
- four distinct `playerId` values are present;
- heartbeat rows continue to appear for active players;
- `multiplayer` is true and `playerTeam`, `playerSide`, `pingMs`, browser engine, FPS, and elapsed time are populated;
- the final four `match-end` rows agree on the shared match and contain the expected victory/defeat split.

## Follow-up phases

1. Add network-health telemetry (`waiting`, reconnect, recovery, desync count, tick lag) after the office test establishes a baseline.
2. Replace transcendental simulation math with a deterministic math layer before supporting mixed Chrome/Safari/Firefox matches.
3. If the relay is moved onto Cloudflare, use one Durable Object per room, persist authoritative room/recovery state, use the WebSocket Hibernation API, and add runtime-level integration tests before switching production traffic.
4. Build the invitation/event workflow only after the 15-minute four-player gate passes twice without unrecovered divergence.
