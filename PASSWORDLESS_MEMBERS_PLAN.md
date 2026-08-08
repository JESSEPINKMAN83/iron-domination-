# Passwordless Members Plan — no credential UI, ever

Replace the login-based member flow with **server-created members**: one small
name + email form (the same shape as the old beta signup that ran for weeks with
no browser warning), and the Worker turns that contact into a real Wix **Site
Member** using the API key it already holds. The game never renders a password
field, never redirects to a login page, and never handles a token that could make
a phishing classifier blink.

## Why this is the safe shape

The "Dangerous" badge was triggered by one thing: **a password input on an
unbranded `workers.dev` origin**, i.e. the textbook credential-phishing signature.
Chrome even said so ("you just entered your password on a deceptive site").

Evidence that the rest was never the problem: the name + email beta form ran in
production for weeks, collecting 24+ signups, with no flag. Email forms are
everywhere; password fields for someone else's service on a free shared host are
not.

So the rule this plan enforces at the boundary: **no password field, no login
redirect, no member tokens in the browser.** Members are created and used
entirely server-side.

Wix supports this officially — it is their documented "import members" flow:

- `POST /members/v1/members` (Create Member) — **admin/API-key identity**, and the
  docs include a "Create a member with login email only" example. No password.
- `Send Set Password Email` — the documented upgrade path: *"The member can log
  in to the site when they set their password for the first time."* We don't use
  it now, but it means these members can become login-capable later with zero
  migration.

## What this trades away (deliberate)

| Kept | Dropped (for now) |
|---|---|
| Real Site Members in Business Manager (events, segments, email marketing) | Cross-device login — identity lives in the browser like the old beta flag |
| Per-member stats (`IronDominionPlayers`), leaderboard, post-match stats | In-game login/logout UI |
| One-tap mobile-friendly signup (name + email + consent checkbox) | Google/Facebook sign-in (came free with hosted login; goes away with it) |
| Free single player, untouched | Relay verification via member access tokens (replaced, see Phase 3) |

