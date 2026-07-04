import { WEAPONS, type ArmorClass, type WeaponKind } from '../content/phase4';
import { angleDelta, slewAngle } from './angles';
import type { Entity, Weapon } from './components';
import { hash2i, smoothstep } from './noise';
import { stopEntities, type GameSim } from './world';

/** Cannons may only fire once the turret has traversed onto the bearing. */
const AIM_TOLERANCE = 0.12;
const BOMB_SPEED = 95; // meters per second of flight, drives travel time
const BOMB_MANUAL_MAX_RANGE = 440;
const DEFENSE_ALERT_RADIUS = 145;
const DEFENSE_ALERT_TTL = 9;
const AIR_DIRECT_MULTIPLIER: Record<WeaponKind, number> = {
  rifle: 0.08,
  cannon: 0.12,
  bomb: 0,
  rocketPod: 0.35,
  agMissile: 1,
  aaMissile: 1.15,
};
const AIR_SPLASH_MULTIPLIER: Record<WeaponKind, number> = {
  rifle: 0,
  cannon: 0.03,
  bomb: 0.035,
  rocketPod: 0.12,
  agMissile: 0.75,
  aaMissile: 0.85,
};
const AIR_RANGE_MULTIPLIER: Record<WeaponKind, number> = {
  rifle: 0.55,
  cannon: 0.65,
  bomb: 0,
  rocketPod: 0.75,
  agMissile: 1,
  aaMissile: 1,
};

interface HitSummary {
  targetId: number;
  targetLabel: string;
  targetType: string;
  targetHealth: number;
  targetMaxHealth: number;
  damage: number;
}

export function damageForArmor(kind: WeaponKind, armor: ArmorClass): number {
  const def = WEAPONS[kind];
  return def.damage * def.vs[armor];
}

export function stepCombat(sim: GameSim, dt: number): void {
  stepProjectiles(sim, dt);

  const combatants = Array.from(sim.world.entities).filter(
    (entity) => weaponSlots(entity).length > 0 && entity.health && entity.team && !entity.destroyed,
  );
  for (const attacker of combatants) {
    if (!attacker.health || !attacker.team) continue;
    for (const weapon of weaponSlots(attacker)) weapon.cooldown = Math.max(0, weapon.cooldown - dt);
    if (attacker.playerControlled) continue; // brain bypassed; stepSim slews the turret to the crosshair

    let turretGoalYaw: number | undefined;
    for (const weapon of weaponSlots(attacker)) {
      const def = WEAPONS[weapon.kind as WeaponKind];
      if (!def) continue;
      // a unit can only auto-engage what it can see — no shelling into the fog
      const range = Math.min(def.range, attacker.vision?.radius ?? def.range);
      const target = validTarget(sim, attacker, weapon, range) ?? acquireTarget(sim, attacker, weapon, range);
      weapon.targetId = target?.id;
      if (!target?.health || !target.armor) continue;
      const bearing = Math.atan2(target.transform.x - attacker.transform.x, target.transform.z - attacker.transform.z);
      // direct-fire weapons wait for the turret; bombs are lobbed from the hull
      if (def.kind !== 'bomb' && attacker.turret) {
        turretGoalYaw ??= bearing;
        if (Math.abs(angleDelta(attacker.turret.yaw, bearing)) > AIM_TOLERANCE) continue;
      }
      if (weapon.cooldown > 0) continue;
      if (def.kind === 'bomb') {
        launchBomb(sim, attacker, weapon, target.transform.x, target.transform.z, def.range);
      } else {
        fireHitscanAtEntity(sim, attacker, weapon, target);
      }
    }
    if (attacker.turret) {
      attacker.turret.yaw = slewAngle(attacker.turret.yaw, turretGoalYaw ?? attacker.transform.rot, attacker.turret.turnRate, dt);
    }
    updateGuardBehavior(sim, attacker, dt);
  }
  tickDestroyed(sim, dt);
}

