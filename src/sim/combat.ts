import { WEAPONS, type ArmorClass, type WeaponKind } from '../content/phase4';
import type { Entity, Weapon } from './components';
import { stopEntities, type GameSim } from './world';

export function damageForArmor(kind: WeaponKind, armor: ArmorClass): number {
  const def = WEAPONS[kind];
  return def.damage * def.vs[armor];
}

export function stepCombat(sim: GameSim, dt: number): void {
  const combatants = Array.from(sim.world.entities).filter((entity) => weaponSlots(entity).length > 0 && entity.health && entity.team && !entity.destroyed);
  for (const attacker of combatants) {
    if (!attacker.health || !attacker.team) continue;
    for (const weapon of weaponSlots(attacker)) weapon.cooldown = Math.max(0, weapon.cooldown - dt);
    if (attacker.playerControlled) continue;

    for (const weapon of weaponSlots(attacker)) {
      const def = WEAPONS[weapon.kind as WeaponKind];
      if (!def || weapon.cooldown > 0) continue;
      const target = validTarget(sim, attacker, weapon, def.range) ?? acquireTarget(sim, attacker, def.range);
      weapon.targetId = target?.id;
      if (!target?.health || !target.armor) continue;
      fireWeaponAtEntity(sim, attacker, weapon, target);
    }
  }
  tickDestroyed(sim, dt);
}

export function manualFireAt(sim: GameSim, attacker: Entity, targetX: number, targetZ: number, slot: 'primary' | 'secondary' = 'primary'): boolean {
  if (!attacker.team || attacker.destroyed) return false;
  const weapon = weaponForSlot(attacker, slot);
  if (!weapon) return false;
  const def = WEAPONS[weapon.kind as WeaponKind];
  if (!def || weapon.cooldown > 0) return false;

  const dx = targetX - attacker.transform.x;
  const dz = targetZ - attacker.transform.z;
  const len = Math.max(0.0001, Math.hypot(dx, dz));
  const ux = dx / len;
  const uz = dz / len;
  const range = Math.min(def.range, len);
  const impactX = attacker.transform.x + ux * range;
  const impactZ = attacker.transform.z + uz * range;
  const target = slot === 'secondary' ? undefined : acquireLineTarget(sim, attacker, ux, uz, range);
  const hitX = target?.transform.x ?? impactX;
  const hitZ = target?.transform.z ?? impactZ;
  let damage = 0;
  let killed = false;

  if (target?.health && target.armor) {
    damage = applyDamage(target, damageForArmor(def.kind, target.armor.kind));
    applyAreaDamage(sim, attacker, hitX, hitZ, def.splashRadius, def.kind, target);
    killed = target.health.current <= 0;
    weapon.targetId = target.id;
  } else {
    damage = applyAreaDamage(sim, attacker, hitX, hitZ, def.splashRadius, def.kind);
    weapon.targetId = undefined;
  }
  weapon.cooldown = def.cooldown;
  if (attacker.turret) attacker.turret.yaw = Math.atan2(ux, uz);
  sim.events.push({
    kind: def.kind,
    fromX: attacker.transform.x,
    fromZ: attacker.transform.z,
    toX: hitX,
    toZ: hitZ,
    damage,
    killed,
  });
  return true;
}

function fireWeaponAtEntity(sim: GameSim, attacker: Entity, weapon: Weapon, target: Entity): boolean {
  if (!target.health || !target.armor) return false;
  const def = WEAPONS[weapon.kind as WeaponKind];
  if (!def || weapon.cooldown > 0) return false;
  const damage = applyDamage(target, damageForArmor(def.kind, target.armor.kind));
  applyAreaDamage(sim, attacker, target.transform.x, target.transform.z, def.splashRadius, def.kind, target);
  weapon.cooldown = def.cooldown;
  if (attacker.turret) attacker.turret.yaw = Math.atan2(target.transform.x - attacker.transform.x, target.transform.z - attacker.transform.z);
  sim.events.push({
    kind: def.kind,
    fromX: attacker.transform.x,
    fromZ: attacker.transform.z,
    toX: target.transform.x,
    toZ: target.transform.z,
    damage,
    killed: target.health.current <= 0,
  });
  return true;
}

