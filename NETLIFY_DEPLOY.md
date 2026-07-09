# Iron Dominion Netlify Deploy

## Manual drag-and-drop

1. Run `npm install` once if dependencies are missing.
2. Run `npm run build`.
3. Drag the generated `dist/` folder into Netlify Drop.

## Git-based Netlify deploy

Use the project root. `netlify.toml` tells Netlify to run:

- Build command: `npm run build`
- Publish directory: `dist`

The default public URL opens the skirmish setup screen. QA modes remain hidden behind URL
params such as `?start=lineup` and `?start=test`.

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

1. Deploy the relay as a Node service:

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
Once you share the link more broadly, set it to the real Netlify domain.

3. On Netlify, set this environment variable before building:

```sh
VITE_MULTIPLAYER_SERVER_URL=https://YOUR_RELAY_HOST
```

4. Redeploy Netlify. The Multiplayer server input will now default to the public relay URL.

5. Open the Netlify link in two browsers or two computers, host a room, share the copied room
   link/code, join, then have both players click `READY`.

The relay serves WebSocket traffic at `/ws`; make sure the host you choose supports WebSocket
upgrades. The client can accept either `https://YOUR_RELAY_HOST` or `http://HOST:PORT` in the setup
screen and will derive the matching `wss://`/`ws://` endpoint automatically.

If the relay URL changes later, either update `VITE_MULTIPLAYER_SERVER_URL` and redeploy, or paste
the new relay URL into the Multiplayer server input. The input is stored locally per browser.