/** Idle units don't stand and take bombardment — they close on visible foes. */
function updateGuardBehavior(sim: GameSim, attacker: Entity, dt: number): void {
  if (!attacker.mover || attacker.mover.target || !attacker.vision) return;
  const slots = weaponSlots(attacker);
  if (slots.length === 0) return;
  let weaponRange = 0;
  for (const weapon of slots) {
    const def = WEAPONS[weapon.kind as WeaponKind];
    if (def && def.kind !== 'bomb') weaponRange = Math.max(weaponRange, def.range);
  }
  if (weaponRange === 0) weaponRange = WEAPONS[slots[0].kind as WeaponKind]?.range ?? 42;
  const foe = acquireTarget(sim, attacker, slots[0], attacker.vision.radius);
  if (!foe && attacker.mover.defenseAlert) {
    const alert = attacker.mover.defenseAlert;
    alert.ttl -= dt;
    const target = entityById(sim, alert.targetId);
    if (alert.ttl <= 0 || !target || !isWeaponTargetable(attacker, slots[0], target)) {
      attacker.mover.defenseAlert = undefined;
    } else {
      alert.x = target.transform.x;
      alert.z = target.transform.z;
      for (const weapon of slots) weapon.targetId = target.id;
      attacker.mover.engage = { x: alert.x, z: alert.z };
      return;
    }
  }
  attacker.mover.engage =
    foe && distance(attacker, foe) > weaponRange * 0.85 ? { x: foe.transform.x, z: foe.transform.z } : undefined;
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

  if (def.kind === 'bomb') {
    const maxRange = Math.max(def.range, BOMB_MANUAL_MAX_RANGE);
    const range = len < 8 ? 48 : Math.min(maxRange, len);
    launchBomb(sim, attacker, weapon, attacker.transform.x + ux * range, attacker.transform.z + uz * range, maxRange);
    return true;
  }

  // direct fire goes down the turret barrel — it must have traversed onto the shot line
  if (attacker.turret && Math.abs(angleDelta(attacker.turret.yaw, Math.atan2(ux, uz))) > AIM_TOLERANCE) return false;
  const range = Math.min(def.range, len);
  const target = acquireLineTarget(sim, attacker, weapon, ux, uz, range);
  const hitX = target?.transform.x ?? attacker.transform.x + ux * range;
  const hitZ = target?.transform.z ?? attacker.transform.z + uz * range;
  let damage = 0;
  let killed = false;
  let hit: HitSummary | undefined;
  if (target?.health && target.armor) {
    const direct = applyDamage(sim, target, directDamageForTarget(def.kind, target));
    if (direct > 0) alertBuildingDefenders(sim, target, attacker);
    damage = direct;
    hit = direct > 0 ? summarizeHit(target, direct) : undefined;
    const area = applyAreaDamage(sim, attacker.team.id, hitX, hitZ, def.splashRadius, def.kind, target, attacker);
    damage += area.damage;
    killed = target.health.current <= 0 || area.killed;
    weapon.targetId = target.id;
  } else {
    const area = applyAreaDamage(sim, attacker.team.id, hitX, hitZ, def.splashRadius, def.kind, undefined, attacker);
    damage = area.damage;
    killed = area.killed;
    hit = area.hit;
    weapon.targetId = undefined;
  }
  weapon.cooldown = def.cooldown;
  sim.events.push({
    kind: def.kind,
    fromX: attacker.transform.x,
    fromZ: attacker.transform.z,
    toX: hitX,
    toY: targetYForEvent(target),
    toZ: hitZ,
    sourceTeamId: attacker.team.id,
    damage,
    killed,
    ...hit,
  });
  return true;
}

/**
 * Bombs are real ordnance: they fly for dist/speed seconds toward a *location* and
 * detonate there. Anyone — including a possessed tank — can drive out of the blast.
 */
function launchBomb(sim: GameSim, attacker: Entity, weapon: Weapon, targetX: number, targetZ: number, maxRange: number): void {
  if (!attacker.team) return;
  const def = WEAPONS.bomb;
  const range = Math.hypot(targetX - attacker.transform.x, targetZ - attacker.transform.z);
  const impact = scatterBombImpact(sim, attacker, targetX, targetZ, range, maxRange);
  const flight = Math.hypot(impact.x - attacker.transform.x, impact.z - attacker.transform.z);
  const duration = Math.min(3.4, Math.max(0.85, flight / BOMB_SPEED));
  sim.projectiles.push({
    kind: 'bomb',
    fromX: attacker.transform.x,
    fromZ: attacker.transform.z,
    toX: impact.x,
    toZ: impact.z,
    elapsed: 0,
    duration,
    teamId: attacker.team.id,
    attackerId: attacker.id,
  });
  weapon.cooldown = def.cooldown;
  sim.events.push({
    kind: 'bomb',
    fromX: attacker.transform.x,
    fromY: bombMuzzleY(attacker),
    fromZ: attacker.transform.z,
    toX: impact.x,
    toZ: impact.z,
    sourceTeamId: attacker.team.id,
    damage: 0,
    killed: false,
    duration,
    trajectory: attacker.flight ? 'drop' : 'arc',
  });
}

function bombMuzzleY(attacker: Entity): number | undefined {
  if (attacker.transform.y === undefined) return undefined;
  return attacker.flight ? attacker.transform.y - 0.45 : attacker.transform.y + 3.1;
}

