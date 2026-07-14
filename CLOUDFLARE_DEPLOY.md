# Iron Dominion Cloudflare deployment

## Build

Run:

```sh
npm run build:cloudflare
```

Upload the generated `dist-cloudflare/` folder to Cloudflare Workers using Direct Upload.

## Automatic deployment from GitHub

The existing Cloudflare Worker is configured in `wrangler.jsonc`. In Cloudflare, open the
`throbbing-truth-af19` Worker, then go to **Settings → Builds → Connect** and select the GitHub
repository. Use the `codex/cloudflare-version` branch initially.

- Build command: `npm ci && npm run build:cloudflare`
- Deploy command: `npx wrangler@4.34.0 deploy`
- Root directory: `/`

After the connection is saved, each push to the production branch builds and deploys the game.

## Manual deployment

1. Open the Cloudflare dashboard.
2. Go to **Workers & Pages**.
3. Select **Create application → Get started → Drag and drop your files**.
4. Name the project `iron-dominion`.
5. Drag in the entire `dist-cloudflare/` folder.
6. Select **Deploy site**.

For later manual releases, open the Worker, choose **New deployment**, and upload a newly built folder.

## Forms

Forms are independent of the hosting provider and submit to Formspree:

- Beta signups: `https://formspree.io/f/xjgnkega`
- Game feedback: `https://formspree.io/f/xykrzdka`

Beta signups include name, email, and release-update consent. Game feedback includes name,
1–5 rating, written feedback, and the page URL. Review submissions in the corresponding
Formspree form inboxes.

## Multiplayer

The static game client remains on Cloudflare Workers. The WebSocket multiplayer relay remains a
separate Node service. Set its `ALLOWED_ORIGINS` value to the final `workers.dev` or custom-domain
origin, and make sure the client build uses the production relay URL.
