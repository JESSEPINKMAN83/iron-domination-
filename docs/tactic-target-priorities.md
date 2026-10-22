# Tactical target priorities

The planner uses the entire selected group. New plans default to High speed, 50% variation, Attack as you move, and Draw path; controls remain adjustable for the current plan.

In Define Tactic, expand **Target priorities** and select any combination of economy, anti-air threats, missile/drone sites, aircraft, artillery, defenses, armor, infantry, production, or headquarters. No selection preserves normal targeting.

With **Attack as you move**, units finish the route while firing at compatible enemies in sight/range. A preferred target takes precedence over an incidental target, including when it enters range mid-flight. If no preferred target is available, weapons fire at other legal enemies. Priorities never cause a detour or chase. Multiple selected groups have equal priority; weapon compatibility, terrain line of sight and hostility still apply.

The preferences belong to that tactic, survive waypoint transitions, formation changes and save/load, and travel through the existing multiplayer tactic command. Finishing/cancelling/replacing the tactic removes them. Manual possession and explicit attack commands retain their existing control behavior.

Visible matching enemies receive amber outlines in the planner; targets hidden by fog are not revealed. Preferred-target scans for an already engaged incidental target are staggered at 5 Hz using the existing nearby spatial query.

## Local practice scene

Use `?start=test&aircraft-route-test=1&target-priority-test=1&armies=2&sides=1,2&doctrines=iron-legion,missile-command&combat=manual&size=small&time=day&weather=clear`.

Six selected aircraft face durable collectors, refinery/power targets, missile/drone facilities, towers, artillery and incidental vehicles. Enemy commander movement is paused. Draw a path through the targets, select Attack as you move and one or more priorities, then Execute. Compare Economy versus Missile & drone sites versus no priorities. Use a fresh test session to reset destroyed targets.

## Validation

Automated coverage includes priority versus distance, retargeting from an incidental enemy, fallback on destruction, incompatible/out-of-vision/allied targets, route completion while firing, classification of real weapons and facilities, save/load, hash sensitivity, and lockstep command ownership.