function stepProjectiles(sim: GameSim, dt: number): void {
  for (let i = sim.projectiles.length - 1; i >= 0; i--) {
    const projectile = sim.projectiles[i];
    projectile.elapsed += dt;
    if (projectile.elapsed < projectile.duration) continue;
    const def = WEAPONS[projectile.kind];
    const attacker = entityById(sim, projectile.attackerId);
    const area = applyAreaDamage(sim, projectile.teamId, projectile.toX, projectile.toZ, def.splashRadius, projectile.kind, undefined, attacker);
    sim.events.push({
      kind: 'bomb-impact',
      fromX: projectile.toX,
      fromZ: projectile.toZ,
      toX: projectile.toX,
      toZ: projectile.toZ,
      sourceTeamId: projectile.teamId,
      damage: area.damage,
      killed: area.killed,
      ...area.hit,
    });
    sim.projectiles.splice(i, 1);
  }
}

function fireHitscanAtEntity(sim: GameSim, attacker: Entity, weapon: Weapon, target: Entity): void {
  if (!target.health || !target.armor || !attacker.team) return;
  const def = WEAPONS[weapon.kind as WeaponKind];
  if (!def) return;
  const directDamage = applyDamage(sim, target, directDamageForTarget(def.kind, target));
  if (directDamage > 0) alertBuildingDefenders(sim, target, attacker);
  const hit = directDamage > 0 ? summarizeHit(target, directDamage) : undefined;
  const area = applyAreaDamage(sim, attacker.team.id, target.transform.x, target.transform.z, def.splashRadius, def.kind, target, attacker);
  weapon.cooldown = def.cooldown;
  sim.events.push({
    kind: def.kind,
    fromX: attacker.transform.x,
    fromZ: attacker.transform.z,
    toX: target.transform.x,
    toY: targetYForEvent(target),
    toZ: target.transform.z,
    sourceTeamId: attacker.team.id,
    damage: directDamage + area.damage,
    killed: target.health.current <= 0 || area.killed,
    ...hit,
  });
}

function validTarget(sim: GameSim, attacker: Entity, weapon: Weapon, range: number): Entity | undefined {
  if (!weapon.targetId) return undefined;
  const target = Array.from(sim.world.entities).find((entity) => entity.id === weapon.targetId);
  if (!target || !isWeaponTargetable(attacker, weapon, target)) return undefined;
  return distance(attacker, target) <= effectiveRangeForTarget(weapon.kind as WeaponKind, target, range) ? target : undefined;
}

