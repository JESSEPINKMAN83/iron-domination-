# V-Mode Flight Feel Spec — Helicopters & All Future Flyers

> **For the coding agent.** This is a focused rework of possessed (V-mode) flight.
> The current implementation works but feels like a flying car. This document explains
> exactly why, and how to rebuild it into a proper arcade-helicopter model — plus a
> data-driven structure so future flyers (jets, drones) get their own feel instead of
> inheriting the helicopter's. Follow the invariants in `CODEX_PHASES_PLAN.md`
> (deterministic 30 Hz sim, no three.js in `/src/sim`, A/D convention: **D = right =
> negative turn** with the `(sin rot, cos rot)` heading).

## 1. Diagnosis of the current model (`src/sim/world.ts`, flight branch of `stepSim`)

1. **Velocity is commanded, not accumulated.** `desired = heading × speed × throttle`,
   then `velocity → desired` at λ≈8/s. Release W → the helicopter stops in ~0.4 s like
   a car lifting off the gas. Helicopters *drift*: they are momentum machines and the
   whole skill/joy loop is managing that momentum.
2. **Velocity is always along the hull heading.** Rotating the nose instantly
   redirects motion — no sideslip, no drifting through a turn while the nose tracks a
   target. That kills both realism and the gunship fantasy (orbiting a target while
   firing sideways-ish).
3. **No attitude.** Real (and good arcade) helicopters tilt to move: nose-down to
   accelerate, nose-up to brake (flare), roll to strafe. Here `bank` is a cosmetic
   by-product of yaw, and pitch attitude doesn't exist at all. The airframe never
   *leans into* what it's doing, so motion reads as sliding, not flying.
4. **No strafe.** A/D only yaws. Lateral translation is a signature helicopter move
   (strafing runs, circle-strafing AA) and is currently impossible.
5. **Mushy climb.** `climb` input moves a *target altitude* that a damped
   vertical-velocity chases through two filters. Feels like an elevator. Collective
   should command vertical velocity semi-directly with light inertia.
6. **Hull auto-slews to mouse at a fixed 3.4 rad/s** regardless of speed, and the
   nose gun has no gimbal — small aim corrections rotate the whole airframe.

## 2. Target model: attitude-driven arcade helicopter

Keep it deterministic and cheap: no rigid body, no torque solver. The model is
**attitude in → acceleration out → velocity integrates with drag**. All state lives in
the sim; render only interpolates.

### 2.1 New/changed sim state

```ts
// components.ts
interface Flight {
  // …existing fields…
  pitchAttitude: number;   // radians, +nose-up (drives motion AND visuals)
  rollAttitude: number;    // radians, +right-roll  (replaces render-only 'bank')
  model: FlightModelId;    // 'gunship' | 'jet' | 'drone' — see §4
}
// PlayerControlled gains: strafe: number (-1..1)   // Q = left, E = right
```

`content/flightModels.ts` — every number below lives here, per model, never inline:

```ts
export interface FlightModel {
  maxSpeed: number;          // gunship 46
  maxReverse: number;        // 12
  maxStrafe: number;         // 16
  tiltAccel: number;         // 15  m/s² at full forward tilt
  strafeAccel: number;       // 10
  dragK: number;             // ≈ tiltAccel / maxSpeed² → v_max emerges from physics
  maxTiltPitch: number;      // 0.34 rad (~19°) visible nose-down at full W
  maxTiltRoll: number;       // 0.42 rad
  attitudeLag: number;       // 6   (λ for attitude approaching its commanded value)
  yawRateHover: number;      // 2.6 rad/s
  yawRateAtSpeed: number;    // 1.3 rad/s (interpolate by speed/maxSpeed)
  weathervane: number;       // 0.35 — heading pulled toward velocity vector at speed
  climbRate: number;         // 14 m/s
  climbAccel: number;        // 22 m/s² vertical response (snappy but not instant)
  hoverDamp: number;         // 0.6 — horizontal bleed λ when no inputs (auto-hover)
  groundEffect: number;      // 0.5 — descent-rate reduction inside 8 m AGL
  gimbalHalfAngle: number;   // 0.44 rad — nose-gun yaw authority before hull must turn
  mouseFollowRate: number;   // 2.2 rad/s hull chase of aim yaw (was 3.4, too twitchy)
}
```

