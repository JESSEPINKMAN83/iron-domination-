import { WEAPONS, type ArmorClass, type WeaponKind } from '../content/phase4';
import type { Entity } from './components';
import { stopEntities, type GameSim } from './world';

export function damageForArmor(kind: WeaponKind, armor: ArmorClass): number {
  const def = WEAPONS[kind];
  return def.damage * def.vs[armor];
}

export function stepCombat(sim: GameSim, dt: number): void {
  const combatants = Array.from(sim.world.entities).filter((entity) => entity.weapon && entity.health && entity.team && !entity.destroyed);
  for (const attacker of combatants) {
    if (!attacker.weapon || !attacker.health || !attacker.team) continue;
    const def = WEAPONS[attacker.weapon.kind as WeaponKind];
    if (!def) continue;
    attacker.weapon.cooldown = Math.max(0, attacker.weapon.cooldown - dt);
    if (attacker.playerControlled) continue;

    const target = validTarget(sim, attacker, def.range) ?? acquireTarget(sim, attacker, def.range);
    attacker.weapon.targetId = target?.id;
    if (!target?.health || !target.armor) continue;
    if (attacker.weapon.cooldown > 0) continue;

    const damage = applyDamage(target, damageForArmor(def.kind, target.armor.kind));
    applySplash(sim, attacker, target, def.splashRadius, def.kind);
    attacker.weapon.cooldown = def.cooldown;
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
  }
  tickDestroyed(sim, dt);
}

export function manualFireAt(sim: GameSim, attacker: Entity, targetX: number, targetZ: number): boolean {
  if (!attacker.weapon || !attacker.team || attacker.destroyed) return false;
  const def = WEAPONS[attacker.weapon.kind as WeaponKind];
  if (!def || attacker.weapon.cooldown > 0) return false;

  const dx = targetX - attacker.transform.x;
  const dz = targetZ - attacker.transform.z;
  const len = Math.max(0.0001, Math.hypot(dx, dz));
  const ux = dx / len;
  const uz = dz / len;
  const range = Math.min(def.range, len);
  const impactX = attacker.transform.x + ux * range;
  const impactZ = attacker.transform.z + uz * range;
  const target = acquireLineTarget(sim, attacker, ux, uz, range);
  const hitX = target?.transform.x ?? impactX;
  const hitZ = target?.transform.z ?? impactZ;
  let damage = 0;
  let killed = false;

  if (target?.health && target.armor) {
    damage = applyDamage(target, damageForArmor(def.kind, target.armor.kind));
    applySplash(sim, attacker, target, def.splashRadius, def.kind);
    killed = target.health.current <= 0;
    attacker.weapon.targetId = target.id;
  } else {
    attacker.weapon.targetId = undefined;
  }
  attacker.weapon.cooldown = def.cooldown;
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

function validTarget(sim: GameSim, attacker: Entity, range: number): Entity | undefined {
  if (!attacker.weapon?.targetId) return undefined;
  const target = Array.from(sim.world.entities).find((entity) => entity.id === attacker.weapon?.targetId);
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

function applySplash(sim: GameSim, attacker: Entity, primary: Entity, radius: number, kind: WeaponKind): void {
  if (radius <= 0) return;
  for (const target of sim.world.entities) {
    if (target === primary || !isTargetable(attacker, target) || !target.armor) continue;
    const dx = target.transform.x - primary.transform.x;
    const dz = target.transform.z - primary.transform.z;
    const d = Math.hypot(dx, dz);
    if (d > radius) continue;
    applyDamage(target, damageForArmor(kind, target.armor.kind) * (1 - d / radius) * 0.55);
  }
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