function acquireTarget(sim: GameSim, attacker: Entity, weapon: Weapon, range: number): Entity | undefined {
  let best: Entity | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of sim.world.entities) {
    if (!isWeaponTargetable(attacker, weapon, candidate)) continue;
    const d = distance(attacker, candidate);
    if (d > effectiveRangeForTarget(weapon.kind as WeaponKind, candidate, range)) continue;
    // the player's possessed unit reads as high-value — AI applies pressure to it
    const score = candidate.playerControlled ? d * 0.55 : d;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function acquireLineTarget(sim: GameSim, attacker: Entity, weapon: Weapon, ux: number, uz: number, range: number): Entity | undefined {
  let best: Entity | undefined;
  let bestAlong = range;
  for (const candidate of sim.world.entities) {
    if (!isWeaponTargetable(attacker, weapon, candidate)) continue;
    const dx = candidate.transform.x - attacker.transform.x;
    const dz = candidate.transform.z - attacker.transform.z;
    const along = dx * ux + dz * uz;
    const targetRange = effectiveRangeForTarget(weapon.kind as WeaponKind, candidate, range);
    if (along < 0 || along > targetRange || along > bestAlong) continue;
    const perp = Math.abs(dx * uz - dz * ux);
    const radius = candidate.collider?.radius ?? candidate.selectable?.radius ?? 2.4;
    if (perp > radius + 2.2) continue;
    best = candidate;
    bestAlong = along;
  }
  return best;
}

function isWeaponTargetable(attacker: Entity, weapon: Weapon, target: Entity): boolean {
  if (!isTargetable(attacker, target) || !target.armor) return false;
  const kind = weapon.kind as WeaponKind;
  const def = WEAPONS[kind];
  if (!def || !def.targetTypes.includes(target.armor.kind)) return false;
  if (target.flight) return AIR_DIRECT_MULTIPLIER[kind] > 0 && AIR_RANGE_MULTIPLIER[kind] > 0;
  return kind !== 'aaMissile';
}

function isTargetable(attacker: Entity, target: Entity): boolean {
  if (attacker === target) return false;
  if (!attacker.team || !target.team) return false;
  return targetableByTeam(attacker.team.id, target);
}

function entityById(sim: GameSim, id: number): Entity | undefined {
  return Array.from(sim.world.entities).find((entity) => entity.id === id);
}

function alertBuildingDefenders(sim: GameSim, damaged: Entity, attacker?: Entity): void {
  if (!attacker?.team || !damaged.building || !damaged.team || damaged.destroyed) return;
  if (attacker.team.id === damaged.team.id) return;
  for (const defender of sim.world.entities) {
    if (defender.team?.id !== damaged.team.id || defender.destroyed || defender.playerControlled) continue;
    if (!defender.mover || !defender.health || defender.building) continue;
    const slots = weaponSlots(defender);
    if (slots.length === 0 || !slots.some((weapon) => isWeaponTargetable(defender, weapon, attacker))) continue;
    const dx = defender.transform.x - damaged.transform.x;
    const dz = defender.transform.z - damaged.transform.z;
    if (Math.hypot(dx, dz) > DEFENSE_ALERT_RADIUS) continue;
    defender.mover.defenseAlert = { targetId: attacker.id, x: attacker.transform.x, z: attacker.transform.z, ttl: DEFENSE_ALERT_TTL };
    if (!defender.mover.target) defender.mover.engage = { x: attacker.transform.x, z: attacker.transform.z };
    for (const weapon of slots) weapon.targetId = attacker.id;
  }
}

function targetableByTeam(teamId: number, target: Entity): boolean {
  if (!target.team || target.team.id === teamId) return false;
  if (!target.health || target.health.current <= 0 || target.destroyed) return false;
  return true;
}

function applyDamage(sim: GameSim, target: Entity, amount: number): number {
  if (!target.health || amount <= 0) return 0;
  const before = target.health.current;
  target.health.current = Math.max(0, target.health.current - amount);
  if (target.health.current <= 0 && !target.destroyed) {
    target.destroyed = { remaining: 20 };
    target.selectable && (target.selectable.selected = false);
    stopEntities([target]);
    if (target.building) sim.nav.removeDynamicBlocker(target.id);
  }
  return before - target.health.current;
}

function directDamageForTarget(kind: WeaponKind, target: Entity): number {
  if (!target.armor) return 0;
  const base = damageForArmor(kind, target.armor.kind);
  return target.flight ? base * AIR_DIRECT_MULTIPLIER[kind] : base;
}

function effectiveRangeForTarget(kind: WeaponKind, target: Entity, range: number): number {
  return target.flight ? range * AIR_RANGE_MULTIPLIER[kind] : range;
}

function splashDamageForTarget(kind: WeaponKind, target: Entity, falloff: number): number {
  if (!target.armor) return 0;
  const multiplier = target.flight ? AIR_SPLASH_MULTIPLIER[kind] : kind === 'bomb' ? 1 : 0.55;
  return damageForArmor(kind, target.armor.kind) * falloff * multiplier;
}

function applyAreaDamage(
  sim: GameSim,
  teamId: number,
  x: number,
  z: number,
  radius: number,
  kind: WeaponKind,
  primary?: Entity,
  attacker?: Entity,
): { damage: number; killed: boolean; hit?: HitSummary } {
  if (radius <= 0) return { damage: 0, killed: false };
  let damage = 0;
  let killed = false;
  let hit: HitSummary | undefined;
  for (const target of sim.world.entities) {
    if (target === primary || !targetableByTeam(teamId, target) || !target.armor) continue;
    const dx = target.transform.x - x;
    const dz = target.transform.z - z;
    const d = Math.hypot(dx, dz);
    if (d > radius) continue;
    const falloff = 1 - d / radius;
    const dealt = applyDamage(sim, target, splashDamageForTarget(kind, target, falloff));
    if (dealt > 0) alertBuildingDefenders(sim, target, attacker);
    damage += dealt;
    if (dealt > 0 && (!hit || dealt > hit.damage)) hit = summarizeHit(target, dealt);
    killed ||= target.health?.current === 0;
  }
  return { damage, killed, hit };
}

function summarizeHit(target: Entity, damage: number): HitSummary | undefined {
  if (!target.health) return undefined;
  return {
    targetId: target.id,
    targetLabel: target.name ?? target.building?.label ?? target.selectable?.type ?? 'target',
    targetType: target.building ? 'building' : target.selectable?.type ?? 'unit',
    targetHealth: target.health.current,
    targetMaxHealth: target.health.max,
    damage,
  };
}

function targetYForEvent(target: Entity | undefined): number | undefined {
  if (!target?.flight) return undefined;
  return target.transform.y;
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