function validTarget(sim: GameSim, attacker: Entity, weapon: Weapon, range: number): Entity | undefined {
  if (!weapon.targetId) return undefined;
  const target = Array.from(sim.world.entities).find((entity) => entity.id === weapon.targetId);
  if (!target || !isTargetable(attacker, target)) return undefined;
  return distance(attacker, target) <= range ? target : undefined;
}

function acquireTarget(sim: GameSim, attacker: Entity, range: number): Entity | undefined {
  let best: Entity | undefined;
  let bestD = range;
  for (const candidate of sim.world.entities) {
    if (!isTargetable(attacker, candidate)) continue;
    const d = distance(attacker, candidate);
    if (d < bestD) {
      bestD = d;
      best = candidate;
    }
  }
  return best;
}

function acquireLineTarget(sim: GameSim, attacker: Entity, ux: number, uz: number, range: number): Entity | undefined {
  let best: Entity | undefined;
  let bestAlong = range;
  for (const candidate of sim.world.entities) {
    if (!isTargetable(attacker, candidate)) continue;
    const dx = candidate.transform.x - attacker.transform.x;
    const dz = candidate.transform.z - attacker.transform.z;
    const along = dx * ux + dz * uz;
    if (along < 0 || along > range || along > bestAlong) continue;
    const perp = Math.abs(dx * uz - dz * ux);
    const radius = candidate.collider?.radius ?? candidate.selectable?.radius ?? 2.4;
    if (perp > radius + 2.2) continue;
    best = candidate;
    bestAlong = along;
  }
  return best;
}

function isTargetable(attacker: Entity, target: Entity): boolean {
  if (attacker === target) return false;
  if (!attacker.team || !target.team || attacker.team.id === target.team.id) return false;
  if (!target.health || target.health.current <= 0 || target.destroyed) return false;
  return true;
}

function applyDamage(target: Entity, amount: number): number {
  if (!target.health || amount <= 0) return 0;
  const before = target.health.current;
  target.health.current = Math.max(0, target.health.current - amount);
  if (target.health.current <= 0 && !target.destroyed) {
    target.destroyed = { remaining: 20 };
    target.selectable && (target.selectable.selected = false);
    stopEntities([target]);
  }
  return before - target.health.current;
}

function applyAreaDamage(sim: GameSim, attacker: Entity, x: number, z: number, radius: number, kind: WeaponKind, primary?: Entity): number {
  if (radius <= 0) return 0;
  let total = 0;
  for (const target of sim.world.entities) {
    if (target === primary || !isTargetable(attacker, target) || !target.armor) continue;
    const dx = target.transform.x - x;
    const dz = target.transform.z - z;
    const d = Math.hypot(dx, dz);
    if (d > radius) continue;
    const falloff = 1 - d / radius;
    const splashMultiplier = kind === 'bomb' ? 1 : 0.55;
    total += applyDamage(target, damageForArmor(kind, target.armor.kind) * falloff * splashMultiplier);
  }
  return total;
}

function tickDestroyed(sim: GameSim, dt: number): void {
  for (const entity of Array.from(sim.world.entities)) {
    if (!entity.destroyed) continue;
    entity.destroyed.remaining -= dt;
    if (entity.destroyed.remaining <= 0) sim.world.remove(entity);
  }
}

function distance(a: Entity, b: Entity): number {
  return Math.hypot(a.transform.x - b.transform.x, a.transform.z - b.transform.z);
}

function weaponSlots(entity: Entity): Weapon[] {
  if (entity.weapons) return [entity.weapons.primary, entity.weapons.secondary].filter((weapon): weapon is Weapon => weapon !== undefined);
  return entity.weapon ? [entity.weapon] : [];
}

function weaponForSlot(entity: Entity, slot: 'primary' | 'secondary'): Weapon | undefined {
  if (entity.weapons) return slot === 'primary' ? entity.weapons.primary : entity.weapons.secondary;
  return slot === 'primary' ? entity.weapon : undefined;
}
