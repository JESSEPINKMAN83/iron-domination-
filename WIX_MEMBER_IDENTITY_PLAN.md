# Member Identity Plan — Free Single-Player, Members-Only Multiplayer

Turn the current "everyone signs up before playing" gate into:

- **Single player** — instant play, zero friction, no account.
- **Multiplayer** — requires a real **Wix Headless member** account (the existing
  signup form becomes a real registration).
- **Returning members** — recognised by name, with persistent stats.
- **Wix dashboard / Business Manager** — every multiplayer player appears as a
  Site Member (and a Contact), not just a form row.

**Verdict: feasible, and most of the groundwork already exists.** No new Wix
product, no new hosting, no paid add-on. Est. 3–5 focused days for v1.

---

## What already exists (verified)

| Piece | State |
|---|---|
| Wix site `be56a4e3-290f-4469-87fc-b4a7a91dc5a9` | Published, **Premium**, Velo enabled |
| **Wix Members Area app** | **Already installed** — required for the Members API and custom member fields |
| Wix Forms + CRM Contacts | Already written by the Worker (`createContact` + form submission) |
| Cloudflare Worker `/api/wix-submit` | Live ingest path, holds `WIX_API_KEY` + `IRON_DOMINION_INGEST_SECRET` |
| Velo `post_ironDominionSubmission` | Live, writes `IronDominionEvents` with `suppressAuth` |
| Custom BM dashboard | 3 tabs (Game Analytics / Beta Signups / Player Feedback) |
| Multiplayer relay (Render, `iron-dominion-relay`) | **No auth at all** — origin allowlist only, client-supplied `playerId`/`name` |

### What's missing

1. A **headless OAuth client** (client ID) — 2 minutes in Headless Settings.
2. Member register/login code in the game (currently the form only POSTs to the
   Worker and sets a `localStorage` flag).
3. **Server-side enforcement** at the relay — today anyone can `join` a room with
   any invented `playerId`.

---

## Current gate (what changes)

`src/landing.ts`
- `hasBetaAccess()` — reads `iron-dominion.beta-access.v1 === 'granted'` from
  `localStorage`. **This is the whole gate.** Anyone can grant it from the console.
- `betaPlayerName()` — reads name from `iron-dominion.beta-profile.v1`.
- Form submit → `submitToBackoffice({ kind: 'signup', … })` → Worker → Contact +
  Wix Form + CMS row → `rememberBetaAccess()` → game starts.

`src/main.ts`
- line ~5135: `if (!localSetupPreview && !(inviteRoom && hasBetaAccess())) await showLandingScreen({ inviteRoom })`
- line ~1382 / ~1419: `client.host({ name: betaPlayerName() ?? 'Host', playerId: rememberedPlayerId(...) })`
  and `client.join(code, betaPlayerName() ?? 'Guest', …)` — name and id are
  cosmetic, client-chosen strings.

