// Shared angle math for the deterministic sim.
export function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Signed shortest delta from `current` to `goal` in (-π, π]. */
export function angleDelta(current: number, goal: number): number {
  return Math.atan2(Math.sin(goal - current), Math.cos(goal - current));
}

/** Rotate toward `goal` at a constant `rate` (rad/s) — how real turrets traverse. */
export function slewAngle(current: number, goal: number, rate: number, dt: number): number {
  const delta = angleDelta(current, goal);
  const step = rate * dt;
  if (Math.abs(delta) <= step) return normalizeAngle(goal);
  return normalizeAngle(current + Math.sign(delta) * step);
}

/** Exponential approach — for soft, non-mechanical motion. */
export function dampAngle(current: number, goal: number, lambda: number, dt: number): number {
  const delta = angleDelta(current, goal);
  return normalizeAngle(current + delta * (1 - Math.exp(-lambda * dt)));
}
