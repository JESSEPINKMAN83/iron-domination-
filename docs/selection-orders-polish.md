# Selection and orders polish — local review

Branch: `feat/selection-orders-polish`, based on merged main `c0ed1ed`.

- Selection rings have a dark edge and mint center in the same draw, with bounded growth at distant zoom. Box selection has matching contrast.
- Screen click assistance follows projected hull size, bounded between 14/18 and 84 CSS pixels. Small distant targets retain assistance; nearby large units have larger hit areas. Building picking/occlusion priority is unchanged.
- Empty clicks reset double-click history; the box-drag threshold now agrees on move and release.
- Quick paths display the simplified waypoints that will actually be sent, with outlined strokes, a direction arrow and endpoint. The canvas redraws only on stroke/size/camera changes. Existing right-drag entry and coalesced input handling remain; units continue previous orders until release.
- Accepted paths briefly remain on terrain using one reusable bounded line buffer. New paths replace the receipt; ordinary move/attack/stop clears it. This is order feedback, not a promise that terrain obstacles can be crossed in a straight line.
- Move/attack/stop confirmations show order type and selected count; paths also show waypoint count. Rejected paths report a failure instead of silently disappearing. Multiplayer text says “sent” because relay acceptance is not final simulation acknowledgment.

## Local preview

`npm run dev -- --host 127.0.0.1 --port 5191 --strictPort`

Practice with six preselected friendly vehicles and unarmed enemy targets (existing test scenario, enemy AI disabled):
http://127.0.0.1:5191/?start=skirmish&armies=2&tank-combat-test=1&seed=231127&doctrines=expeditionary-force,missile-command

Normal game: http://127.0.0.1:5191/?start=skirmish&armies=2

Try a unit click, drag box, right-click move, right-drag route, second replacement route, Escape cancellation and X to stop. The Quick Tactic button opens the same drawing surface for a left-button stroke.

## Verification and cost

All 1,000 tests / 132 files pass; production build passes with the existing bundle-size advisory. New tests cover zoom bounds and reuse/replacement/clearing/expiry of the route buffer. Desktop browser verified unit selection, move confirmation, path execution, replacement, release over the HUD, Escape preserving the previous order, and X stopping all six units; no console warnings/errors. The path was exercised through the existing Quick Tactic button; automated right-button dragging was not available in the browser tool.

Rings keep one draw per selected unit (more vertices for the contrasting bands); route feedback adds one short-lived line. No new full-screen shader, postprocessing, light, shadow, gameplay simulation, navigation rule or network protocol. Full-battle/mobile performance has not been benchmarked for this change. The user approved the local preview for publication and deployment.
