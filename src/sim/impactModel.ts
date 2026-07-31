import type { ArmorClass } from '../content/phase4';

export type ImpactZone = 'front' | 'rear' | 'left' | 'right' | 'top' | 'near';

export interface DirectionalImpactInput {
  targetX: number;
  targetY?: number;
  targetZ: number;
  targetRot: number;
  targetRadius: number;
  armor: ArmorClass;
  force: number;
  fromX: number;
  fromY?: number;
  fromZ: number;
  hitX: number;
  hitY?: number;
  hitZ: number;
  splashRadius: number;
  trajectory?: 'arc' | 'drop' | 'flat' | 'homing';
}

export interface DirectionalImpactResponse {
  zone: ImpactZone;
  directionX: number;
  directionZ: number;
  localSide: number;
  localForward: number;
  topFactor: number;
  directness: number;
  impulseSpeed: number;
  verticalImpulse: number;
  angularImpulse: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Converts a damage event into a bounded, deterministic physical response.
 * This models the combat motions players can read without running a rigid-body
 * solver for every unit.
 */
export function directionalImpactResponse(input: DirectionalImpactInput): DirectionalImpactResponse {
  const force = clamp(input.force, 0, 1);
  const radius = Math.max(0.5, input.targetRadius);
  const hitDx = input.targetX - input.hitX;
  const hitDz = input.targetZ - input.hitZ;
  const hitDistance = Math.hypot(hitDx, hitDz);
  const isNear = input.splashRadius > 0 && hitDistance > radius * 0.72;
  const directness = input.splashRadius <= 0
    ? 1
    : clamp(1 - Math.max(0, hitDistance - radius * 0.25) / Math.max(radius, input.splashRadius + radius), 0.22, 1);

  // A nearby blast pushes away from its detonation point. A direct strike
  // follows the projectile line, which remains stable at the target center.
  const originX = isNear ? input.hitX : input.fromX;
  const originZ = isNear ? input.hitZ : input.fromZ;
  let directionX = input.targetX - originX;
  let directionZ = input.targetZ - originZ;
  let distance = Math.hypot(directionX, directionZ);
  if (distance < 0.001) {
    directionX = -Math.sin(input.targetRot);
    directionZ = -Math.cos(input.targetRot);
    distance = 1;
  }
  directionX /= distance;
  directionZ /= distance;

  const forwardX = Math.sin(input.targetRot);
  const forwardZ = Math.cos(input.targetRot);
  const rightX = Math.cos(input.targetRot);
  const rightZ = -Math.sin(input.targetRot);
  const localSide = directionX * rightX + directionZ * rightZ;
  const localForward = directionX * forwardX + directionZ * forwardZ;

  const trajectoryTop =
    input.trajectory === 'drop' ? 0.94
      : input.trajectory === 'arc' ? 0.52
        : input.trajectory === 'homing' ? 0.2
          : 0.08;
  const heightTop = input.fromY !== undefined && input.targetY !== undefined
    ? clamp((input.fromY - input.targetY - radius * 0.4) / Math.max(2, radius * 2.4), 0, 0.92)
    : 0;
  const hitHeightTop = input.hitY !== undefined && input.targetY !== undefined
    ? clamp((input.hitY - input.targetY - radius * 0.25) / Math.max(1, radius * 1.4), 0, 0.84)
    : 0;
  const topFactor = Math.max(trajectoryTop, heightTop, hitHeightTop);

  let zone: ImpactZone;
  if (isNear) zone = 'near';
  else if (topFactor >= 0.68) zone = 'top';
  else if (Math.abs(localSide) > Math.abs(localForward)) zone = localSide >= 0 ? 'left' : 'right';
  else zone = localForward >= 0 ? 'rear' : 'front';

  const massResponse =
    input.armor === 'infantry' ? 1.48
      : input.armor === 'air' ? 1.18
        : input.armor === 'light' ? 1.08
          : input.armor === 'heavy' ? 0.62
            : 0.3;
  const horizontalShape = (1 - topFactor * 0.46) * (isNear ? 0.78 : 1);
  const impulseSpeed = clamp(force * massResponse * directness * horizontalShape * 7.2, 0, input.armor === 'heavy' ? 4.4 : 10.5);
  const verticalImpulse = clamp(
    force * massResponse * directness * (0.34 + topFactor * 2.15) * (isNear ? 0.72 : 1),
    0,
    input.armor === 'infantry' ? 4.8 : 2.7,
  );
  const torqueShape =
    zone === 'left' || zone === 'right' ? 1.18
      : zone === 'front' || zone === 'rear' ? 0.82
        : zone === 'top' ? 0.58
          : 0.68;
  const angularSign = localSide >= 0 ? 1 : -1;
  const angularImpulse = clamp(force * massResponse * directness * torqueShape, 0, 1.35) * angularSign;

  return {
    zone,
    directionX,
    directionZ,
    localSide,
    localForward,
    topFactor,
    directness,
    impulseSpeed,
    verticalImpulse,
    angularImpulse,
  };
}