### 2.2 The per-tick integration (possessed flyer), in order

1. **Inputs** (already collected in `firstPersonController.simTick`):
   `throttle` (W/S), `turn` (A/D, D negative), `strafe` (Q/E — NEW), `climb`
   (Space/Ctrl), `aimYaw`/`aimPitch` from mouse.
2. **Yaw**: `yawRate = lerp(yawRateHover, yawRateAtSpeed, speed/maxSpeed)`.
   Hull yaw = keyboard turn × yawRate **plus** slew toward `aimYaw` at
   `mouseFollowRate`, **but only when the aim exceeds the gun gimbal** (§2.4), plus
   `weathervane`: when `speed > 0.4·maxSpeed`, blend heading toward the velocity
   vector's direction at `weathervane · yawRate` — flying fast keeps the nose honest
   without robbing low-speed freedom.
3. **Attitude command** (this is the heart of the rework):
   `pitchCmd = -throttle × maxTiltPitch` (+ a small `+0.3·maxTiltPitch` flare when
   braking from speed: throttle ≤ 0 while `speed > 8`);
   `rollCmd = strafe × maxTiltRoll + yawRateApplied × speed × 0.010` (lean into turns).
   Approach: `pitchAttitude → pitchCmd`, `rollAttitude → rollCmd` at `attitudeLag`.
   **Attitude is state, not decoration** — acceleration derives from it next.
4. **Acceleration from attitude** (in hull frame, then rotate to world):
   `aFwd = -sin(pitchAttitude)/sin(maxTiltPitch) × tiltAccel`
   `aSide = sin(rollAttitude)/sin(maxTiltRoll) × strafeAccel`
   Reverse is naturally weaker because flare pitch is capped lower than dive pitch.
5. **Drag + integrate**: `a -= velocity × dragK × |velocity|` (quadratic, so top speed
   emerges instead of being clamped), then `velocity += a·dt`,
   `position += velocity·dt`. **Never snap velocity to a "desired" vector again.**
6. **Auto-hover assist**: if all of throttle/strafe/turn are zero, additionally bleed
   horizontal velocity at `hoverDamp` λ and level attitude to a gentle hover bob
   (±0.12 m sine at 0.9 Hz, seeded by entity id — deterministic). This keeps the
   drift *manageable*: momentum exists, but letting go of the keys settles you into a
   stable gun platform within ~2 s. This single behavior is what makes the model
   playable by a 10-year-old and satisfying for an adult.
7. **Vertical**: `vyTarget = climb × climbRate` (climb input, else 0 in hover);
   `verticalVelocity → vyTarget` at `climbAccel` (m/s², linear approach — one filter,
   not two). Power-budget coupling: while `|climb| > 0.5`, scale `tiltAccel` by 0.75
   (climbing steals from forward drive — subtle but very "helicopter").
   Ground effect: below 8 m AGL, descent rate scales by `groundEffect`.
   Keep the existing terrain-ahead lookahead + `minAGL` clamp and crash rule, but
   **soften the crash**: only crash if `verticalVelocity < -9` or horizontal
   `speed > 18` at contact; otherwise it's a hard-bounce (kill velocity, +0.5 m,
   10 damage, camera thump event) — clipping a ridge shouldn't always be death.
8. **AI-controlled flyers reuse steps 3–7** by synthesizing throttle/strafe from
   their steering intent (`desired velocity → attitude commands`). One model, two
   input sources — that keeps AI aircraft visually identical to possessed ones
   (banked approaches, flares on arrival) and preserves cross-mode integrity.

### 2.3 Render (`unitView`)

- Apply `pitchAttitude`/`rollAttitude` to the airframe mesh (rotate fuselage, not the
  whole object — rotor stays roughly level-ish, tilting ~60 % of fuselage tilt).
- Interpolate attitude and `y` between ticks like x/z/rot (add them to
  `previousTransform` handling; attitude snaps look terrible at 30 Hz).
