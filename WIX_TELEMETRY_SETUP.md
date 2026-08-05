# Wix Telemetry Setup

## How data reaches Wix Headless

The live game does **not** call Wix APIs from the browser. It posts to our
Cloudflare Worker, which forwards into your Wix site’s HTTP function. That is the
Wix Headless ingest path used for telemetry (and the same one used for signup /
feedback forms).

```
Browser (Iron Dominion)
  → POST /api/wix-submit
      { kind: "telemetry", event, playerId, page, buildVersion, match?, feature? }
  → Cloudflare Worker (`serverless/wix-backoffice.mjs`)
      validates payload + allowlisted event names
      adds header `x-iron-dominion-secret`
  → Wix Velo HTTP function `post_ironDominionSubmission`
      (env: WIX_CMS_ENDPOINT)
  → wixData.insert('IronDominionEvents', …)
  → Business Manager custom dashboard reads IronDominionEvents
```

**Required Worker secrets (already used for forms — no new secrets):**
- `WIX_CMS_ENDPOINT` — full URL of the published Velo HTTP function
- `IRON_DOMINION_INGEST_SECRET` — shared secret checked by Velo

**Game-side send helper:** `sendTelemetryEvent()` in `src/telemetry.ts` uses
`navigator.sendBeacon` / `fetch` to `/api/wix-submit`. Define Tactic feedback
calls it with `event: "tactic-feedback"` and `feature: { useful: true|false }`.

Complete the Wix CMS + Velo + dashboard steps below (paste the prompts into the
Wix AI chat, in order), then publish the Wix site **before** relying on
production dashboards.

---

The game now sends automatic telemetry events (no player action needed) to the
same Worker endpoint as forms: `session-start` on every page load, `match-start`
when a match begins, `heartbeat` every 2 minutes during play (and on tab close),
and `match-end` on victory/defeat.

Tactic planner usage also emits feature events: `tactic-open`, `tactic-cancel`,
`tactic-execute`, and `tactic-feedback` from a Yes/No prompt after each close
until the player answers (plus reserved `tactic-complete` /
`tactic-interrupted`). Those include a `feature` object with unit/path stats
(`useful` on feedback).

`match-end` also includes combat-rank mix for the local army (Recruit / Veteran /
Elite / Ace shares that sum to ~1).

The Worker forwards them to the existing Velo HTTP function
(`ironDominionSubmission`) with `kind: "telemetry"`. Complete the Wix side by
pasting the prompts below into the Wix AI chat, in order.

## Payload the Velo function will receive

```json
{
  "kind": "telemetry",
  "event": "session-start | match-start | match-end | heartbeat | tactic-open | tactic-cancel | tactic-execute | tactic-complete | tactic-interrupted | tactic-feedback",
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
  },
  "feature": {
    "unitCount": 3,
    "selectionCount": 4,
    "unitKinds": "tank:2,soldier:1",
    "waypointCount": 3,
    "pathLengthApprox": 120.5,
    "endAction": "hold | attack-move | attack",
    "plannerDurationMs": 8500,
    "subsetOfSelection": true,
    "useful": true,
    "rankRecruitShare": 0.9,
    "rankVeteranShare": 0.07,
    "rankEliteShare": 0.02,
    "rankAceShare": 0.01,
    "rankCounts": "recruit:90,veteran:7,elite:2,ace:1",
    "combatUnitCount": 100
  }
}
```

`match` is absent on `session-start`. `feature` is present on tactic events.
`playerId` + `_createdDate` answer "players today"; distinct `matchId` on
`match-start` answers "matches today". Tactic open vs execute rates answer
"how many players opened / used Define Tactic".

## Prompt 1 — collection + backend (paste into Wix AI chat)

