# New Game / Skirmish Setup — Minimal Spec (pre-Netlify ship)

> **For the coding agent.** Smallest possible "front door" so a public visitor can
> start, finish, and restart a match without URL parameters. **No save/load** — that
> is a later phase. Half-day scope; don't gold-plate. Keep all standing invariants
> (deterministic sim, dependency-free DOM UI, don't regress V-mode keys).

## 1. Skirmish setup screen (replaces auto-boot)

On page load show a full-screen overlay (reuse the loading-overlay styling — dark,
monospace, letter-spaced) instead of booting straight into a match:

- Title: `IRON DOMINION`, small subtitle line, version/phase tag.
- **Difficulty**: Easy / Normal / Hard (default Normal).
- **Enemy commander**: Turtle / Rusher / Balanced (default Balanced).
- **Map seed**: numeric field, defaulting to a random seed each visit, with a
  🎲 "randomize" button. Same seed = same map (say so in a caption — it's a feature).
- **START** button (large, obvious). Enter key also starts.
- A short controls card (condensed F1 help: select, orders, build, V-mode, fly).

Mechanics:
- Selected settings are written to `localStorage` (`iron-dominion.skirmish.v1`) and
  read back as defaults on the next visit.
- `boot()` takes the settings as a parameter object `{ seed, ai, aiStyle, debug }`.
  **URL params keep working and override the screen's defaults** (existing
  `?ai= / ?ai-style= / ?debug=armies` workflows must not break); when URL params are
  present you may skip the setup screen entirely except for START.
- Map seed flows into terrain: `generateHeightfield({ ...MAP01, seed: settings.seed })`
  and the scatter seed derives from it (today it's `MAP01.seed ^ 0x5eed` — derive from
  the chosen seed instead). **Do not mutate `MAP01` itself** — tests depend on it.
- Show the existing "generating terrain…" state after START.

## 2. Restarting

- **Victory/defeat banner** gains two buttons: `PLAY AGAIN` (same settings, new
  random seed) and `SETUP` (back to the setup screen). The banner is currently
  `pointer-events:none` — enable pointer events on the buttons only.
- **In-game**: a small `MENU` button (top-right, near the sidebar, or bottom of the
  sidebar) opens a tiny pause-less dialog: `Restart match` / `Back to setup` /
  `Cancel`. Restarting mid-match requires this confirm step — no accidental resets.
  Do **not** bind Escape (used by possession/placement) or F-keys already taken.
- Implementation of restart: write settings to `localStorage`, then
  `location.reload()`. A full reload is the *intended* design — zero teardown risk,
  and at 5 MB the reload is instant. Do not attempt in-place world teardown.
- In-game buttons must not steal keyboard focus (`tabindex="-1"`, blur after click)
  and must stop pointer propagation so clicks don't select units.

## 3. Acceptance

1. Fresh visitor (no URL params): setup screen → START → match boots with chosen
   difficulty/personality; F1 help unchanged; WASD/V/Space all work (no focus theft).
2. Win or lose → banner buttons work: PLAY AGAIN gives a **different map** (new
   seed), same settings; SETUP returns to the screen with previous choices remembered.
3. Same seed entered twice → identical terrain both times.
4. `?debug=armies` and `?ai=hard` still work as before.
5. `npm test` fully green (no sim changes should be needed at all); `npm run build`
   clean — this ships to Netlify immediately after.