If cross-device identity is ever wanted again: `Send Set Password Email` or
reviving the hosted-login branch (`fix/wix-hosted-login`, PR #58) are both
additive upgrades on top of these same member records — nothing here paints us
into a corner.

## Architecture

```
Multiplayer click
   └─ enlisted? ──yes──> straight to ONLINE BATTLE
        │no
        ▼
   Enlist form (name + email + "make me a member" consent)   ← no password, ever
        │  POST /api/wix-submit { kind: 'enlist', name, email }
        ▼
   Cloudflare Worker (has WIX_API_KEY already)
        ├─ upsert Contact (existing code path)
        ├─ POST /members/v1/members { loginEmail, profile.nickname }   (idempotent:
        │    on "already exists" → Query Members by loginEmail → reuse id)
        └─ respond { memberId, ticket }        ticket = HMAC(memberId, INGEST_SECRET)
        ▼
   Game stores { memberId, name, ticket } in localStorage (like the old beta profile)
        ├─ relay host/join carries { memberId, ticket }        (Phase 3 rework)
        ├─ match-end sends { kind: 'player-stat', memberId, … } (pipeline already ½ live)
        └─ debrief fetches leaderboard + own record             (new Velo GET endpoint)
```

## Phases — each its own PR, each independently shippable

### Phase A — remove the credential surface and clear the badge (first, urgent)

1. **Land #58's deletions, drop its redirect.** Keep the removal of the account
   panel and all password transport. Replace the hosted-login redirect with the
   enlist form (Phase B) — or, if B isn't ready, temporarily gate multiplayer on
   the old local signup. Either way the deployed origin has **zero credential
   code**.
2. **Search Console review.** Add a Worker route serving Google's verification
   file (URL-prefix property; owning a domain is NOT required), then request a
   Safe Browsing review. Do this only after the deploy — reviews of still-flagged
   content re-flag.
3. Keep the `?identity=0` kill switch semantics: off = multiplayer gates on the
   legacy local profile only.

### Phase B — the enlist pipeline

1. **Worker** (`serverless/wix-backoffice.mjs`): new `kind: 'enlist'`:
   - validate name + email exactly like `signup`;
   - reuse the existing contact-creation path;
   - `POST /members/v1/members` with the API key (confirm the exact request
     shape via SearchWixAPISpec before coding — grounded so far: endpoint,
     admin identity, email-only example);
   - on "already a member": Query Members filtered by `loginEmail`, reuse the id
     (makes enlist idempotent — re-enlisting on a second device just returns the
     same member);
   - mint `ticket = base64(HMAC_SHA256(memberId, IRON_DOMINION_INGEST_SECRET))`;
   - return `{ ok, memberId, ticket }`.
   - Rate-limit note from the docs: 1 create/second — fine at this scale; the
     idempotent path absorbs retries.
2. **Game**: `src/identity/enlist.ts` replaces `session.ts`/`wixAuth.ts`
   (both deleted — that's ~500 lines of OAuth/PKCE code gone):
   - `enlistedCommander()` → `{ memberId, name } | undefined` from localStorage;
   - `enlist(name, email)` → calls the Worker, stores the result;
   - the Multiplayer button opens the form only when not enlisted.
   - The form is the old beta panel styling (it never caused problems), with a
     consent line: "Create my free member account for multiplayer and events."
3. **Chip**: `currentCommander()` reads the enlisted name. The lobby avatars and
   debrief "COMMANDER X" line keep working unchanged — they're local presentation
   and cost nothing (they only *look* like the dropped complexity; the complex
   part was auth, which is gone).

### Phase C — relay: replace token verification with the HMAC ticket

The relay's three-mode structure (`off | log | enforce`) and rollout discipline
stay identical; only the verification changes:

1. Add `IRON_DOMINION_INGEST_SECRET` to the Render service env (same value the
   Worker holds — one secret, already provisioned in two places, now three).
2. `host`/`join` carry `{ memberId, ticket }`. The relay recomputes the HMAC and
   compares — **no network call at all**, so verification is now instant, free,
   and immune to Wix outages (the `unavailable` failure mode disappears).
3. `verifiedMember` flag and `MEMBER_AUTH=log` default behave exactly as today.
   Enforce remains an env-var flip once enlist volume exists.
4. Delete the Wix `Get My Member` verifier (`server/memberAuth.mjs` slims down;
   its mode/decision tests survive, the fetch-verifier tests are replaced by
   HMAC tests with a known secret).

### Phase D — stats, already half-live

The Velo `player-stat` upsert is **already published** on the site and the
`IronDominionPlayers` collection exists. Remaining:

1. Rebase the `feature/identity-phase5-player-stats` branch: `playerStatUpdate()`
   reads `enlistedCommander()` instead of `cachedMemberProfile()` — one function
   swap; every rule (multiplayer-only, finished-only, aggregates-only) and all
   tests stay.
2. Merge + deploy → the end-to-end `curl` check flips from `invalid-submission`
   to a row in `IronDominionPlayers`.

### Phase E — leaderboard and post-match stats (the payoff)

1. **Velo**: `get_ironDominionLeaderboard` in the same `http-functions.js` —
   returns top 20 by `mpWins` as `{ nickname, mpMatches, mpWins, bestRankAceShare }`.
   **No emails, no memberIds in the response** — nicknames and numbers only.
   Public GET, cheap query, `suppressAuth` read.
2. **Worker**: proxy route `/api/leaderboard` with a 60s cache header, so the
   game never calls wixsite.com directly (CORS + keeps one egress point).
3. **Game**: debrief gains a "COMMANDERS' LADDER" panel — your record (from your
   own enlisted stats) + top 20. Multiplayer debriefs only; single player stays
   stat-free and anonymous.
4. **BM dashboard**: a Members card via Aria (members total, new this week,
   matches/member, win rate) — same workflow as the telemetry cards.

### Phase F — cleanup

- Delete the OAuth app usage from the code (the app itself can stay in Headless
  Settings, unused, in case hosted login returns).
- Remove `MEMBER_AUTH` token-path code once the ticket path has run in `log`.
- Update `WIX_MEMBER_IDENTITY_PLAN.md` to point here; memory updated.

## Safety rails (unchanged discipline)

- Single player never touches any of this. If the Worker is down, enlist fails
  with a friendly error and single player is unaffected.
- Every phase behind the existing runtime kill switch where player-visible.
- The enforcement flip (relay `enforce`) stays a Render env var, log-first.
- No PII beyond name + email, which the signup form already collected; the
  leaderboard endpoint exposes neither emails nor ids.

## Confirmed against the live site before coding (Phase B step 0)

Two throwaway members were created and deleted on the real site to settle these:

1. **Create Member** — `POST /members/v1/members` with
   `{ member: { loginEmail, profile: { nickname } } }`, admin API key. Returns
   `{ member: { id, contactId, status, privacyStatus } }`. No password anywhere in
   the request or the response.
2. **Status** — created members land `APPROVED` (`privacyStatus: PRIVATE`) under the
   site's current settings, so they can be used immediately.
3. **Duplicate email** — `409` with
   `{"message":"Already exists","details":{"applicationError":{"code":"ALREADY_EXISTS"}}}`.
4. **Query Members** — a plain `{ query: { filter: { loginEmail } } }` finds the
   existing member, which is what makes enlist idempotent.

## Status

- **Phase A + B: implemented** on `feature/passwordless-members`. Every credential
  module is deleted (`accountPanel`, `session`, `wixAuth`, `config` — the OAuth,
  PKCE and password transport), the enlist form gates multiplayer, and the Worker
  creates the member and mints the ticket. The built bundle contains no password
  field, no OAuth call and no PKCE code — grep it and see.
- **Phase C onward: not started.** Until the relay verifies tickets, `verifiedMember`
  is false for everyone, so lobby verification badges are absent by design rather
  than broken. `MEMBER_AUTH` stays in `log`.
- Search Console: the Worker serves `google<token>.html` as soon as the
  `GOOGLE_SITE_VERIFICATION` secret is set — no deploy needed to start the review.
