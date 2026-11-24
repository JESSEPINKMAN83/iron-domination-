import type { ProjectileKind, WeaponKind } from '../content/phase4';

/** Exhaustive weapon-to-visual mapping. Adding a weapon requires choosing a
 * presentation here, instead of quietly falling back to the smallest trail. */
export const PROJECTILE_VISUAL_FAMILIES: Record<WeaponKind, WeaponKind | ProjectileKind> = {
  mlrsRocket: 'rocketLauncher', heavyBomb: 'bomb', fpvStrike: 'emberDrone',
  rifle: 'rifle', rifleGrenade: 'grenade', sniperRifle: 'sniperRifle', grenade: 'grenade',
  rocketLauncher: 'rocketLauncher', scoutMissile: 'scoutMissile', tankMissile: 'tankMissile', siegeMissile: 'siegeMissile',
  autocannon: 'autocannon', waspAutocannon: 'waspAutocannon', cannon: 'kineticShell', heavyCannon: 'kineticShell', siegeShell: 'artilleryShell',
  tankBomb: 'siegeMissile', bomb: 'bomb', rocketPod: 'rocketPod', precisionMissile: 'agMissile', agMissile: 'agMissile', aaMissile: 'aaMissile',
  skylanceGun: 'skylanceGun', microLaser: 'microLaser', overchargeRifle: 'overchargeRifle', clusterGrenade: 'grenade', railShot: 'railShot',
  swarmRocket: 'agMissile', annihilatorMissile: 'siegeMissile', strategicMissile: 'strategicMissile', emberDrone: 'emberDrone',
};

export function projectileVisualKind(weaponKind: string, projectileKind = weaponKind): string {
  return Object.prototype.hasOwnProperty.call(PROJECTILE_VISUAL_FAMILIES, weaponKind)
    ? PROJECTILE_VISUAL_FAMILIES[weaponKind as WeaponKind]
    : projectileKind;
}

export function isRocketPowered(kind: string): boolean {
  const family = projectileVisualKind(kind);
  return family === 'rocketLauncher' || family === 'rocketPod' || family === 'atRocket' || family === 'scoutMissile'
    || family === 'tankMissile' || family === 'siegeMissile' || family === 'agMissile' || family === 'aaMissile' || family === 'strategicMissile';
}
