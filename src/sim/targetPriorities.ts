import { WEAPONS, type WeaponKind } from '../content/phase4';
import type { Entity } from './components';

export const TARGET_PRIORITY_OPTIONS = [
  { id: 'economy', label: 'Economy', detail: 'Ore collectors, refineries and power plants' },
  { id: 'anti-air', label: 'Anti-air threats', detail: 'Units and defenses able to attack aircraft or intercept missiles' },
  { id: 'missile-sites', label: 'Missile & drone sites', detail: 'Missile City / strategic silos and drone launch headquarters' },
  { id: 'aircraft', label: 'Aircraft', detail: 'Enemy helicopters, aircraft and combat drones' },
  { id: 'artillery', label: 'Artillery', detail: 'Heavy artillery and mobile siege missile launchers' },
  { id: 'defenses', label: 'Defenses', detail: 'Guard towers, Iron Dome, Arrow 3 and Phalanx batteries' },
  { id: 'armor', label: 'Armored vehicles', detail: 'Enemy tanks, APCs and tracked artillery' },
  { id: 'infantry', label: 'Infantry', detail: 'Rifle squads, grenadiers, snipers and rocket infantry' },
  { id: 'production', label: 'Production', detail: 'Barracks, vehicle factories and air bases' },
  { id: 'headquarters', label: 'Headquarters', detail: 'Enemy command yards' },
] as const;
export type TargetPriority = typeof TARGET_PRIORITY_OPTIONS[number]['id'];

/** Canonical order keeps equivalent choices identical in saves and lockstep hashes. */
export function normalizeTargetPriorities(value: unknown): TargetPriority[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = TARGET_PRIORITY_OPTIONS.filter(option => value.includes(option.id)).map(option => option.id);
  return result.length ? result : undefined;
}

const hasAntiAirWeapon = (weapon: Entity['weapon']): boolean => !!weapon && WEAPONS[weapon.kind as WeaponKind]?.canTargetAir === true;

export function matchesTargetPriorities(entity: Entity, priorities: readonly TargetPriority[]): boolean {
  const kind = entity.building?.kind;
  for (const priority of priorities) {
    switch (priority) {
      case 'economy': if (entity.harvester || kind === 'refinery' || kind === 'power-plant') return true; break;
      case 'missile-sites': if (kind === 'strategic-silo' || kind === 'intelligence-center') return true; break;
      case 'aircraft': if (entity.flight) return true; break;
      case 'artillery': if (!entity.building && (entity.artillery || entity.weapon?.kind === 'heavyCannon' || entity.weapon?.kind === 'siegeMissile' || entity.weapons?.secondary?.kind === 'siegeMissile')) return true; break;
      case 'defenses': if (kind === 'guard-tower' || kind === 'aa-tower' || kind === 'missile-defense' || kind === 'skylance-ciws') return true; break;
      case 'armor': if (!entity.building && !entity.harvester && entity.selectable?.type === 'tank') return true; break;
      case 'infantry': if (!entity.building && entity.selectable?.type === 'infantry') return true; break;
      case 'production': if (kind === 'barracks' || kind === 'factory' || kind === 'helipad') return true; break;
      case 'headquarters': if (kind === 'command-yard') return true; break;
      case 'anti-air': {
        if (kind === 'aa-tower' || kind === 'missile-defense' || kind === 'skylance-ciws') return true;
        if (hasAntiAirWeapon(entity.weapon) || hasAntiAirWeapon(entity.weapons?.primary) || hasAntiAirWeapon(entity.weapons?.secondary) || hasAntiAirWeapon(entity.specialWeapon) || hasAntiAirWeapon(entity.building?.airDefenseWeapon)) return true;
        break;
      }
    }
  }
  return false;
}
