import { WEAPONS, type ArmorClass, type WeaponKind } from '../content/phase4';
import type { Entity, Weapon } from './components';
import { hash2i, smoothstep } from './noise';
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
      const target = validTarget(sim, attacker, weapon, def.range) ?? acquireTarget(sim, attacker, weapon, def.range);
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

  const rawDx = targetX - attacker.transform.x;
  const rawDz = targetZ - attacker.transform.z;
  const rawLen = Math.hypot(rawDx, rawDz);
  const fallbackYaw = attacker.playerControlled?.aimYaw ?? attacker.turret?.yaw ?? attacker.transform.rot;
  const ux = rawLen > 0.001 ? rawDx / rawLen : Math.sin(fallbackYaw);
  const uz = rawLen > 0.001 ? rawDz / rawLen : Math.cos(fallbackYaw);
  const len = Math.max(0.0001, rawLen);
  const ballisticBomb = slot === 'secondary' && def.kind === 'bomb';
  const maxRange = ballisticBomb ? Math.max(def.range, 440) : def.range;
  const range = ballisticBomb ? Math.min(maxRange, Math.max(48, len)) : Math.min(maxRange, len);
  const intendedX = attacker.transform.x + ux * range;
  const intendedZ = attacker.transform.z + uz * range;
  const impact = ballisticBomb ? scatterBombImpact(sim, attacker, intendedX, intendedZ, range, maxRange) : { x: intendedX, z: intendedZ };
  const target = ballisticBomb ? undefined : acquireLineTarget(sim, attacker, ux, uz, range);
  const hitX = target?.transform.x ?? impact.x;
  const hitZ = target?.transform.z ?? impact.z;
  let damage = 0;
  let killed = false;

  if (target?.health && target.armor) {
    damage = applyDamage(target, damageForArmor(def.kind, target.armor.kind));
    const area = applyAreaDamage(sim, attacker, hitX, hitZ, def.splashRadius, def.kind, target);
    killed = target.health.current <= 0 || area.killed;
    weapon.targetId = target.id;
  } else {
    const area = applyAreaDamage(sim, attacker, hitX, hitZ, def.splashRadius, def.kind);
    damage = area.damage;
    killed = area.killed;
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
  const area = applyAreaDamage(sim, attacker, target.transform.x, target.transform.z, def.splashRadius, def.kind, target);
  weapon.cooldown = def.cooldown;
  if (attacker.turret) attacker.turret.yaw = Math.atan2(target.transform.x - attacker.transform.x, target.transform.z - attacker.transform.z);
  sim.events.push({
    kind: def.kind,
    fromX: attacker.transform.x,
    fromZ: attacker.transform.z,
    toX: target.transform.x,
    toZ: target.transform.z,
    damage,
    killed: target.health.current <= 0 || area.killed,
  });
  return true;
}

function validTarget(sim: GameSim, attacker: Entity, weapon: Weapon, range: number): Entity | undefined {
  if (!weapon.targetId) return undefined;
  const target = Array.from(sim.world.entities).find((entity) => entity.id === weapon.targetId);
  if (!target || !isTargetable(attacker, target)) return undefined;
  if (!isWeaponAllowedToTarget(weapon, target)) return undefined;
  return distance(attacker, target) <= range ? target : undefined;
}

function acquireTarget(sim: GameSim, attacker: Entity, weapon: Weapon, range: number): Entity | undefined {
  let best: Entity | undefined;
  let bestD = range;
  for (const candidate of sim.world.entities) {
    if (!isTargetable(attacker, candidate)) continue;
    if (!isWeaponAllowedToTarget(weapon, candidate)) continue;
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

function isWeaponAllowedToTarget(weapon: Weapon, target: Entity): boolean {
  return !(weapon.kind === 'bomb' && target.playerControlled);
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

function applyAreaDamage(
  sim: GameSim,
  attacker: Entity,
  x: number,
  z: number,
  radius: number,
  kind: WeaponKind,
  primary?: Entity,
): { damage: number; killed: boolean } {
  if (radius <= 0) return { damage: 0, killed: false };
  let damage = 0;
  let killed = false;
  for (const target of sim.world.entities) {
    if (target === primary || !isTargetable(attacker, target) || !target.armor) continue;
    const dx = target.transform.x - x;
    const dz = target.transform.z - z;
    const d = Math.hypot(dx, dz);
    if (d > radius) continue;
    const falloff = 1 - d / radius;
    const splashMultiplier = kind === 'bomb' ? 1 : 0.55;
    damage += applyDamage(target, damageForArmor(kind, target.armor.kind) * falloff * splashMultiplier);
    killed ||= target.health?.current === 0;
  }
  return { damage, killed };
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

function scatterBombImpact(sim: GameSim, attacker: Entity, intendedX: number, intendedZ: number, range: number, maxRange: number): { x: number; z: number } {
  const longT = smoothstep(135, maxRange, range);
  if (longT <= 0) return { x: intendedX, z: intendedZ };
  const seedX = Math.round(intendedX * 10);
  const seedZ = Math.round(intendedZ * 10);
  const seed = Math.imul(attacker.id, 73856093) ^ Math.imul(sim.tick + 1, 19349663) ^ Math.imul(seedX, 83492791) ^ seedZ;
  const angle = hash2i(seed, attacker.id, 0xb04b) * Math.PI * 2;
  const radius = Math.sqrt(hash2i(seed, sim.tick + 17, 0x51e9)) * (longT * longT) * 58;
  return {
    x: intendedX + Math.cos(angle) * radius,
    z: intendedZ + Math.sin(angle) * radius,
  };
}
