import type { CombatEvent } from '../sim/world';

export interface HitShakeProfile {
  strength: number;
  duration: number;
}

export function impactForceFromEvent(event: Pick<CombatEvent, 'force' | 'damage' | 'targetMaxHealth'>): number {
  const fromForce = event.force;
  if (typeof fromForce === 'number' && Number.isFinite(fromForce)) {
    return Math.max(0.02, Math.min(1, fromForce));
  }
  const maxHealth = Math.max(1, event.targetMaxHealth ?? event.damage);
  return Math.max(0.02, Math.min(1, event.damage / maxHealth));
}

/** Stronger camera punch curve for possessed-unit hits. */
export function hitShakeProfile(force: number): HitShakeProfile {
  const f = Math.max(0, Math.min(1, force));
  return {
    strength: 0.22 + f * 1.25,
    duration: 0.22 + f * 0.62,
  };
}

export function hitFlashOpacity(force: number): number {
  const f = Math.max(0, Math.min(1, force));
  return Math.min(1, 0.22 + f * 0.85);
}

/** Persistent edge vignette while hull is low in V-mode. Zero above 35% HP. */
export function lowHpVignetteOpacity(hullPct: number): number {
  if (!Number.isFinite(hullPct) || hullPct >= 0.35) return 0;
  const t = Math.max(0, Math.min(1, (0.35 - hullPct) / 0.35));
  return 0.18 + t * 0.62;
}

export function reticleFlashIntensity(force: number): number {
  const f = Math.max(0, Math.min(1, force));
  return 0.35 + f * 0.65;
}

export function possessionHitGain(force: number): number {
  const f = Math.max(0, Math.min(1, force));
  return 0.28 + f * 0.42;
}
