# Wix Match Metadata Setup

The game now sends a `match` object with every feedback submission. Complete the
steps below so Wix stores those values in `IronDominionFormSubmissions`.

## 1. Add CMS fields

In Wix, open **CMS > Collections > IronDominionFormSubmissions > Manage Fields**
and add these fields. The field IDs must match exactly.

| Field name | Field ID | Type |
| --- | --- | --- |
| Match ID | `matchId` | Text |
| Match status | `matchStatus` | Text |
| Multiplayer | `multiplayer` | Boolean |
| Room code | `roomCode` | Text |
| Map | `mapId` | Text |
| Map size | `mapSize` | Text |
| Map seed | `mapSeed` | Number |
| Player name | `playerName` | Text |
| Player team | `playerTeam` | Number |
| Player side | `playerSide` | Number |
| Elapsed seconds | `elapsedSeconds` | Number |
| FPS | `fps` | Number |
| Ping ms | `pingMs` | Number |
| Visual quality | `visualQuality` | Text |
| Render scale | `renderScale` | Number |
| Browser engine | `browserEngine` | Text |
| Build version | `buildVersion` | Text |

## 2. Update the Wix HTTP function

In `backend/http-functions.js`, find the feedback branch that builds `item`.
After its existing feedback fields are assigned and before `wixData.insert`, add:

```js
const match = body.match && typeof body.match === 'object' ? body.match : null;

if (match) {
  Object.assign(item, {
    matchId: String(match.matchId || ''),
    matchStatus: String(match.status || 'ongoing'),
    multiplayer: match.multiplayer === true,
    roomCode: String(match.roomCode || ''),
    mapId: String(match.mapId || ''),
    mapSize: String(match.mapSize || ''),
    mapSeed: Number(match.seed) || 0,
    playerName: String(match.playerName || ''),
    playerTeam: Number(match.playerTeam) || 0,
    playerSide: Number(match.playerSide) || 0,
    elapsedSeconds: Number(match.elapsedSeconds) || 0,
    fps: Number(match.fps) || 0,
    pingMs: Number(match.pingMs) || 0,
    visualQuality: String(match.quality || ''),
    renderScale: Number(match.renderScale) || 0,
    browserEngine: String(match.engine || ''),
    buildVersion: String(match.buildVersion || ''),
  });
}
```

Publish the Wix site after saving the backend code.

## 3. Release checklist

Do not rotate `IRON_DOMINION_INGEST_SECRET` while the current game is live. The
Cloudflare Worker and Wix must always use the same value. Before deploying the
new game build, restore `WIX_API_KEY` to the Cloudflare Worker and then verify a
test feedback record in the CMS collection.
