# Iron Dominion Cloudflare deployment

## Build

Run:

```sh
npm run build:cloudflare
```

Upload the generated `dist-cloudflare/` folder to Cloudflare Pages using Direct Upload.

## First deployment

1. Open the Cloudflare dashboard.
2. Go to **Workers & Pages**.
3. Select **Create application → Get started → Drag and drop your files**.
4. Name the project `iron-dominion`.
5. Drag in the entire `dist-cloudflare/` folder.
6. Select **Deploy site**.

For later releases, open the Pages project, choose **Create a new deployment**, and upload a newly built folder.

## Forms

Forms are independent of the hosting provider and submit to Formspree:

- Beta signups: `https://formspree.io/f/xjgnkega`
- Game feedback: `https://formspree.io/f/xykrzdka`

Beta signups include name, email, and release-update consent. Game feedback includes name,
1–5 rating, written feedback, and the page URL. Review submissions in the corresponding
Formspree form inboxes.

## Multiplayer

The static game client remains on Cloudflare Pages. The WebSocket multiplayer relay remains a
separate Node service. Set its `ALLOWED_ORIGINS` value to the final `pages.dev` or custom-domain
origin, and make sure the client build uses the production relay URL.