**Change:** the landing page stops being a wall. It becomes a normal hero with
**Play** (instant) and **Multiplayer** (which opens the account panel when the
player isn't signed in).

---

## Architecture

```
                    ┌── single player ──> straight into the setup screen (no account)
Landing / main menu ─┤
                    └── multiplayer ───> signed in?  ──yes──> host / join room
                                              │
                                              no
                                              ▼
                                   Account panel (sign up / log in)
                                   @wix/sdk OAuthStrategy (clientId only)
                                   auth.register / auth.login
                                              │
                                   member access + refresh token
                                              │
                     ┌────────────────────────┼────────────────────────┐
                     ▼                        ▼                        ▼
             members.getCurrentMember   relay `join`/`host`      Worker /api/*
             (nickname, memberId)       carries access token     (stats, telemetry)
                                              │
                                    relay verifies via
                                    GET wixapis.com/members/v1/members/my
                                              │
                                    playerId := memberId (trusted)
```

Wix stays the identity provider — **we never see or store a password.**

---

## Wix side (dashboard work, ~30 min)

1. **Create a headless client** — Dashboard → **Headless Settings** → OAuth apps →
   create a client for the game. Copy the **Client ID** (public; no secret exists
   for headless OAuth, so it can ship in the bundle).
2. **Allowed redirect URIs / domains** — add the game's origins:
   - `https://throbbing-truth-af19.danireuven.workers.dev` (+ any custom domain)
   - `http://localhost:5173` and `http://localhost:5174` for dev
   Needed for the mobile PKCE redirect and for password-reset returns. Must match
   **exactly**, including trailing slash.
3. **Member signup settings** (Settings → Members / signup & login):
   - **Recommended for v1:** anyone can sign up, **no email verification**, **no
     owner approval** → `register()` returns `SUCCESS` and the player is in the
     room within seconds.
   - Email verification (`EMAIL_VERIFICATION_REQUIRED`) or approval
     (`OWNER_APPROVAL_REQUIRED`) both add a blocking step; the code should handle
     them anyway, but don't enable them for a game beta.
4. *(Optional)* **Members custom fields** — for `commanderTag`, `country`, etc.
   Requires Members Area (installed ✓) via the Members Custom Fields API.
   Undefined custom fields are **silently dropped** on register.
5. *(Optional)* **reCAPTCHA** for the custom login flow — enable in project
   settings + add the widget. Worth it only if signup abuse appears.
6. **New CMS collection `IronDominionPlayers`** (backend-only permissions):
   `memberId` (Text, unique-ish), `nickname`, `loginEmail`, `firstSeen`,
   `lastSeen`, `mpMatches`, `mpWins`, `mpLosses`, `bestRankShare`, `totalPlayMinutes`.
   Written by the existing Velo function (new `kind: 'player-stat'` branch,
   `suppressAuth: true`) — same trust model as telemetry.

**Where they show up:** Dashboard → **Contacts → Site Members** (status, signup
date, last login) and Contacts (the member's contact record, already linked by
email to any existing beta signup). Add a **Members** card to the custom BM
dashboard later by joining `IronDominionPlayers` on `memberId`.

---

## Game side

### Phase 1 — Split the gate (no Wix code yet)

Ship this first; it is independently valuable and reversible.

1. `src/landing.ts`: replace the single "Play game" CTA with
   **Play** (single player) and **Multiplayer**. Drop `hasBetaAccess()` from the
   single-player path entirely. Keep the existing signup form markup — it becomes
   the account panel in Phase 2.
2. `src/main.ts` ~5135: landing shows for everyone; nothing blocks the setup screen.
3. Setup screen: `OPEN ONLINE ROOM` / `JOIN` become the gated entry points —
   if `!auth.loggedIn()` they open the account panel instead of the relay.
4. Keep `betaPlayerName()` as the fallback display name until Phase 2 lands.

**Acceptance:** a fresh browser (cleared storage) reaches a skirmish with zero
form input; multiplayer prompts for an account.

### Phase 2 — Wix member auth module

New file `src/net/identity.ts` — the only place that touches `@wix/sdk`:

```ts
// lazy: keep @wix/sdk out of the initial game bundle
const { createClient, OAuthStrategy } = await import('@wix/sdk');
const { members } = await import('@wix/members');

const client = createClient({
  modules: { members },
  auth: OAuthStrategy({ clientId: WIX_CLIENT_ID, tokens: storedTokens() }),
});
```

Public surface:

```ts
isSignedIn(): boolean                    // client.auth.loggedIn()
currentMember(): Promise<MemberProfile>  // members.getCurrentMember()
register(email, password, profile): Promise<AuthResult>
login(email, password): Promise<AuthResult>
sendPasswordReset(email): Promise<void>
memberAccessToken(): Promise<string>     // refreshed on demand, for the relay
signOut(): Promise<void>                 // auth.logout(returnUrl) → redirect
```

Register with profile, so the branded form still earns its keep:

```ts
const response = await client.auth.register({
  email, password,
  profile: { firstName, nickname: commanderName },
});
```

**`loginState` handling — all five branches:**

| State | UI |
|---|---|
| `SUCCESS` | exchange session token → store tokens → continue into the room |
| `FAILURE` + `emailAlreadyExists` | "Already registered — log in instead" (switch tab, prefill email) |
| `FAILURE` + `invalidEmail` / `invalidPassword` | inline field error |
| `FAILURE` + `resetPassword` | call `sendPasswordResetEmail(email, redirectUri)` |
| `EMAIL_VERIFICATION_REQUIRED` | code input → `auth.processVerification({ verificationCode })` |
| `OWNER_APPROVAL_REQUIRED` | "Membership pending approval" notice |

**⚠️ The one real trap — mobile token exchange.**
`getMemberTokensForDirectLogin(sessionToken)` uses a hidden iframe and **fails on
mobile browsers that block third-party cookies** (it hangs, then
`createRedirectSession` fails with `FAILED_TO_EXTRACT_SESSION`). The game is
explicitly mobile-supported (`mobile.css`, `isMobileTouchDevice`), so:

- **Desktop:** `getMemberTokensForDirectLogin()` → `auth.setTokens(tokens)`.
- **Mobile (or as the single code path, which I'd prefer):** the **PKCE
  full-page redirect** — generate a code verifier + SHA-256 challenge + state,
  `POST /_api/redirects-api/v1/redirect-session` with the `sessionToken` and
  `authRequest`, navigate to `redirectSession.fullUrl`, then on return exchange
  `code` + `codeVerifier` at `POST /oauth2/token` for member tokens.
- A full-page redirect mid-session means **the match/setup state must survive a
  reload.** Persist the pending intent (`{ action: 'host' | 'join', roomCode }`)
  in `sessionStorage` before redirecting and resume it on boot. This is the main
  piece of real work in Phase 2.

**Token storage.** v1: refresh token in `localStorage` (`renewToken()` on boot,
fall back to the account panel on failure). Wix's own docs warn against exposing
refresh tokens to the browser — since we already run a Worker, **v2 hardening**
is to move the exchange/refresh behind `/api/auth/*` and keep the refresh token
in an `HttpOnly; Secure; SameSite=Lax` cookie. Don't block v1 on it.

**Bundle cost.** `@wix/sdk` + `@wix/members` must be **dynamically imported**
only when the account panel or a multiplayer action is triggered — a 3D game's
first paint should not pay for an auth SDK. Verify with `npm run build` that the
main chunk doesn't grow.

### Phase 3 — Real enforcement at the relay

Client-side gating alone is theatre (see the console trick that grants beta
access today). In `server/multiplayer-server.mjs`:

1. `host` and `join` messages carry `memberToken` (the member access token).
2. Relay verifies it once per connection:
   ```js
   const res = await fetch('https://www.wixapis.com/members/v1/members/my', {
     headers: { Authorization: memberToken },
   });
   // 200 → { member: { id, loginEmail, loginEmailVerified, status, profile } }
   ```
   Non-200 → reject with `member-required`. Cache `hash(token) → { memberId, nickname }`
   for the token's lifetime (small `Map` + TTL) so the relay isn't hammering Wix.
3. **`playerId := member.id`** — replaces the client-chosen id, which kills
   impersonation and makes reconnect/grace logic identity-based rather than
   string-based. Display name comes from `member.profile.nickname`, not the client.
4. New env var on Render: nothing secret needed — the member's own token is the
   credential. (No API key on the relay: keep it that way.)
5. Reject two connections claiming the same `memberId` in one room.

**Free-tier note:** the Render free plan sleeps; the verify call adds ~100–300 ms
to the first join. Acceptable; cache makes it once per session.

### Phase 4 — Returning-player identity and stats

1. On boot, if signed in: `members.getCurrentMember()` → greet by nickname on the
   landing page ("Welcome back, Commander <nickname>") and prefill the
   multiplayer name. Add a small **account chip** (nickname + sign out) in the
   corner.
2. On `match-end` for a **multiplayer** match, the Worker gets
   `{ kind: 'player-stat', memberId, result, elapsedSeconds, rankShares }` and the
   Velo function upserts `IronDominionPlayers` (query by `memberId`, then
   `insert`/`update` with `suppressAuth`).
3. Add `memberId` (optional) to the existing telemetry payload so
   `IronDominionEvents` can be joined to real people for multiplayer sessions,
   while single-player stays fully anonymous (`playerId` uuid only).
4. Dashboard: a **Members** card — total members, new this week, MP matches per
   member, win rate. Same Aria workflow as the existing cards.

### Phase 5 — Optional polish

- **Sign in with Google** — Wix runs the whole OAuth flow, no backend and no API
  key needed. Highest-value follow-up: removes password friction for a game audience.
- Migrate the ~28 existing beta signups: they're Contacts, not members. When they
  register with the same email Wix links the new member to the existing contact,
  so history isn't lost. Optionally email them a "claim your commander profile" link.
- Member-only extras once identity exists: persistent commander name, friend
  invites by nickname, leaderboards, cosmetic unlocks.

---

## Returning members and multiple devices

This is the core reason to do this at all. Today's `localStorage` flag is
per-browser and dies with a cache clear. A Wix member is stored on Wix:

| Scenario | Today | As a member |
|---|---|---|
| Next session, same browser | works until storage is cleared | auto signed-in via the stored refresh token (`renewToken()` on boot) |
| Different device / phone | starts over, name lost | logs in with the same email + password |
| Private window / cleared cookies | identity gone | logs in again, member + stats intact |
| Forgot password | n/a | Wix-hosted reset via `sendPasswordResetEmail()` |
| Name, stats, history | per-browser | attached to `memberId`, follows them everywhere |

The browser only ever caches a refresh token for convenience. Losing it costs one
login, not the account.

### Mistyped signup email — actual severity: low

With email verification **off**, a typo'd email means that **account** can't be
recovered by email. It does **not** mean the player is stuck:

- **Login still works.** Email + password authenticates from any device. The
  address never has to receive mail unless they forget the password.
- **They can just register again** with the correct address. Nothing blocks it —
  the typo'd address occupies its own member record and is simply abandoned.
- **What is actually lost:** password reset on the orphaned account, and if they
  re-register, the stats/nickname attached to the old `memberId`.
- **The one confusing case:** they typo at signup, then later try to log in with
  the *correct* address and get "no such member".

Because nothing here is paid or irreplaceable, this does **not** justify adding a
verification step in front of "sign up and join the room now". Handle it in UI instead:

1. A **confirm-email field** in the signup form (cheap, catches most typos).
2. On a failed login, a clear message plus an obvious **"Create an account"**
   path — never a dead end.
3. Show the signed-in **email in the account chip**, so the player can see which
   address they actually used.
4. "Sign in with Google" (Phase 5) removes the whole class of problem.

Verification remains a Wix **setting** — switch it on later with no code change if
abuse ever appears.

---

## Member presence in the game (name + avatar)

Once identity is real, show it. This is the payoff the player actually feels, and
it is **pure UI** — no sim, no netcode, no gameplay coupling.

### Where identity appears

| Surface | What shows | Notes |
|---|---|---|
| **Landing / home** | Account chip, top-right: avatar + nickname + sign out; hero line becomes "Welcome back, Commander \<nickname\>" | Replaces the current returning-player CTA block |
| **Setup screen header** | Commander identity beside the existing `PUBLIC BETA · BUILD 0.1` badge | Best "it knows me" moment before a match |
| **Multiplayer lobby rows** | Avatar + nickname per player | Now *trustworthy* — the relay verified it (Phase 3) |
| **Outcome screen** | "VICTORY — Commander \<nickname\>", opponent named too | `src/ui/outcomeScreen.ts` / `outcomeScreen.css` |
| **Mission briefing** | Player's avatar beside the existing commander portrait ("your command") | Reuses the card in `src/missionBriefing.ts` |
| **In-match, multiplayer only** | Opponent/ally name in the mode banner and on tactical ping labels | Identity where it changes behaviour |
| **In-match HUD (resource strip)** | ❌ **Deliberately not** | The strip was just rebuilt for legibility; an avatar there re-clutters it |

Single-player surfaces stay identity-free unless the player happens to be signed
in — a guest must never see an empty avatar slot or a "sign in" nag.

### Avatar source — recommendation

**A game-native portrait picker, not photo upload.**

1. **Ship 8–12 commander portraits** as local assets (the art direction already
   exists — see the briefing portrait). The player picks one at signup or from the
   account chip. Stored as `avatarId` on the `IronDominionPlayers` row.
   - No upload plumbing, no Wix Media API, no CORS, **no user-content moderation
     problem**, always on-brand, bytes already in the bundle, works offline.
2. **Use the Wix member photo when one exists** — `getCurrentMember()` returns
   `profile` (nickname, slug, photo). If a member has a photo (e.g. set through the
   Members Area), prefer it. Opportunistic only.
3. **Fallback, always available:** a monogram — initials plus a colour derived
   deterministically from `memberId`. Guarantees no broken-image state ever.
4. **User-uploaded photos: explicitly deferred.** Needs Wix Media upload plus a
   moderation policy. Not worth it for a beta.

### Writing profile changes

- **Nickname and avatar choice → our own `IronDominionPlayers` row**, via the
  existing Worker → Velo path. This is the safe default: it's the pipeline you
  already operate, and it can't fail in a way that touches Wix identity.
- Writing back to the **Wix member profile** (`PATCH /members/v1/members/{id}`)
  carries a `Manage Members` scope requirement, so if you want the nickname to
  appear in Contacts → Site Members, do that write **server-side in the Worker with
  the existing API key** — never from the browser.
- `nickname` is also collected at registration via `auth.register({ profile: { nickname } })`,
  so the Wix record is populated correctly from the start with no extra call.

### Safety rules for this layer

- Avatars are **local assets**; no external image fetch during a match.
- A remote Wix photo loads lazily with the monogram as the immediate placeholder,
  and never blocks boot or match start.
- Every identity field is optional in the render path: `nickname ?? 'Commander'`,
  avatar ?? monogram. A missing profile degrades to today's look, never a gap.
- Nickname is **display-only** — never a key, never used for matchmaking or
  reconnect logic (`memberId` is the key). Sanitise length and strip control
  characters before rendering.

---

## Safety-first rollout

Hard rule: **this feature must never be able to break the game.** Everything below
follows from that.

### Isolation rules

1. **No sim, netcode-determinism, rendering, or input code is touched.** The change
   is confined to the landing page, boot path, the multiplayer entry buttons, one
   new `src/net/identity.ts`, and the relay's join/host handshake.
2. **Single player must never depend on Wix.** If Wix is unreachable, the SDK fails
   to load, or the client ID is wrong, the game still boots and single player still
   plays. Identity code is dynamically imported and every call is wrapped — a
   failure shows an error *inside the account panel only*.
3. **Never trigger auth from inside a live match.** The account panel is reachable
   only from the landing page and the setup screen, so the full-page redirect can
   never interrupt a match in progress.
4. **Keep the existing signup pipeline running in parallel** during the transition
   (Contact + Wix Form + CMS row still written on registration). No data path is
   removed until members have been live for a while.

### Kill switch

Ship a **runtime** flag, not a build-time one, so a bad rollout is fixed without a
deploy:

- `identityEnabled` resolved at boot from, in order: URL param (`?identity=0`),
  `localStorage` override, then a value served by the Worker (e.g. from
  `/api/config`) with a safe default.
- Flag **off** ⇒ the exact current behaviour: old landing, old gate, relay accepts
  unauthenticated joins. This is the rollback, and it takes seconds.

### Sequencing — one change at a time, each independently verifiable

| Step | Change | Blast radius | Rollback |
|---|---|---|---|
| **1** | Gate split only (Play / Multiplayer, single player free). No Wix code. | Menu navigation | Revert one PR |
| **2** | `identity.ts` + account panel behind the flag, **flag off in production** | None until flipped | Flag stays off |
| **3** | Flip the flag for yourself only (URL param), test the full matrix | You only | Close the tab |
| **4** | Flag on for everyone. Relay still accepts unauthenticated joins. | Multiplayer signup UX | Flag off |
| **5** | Relay verification in **log-only mode**: verify the token, record pass/fail, **still allow the join** | Nothing — observation only | Nothing to undo |
| **6** | Relay **enforces** once step 5 shows a clean pass rate | Multiplayer access | Env var back to log-only |

Step 5 is the important one: it turns "did we lock real players out of
multiplayer?" from a production surprise into a metric you read first. Enforcement
should be an env var on Render (`MEMBER_AUTH=off | log | enforce`), so tightening
or loosening it never needs a code deploy.

### Test matrix before each flag flip

- Fresh browser, storage cleared → single player start, **zero input required**
- Fresh browser → multiplayer → sign up → lands in the room
- Sign out → sign in → still recognised, nickname correct
- **Second device**, same account → logs in, same nickname
- **Real iOS Safari** (not desktop emulation) → the redirect flow completes
- Invite link `?room=CODE` while signed out → signup → **still joins that room**
- Wix blocked (DevTools request blocking on `wixapis.com`) → single player unaffected,
  account panel shows a clean error
- Two browsers, one account, same room → second is rejected cleanly (post-step 6)
- Existing player with the old `beta-access` flag → not worse off

### What could still go wrong, and the guard for each

| Risk | Guard |
|---|---|
| Redirect loses the player's place | Pending intent in `sessionStorage`, resumed on boot; only ever triggered from menus |
| Mobile cookie block | PKCE redirect as the single code path; verified on real iOS |
| Redirect-URI mismatch | Checked per environment (worker domain + both localhost ports) before flipping |
| Auth SDK fails to load | Dynamic import in a `try/catch`; single player untouched |
| Players locked out of multiplayer | Log-only step 5, then enforce |
| Signup conversion drops | Compare `session-start → match-start` (SP) and the MP funnel before/after; flag off if SP regresses |

## Decisions to make before coding

| Decision | Recommendation |
|---|---|
| Email verification on signup? | **No** for the beta — it blocks the "sign up and join the room now" flow |
| Custom form vs Wix-hosted login page? | **Custom** — keeps the game's art direction and lets you collect a commander nickname at signup |
| Token exchange path | **PKCE full-page redirect everywhere** — one code path, mobile-safe, at the cost of resumable state |
| Refresh token storage | v1 `localStorage`; v2 Worker + HttpOnly cookie |
| Can single-player players still be counted? | Yes — keep the anonymous telemetry `playerId`; membership is additive |
| Gate invite links (`?room=CODE`)? | Yes, same gate — but land on the account panel with the room code preserved so the invite still converts |

## Risks

1. **Mobile cookie behaviour** — the documented failure mode; solved only by the
   redirect flow. Test on real iOS Safari, not a desktop emulation.
2. **Redirect-URI mismatch** — the single most common setup error; exact match
   including trailing slash, and the Worker domain differs from `localhost`.
3. **Full-page redirect loses game state** — must persist and resume the pending
   multiplayer intent, or the player lands back on the menu after signing up.
4. **Bundle bloat** — enforce the dynamic import.
5. **Conversion drop on multiplayer** — expected, and the point of the change:
   single-player conversion should go *up* because the wall is gone. Measure both
   (`session-start` → `match-start` for SP vs the MP funnel) before/after.
6. **Relay free tier** — cold starts plus a Wix verify call on first join.

## Recommended cut for v1

Phases 1 + 2 + 3 only:

- instant single player,
- real Wix members for multiplayer with a branded signup that collects a
  commander name,
- relay actually enforcing it and using `memberId` as the player identity,
- members visible in Contacts → Site Members in the dashboard.

Stats, dashboard cards, and Google sign-in follow once the identity spine works.
