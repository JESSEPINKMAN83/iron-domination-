# Iron Dominion Multiplayer

## Current Slice: Phase M2

This is the first friends-link 1v1 multiplayer layer. It provides:

- a lightweight WebSocket room relay server
- host/join room codes
- copyable room links with `?room=ABC123`
- player assignment: host is player 1, guest is player 2
- synchronized seed/map/difficulty/AI profile/combat-mode handoff
- lobby READY/UNREADY flow and a 3-second countdown
- lobby ping measurement and fixed match input delay selection: 4, 8, or 12 ticks
- browser-engine exchange with a warning when players use different engines
- guest-side local ownership of team 2
- AI disabled in multiplayer rooms
- deterministic command relay for RTS move/attack-move, stop, harvester orders, rally,
  structure build/place/cancel, unit queue/cancel, and primary producer selection
- realtime V-mode possession mirroring for drive/fly controls, release, and manual fire
- periodic sim-hash desync checks
- visible in-match multiplayer status/warning overlay
- pause-on-disconnect for interrupted rooms/opponents
- a short starting countdown/loading state when both players are ready

This is still an MVP. Reconnect resumes the local stream and pauses on interruptions, but full
snapshot repair/rollback is not finished yet.

Cross-browser play can desync because browser engines are not guaranteed to produce bit-identical
floating-point results. The lobby warns when engines differ. The planned M5 fix is a deterministic
math layer in `src/sim/math.ts` for table/fixed-point sin/cos/atan2/sqrt before claiming reliable
Chrome-to-Safari/Firefox play.

## Run Locally

```sh
npm run dev:multiplayer
```

This starts:

- Vite app: `http://127.0.0.1:5173`
- Multiplayer relay: `http://127.0.0.1:8787`

Open two browser windows:

1. In window A, use the setup screen Multiplayer section and click `HOST ROOM`.
2. Copy the room link or room code.
3. In window B, open the link or enter the same server URL and room code, then click `JOIN ROOM`.
4. Both players click `READY`.
5. The room enters a short starting countdown, then both clients
   receive the same start payload and boot.
6. Host controls the green army; guest controls the red army.
7. In-match V-mode controls are mirrored to the opponent as realtime possession commands.

## Same Network Test

Run this on the host machine:

```sh
npm run dev:multiplayer
```

Find the host LAN IP, then use:

- App URL: `http://HOST_IP:5173`
- Multiplayer server URL in the setup screen: `http://HOST_IP:8787`

## Public Deployment Note

Netlify can host the static client, but not this long-running multiplayer relay. For public
multiplayer, deploy `server/multiplayer-server.mjs` separately to a Node host such as Render,
Fly.io, Railway, or a small VPS, then enter that server URL in the setup screen.

For a deploy-ready setup:

- Set `VITE_MULTIPLAYER_SERVER_URL=https://YOUR_RELAY_HOST` in Netlify so the setup screen
  defaults to the public relay.
- Set `ALLOWED_ORIGINS=https://YOUR_NETLIFY_SITE.netlify.app` on the relay host to restrict
  browser access to the game site.
- Keep `PORT` managed by the relay host; locally it defaults to `8787`.
- Player IDs are remembered per relay+room in local storage, so rejoining the same room can
  reclaim the same player slot while the room is still alive.

## Next Multiplayer Slice

Phase 9D should move from MVP relay play to production-grade online play:

- deploy the relay to a public Node host
- add desync snapshot capture and optional state recovery
- add lobby list/private room UX
- start separating realtime possession state from authoritative gameplay state if public latency
  proves too high
