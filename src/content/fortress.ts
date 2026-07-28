import type { Entity, Weapon, WeaponRack } from '../sim/components';
import type { StructureKind } from './phase3';

export type FortressTowerKind = Extract<StructureKind, 'guard-tower' | 'aa-tower'>;

export const FORTRESS_TOWER_KINDS: readonly FortressTowerKind[] = ['guard-tower', 'aa-tower'];

export const FORTRESS_TOWER = {
  socketHeight: 25.5,
  muzzleHeight: 17.2,
  turretTurnRate: 3.25,
  visionRadius: 260,
  primaryRange: 220,
  secondaryRange: 340,
  specialRange: 520,
} as const;

export function isFortressTower(entity: Entity | undefined): boolean {
  return Boolean(
    entity?.possessable &&
    FORTRESS_TOWER_KINDS.includes(entity.building?.kind as FortressTowerKind),
  );
}

export function createFortressWeapons(kind: FortressTowerKind): {
  weapon: Weapon;
  weapons: WeaponRack;
  specialWeapon: Weapon;
} {
  const primary: Weapon = {
    kind: kind === 'aa-tower' ? 'aaMissile' : 'siegeMissile',
    range: kind === 'aa-tower' ? 320 : FORTRESS_TOWER.primaryRange,
    cooldown: 0,
    salvoCount: 2,
  };
  return {
    weapon: primary,
    weapons: {
      primary,
      secondary: {
        kind: kind === 'aa-tower' ? 'swarmRocket' : 'tankBomb',
        range: kind === 'aa-tower' ? 360 : FORTRESS_TOWER.secondaryRange,
        cooldown: 0,
        salvoCount: kind === 'aa-tower' ? 2 : 4,
      },
    },
    specialWeapon: {
      kind: 'annihilatorMissile',
      range: FORTRESS_TOWER.specialRange,
      cooldown: 0,
    },
  };
}
