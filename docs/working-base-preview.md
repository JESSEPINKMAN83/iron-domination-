# Working base and layered interception

Branch: `codex/base-activity-threat-interception`, from deployed main including PR #96.

## Local test

http://127.0.0.1:5183/?start=test&base-activity-test=1&map=natanz&armies=2&doctrines=iron-legion,missile-command&size=small&seed=41&relief=0.3&combat=manual&time=day&weather=clear&preview=2

The local-only panel provides a powered base, an opposing missile program and controlled buttons. AI commanders are paused in this scenario so the player can compare one event at a time.

1. View Iron Dome, then send an incoming missile or drone. The battery detects strategic threats within 420 world units and launches visible defense missiles at 190 units/s. Other units retain their existing short air-weapon ranges. Battery firing is limited to three live interceptors per launcher with cooldowns and assigned-damage limits.
2. Watch the Code Red report name the threat, army and world compass bearing. Radar briefly marks the threatened area with a pulsing ring and the same direction; existing moving threat contacts remain visible.
3. Produce Apache. The camera focuses on the helipad. Produced aircraft spawn in a reserved near-pad slot, spool for one second, lift vertically for 1.5 seconds, then follow the existing rally order. This is deterministic simulation state, included in serialization and state hashing; player possession can take control immediately.
4. Produce tank + infantry. Production shutters open near job completion and remain open briefly after departure. No movement/collision shortcuts are added for ground units.
5. Repair damaged facilities. Existing paid repairs continue to drive HP recovery. Small service-arm/beacon assemblies appear only during repair, hide in fog and disappear when repair ends or the building dies. Three meshes per active facility, no point lights or particle emitters.

## Interceptor correctness

- Uses a bounded bisection solve for a reachable future meeting point, rather than a two-step travel-time guess.
- In-flight rounds adjust the meeting position when a strategic drone changes course. Damage occurs only at arrival and within the meeting tolerance; no damage at launch or after target impact.
- Rendered strategic missile/drone sine arcs now match simulation arcs, so the visible threat and interceptor can meet.
- Interceptor events are distinguished from threats; they do not get enemy health bars or turn into the enemy wreck when a shared strategic id is intercepted.

## Verification

- Production build passed (existing bundle-size warning).
- 733 tests passed across 96 files, including raised-terrain interceptor meetings.
- Regression coverage includes early launch before point defenses, no launch damage, physical meeting before damage, bounded rounds, incomplete batteries, departure timing and retained orders, compass bearings, and bounded/fogged repair effects.
- Local browser confirmed directional reports, radar pulses, production queueing, repair visuals, and Iron Dome's intercepted outcome. No observed console errors.
- Preview controls are excluded from the production JS. Local preview approved for release.
