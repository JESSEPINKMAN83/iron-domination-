# Soldier Visual Upgrade — Make Infantry Read as Soldiers

> **For the coding agent.** The soldier rig (`src/render/soldier.ts`) has good bones —
> articulated hips/knees, aimable torso via `turretPivot`, per-kit gear, shared
> geometry caches — but reads as "toy robot": cube head, slab torso, mitten-less
> block hands, one static arm pose, one walk cycle, one death crumple. This spec
> upgrades it to "little soldier" at both RTS zoom and V-mode close-up, still fully
> procedural (no GLB yet — that's Phase 7). **Zero sim changes**: everything below is
> render-only, driven by state the sim already exposes. Keep the `turretPivot`
> contract, kit system (`rifle/grenadier/rocket/sniper`), shared-geometry cache,
> wreck material-swap, and eviction/disposal paths working.

## A. Proportion & anatomy pass (biggest single win)

Current body is ~4.5 "heads" tall — toy proportions. Target ~6.5–7 heads (heroic
military): shrink head box to ~0.17, shorten neck, lengthen legs slightly.
- **Torso in two masses**: chest box (wider, 0.44) over abdomen box (narrower,
  0.34) with a slight forward chest tilt — kills the "slab" read instantly.
- **Shoulders**: small pauldron boxes capping each arm joint (uniform material,
  accent stripe on the left one). Silhouette gains the classic soldier "T".
- **Hands**: two-part mitt (palm box + thumb nub) gripping the weapon at real grip
  points — move the existing hand boxes onto the rifle's grip/foregrip positions so
  weapons look *held*, not floated.
- **Boots/kneepads**: keep, slightly larger boots (ground anchor).

## B. Head & helmet (the "is it a person?" test)

- Helmet becomes 3 parts: low-poly dome (8-seg cylinder cap or scaled box stack),
  brim, and **side ear covers**; chin-strap thin dark box under the jaw.
- **Goggle strip**: dark glossy box across the upper face (new shared `visor`
  material, slight emissive-none gloss) + a small NVG mount block on the helmet
  front. The eye-line is what makes faces read at distance.
- Face: keep skin box but add a darker under-shadow strip below the goggles
  (painted onto the skin material? No — separate thin box, materials stay shared).
- Helmet camo band = existing accent band (unchanged, it's the team read).

## C. Uniform texture — camo without new art

Replace the flat `uniform` color with a **canvas-painted camo texture** (reuse the
`textures.ts` blotch/speckle painters): 2 shared textures total, one per faction
palette (Meridian: green/gray disruptive; Ash Legion: rust/brown). Apply to uniform
material only (vest/gear stay dark). Also paint faint fabric noise. This is ~30
lines using existing helpers and transforms the close-up read.

## D. Weapon handling poses (per kit, static — set once at build)

- **Rifle**: proper two-hand hold — stock into right shoulder, support hand at
  foregrip, muzzle slightly down at idle ("low ready"), level when `weapon.targetId`
  is set (aim state, see E).
- **Grenadier**: launcher carried at hip with both hands on top, body angled 15°.
- **Rocket**: tube ON the shoulder (currently floats at chest height) — right hand
  under, left hand steadying front; head tucked left of the tube.
- **Sniper**: rifle high-ready across chest at idle; horizontal when aiming.

## E. Animation states (render-side, driven by existing sim state — no events needed)

Extend the per-entity `AnimState` in `unitView.ts`:
- **Aim state**: `weapon.targetId !== undefined` → raise weapon to firing pose,
  blend over ~150 ms (one lerp factor, like `swing`).
- **Recoil on fire**: detect a shot render-side: weapon `cooldown` jumped up since
  last frame (track `lastCooldown` per entity) → kick the rifle/tube back 0.05 m and
  torso 2° for ~100 ms, and flash a small additive muzzle quad at a cached muzzle
  ref for 2 frames. Works for every kit incl. rocket back-blast (bigger flash aft).
- **Crouch-fire**: stationary (`speed < 0.4`) AND aiming → lower stance: hips bend,
  knees bend, torso drops ~0.12 — soldiers who fight from a braced crouch look
  trained. Rocket kit kneels fully (rear knee down) — the classic AA pose.
- **Run lean by speed**: scale the existing forward lean and arm-pump with
  `speed/maxSpeed` instead of the binary `swing` (walk vs sprint reads differently).
- **Death variety**: replace the single sideways crumple with 3 deterministic
  variants picked by `hash2i(entity.id, 0, 0xdead)`: crumple-sideways (current),
  knees-then-face-down (rotate x), blown-backward (rotate -x + slide 0.4 m). Limbs
  relax: hips/knees to slack angles over the fall. Corpses keep the 20 s persist.
- All state transitions are pure functions of sim state + entity id — identical on
  every client, no sim mutation, no event plumbing.

## F. Grounding details

- **Footstep dust**: tiny fading quad puff at alternating foot positions while
  `speed > 6`, budgeted (shared geometry, ≤ 1 puff per soldier per half-cycle,
  global cap ~40 active — follow the combatView effect pattern with disposal).
- Weapon sling: one thin dark box diagonal across the back when kit ≠ rifle.
- Belt pouches ×3 + canteen on the pelvis box.

## G. Budgets, guardrails, QA

- ≤ 40 meshes per soldier (currently ~20; the additions above fit), ALL from the
  shared geometry caches; ≤ 3 new shared materials total (visor + 2 camo uniforms).
- No per-frame allocations; new animatable refs (muzzle, hands, shoulders) cached in
  the rig at build time — never `getObjectByName` in update.
- Wreck/death material swap, fog hiding, selection rings, health bars, possession
  hide, and eviction disposal must keep working (run a match: kill soldiers of every
  kit, possess one, check nothing regresses).
- QA in `?start=lineup`: screenshot all 4 kits × 2 factions at close + mid + far
  zoom. Acceptance: at close zoom they read as *soldiers* (helmet/goggles/held
  weapon/camo); at far zoom kit silhouettes stay distinct; firing squads show
  aim-raise, recoil, muzzle flashes, crouches; three different death poses visible
  after a battle; `npm test` green (no sim file touched — if one changed, stop).

## Order of work
1. Proportions + shoulders + hands (A) — re-screenshot lineup.
2. Head/helmet/goggles (B). 3. Camo textures (C). 4. Kit poses (D).
5. Anim states (E) one at a time: aim → recoil/flash → crouch → deaths → run lean.
6. Grounding details (F) last, under budget. Commit per step.
