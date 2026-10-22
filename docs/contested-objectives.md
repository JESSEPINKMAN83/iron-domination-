# Contested objectives and weapon feedback

Battlefield capture sites complement tactical target priorities and movement orders.

## Capture sites

New normal matches contain three public neutral landmarks. Park an armed ground unit beside the structure, inside its marked 25 m ring, for eight seconds. Site structures have solid ground-navigation footprints, including after loading older saves. Center-click orders resolve to reachable positions beside the structure. Hostile presence freezes capture and benefits. Capture requires continuous occupation; leaving before completion resets progress. Aircraft, collectors and buildings cannot capture. Allied units cooperate; ownership changes only after the entire capture completes.

- Radar: 180 m vision shared with allies.
- Supply: parked ground combat units within 36 m regain 2% maximum health per second.
- Oil: 100 credits every ten seconds, without AI income multipliers.

Neutral sites fly a white flag. During visible uncontested capture, the flag and label identify the capturing country; completed sites retain their owning country flag, even after defenders leave. Contested neutral sites remain white, and contested owned sites keep their owner flag. Labels/tooltips distinguish the current owner from the capturing army. Sites can be recaptured and persist in saved games. They do not replace headquarters as the victory condition. Both AI doctrines assign up to two healthy reserves to capture duty, keeping assault squads intact. Site locations/ownership are public; capture progress is shown only with local vision or allied ownership.

The three landmarks use 22 static meshes in total, shared geometry, and no shadows, extra lights or particles. Capture/reward processing runs at 10 Hz and scans ground movers, not all world objects per site.

## Combat feedback

Terminal events display distinct armor-hit (amber), hit (mint), interception (cyan), miss (muted gray), and destruction (red) labels. Interceptions use a cyan pulse instead of an orange ground explosion. Missile launches are not mistaken for misses. Miss labels are local-only, visible-only and throttled to prevent automatic-fire spam. Existing quality budgets and label caps remain enforced.

## Local exercise

Open `http://127.0.0.1:5183/?start=test&aircraft-route-test=1&objective-test=1&armies=2&sides=1,2&doctrines=iron-legion,missile-command&combat=manual&size=small&time=day&weather=clear`.

1. Click Radar, Supply or Oil at the top to locate it; right-click inside the ring with the selected tanks.
2. Hold eight seconds and watch capture progress, ownership and flag color change.
3. Use **Send enemy raiders** after capturing a site to test combat/contesting. Move defenders away to let enemies recapture.
4. Fight with tanks/aircraft to see armor-hit and destruction feedback. Ground-fire away from enemies to see misses. An ordinary match with missile defense provides actual interception feedback.
5. Supply repairs parked damaged ground troops; Oil pays in ten-second batches. AI commanders are paused in this controlled exercise; ordinary matches enable both factions' capture detachments.

Validation covers capture duration, contesting, recapture, alliance rules, ineligible aircraft, income, repairs, serialization/hashes, both AI doctrines, terminal-event classification, and repeated combat effects under every existing budget. Relay tests pass with local socket permissions; production build passes.
