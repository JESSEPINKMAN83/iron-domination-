# Iron Dominion Netlify Deploy

## Manual drag-and-drop

1. Run `npm install` once if dependencies are missing.
2. Run `npm run build`.
3. Drag the generated `dist/` folder into Netlify Drop.

## Git-based Netlify deploy

Use the project root. `netlify.toml` tells Netlify to run:

- Build command: `npm run build`
- Publish directory: `dist`

The default public URL opens the Iron Dominion landing page. **Start a new game** opens the
skirmish setup as an overlay above the landing page. QA modes remain hidden behind URL
params such as `?start=lineup` and `?start=test`.

## Beta signups

The landing page requires a name and email before opening the game setup. An optional,
unchecked consent box records whether the player wants official-release updates.

After deploying, signups are available in **Netlify → Forms → iron-dominion-beta**. Each
submission includes `name`, `email`, and `release-updates` (`yes` or `no`). Configure email
notifications or export a CSV from that Forms screen. Netlify Forms only captures submissions
on the deployed Netlify site; local preview submissions are not stored in Netlify.

After a successful signup, the browser stores an anonymous beta-access flag. Returning players
on that browser see only the **Play game** button and are not asked to submit again. The flag does
not contain their name or email. Private browsing, cleared site data, a different browser/device,
or moving to another domain will require a new signup.

## Player feedback

The persistent **Feedback** button is available on the landing page, setup screen, and during a
match. Submitted field reports appear under **Netlify → Forms → iron-dominion-game-feedback** with
the player's name, 1–5 rating, written game feedback, and page URL. This clean form has no email
field or honeypot and is registered as a new form on the next deploy.

## Multiplayer

The Netlify build can host the browser client, including the Multiplayer setup UI. The live
WebSocket room relay is a separate Node process and cannot run on plain Netlify static hosting.

For local multiplayer testing, run:

```sh
npm run dev:multiplayer
```

For public multiplayer, deploy `server/multiplayer-server.mjs` to a Node host such as Render,
Fly.io, Railway, or a VPS.

### Public multiplayer deploy checklist

1. Deploy the relay as a Node service. On Render, connect the repository and apply the included
   `render.yaml` Blueprint. On another Node host, use:

```sh
npm install
npm run multiplayer
```

Most Node hosts will provide a `PORT` environment variable automatically. The relay reads it.

2. On the relay host, set:

```sh
ALLOWED_ORIGINS=https://YOUR_NETLIFY_SITE.netlify.app
```

For a first private test, you can omit `ALLOWED_ORIGINS`; the relay will allow all origins.
Before sharing the link, set it to the exact Netlify origin. Multiple allowed origins can be
comma-separated.

3. On Netlify, set this environment variable before building:

```sh
VITE_MULTIPLAYER_SERVER_URL=https://YOUR_RELAY_HOST
```

4. Redeploy Netlify. The Multiplayer server input will now default to the public relay URL.

5. Open the Netlify link in two browsers or two computers, host a room, share the copied room
   link/code, and join. The guest waits in the room lobby; only the host can click `START MATCH`.

6. Test recovery once before publishing: during a match, briefly disable one browser's network.
   Both simulations should pause, the disconnected browser should automatically reconnect within
   60 seconds, and play should resume after the host snapshot is acknowledged.

The relay serves WebSocket traffic at `/ws`; make sure the host you choose supports WebSocket
upgrades. The client can accept either `https://YOUR_RELAY_HOST` or `http://HOST:PORT` in the setup
screen and will derive the matching `wss://`/`ws://` endpoint automatically.

If the relay URL changes later, either update `VITE_MULTIPLAYER_SERVER_URL` and redeploy, or paste
the new relay URL into the Multiplayer server input. The input is stored locally per browser.

This repository includes `.env.production` with the current public Render relay, so local
`npm run build` output is ready for the configured Netlify/Render deployment by default.

### Relay production settings

- `RECONNECT_GRACE_MS=60000`: time allowed to reclaim a disconnected player slot.
- `MAX_COMMANDS_PER_SECOND=180`: per-socket command ceiling; high enough for V-mode input.
- `EXPOSE_ROOMS=false`: keeps `/rooms` unavailable so active room codes are not publicly listed.
- `PORT`: supplied by the Node host; defaults to `8787` locally.

The `/health` endpoint is intended for the host's health check. Free hosting plans that sleep can
make the first room connection slow; use an always-on instance for a public playtest.
