# Iron Dominion Multiplayer

## Current Slice: Phase 9C

This is the hardened playable multiplayer MVP layer. It provides:

- a lightweight room relay server
- host/join room codes
- player assignment: host is player 1, guest is player 2
- synchronized seed/difficulty/AI profile handoff
- guest-side local ownership of team 2
- AI disabled in multiplayer rooms
- deterministic command relay for RTS move/attack-move, stop, harvester orders, rally,
  structure build/place/cancel, unit queue/cancel, and primary producer selection
- realtime V-mode possession mirroring for drive/fly controls, release, and manual fire
- periodic sim-hash desync checks
- visible in-match multiplayer status/warning overlay
- pause-on-disconnect for interrupted rooms/opponents
- a short starting countdown/loading state when the second player joins

This is still an MVP. Reconnect resumes the local stream and pauses on interruptions, but full
snapshot repair/rollback is not finished yet.

## Run Locally

```sh
npm run dev:multiplayer
```

This starts:

- Vite app: `http://127.0.0.1:5173`
- Multiplayer relay: `http://127.0.0.1:8787`

Open two browser windows:

1. In window A, use the setup screen Multiplayer section and click `HOST ROOM`.
2. Copy the room code.
3. In window B, enter the same server URL and room code, then click `JOIN ROOM`.
4. When the second player joins, the room enters a short starting countdown, then both clients
   receive the same start payload and boot.
5. Host controls the green army; guest controls the red army.
6. In-match V-mode controls are mirrored to the opponent as realtime possession commands.

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
- add lobby list/private room UX and match-ready confirmation
- start separating realtime possession state from authoritative gameplay state if public latency
  proves too high
