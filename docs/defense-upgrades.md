# Defense upgrade tiers

On `codex/unit-loss-feed`, alongside the local unit loss history feature. Not deployed.

Preview: http://127.0.0.1:5183/?start=test&base-activity-test=1&defense-upgrade-test=1&map=natanz&armies=2&doctrines=iron-legion,missile-command&size=small&seed=41&relief=0.3&combat=manual&time=day&weather=clear&preview=2

Select a completed friendly defense and use the upgrade button beside the selected-item count. Each tower upgrades independently, sequentially; MAX disables further spending.

| Tier | Price for this tier | Hull vs base | Damage vs base | Reload vs base | Missile speed vs base |
| --- | --- | --- | --- | --- | --- |
| I | 100 | 1.4× | 1.2× | 0.92× | 1.15× |
| II | 250 | 1.9× | 1.55× | 0.8× | 1.3× |
| III | 500 | 2.6× | 2.1× | 0.65× | 1.5× |

- All four defense types support upgrades: guard tower, AA/Iron Dome, Arrow 3, and Phalanx. Applies to either faction where that structure is available.
- Tier I adds an independent AA missile mount to guard towers and Arrow batteries. Their existing ground weapons/interception roles remain. Already air-capable defenses retain their current weapons.
- Strategic threats use actual interception rounds; upgraded damage/reload/speed apply to missile interception as well as ordinary combat. Existing early Iron Dome engagement radius and active interceptor cap remain unchanged.
- Damage percentage is preserved when hull increases: upgrading does not repair a damaged tower to full health. Ordinary paid repair still applies.
- Multiplayer uses a commander-only economy command with ownership/funds validation and an expected-level check to prevent duplicate queued clicks from buying unintended tiers. Level and added-mount cooldown/target state are serialized and hashed for recovery.
- Towers no longer accidentally receive vehicle-only upgrade menus. Sidebar hull data refreshes immediately after a tier purchase.
- No additional visual effects or per-frame simulation scans. Preview buttons and extra structures are development-only.

Verification: full suite 748 tests across 98 files passed; production build passed with existing bundle-size warning. Regression coverage includes all tier prices/caps, damaged hull ratio, ownership/funds/completion checks, real damage/speed/reload gains, AA acquisition, missile/drone engagement, save/recovery, multiplayer permissions and stale-command spending. Browser verified all guard tiers and the three specialist controls; no console errors.
