import type { Entity } from '../sim/components';
import type { UnitKind } from './phase3';
import { UNIT_ARSENALS, type UnitArsenal } from './unitArsenal';
import { WEAPONS } from './phase4';

/** Gameplay abstractions, not real-world specifications or equipment rankings. */
export const UKRAINE_ROLES: Partial<Record<UnitKind, string>> = {
  infantry: 'Mobile mechanized infantry · faster repositioning',
  sniper: 'Recon marksman · wide sight, fragile',
  'rocket-infantry': 'Stugna-P guided anti-armor team',
  'scout-tank': 'BTR-4 reconnaissance · wide sight, light armor',
  tank: 'Leopard 2A6 · mobile armor, less durability than Merkava',
  'siege-tank': 'PzH 2000 · mobile fire support',
  artillery: 'Bohdana · mobile 155mm artillery · deploy to fire',
  wasp: 'Agile interceptor UAV · air-only seeker · very fragile',
  vulture: 'Mi-24 rocket helicopter · less durable than Apache',
  hammerhead: 'TB2 precision UAV · guided strike and single bomb · fragile',
};
export function ukraineArsenal(kind: UnitKind): UnitArsenal {
  if (kind === 'wasp') return { primary: 'aaMissile', designation: 'INTERCEPTOR UAV', fireControl: 'AIR-ONLY SEEKER', hud: 'aviation' };
  if (kind === 'hammerhead') return { ...UNIT_ARSENALS.hammerhead, primary: 'precisionMissile', secondarySalvoCount: 1, designation: 'BAYRAKTAR TB2', fireControl: 'PRECISION STRIKE / SINGLE BOMB' };
  if (kind === 'vulture') return { ...UNIT_ARSENALS.vulture, designation: 'MI-24 HIND', fireControl: 'ROCKET IMPACT COMPUTER' };
  return UNIT_ARSENALS[kind];
}

export function applyUkraineProfile(entity: Entity, kind: UnitKind): void {
  if (entity.ukraineProfile) return;
  entity.ukraineProfile = true;
  entity.rosterKind = kind;
  const health = kind === 'wasp' ? 0.48 : kind === 'hammerhead' ? 0.52 : kind === 'vulture' ? 0.78 : ['tank','siege-tank','scout-tank'].includes(kind) ? 0.9 : 1;
  if (entity.health) { entity.health.current *= health; entity.health.max *= health; }
  const speed = kind === 'wasp' ? 1.12 : kind === 'hammerhead' ? 1.25 : kind === 'artillery' ? 1.3 : entity.flight ? 1 : 1.1;
  if (entity.mover) entity.mover.speed *= speed;
  if (entity.vision) entity.vision.radius *= kind === 'wasp' ? 1.4 : kind === 'hammerhead' ? 1.65 : kind === 'scout-tank' ? 1.25 : 1;
  if (entity.flight) {
    if (kind !== 'vulture') entity.flight.model = 'drone';
    entity.flight.agility = kind === 'wasp' ? 1.6 : kind === 'hammerhead' ? 1.1 : 1;
  }
  if (kind === 'wasp' || kind === 'hammerhead') {
    const arsenal = ukraineArsenal(kind);
    const primary = { kind: arsenal.primary, range: WEAPONS[arsenal.primary].range, cooldown: 0 };
    entity.weapon = primary;
    entity.weapons = { primary, secondary: arsenal.secondary ? { kind: arsenal.secondary, range: WEAPONS[arsenal.secondary].range, cooldown: 0, salvoCount: arsenal.secondarySalvoCount } : undefined };
  }
}
