# IRON DOMINION — Quality Uplift & Road to Phase 6+

State after Codex's run: Phases 1–5 are playable but several plan-critical systems were
simplified or faked. This plan raises quality to spec *before* piling on features, then
proceeds with Phase 6. Keep: the chase-cam possession with pitch-ranged bombs
(far = inaccurate scatter) — it's the fun core.

## 0. Bugs (fix first)

**B1 — Tank dies right after leaving V mode.** Root cause, two layers:
1. All damage is applied *instantly* in the sim; the flying bomb in `CombatView` is a
   purely cosmetic bezier. So hits land seconds before the visuals do.
2. The possessed tank is protected by a hack (`isWeaponAllowedToTarget`: enemy bombs may
   not target `playerControlled`). On exit the flag is deleted → every enemy bomb off
   cooldown instantly targets and damages the tank → it explodes "for no reason".

Fix: make bombs **real sim projectiles** (travel time, land at the aimed *location*,
damage on impact, splash only). Delete the immunity hack — a moving tank dodges
naturally, rules identical possessed or not (plan §Phase 5 "cross-mode integrity").
Visual flight duration = sim flight duration, blast when damage actually lands.

## 1. Quality uplift (this session)

- **Q1 Turret traverse** (plan §4/§5): turrets slew at their real `turnRate`
  (constant-rate, not instant snap); cannons only fire when aligned (±7°). Applies to
  AI and to manual fire — you *feel* heavy turrets in chase mode.
- **Q2 Soldiers** (user report: "boxes"): articulated low-poly soldier — helmet, torso,
  pelvis, two-segment legs, arms holding a rifle; procedural walk cycle driven by sim
  velocity, aimable upper body (reuses turret yaw), muzzle-height tracers, falls over on
  death. Placeholder-art quality bar: silhouette reads as a soldier at RTS zoom.
- **Q3 Wrecks** (plan §4): destroyed tanks become scorched husks for 20 s instead of
  squashing to 45% height.
- **Q4 Fog of war** (plan §4, prerequisite for honest AI): per-team visibility grid
  (128², visible/explored/unexplored), terrain shroud overlay, hidden enemy
  units/health bars/combat VFX, fogged minimap. Buildings provide vision.

## 2. Phase 6 — Enemy Commander AI (this session)

- Per-team economy (credits/power/production per team) — refactor, player = team 1.
- AI base spawns east: command yard + power → refinery → factory build order, placement
  ring-searched around its yard; rebuilds losses, adds refineries as it grows ("logs
  show it rebuilding and expanding" — visible in console as `[ai] …`).
- Squad system: forms squads from idle tanks, attack-moves at last-*seen* player assets
  (uses its own visibility grid — no map hacks on Normal), retreats squads under 40%
  strength, diverts pressure onto the player's possessed unit when spotted.
- Personalities: turtle / rusher / balanced (`?ai-style=`), difficulty easy / normal /
  hard (`?ai=`) = income multiplier + reaction delay + army cap, never map hacks.
- Victory/defeat: lose all buildings → banner. Game starts as a real match now
  (small starting forces); `?debug=armies` restores the 120-tank stress spawn.
- Tests: AI grows economy + attacks deterministically (same seed → same sim hash).

## 3. Later phases (unchanged from build plan, quality notes added)

- **Phase 7 Presentation**: replace all procedural placeholder art (GLB set, skeletal
  infantry anims replace Q2's procedural rig, real VFX/audio/music, 2 more maps,
  skirmish screen). This is where "wow" lives — budget it the most.
- **Phase 8 Meta/balance/polish**: save/load, settings, tutorial, AI-vs-AI balance
  harness, LOD/pooling perf pass, accessibility.
- **Phase 9 (optional) Multiplayer**: deterministic core already maintained for this.
- Deferred debts to revisit in 7/8: harvester units with real ore hauling (income is
  currently a flat per-refinery drip), ore field depletion, defenses (turrets) +
  power-brownout disabling them, veterancy, minimap fog on water, per-unit FPS fog.