- Rotor: spin rate = base + 40 %·(collective + |tilt|); add a subtle collective
  "blade cone" scale-y squash when climbing hard.

### 2.4 Aiming & camera (`firstPersonController`)

- **Gun gimbal**: nose weapon aims at `aimYaw` freely within `±gimbalHalfAngle` of the
  hull; the hull only starts its `mouseFollowRate` chase when aim leaves the gimbal.
  Result: fine aim corrections no longer wag the airframe.
- **Camera follows velocity, not heading**: chase position anchors behind the
  *velocity vector* blended 65/35 with heading (at hover: pure heading). Distance
  14→19 m and FOV 62→70 scale with speed. Position damp λ≈4.5, look-target λ≈9 — the
  helicopter should visibly slide within the frame during turns (that's where the
  feeling of mass comes from).
- Camera **roll** = 30 % of `rollAttitude` (clamped ±8°).
- Reticle: keep crosshair, add a small **velocity-vector dot** (project
  `velocity` 60 m ahead) — players learn to drift-aim with it instantly.
- Effects hooks (cheap, sim-event driven): rocket volley kick = +1.5° pitch impulse to
  the *camera* only; hard-bounce event = 0.2 s shake.

## 3. Tuning targets (playtest checklist — iterate until all pass)

| Check | Target |
|---|---|
| 0 → max speed (full W) | ~3.5 s, visible nose-down the whole way |
| Max speed → hover (full S flare) | ~2.5 s, nose-up flare, slight balloon +2 m |
| Release all keys at max speed | drifts ~35–45 m, settles to hover in ~2.5 s |
| 180° turn at speed (A/D held) | ~2.0 s, banked, keeps ≥60 % of speed, visible sideslip |
| Strafe orbit around a tank at 60 m | sustainable with E + slight A, nose stays on target |
| Hover aim | rock-steady within 1 s of releasing keys (auto-hover) |
| Clip a ridge at low speed | bounce + damage, not death |
| Dive into ground at speed | crash spiral (existing flow) |

Add a debug overlay (F6): speed, vy, AGL, pitch/roll attitude in degrees, drift
vector. Tuning without instruments is guesswork.

## 4. Future flyers: one integrator, three models

Branch by `flight.model` on the *command* stage only (steps 2–4); integration (5–7)
stays shared:

- **`gunship`** (Vulture, current): as specified above. Hover-capable.
- **`jet`** (future strike aircraft): no hover — enforce `minSpeed ≈ 0.4·maxSpeed`
  (throttle maps within [min,max], S is airbrake not reverse); **turning is banking**:
  A/D and mouse command roll, turn rate = `g·tan(roll)/speed` (fast when slow, wide
  when fast); climb comes from pitch attitude at speed, not collective; Space/Ctrl
  nudge pitch instead of vy. Attack runs + wide turnarounds fall out of the math.
- **`drone`** (future scout/support): low inertia (attitudeLag 12, drag high), snappy
  strafe, low maxSpeed, near-instant hover — deliberately "easy mode".

Do **not** give jets the helicopter integrator with bigger numbers — the min-speed +
bank-to-turn constraints are what make a jet read as a jet.

## 5. Order of work & guardrails

1. `content/flightModels.ts` + `Flight.pitchAttitude/rollAttitude/model` + strafe
   input (Q/E) end-to-end. Q/E are free in possession mode (they're RTS camera keys
   only outside possession — verify no conflict).
2. Rewrite the possessed-flight branch of `stepSim` per §2.2 (steps 2–7). Keep the
   AI branch functional by mapping its steering to the same commands (step 8).
3. Gimbal + camera changes (§2.4). 4. Render attitude (§2.3). 5. Debug overlay.
6. Tune against §3 with the user playtesting.
- Determinism: add a test — scripted 600-tick input tape (W, then turn, then strafe,
  then flare) on a possessed Vulture → identical `hashSim` across two runs; include
  attitude fields in the hash (round ×1000).
- All existing tests must stay green (AI flyers still route, rearm, and fight).
- Do not regress: D turns **right** in every flyer; V toggles out; crash-eject flow.
