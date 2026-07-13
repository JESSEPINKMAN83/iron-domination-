import type { UnitKind } from '../content/phase3';
import { WEAPONS, type WeaponKind } from '../content/phase4';
import type { Entity } from './components';
import type { EconomyState } from './economy';
import type { GameSim } from './world';

export type UnitUpgradeId =
  | 'combat-bike'
  | 'tesla-dart'
  | 'cluster-satchel'
  | 'rail-lance'
  | 'hydra-volley'
  | 'jackal-overdrive'
  | 'jackal-hunter'
  | 'reactive-plating'
  | 'ion-spear'
  | 'siege-stabilizers'
  | 'earthshaker-round'
  | 'vector-thrusters'
  | 'needle-storm'
  | 'specter-plating'
  | 'bunker-buster'
  | 'titan-lift'
  | 'skyfall-warhead';

export interface UnitUpgradeDef {
  id: UnitUpgradeId;
  label: string;
  description: string;
  cost: number;
  kinds: UnitKind[];
  category: 'frame' | 'ability';
  hotkey?: 'F';
  speedMultiplier?: number;
  healthBonus?: number;
  visionBonus?: number;
  turretRateMultiplier?: number;
  climbMultiplier?: number;
  specialWeapon?: WeaponKind;
}

export const UNIT_UPGRADES: Record<UnitUpgradeId, UnitUpgradeDef> = {
  'combat-bike': {
    id: 'combat-bike', label: 'Combat Bike', category: 'frame', cost: 170,
    description: 'Mounts the soldier on a high-speed attack bike. Snipers must stop the bike before aiming or firing.',
    kinds: ['infantry', 'grenadier', 'sniper', 'rocket-infantry'], speedMultiplier: 2.65, healthBonus: 14,
  },
  'tesla-dart': {
    id: 'tesla-dart', label: 'Tesla Dart', category: 'ability', cost: 290, hotkey: 'F',
    description: 'F fires a charged anti-armor electric dart with a long recharge.', kinds: ['infantry'], specialWeapon: 'overchargeRifle',
  },
  'cluster-satchel': {
    id: 'cluster-satchel', label: 'Cluster Satchel', category: 'ability', cost: 330, hotkey: 'F',
    description: 'F launches a wide explosive cluster shell into grouped enemies.', kinds: ['grenadier'], specialWeapon: 'clusterGrenade',
  },
  'rail-lance': {
    id: 'rail-lance', label: 'Rail Lance', category: 'ability', cost: 440, hotkey: 'F',
    description: 'F fires an extreme-range armor-piercing shot. The sniper must be completely still.', kinds: ['sniper'], specialWeapon: 'railShot',
  },
  'hydra-volley': {
    id: 'hydra-volley', label: 'Hydra Volley', category: 'ability', cost: 390, hotkey: 'F',
    description: 'F launches a smart heavy rocket with a violent impact.', kinds: ['rocket-infantry'], specialWeapon: 'swarmRocket',
  },
  'jackal-overdrive': {
    id: 'jackal-overdrive', label: 'Predator Drive', category: 'frame', cost: 260,
    description: 'High-torque treads increase speed and extend forward reconnaissance.', kinds: ['scout-tank'], speedMultiplier: 1.28, visionBonus: 24,
  },
  'jackal-hunter': {
    id: 'jackal-hunter', label: 'Hunter Missile', category: 'ability', cost: 410, hotkey: 'F',
    description: 'F launches a precision hunter missile built to finish damaged armor.', kinds: ['scout-tank'], specialWeapon: 'swarmRocket',
  },
  'reactive-plating': {
    id: 'reactive-plating', label: 'Reactive Plating', category: 'frame', cost: 380,
    description: 'Explosive armor tiles add 60 maximum health to this exact tank.', kinds: ['tank'], healthBonus: 60,
  },
  'ion-spear': {
    id: 'ion-spear', label: 'Ion Spear', category: 'ability', cost: 560, hotkey: 'F',
    description: 'F fires a costly high-energy missile that punches through heavy formations.', kinds: ['tank'], specialWeapon: 'annihilatorMissile',
  },
  'siege-stabilizers': {
    id: 'siege-stabilizers', label: 'Siege Gyros', category: 'frame', cost: 470,
    description: 'Braced suspension adds 85 health and makes the heavy turret traverse faster.', kinds: ['siege-tank'], healthBonus: 85, turretRateMultiplier: 1.45,
  },
  'earthshaker-round': {
    id: 'earthshaker-round', label: 'Earthshaker', category: 'ability', cost: 720, hotkey: 'F',
    description: 'F launches a rare siege warhead with massive impact and a very long reload.', kinds: ['siege-tank'], specialWeapon: 'annihilatorMissile',
  },
  'vector-thrusters': {
    id: 'vector-thrusters', label: 'Vector Thrusters', category: 'frame', cost: 360,
    description: 'Experimental rotors increase flight speed and climb authority.', kinds: ['wasp'], speedMultiplier: 1.22, climbMultiplier: 1.3,
  },
  'needle-storm': {
    id: 'needle-storm', label: 'Needle Storm', category: 'ability', cost: 480, hotkey: 'F',
    description: 'F releases a compact anti-ground missile from the scout frame.', kinds: ['wasp'], specialWeapon: 'swarmRocket',
  },
  'specter-plating': {
    id: 'specter-plating', label: 'Specter Plating', category: 'frame', cost: 520,
    description: 'Composite armor adds 75 health without sacrificing gunship speed.', kinds: ['vulture'], healthBonus: 75,
  },
  'bunker-buster': {
    id: 'bunker-buster', label: 'Bunker Buster', category: 'ability', cost: 680, hotkey: 'F',
    description: 'F drives a heavy warhead into vehicles and structures below.', kinds: ['vulture'], specialWeapon: 'annihilatorMissile',
  },
  'titan-lift': {
    id: 'titan-lift', label: 'Titan Lift', category: 'frame', cost: 680,
    description: 'Reinforced lift system adds 120 health and stronger vertical control.', kinds: ['hammerhead'], healthBonus: 120, climbMultiplier: 1.22,
  },
  'skyfall-warhead': {
    id: 'skyfall-warhead', label: 'Skyfall Warhead', category: 'ability', cost: 890, hotkey: 'F',
    description: 'F fires the heaviest purchasable tactical warhead in the aircraft roster.', kinds: ['hammerhead'], specialWeapon: 'annihilatorMissile',
  },
};

