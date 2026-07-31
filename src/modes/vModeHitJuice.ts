import type { CombatEvent } from '../sim/world';

export interface HitShakeProfile {
  strength: number;
  duration: number;
}

export interface DirectionalHitFeedback {
  side: number;
  longitudinal: number;
  vertical: number;
  roll: number;
  pitch: number;
  zone: NonNullable<CombatEvent['impactZone']>;
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

export function directionalHitFeedback(event: CombatEvent, lookYaw: number): DirectionalHitFeedback {
  let dirX = event.impulseX ?? event.toX - event.fromX;
  let dirZ = event.impulseZ ?? event.toZ - event.fromZ;
  const length = Math.hypot(dirX, dirZ);
  if (length > 0.001) {
    dirX /= length;
    dirZ /= length;
  }
  const localAngle = Math.atan2(dirX, dirZ) - lookYaw;
  const side = Math.sin(localAngle);
  const longitudinal = Math.cos(localAngle);
  const zone = event.impactZone
    ?? (event.trajectory === 'drop'
      ? 'top'
      : Math.abs(side) > Math.abs(longitudinal)
        ? side >= 0 ? 'left' : 'right'
        : longitudinal >= 0 ? 'rear' : 'front');
  const top = Math.max(event.topFactor ?? 0, zone === 'top' ? 0.9 : 0);
  return {
    side,
    longitudinal,
    vertical: top,
    roll: (zone === 'left' || zone === 'right' ? side : side * 0.32) * (1 - top * 0.35),
    pitch: zone === 'top' ? 0.72 : -longitudinal * 0.62,
    zone,
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
