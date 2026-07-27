import type { Entity, Weapon, WeaponRack } from '../sim/components';

export const FORTRESS_TOWER_KIND = 'guard-tower';

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
  return entity?.building?.kind === FORTRESS_TOWER_KIND && Boolean(entity.possessable);
}

export function createFortressWeapons(): {
  weapon: Weapon;
  weapons: WeaponRack;
  specialWeapon: Weapon;
} {
  const primary: Weapon = {
    kind: 'siegeMissile',
    range: FORTRESS_TOWER.primaryRange,
    cooldown: 0,
    salvoCount: 2,
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