const OPTIONS_BY_KIND: Record<UnitKind, UnitUpgradeId[]> = {
  infantry: ['combat-bike', 'tesla-dart'],
  grenadier: ['combat-bike', 'cluster-satchel'],
  sniper: ['combat-bike', 'rail-lance'],
  'rocket-infantry': ['combat-bike', 'hydra-volley'],
  'scout-tank': ['jackal-overdrive', 'jackal-hunter'],
  tank: ['reactive-plating', 'ion-spear'],
  'siege-tank': ['siege-stabilizers', 'earthshaker-round'],
  wasp: ['vector-thrusters', 'needle-storm'],
  vulture: ['specter-plating', 'bunker-buster'],
  hammerhead: ['titan-lift', 'skyfall-warhead'],
};

export interface UpgradePurchaseResult {
  ok: boolean;
  reason: string;
  upgraded: number;
  cost: number;
}

export function upgradeOptionsForKind(kind: UnitKind): UnitUpgradeDef[] {
  return OPTIONS_BY_KIND[kind].map((id) => UNIT_UPGRADES[id]);
}

export function hasUnitUpgrade(entity: Entity | undefined, id: UnitUpgradeId): boolean {
  return Boolean(entity?.unitUpgrades?.ids.includes(id));
}

export function specialUpgradeForEntity(entity: Entity | undefined): UnitUpgradeDef | undefined {
  if (!entity?.unitUpgrades) return undefined;
  for (const id of entity.unitUpgrades.ids) {
    const def = UNIT_UPGRADES[id as UnitUpgradeId];
    if (def?.category === 'ability') return def;
  }
  return undefined;
}

export function unitKindForUpgrade(entity: Entity): UnitKind | undefined {
  const name = (entity.name ?? '').toLowerCase();
  const weapon = entity.weapon?.kind;
  if (weapon === 'sniperRifle') return 'sniper';
  if (weapon === 'grenade') return 'grenadier';
  if (weapon === 'rocketLauncher') return 'rocket-infantry';
  if (weapon === 'rifle') return 'infantry';
  if (weapon === 'scoutMissile' || name.includes('jackal')) return 'scout-tank';
  if (weapon === 'siegeMissile' || name.includes('mauler')) return 'siege-tank';
  if (weapon === 'tankMissile' || entity.selectable?.type === 'tank') return 'tank';
  if (name.includes('wasp')) return 'wasp';
  if (name.includes('hammerhead')) return 'hammerhead';
  if (entity.selectable?.type === 'vulture' || name.includes('vulture')) return 'vulture';
  return undefined;
}

export function purchaseUnitUpgrade(
  sim: GameSim,
  economy: EconomyState,
  ids: number[],
  upgradeId: UnitUpgradeId,
  team = economy.team,
): UpgradePurchaseResult {
  const def = UNIT_UPGRADES[upgradeId];
  if (!def) return { ok: false, reason: 'Unknown upgrade', upgraded: 0, cost: 0 };
  const entities = ids
    .map((id) => sim.byId.get(id))
    .filter((entity): entity is Entity => Boolean(entity && !entity.destroyed && entity.team?.id === team && def.kinds.includes(unitKindForUpgrade(entity)!)))
    .filter((entity) => !hasUnitUpgrade(entity, upgradeId));
  if (entities.length === 0) return { ok: false, reason: 'Already installed', upgraded: 0, cost: 0 };
  const cost = def.cost * entities.length;
  if (economy.credits < cost) return { ok: false, reason: `Need $${cost}`, upgraded: 0, cost };
  economy.credits -= cost;
  economy.ledger.push({ tick: sim.tick, type: 'spend', label: `${def.label} x${entities.length}`, amount: -cost });
  for (const entity of entities) applyUpgrade(entity, def);
  return { ok: true, reason: `${def.label} installed`, upgraded: entities.length, cost };
}

function applyUpgrade(entity: Entity, def: UnitUpgradeDef): void {
  entity.unitUpgrades ??= { ids: [] };
  if (entity.unitUpgrades.ids.includes(def.id)) return;
  entity.unitUpgrades.ids.push(def.id);
  entity.unitUpgrades.ids.sort();
  if (entity.mover && def.speedMultiplier) entity.mover.speed *= def.speedMultiplier;
  if (entity.health && def.healthBonus) {
    entity.health.max += def.healthBonus;
    entity.health.current += def.healthBonus;
  }
  if (entity.vision && def.visionBonus) entity.vision.radius += def.visionBonus;
  if (entity.turret && def.turretRateMultiplier) entity.turret.turnRate *= def.turretRateMultiplier;
  if (entity.flight && def.climbMultiplier) entity.flight.climbRate *= def.climbMultiplier;
  if (def.specialWeapon) entity.specialWeapon = { kind: def.specialWeapon, range: WEAPONS[def.specialWeapon].range, cooldown: 0 };
}