> Create or update the CMS collection named **IronDominionEvents** (permissions: no one
> can read/write from the site; backend code only). Add these fields with these
> exact field IDs (skip any that already exist):
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
> - Feature unit count — `featureUnitCount` — Number
> - Feature selection count — `featureSelectionCount` — Number
> - Feature unit kinds — `featureUnitKinds` — Text
> - Feature waypoint count — `featureWaypointCount` — Number
> - Feature path length — `featurePathLengthApprox` — Number
> - Feature end action — `featureEndAction` — Text
> - Feature planner duration ms — `featurePlannerDurationMs` — Number
> - Feature subset of selection — `featureSubsetOfSelection` — Boolean
> - Feature useful — `featureUseful` — Boolean
> - Rank recruit share — `rankRecruitShare` — Number
> - Rank veteran share — `rankVeteranShare` — Number
> - Rank elite share — `rankEliteShare` — Number
> - Rank ace share — `rankAceShare` — Number
> - Rank counts — `rankCounts` — Text
> - Combat unit count — `combatUnitCount` — Number
>
> Then update the existing `post_ironDominionSubmission` function in
> `backend/http-functions.js`. Keep the `x-iron-dominion-secret` header check
> exactly as it is. After the secret check passes, ensure the telemetry branch
> looks like this BEFORE the existing signup/feedback handling:
>
> ```js
> if (body.kind === 'telemetry') {
>   const match = body.match && typeof body.match === 'object' ? body.match : null;
>   const feature = body.feature && typeof body.feature === 'object' ? body.feature : null;
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
>   if (feature) {
>     Object.assign(item, {
>       featureUnitCount: Number(feature.unitCount) || 0,
>       featureSelectionCount: Number(feature.selectionCount) || 0,
>       featureUnitKinds: String(feature.unitKinds || ''),
>       featureWaypointCount: Number(feature.waypointCount) || 0,
>       featurePathLengthApprox: Number(feature.pathLengthApprox) || 0,
>       featureEndAction: String(feature.endAction || ''),
>       featurePlannerDurationMs: Number(feature.plannerDurationMs) || 0,
>       featureSubsetOfSelection: feature.subsetOfSelection === true,
>       featureUseful: feature.useful === true,
>       rankRecruitShare: Number(feature.rankRecruitShare) || 0,
>       rankVeteranShare: Number(feature.rankVeteranShare) || 0,
>       rankEliteShare: Number(feature.rankEliteShare) || 0,
>       rankAceShare: Number(feature.rankAceShare) || 0,
>       rankCounts: String(feature.rankCounts || ''),
>       combatUnitCount: Number(feature.combatUnitCount) || 0,
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
> 6. **Tactic opens today** — count of `eventName === "tactic-open"` today.
> 7. **Tactic executes today** — count of `eventName === "tactic-execute"` today.
> 8. **Tactic cancel rate** — cancels / opens for today (`tactic-cancel` /
>    `tactic-open`).
> 9. **Avg waypoints on execute** — average `featureWaypointCount` for
>    `tactic-execute` today.
> 10. **End-action mix** — counts of `featureEndAction` (`hold`,
>     `attack-move`, `attack`) for `tactic-execute` today.
> 11. **Tactic useful rate** — among `tactic-feedback` today, share where
>     `featureUseful === true`.
> 12. **Avg combat-rank mix** — average of `rankRecruitShare` /
>     `rankVeteranShare` / `rankEliteShare` / `rankAceShare` on `match-end`
>     today (stacked bar or four %).
> 13. **Ace rate** — average `rankAceShare` on `match-end` today.
>
> Note: `heartbeat` events exist for abandoned-match analysis — exclude them
> from the counts above.

## Release checklist

1. Run both prompts in Wix AI chat and publish the site **first**.
2. Then deploy the game: `npm run deploy:cloudflare`.
3. Verify: open the game (a `session-start` row should appear in
   IronDominionEvents), start a skirmish (`match-start`), open Define Tactic
   (`tactic-open`), execute a path (`tactic-execute`), finish or lose the match
   (`match-end` with `matchStatus` victory/defeat and rank share fields).

No new secrets or env vars are needed — telemetry reuses `WIX_CMS_ENDPOINT` and
`IRON_DOMINION_INGEST_SECRET`. Telemetry does not use the Wix Forms API, so it
keeps working even if `WIX_API_KEY` is removed.
