# Live unit loss feed

Branch: `codex/unit-loss-feed`, based on main after PR #98. Local review only.

Preview: http://127.0.0.1:5183/?start=test&aircraft-route-test=1&loss-feed-test=1&armies=2&sides=1,2&combat=manual

- Small chip below Menu shows your total unit losses this match. A new casualty displays the count and unit types for eight seconds, then returns to the quiet total.
- Losses within three simulation seconds of the first casualty are grouped into one report. Click the chip for per-type totals and newest-first timestamped history. Earlier reports load in pages of 50; data remains available for the current match.
- Tracks the local army only, including collectors and crashes. Buildings and hostile armies are excluded. Existing wrecks on initial load are not treated as new casualties. History starts when this match session loads; it is not persisted in saves.
- Presentation-only observer checks the local living roster at 10 Hz and catches destroyed entities before removal. No changes to damage, deterministic simulation or network commands.
- Test buttons deliberately destroy up to two matching friendly units. They are excluded from production builds.
- Five focused tests passed: four casualty-accounting regressions and the existing two-peer lockstep test. Production build passed with the existing bundle-size warning. Browser verified grouped aircraft losses, collector loss, counts and history.
