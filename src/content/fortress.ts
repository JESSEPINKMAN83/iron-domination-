import type { Entity, Weapon, WeaponRack } from '../sim/components';
import type { StructureKind } from './phase3';

export type FortressTowerKind = Extract<StructureKind, 'guard-tower' | 'aa-tower'>;

export const FORTRESS_TOWER_KINDS: readonly FortressTowerKind[] = ['guard-tower', 'aa-tower'];

export const FORTRESS_TOWER = {
  // Camera sits just above the launcher deck on the redesigned 10.5u towers.
  socketHeight: 13.2,
  muzzleHeight: 12.0,
  turretTurnRate: 3.25,
  visionRadius: 260,
  primaryRange: 220,
  secondaryRange: 340,
  specialRange: 520,
} as const;

export const SKYGUARD_TOWER = {
  socketHeight: 8.8,
  muzzleHeight: 7.5,
} as const;

export function isFortressTower(entity: Entity | undefined): boolean {
  return Boolean(
    entity?.possessable &&
    FORTRESS_TOWER_KINDS.includes(entity.building?.kind as FortressTowerKind),
  );
}

export function isSkyguardTower(entity: Entity | undefined): boolean {
  return entity?.building?.kind === 'aa-tower';
}

export function fortressSocketHeight(entity: Entity | undefined): number {
  return isSkyguardTower(entity) ? SKYGUARD_TOWER.socketHeight : FORTRESS_TOWER.socketHeight;
}

export function fortressMuzzleHeight(entity: Entity | undefined): number {
  return isSkyguardTower(entity) ? SKYGUARD_TOWER.muzzleHeight : FORTRESS_TOWER.muzzleHeight;
}

export function createFortressWeapons(kind: FortressTowerKind): {
  weapon: Weapon;
  weapons: WeaponRack;
  specialWeapon?: Weapon;
} {
  if (kind === 'aa-tower') {
    const primary: Weapon = {
      kind: 'skyguardInterceptor',
      range: 420,
      cooldown: 0,
      salvoCount: 1,
    };
    return {
      weapon: primary,
      weapons: {
        primary,
        secondary: {
          kind: 'skyguardLaser',
          range: 110,
          cooldown: 0,
        },
      },
    };
  }
  const primary: Weapon = {
    kind: 'siegeMissile',
    range: FORTRESS_TOWER.primaryRange,
    cooldown: 0,
    salvoCount: 1,
  };
  return {
    weapon: primary,
    weapons: {
      primary,
      secondary: {
        kind: 'tankBomb',
        range: FORTRESS_TOWER.secondaryRange,
        cooldown: 0,
        salvoCount: 4,
      },
    },
    specialWeapon: {
      kind: 'annihilatorMissile',
      range: FORTRESS_TOWER.specialRange,
      cooldown: 0,
    },
  };
}
