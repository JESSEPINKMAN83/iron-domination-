# Wix Telemetry Setup

The game now sends automatic telemetry events (no player action needed) to the
same Worker endpoint as forms: `session-start` on every page load, `match-start`
when a match begins, `heartbeat` every 2 minutes during play (and on tab close),
and `match-end` on victory/defeat.

The Worker forwards them to the existing Velo HTTP function
(`ironDominionSubmission`) with `kind: "telemetry"`. Complete the Wix side by
pasting the prompts below into the Wix AI chat, in order.

## Payload the Velo function will receive

```json
{
  "kind": "telemetry",
  "event": "session-start | match-start | match-end | heartbeat",
  "playerId": "anonymous uuid, stable per browser",
  "page": "https://…",
  "buildVersion": "0.1.0",
  "match": {
    "matchId": "…", "status": "ongoing | victory | defeat",
    "multiplayer": false, "roomCode": "…", "mapId": "…", "mapSize": "…",
    "seed": 123, "playerName": "…", "playerTeam": 1, "playerSide": 1,
    "elapsedSeconds": 523.3, "fps": 58.8, "pingMs": 72,
    "quality": "balanced", "renderScale": 0.85, "engine": "chrome",
    "buildVersion": "0.1.0"
  }
}
```

`match` is absent on `session-start`. `playerId` + `_createdDate` answer
"players today"; distinct `matchId` on `match-start` answers "matches today".

## Prompt 1 — collection + backend (paste into Wix AI chat)

> Create a new CMS collection named **IronDominionEvents** (permissions: no one
> can read/write from the site; backend code only). Add these fields with these
> exact field IDs:
>
> - Event name — `eventName` — Text
> - Player ID — `playerId` — Text
> - Page — `page` — Text
> - Build version — `buildVersion` — Text
> - Match ID — `matchId` — Text
> - Match status — `matchStatus` — Text
> - Multiplayer — `multiplayer` — Boolean
> - Room code — `roomCode` — Text
> - Map — `mapId` — Text
> - Map size — `mapSize` — Text
> - Map seed — `mapSeed` — Number
> - Player name — `playerName` — Text
> - Player team — `playerTeam` — Number
> - Player side — `playerSide` — Number
> - Elapsed seconds — `elapsedSeconds` — Number
> - FPS — `fps` — Number
> - Ping ms — `pingMs` — Number
> - Visual quality — `visualQuality` — Text
> - Render scale — `renderScale` — Number
> - Browser engine — `browserEngine` — Text
>
> Then update the existing `post_ironDominionSubmission` function in
> `backend/http-functions.js`. Keep the `x-iron-dominion-secret` header check
> exactly as it is. After the secret check passes, add a new branch BEFORE the
> existing signup/feedback handling:
>
> ```js
> if (body.kind === 'telemetry') {
>   const match = body.match && typeof body.match === 'object' ? body.match : null;
>   const item = {
>     eventName: String(body.event || ''),
>     playerId: String(body.playerId || ''),
>     page: String(body.page || ''),
>     buildVersion: String(body.buildVersion || ''),
>   };
>   if (match) {
>     Object.assign(item, {
>       matchId: String(match.matchId || ''),
>       matchStatus: String(match.status || 'ongoing'),
>       multiplayer: match.multiplayer === true,
>       roomCode: String(match.roomCode || ''),
>       mapId: String(match.mapId || ''),
>       mapSize: String(match.mapSize || ''),
>       mapSeed: Number(match.seed) || 0,
>       playerName: String(match.playerName || ''),
>       playerTeam: Number(match.playerTeam) || 0,
>       playerSide: Number(match.playerSide) || 0,
>       elapsedSeconds: Number(match.elapsedSeconds) || 0,
>       fps: Number(match.fps) || 0,
>       pingMs: Number(match.pingMs) || 0,
>       visualQuality: String(match.quality || ''),
>       renderScale: Number(match.renderScale) || 0,
>       browserEngine: String(match.engine || ''),
>       buildVersion: String(match.buildVersion || item.buildVersion),
>     });
>   }
>   await wixData.insert('IronDominionEvents', item, { suppressAuth: true });
>   return the same success response shape the function already returns for
>   other kinds (200, { ok: true });
> }
> ```
>
> Do not change how signup and feedback submissions are handled. Publish the
> site when done.

## Prompt 2 — dashboard (paste after Prompt 1 is done)

> In my custom Iron Dominion dashboard, add a new "Live telemetry" section at
> the top, reading from the **IronDominionEvents** collection:
>
> 1. **Players today** — count of DISTINCT `playerId` where
>    `eventName === "session-start"` and `_createdDate` is today.
> 2. **Matches started today** — count of DISTINCT `matchId` where
>    `eventName === "match-start"` and `_createdDate` is today.
> 3. **Matches finished today** — count of `eventName === "match-end"` today,
>    with a victory/defeat split using `matchStatus`.
> 4. **Average match length** — average `elapsedSeconds` of `match-end` events
>    (show as minutes:seconds).
> 5. A line chart of daily unique players (`session-start`, distinct
>    `playerId` per day) over the last 14 days.
>
> Note: `heartbeat` events exist for abandoned-match analysis — exclude them
> from the counts above.

## Release checklist

1. Run both prompts in Wix AI chat and publish the site **first**.
2. Then deploy the game: `npm run deploy:cloudflare`.
3. Verify: open the game (a `session-start` row should appear in
   IronDominionEvents), start a skirmish (`match-start`), finish or lose it
   (`match-end` with `matchStatus` victory/defeat).

No new secrets or env vars are needed — telemetry reuses `WIX_CMS_ENDPOINT` and
`IRON_DOMINION_INGEST_SECRET`. Telemetry does not use the Wix Forms API, so it
keeps working even if `WIX_API_KEY` is removed.
