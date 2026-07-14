import { WEAPONS, type ArmorClass, type WeaponKind } from '../content/phase4';
import { angleDelta, slewAngle } from './angles';
import type { Entity, Weapon } from './components';
import { hash2i, smoothstep } from './noise';
import { applyStructureDamage } from './structureDamage';
import { areTeamsHostile, attackStandoffPoint, entityById, issueMoveOrder, stopEntities, type GameSim } from './world';

/** Cannons may only fire once the turret has traversed onto the bearing. */
const AIM_TOLERANCE = 0.12;
const BOMB_SPEED = 95; // meters per second of flight, drives travel time
const DEFENSE_ALERT_RADIUS = 145;
const DEFENSE_ALERT_TTL = 9;

interface HitSummary {
  targetId: number;
  targetLabel: string;
  targetType: string;
  targetHealth: number;
  targetMaxHealth: number;
  damage: number;
}

export interface CombatStepOptions {
  /** False for visual/QA scenes: projectiles and cooldowns tick, units do not auto-acquire/fire. */
  autoFire?: boolean;
}

export function damageForArmor(kind: WeaponKind, armor: ArmorClass): number {
  const def = WEAPONS[kind];
  return def.damage * def.vs[armor];
}

export function stepCombat(sim: GameSim, dt: number, options: CombatStepOptions = {}): void {
  stepProjectiles(sim, dt);
  tickWeaponCooldowns(sim, dt);
  if (options.autoFire === false) {
    tickDestroyed(sim, dt);
    return;
  }

  const combatants = Array.from(sim.world.entities).filter(
    (entity) => weaponSlots(entity).length > 0 && entity.health && entity.team && !entity.destroyed,
  );
  for (const attacker of combatants) {
    if (!attacker.health || !attacker.team) continue;
    if (attacker.playerControlled) continue; // brain bypassed; stepSim slews the turret to the crosshair
    const commandDrivenCombat = !sim.rules.autoCombat;
    if (commandDrivenCombat && !attacker.mover?.attackMove && !weaponSlots(attacker).some((weapon) => weapon.targetId !== undefined)) continue;

    const orderedTarget = explicitOrderTarget(sim, attacker);
    let turretGoalYaw: number | undefined;
    for (const weapon of weaponSlots(attacker)) {
      const def = WEAPONS[weapon.kind as WeaponKind];
      if (!def) continue;
      // a unit can only auto-engage what it can see — no shelling into the fog
      const weaponRange = weapon.range || def.range;
      const range = Math.min(weaponRange, attacker.vision?.radius ?? weaponRange);
      let target: Entity | undefined;
      if (orderedTarget) {
        if (!isWeaponTargetable(sim, attacker, weapon, orderedTarget)) {
          weapon.targetId = undefined;
          continue;
        }
        weapon.targetId = orderedTarget.id;
        target = validTarget(sim, attacker, weapon, range);
        if (!target) continue;
      } else {
        target = validTarget(sim, attacker, weapon, range);
      }
      if (!target) {
        if (commandDrivenCombat && !attacker.mover?.attackMove) {
          weapon.targetId = undefined;
          continue;
        }
        if (attacker.aiCombat && (attacker.aiCombat.nextAcquireTick ?? 0) > sim.tick) continue;
        target = acquireTarget(sim, attacker, weapon, range);
        if (attacker.aiCombat) attacker.aiCombat.nextAcquireTick = sim.tick + attacker.aiCombat.targetAcquireDelayTicks;
      }
      weapon.targetId = target?.id;
      if (!target?.health || !target.armor) continue;
      const bearing = Math.atan2(target.transform.x - attacker.transform.x, target.transform.z - attacker.transform.z);
      // direct-fire weapons wait for the turret; bombs are lobbed from the hull
      if (def.kind !== 'bomb' && attacker.turret) {
        turretGoalYaw ??= bearing;
        if (Math.abs(angleDelta(attacker.turret.yaw, bearing)) > AIM_TOLERANCE) continue;
      }
      if (weapon.cooldown > 0) continue;
      if (def.kind === 'bomb' || def.kind === 'tankBomb') {
        const aim = autoAimPoint(sim, attacker, weapon, target, target.transform.x, target.transform.z, 'bomb');
        launchBomb(sim, attacker, weapon, aim.x, aim.z, def.range);
      } else if (def.projectile) {
        launchWeaponProjectileAtEntity(sim, attacker, weapon, target);
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

function tickWeaponCooldowns(sim: GameSim, dt: number): void {
  for (const entity of sim.world.entities) {
    for (const weapon of cooldownWeapons(entity)) weapon.cooldown = Math.max(0, weapon.cooldown - dt);
  }
}

/** Idle units don't stand and take bombardment — they close on visible foes. */
function updateGuardBehavior(sim: GameSim, attacker: Entity, dt: number): void {
  if (!attacker.mover || attacker.mover.target || attacker.mover.attackTargetId !== undefined || !attacker.vision) return;
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
    if (alert.ttl <= 0 || !target || !isWeaponTargetable(sim, attacker, slots[0], target)) {
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

export function issueAttackOrder(sim: GameSim, attackers: Entity[], target: Entity): boolean {
  if (!target.team || !target.health || target.destroyed) return false;
  const eligible = attackers.filter(
    (attacker) =>
      attacker.mover &&
      attacker.team &&
      !attacker.destroyed &&
      areTeamsHostile(sim, attacker.team.id, target.team!.id) &&
      weaponSlots(attacker).some((weapon) => isWeaponTargetable(sim, attacker, weapon, target)),
  );
  if (eligible.length === 0) return false;
  const destination = attackStandoffPoint(sim, eligible, target);
  if (!issueMoveOrder(sim, eligible, destination.x, destination.z, true)) return false;
  for (const attacker of eligible) {
    attacker.mover!.attackTargetId = target.id;
    for (const weapon of weaponSlots(attacker)) {
      weapon.targetId = isWeaponTargetable(sim, attacker, weapon, target) ? target.id : undefined;
    }
  }
  return true;
}

function explicitOrderTarget(sim: GameSim, attacker: Entity): Entity | undefined {
  const targetId = attacker.mover?.attackTargetId;
  if (targetId === undefined) return undefined;
  const target = entityById(sim, targetId);
  if (target && target.health && !target.destroyed && target.health.current > 0 && target.team && attacker.team && areTeamsHostile(sim, attacker.team.id, target.team.id)) {
    return target;
  }
  attacker.mover!.attackTargetId = undefined;
  attacker.mover!.attackMove = false;
  attacker.mover!.target = undefined;
  attacker.mover!.formationOffset = undefined;
  attacker.mover!.flow = undefined;
  for (const weapon of weaponSlots(attacker)) weapon.targetId = undefined;
  return undefined;
}

export function manualFireAt(
  sim: GameSim,
  attacker: Entity,
  targetX: number,
  targetZ: number,
  slot: 'primary' | 'secondary' | 'special' = 'primary',
  targetY?: number,
): boolean {
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
  const muzzleY = directMuzzleY(attacker) ?? attacker.transform.y ?? targetY ?? 0;
  const rayLength = targetY === undefined ? 0 : Math.hypot(rawDx, targetY - muzzleY, rawDz);
  const aimRay = targetY !== undefined && rayLength > 0.001
    ? { x: rawDx / rayLength, y: (targetY - muzzleY) / rayLength, z: rawDz / rayLength, fromY: muzzleY }
    : undefined;

  if (def.kind === 'bomb' || def.kind === 'tankBomb') {
    // A manually aimed artillery shot can cross the entire battlefield. The
    // V-mode reticle keeps the requested point inside the map, while this cap
    // also accepts network commands from any corner to the opposite corner.
    const maxRange = Math.max(def.range, sim.nav.size * Math.SQRT2 + 8);
    const range = attacker.flight ? Math.min(maxRange, len) : len < 8 ? 48 : Math.min(maxRange, len);
    launchBomb(sim, attacker, weapon, attacker.transform.x + ux * range, attacker.transform.z + uz * range, maxRange);
    return true;
  }

  // direct fire goes down the turret barrel — it must have traversed onto the shot line
  if (attacker.turret && Math.abs(angleDelta(attacker.turret.yaw, Math.atan2(ux, uz))) > AIM_TOLERANCE) return false;
  // Player-issued tank missiles follow the full aim ray. Automatic combat still
  // uses each tank's normal acquisition range before it reaches this path.
  const range = isTankDirectMissile(def.kind) ? len : Math.min(weapon.range || def.range, len);
  if (def.minRange !== undefined && len < def.minRange) return false;
  const target = acquireLineTarget(sim, attacker, weapon, ux, uz, range, aimRay);
  const hitX = target?.transform.x ?? attacker.transform.x + ux * range;
  const hitZ = target?.transform.z ?? attacker.transform.z + uz * range;
  if (def.projectile) {
    launchWeaponProjectile(sim, attacker, weapon, target, hitX, targetYForEvent(target, targetY), hitZ);
    return true;
  }
  let damage = 0;
  let killed = false;
  let hit: HitSummary | undefined;
  if (target?.health && target.armor) {
    const direct = applyDamage(sim, target, directDamageForTarget(def.kind, target), {
      hitX,
      hitZ,
      hitY: structureHitY(target, attacker),
      fromX: attacker.transform.x,
      fromZ: attacker.transform.z,
      splashRadius: 0,
      trajectory: attacker.flight ? 'flat' : 'flat',
      weaponKind: def.kind,
    });
    if (direct > 0) alertEconomyDefenders(sim, target, attacker);
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
    fromY: directMuzzleY(attacker),
    fromZ: attacker.transform.z,
    toX: hitX,
    toY: targetYForEvent(target, targetY),
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
  const weaponKind = weapon.kind === 'tankBomb' ? 'tankBomb' : 'bomb';
  const def = WEAPONS[weaponKind];
  const projectileKind = weaponKind === 'tankBomb' ? 'tankBomb' : 'bomb';
  const range = Math.hypot(targetX - attacker.transform.x, targetZ - attacker.transform.z);
  const salvoCount = Math.max(1, Math.min(4, Math.round(weapon.salvoCount ?? 1)));
  const baseImpact = scatterBombImpact(sim, attacker, targetX, targetZ, range, maxRange);
  const aimYaw = Math.atan2(targetX - attacker.transform.x, targetZ - attacker.transform.z);
  const impactLimit = sim.nav.size / 2 - 2;
  for (let i = 0; i < salvoCount; i++) {
    const salvoImpact = offsetSalvoImpact(baseImpact.x, baseImpact.z, aimYaw, salvoCount, i);
    const impact = {
      x: Math.max(-impactLimit, Math.min(impactLimit, salvoImpact.x)),
      z: Math.max(-impactLimit, Math.min(impactLimit, salvoImpact.z)),
    };
    const flight = Math.hypot(impact.x - attacker.transform.x, impact.z - attacker.transform.z);
    const duration = Math.min(8, Math.max(0.85, flight / BOMB_SPEED) + i * 0.08);
    sim.projectiles.push({
      kind: projectileKind,
      weaponKind,
      fromX: attacker.transform.x,
      fromZ: attacker.transform.z,
      toX: impact.x,
      toZ: impact.z,
      elapsed: 0,
      duration,
      trajectory: attacker.flight ? 'drop' : 'arc',
      teamId: attacker.team.id,
      attackerId: attacker.id,
    });
    sim.events.push({
      kind: projectileKind,
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
  weapon.cooldown = weaponCooldown(def.cooldown, attacker);
}

function launchWeaponProjectileAtEntity(sim: GameSim, attacker: Entity, weapon: Weapon, target: Entity): void {
  const aim = autoAimPoint(sim, attacker, weapon, target, target.transform.x, target.transform.z, 'projectile');
  launchWeaponProjectile(sim, attacker, weapon, aim.directTarget, aim.x, targetYForEvent(aim.directTarget, target.transform.y), aim.z);
}

function launchWeaponProjectile(
  sim: GameSim,
  attacker: Entity,
  weapon: Weapon,
  target: Entity | undefined,
  targetX: number,
  targetY: number | undefined,
  targetZ: number,
): void {
  if (!attacker.team) return;
  const def = WEAPONS[weapon.kind as WeaponKind];
  if (!def?.projectile) return;
  const fromY = directMuzzleY(attacker);
  const dx = targetX - attacker.transform.x;
  const dz = targetZ - attacker.transform.z;
  const distanceToAim = Math.max(0.001, Math.hypot(dx, dz));
  const speed = def.projectile.speed;
  const duration = Math.min(3.2, Math.max(0.08, distanceToAim / speed));
  const homing =
    def.projectile.trajectory === 'homing' && target?.id
      ? { targetId: target.id, speed, fizzleRange: def.projectile.fizzleRange ?? def.range * 1.15 }
      : undefined;
  sim.projectiles.push({
    kind: def.projectile.kind,
    weaponKind: def.kind,
    fromX: attacker.transform.x,
    fromY,
    fromZ: attacker.transform.z,
    x: attacker.transform.x,
    y: fromY,
    z: attacker.transform.z,
    toX: targetX,
    toY: targetY,
    toZ: targetZ,
    elapsed: 0,
    duration,
    speed,
    maxDistance: def.projectile.fizzleRange ?? (isTankDirectMissile(def.kind) ? distanceToAim : def.range),
    directTargetId: target?.id,
    trajectory: def.projectile.trajectory,
    homing,
    teamId: attacker.team.id,
    attackerId: attacker.id,
  });
  weapon.cooldown = weaponCooldown(def.cooldown, attacker);
  sim.events.push({
    kind: def.projectile.kind,
    fromX: attacker.transform.x,
    fromY,
    fromZ: attacker.transform.z,
    toX: targetX,
    toY: targetY,
    toZ: targetZ,
    targetId: target?.id,
    targetLabel: target?.name ?? target?.building?.label ?? target?.selectable?.type,
    sourceTeamId: attacker.team.id,
    damage: 0,
    killed: false,
    duration,
    trajectory: def.projectile.trajectory,
  });
}

function isTankDirectMissile(kind: WeaponKind): boolean {
  return kind === 'scoutMissile' || kind === 'tankMissile' || kind === 'siegeMissile';
}

function bombMuzzleY(attacker: Entity): number | undefined {
  if (attacker.transform.y === undefined) return undefined;
  return attacker.flight ? attacker.transform.y - 0.45 : attacker.transform.y + 3.1;
}

function directMuzzleY(attacker: Entity): number | undefined {
  if (attacker.transform.y === undefined) return undefined;
  if (attacker.flight) return attacker.transform.y - 0.15;
  if (attacker.weapon?.kind === 'sniperRifle' || attacker.weapons?.primary.kind === 'sniperRifle') return attacker.transform.y + 1.72;
  return attacker.transform.y + (attacker.selectable?.type === 'infantry' ? 1.35 : 2.2);
}

function stepProjectiles(sim: GameSim, dt: number): void {
  for (let i = sim.projectiles.length - 1; i >= 0; i--) {
    const projectile = sim.projectiles[i];
    projectile.elapsed += dt;
    if (projectile.homing) {
      const target = entityById(sim, projectile.homing.targetId);
      if (!target || !target.health || target.health.current <= 0 || target.destroyed) {
        sim.projectiles.splice(i, 1);
        continue;
      }
      const px = projectile.x ?? projectile.fromX;
      const py = projectile.y ?? projectile.fromY ?? 0;
      const pz = projectile.z ?? projectile.fromZ;
      const ty = target.transform.y ?? 1.6;
      const vx = target.transform.x - px;
      const vy = ty - py;
      const vz = target.transform.z - pz;
      const d = Math.max(0.001, Math.hypot(vx, vy, vz));
      const step = Math.min(d, projectile.homing.speed * dt);
      projectile.x = px + (vx / d) * step;
      projectile.y = py + (vy / d) * step;
      projectile.z = pz + (vz / d) * step;
      const traveled = Math.hypot((projectile.x ?? px) - projectile.fromX, (projectile.z ?? pz) - projectile.fromZ);
      if (traveled > projectile.homing.fizzleRange) {
        sim.projectiles.splice(i, 1);
        continue;
      }
      const weaponKind = (projectile.weaponKind ?? projectile.kind) as WeaponKind;
      const impactRadius = WEAPONS[weaponKind]?.projectile?.impactRadius ?? 2.5;
      if (d > impactRadius) continue;
      impactProjectile(sim, projectile, target.transform.x, ty, target.transform.z, target);
      sim.projectiles.splice(i, 1);
      continue;
    }

    const t = Math.min(1, projectile.elapsed / projectile.duration);
    projectile.x = projectile.fromX + (projectile.toX - projectile.fromX) * t;
    projectile.z = projectile.fromZ + (projectile.toZ - projectile.fromZ) * t;
    if (projectile.trajectory === 'arc') {
      const fromY = projectile.fromY ?? 1.8;
      const toY = projectile.toY ?? 1.2;
      const lift = Math.min(28, Math.hypot(projectile.toX - projectile.fromX, projectile.toZ - projectile.fromZ) * 0.32);
      projectile.y = fromY + (toY - fromY) * t + Math.sin(t * Math.PI) * lift;
    } else if (projectile.trajectory === 'drop') {
      const fromY = projectile.fromY ?? 20;
      const toY = projectile.toY ?? 0.8;
      projectile.y = fromY + (toY - fromY) * (t * t);
    } else {
      projectile.y = (projectile.fromY ?? 2) + ((projectile.toY ?? 1.4) - (projectile.fromY ?? 2)) * t;
    }
    if (projectile.elapsed < projectile.duration) continue;
    const directTarget = projectile.directTargetId ? entityById(sim, projectile.directTargetId) : undefined;
    impactProjectile(sim, projectile, projectile.toX, projectile.toY, projectile.toZ, directTarget);
    sim.projectiles.splice(i, 1);
  }
}

function impactProjectile(sim: GameSim, projectile: GameSim['projectiles'][number], x: number, y: number | undefined, z: number, directTarget?: Entity): void {
  const weaponKind = (projectile.weaponKind ?? projectile.kind) as WeaponKind;
  const def = WEAPONS[weaponKind];
  if (!def) return;
  const attacker = entityById(sim, projectile.attackerId);
  const impactTrajectory = projectile.trajectory === 'arc' || projectile.trajectory === 'drop' ? projectile.trajectory : 'flat';
  let directDamage = 0;
  let hit: HitSummary | undefined;
  const impactRadius = def.projectile?.impactRadius ?? directTarget?.collider?.radius ?? 1.8;
  if (directTarget?.health && directTarget.armor && targetableByTeam(sim, projectile.teamId, directTarget)) {
    const dx = directTarget.transform.x - x;
    const dz = directTarget.transform.z - z;
    const radius = (directTarget.collider?.radius ?? directTarget.selectable?.radius ?? 1.4) + impactRadius;
    if (Math.hypot(dx, dz) <= radius) {
      directDamage = applyDamage(sim, directTarget, directDamageForTarget(weaponKind, directTarget), {
        hitX: x,
        hitZ: z,
        hitY: structureHitY(directTarget, attacker, impactTrajectory),
        fromX: projectile.fromX,
        fromZ: projectile.fromZ,
        splashRadius: 0,
        trajectory: impactTrajectory,
        weaponKind,
      });
      if (directDamage > 0) {
        alertEconomyDefenders(sim, directTarget, attacker);
        hit = summarizeHit(directTarget, directDamage);
      }
    }
  }
  const area = applyAreaDamage(sim, projectile.teamId, x, z, def.splashRadius, weaponKind, directTarget, attacker, impactTrajectory);
  if (!hit) hit = area.hit;
  sim.events.push({
    kind: `${projectile.kind}-impact`,
    fromX: x,
    fromY: y,
    fromZ: z,
    toX: x,
    toY: y,
    toZ: z,
    sourceTeamId: projectile.teamId,
    damage: directDamage + area.damage,
    killed: directTarget?.health?.current === 0 || area.killed,
    ...hit,
  });
}

function fireHitscanAtEntity(sim: GameSim, attacker: Entity, weapon: Weapon, target: Entity): void {
  if (!target.health || !target.armor || !attacker.team) return;
  const def = WEAPONS[weapon.kind as WeaponKind];
  if (!def) return;
  const aim = autoAimPoint(sim, attacker, weapon, target, target.transform.x, target.transform.z, 'direct');
  let directDamage = 0;
  let hit: HitSummary | undefined;
  if (aim.directTarget) {
    directDamage = applyDamage(sim, target, directDamageForTarget(def.kind, target), {
      hitX: target.transform.x,
      hitZ: target.transform.z,
      hitY: structureHitY(target, attacker),
      fromX: attacker.transform.x,
      fromZ: attacker.transform.z,
      splashRadius: 0,
      trajectory: attacker.flight ? 'flat' : 'flat',
      weaponKind: def.kind,
    });
    if (directDamage > 0) alertEconomyDefenders(sim, target, attacker);
    hit = directDamage > 0 ? summarizeHit(target, directDamage) : undefined;
  }
  const area = applyAreaDamage(sim, attacker.team.id, aim.x, aim.z, def.splashRadius, def.kind, aim.directTarget, attacker);
  weapon.cooldown = weaponCooldown(def.cooldown, attacker);
  sim.events.push({
    kind: def.kind,
    fromX: attacker.transform.x,
    fromY: directMuzzleY(attacker),
    fromZ: attacker.transform.z,
    toX: aim.x,
    toY: targetYForEvent(aim.directTarget),
    toZ: aim.z,
    sourceTeamId: attacker.team.id,
    damage: directDamage + area.damage,
    killed: (aim.directTarget?.health?.current ?? 1) <= 0 || area.killed,
    ...hit,
  });
}

function weaponCooldown(baseCooldown: number, attacker: Entity): number {
  return baseCooldown * (attacker.aiCombat?.cooldownMultiplier ?? 1);
}

function autoAimPoint(
  sim: GameSim,
  attacker: Entity,
  weapon: Weapon,
  target: Entity,
  targetX: number,
  targetZ: number,
  mode: 'direct' | 'projectile' | 'bomb',
): { x: number; z: number; directTarget?: Entity } {
  const ai = attacker.aiCombat;
  if (!ai) return { x: targetX, z: targetZ, directTarget: target };
  const salt = weaponKindSalt(weapon.kind) + (mode === 'direct' ? 0x101 : mode === 'projectile' ? 0x202 : 0x303);
  const hitRoll = hash2i(attacker.id, sim.tick + target.id, salt);
  const hitsCleanly = hitRoll <= ai.accuracy;
  if (hitsCleanly && mode === 'direct') return { x: targetX, z: targetZ, directTarget: target };

  const scatterBase = ai.projectileScatter * (mode === 'bomb' ? 1.15 : mode === 'projectile' ? 0.82 : 0.62);
  if (scatterBase <= 0.01 && hitsCleanly) return { x: targetX, z: targetZ, directTarget: target };
  const angle = hash2i(target.id, attacker.id, sim.tick + salt) * Math.PI * 2;
  const missBoost = hitsCleanly ? 0.35 : 1.0;
  const radius = (0.35 + hash2i(sim.tick, attacker.id + target.id, salt ^ 0x55aa) * 0.9) * scatterBase * missBoost;
  return {
    x: targetX + Math.cos(angle) * radius,
    z: targetZ + Math.sin(angle) * radius,
    directTarget: hitsCleanly ? target : undefined,
  };
}

function weaponKindSalt(kind: string): number {
  let hash = 0x9e3779b9;
  for (let i = 0; i < kind.length; i++) hash = Math.imul(hash ^ kind.charCodeAt(i), 0x85ebca6b);
  return hash >>> 0;
}

function validTarget(sim: GameSim, attacker: Entity, weapon: Weapon, range: number): Entity | undefined {
  if (!weapon.targetId) return undefined;
  const target = entityById(sim, weapon.targetId);
  if (!target || !isWeaponTargetable(sim, attacker, weapon, target)) return undefined;
  const visionCap = attacker.vision?.radius ?? range;
  const d = distance(attacker, target);
  return d <= effectiveRangeForTarget(weapon.kind as WeaponKind, target, range, visionCap) && d >= minimumRangeForWeapon(weapon.kind as WeaponKind) ? target : undefined;
}

function acquireTarget(sim: GameSim, attacker: Entity, weapon: Weapon, range: number): Entity | undefined {
  let best: Entity | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  const visionCap = attacker.vision?.radius ?? range;
  for (const candidate of sim.world.entities) {
    if (!isWeaponTargetable(sim, attacker, weapon, candidate)) continue;
    const d = distance(attacker, candidate);
    if (d > effectiveRangeForTarget(weapon.kind as WeaponKind, candidate, range, visionCap)) continue;
    if (d < minimumRangeForWeapon(weapon.kind as WeaponKind)) continue;
    // the player's possessed unit reads as high-value — AI applies pressure to it
    const score = candidate.playerControlled ? d * (attacker.aiCombat?.possessedTargetPriority ?? 0.55) : d;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

interface ManualAimRay {
  x: number;
  y: number;
  z: number;
  fromY: number;
}

function acquireLineTarget(
  sim: GameSim,
  attacker: Entity,
  weapon: Weapon,
  ux: number,
  uz: number,
  range: number,
  aimRay?: ManualAimRay,
): Entity | undefined {
  let best: Entity | undefined;
  let bestAlong = Number.POSITIVE_INFINITY;
  const visionCap = attacker.vision?.radius ?? range;
  for (const candidate of sim.world.entities) {
    if (!isWeaponTargetable(sim, attacker, weapon, candidate)) continue;
    const dx = candidate.transform.x - attacker.transform.x;
    const dz = candidate.transform.z - attacker.transform.z;
    const horizontalAlong = dx * ux + dz * uz;
    const targetRange = effectiveRangeForTarget(weapon.kind as WeaponKind, candidate, range, visionCap);
    if (horizontalAlong < 0 || horizontalAlong > targetRange) continue;
    if (horizontalAlong < minimumRangeForWeapon(weapon.kind as WeaponKind)) continue;
    const radius = candidate.collider?.radius ?? candidate.selectable?.radius ?? 2.4;
    let along = horizontalAlong;
    let perp = Math.abs(dx * uz - dz * ux);
    let tolerance = radius + 2.2;
    if (aimRay) {
      const baseY = candidate.transform.y;
      const centerOffset = candidate.flight ? 0 : candidate.building ? 2.4 : candidate.selectable?.type === 'infantry' ? 1 : 1.4;
      const candidateY = baseY === undefined ? aimRay.fromY : baseY + centerOffset;
      const dy = candidateY - aimRay.fromY;
      along = dx * aimRay.x + dy * aimRay.y + dz * aimRay.z;
      if (along < 0) continue;
      perp = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - along * along));
      tolerance = radius + (candidate.flight ? 1.35 : 0.8);
    }
    if (along > bestAlong || perp > tolerance) continue;
    best = candidate;
    bestAlong = along;
  }
  return best;
}

function isWeaponTargetable(sim: GameSim, attacker: Entity, weapon: Weapon, target: Entity): boolean {
  if (!isTargetable(sim, attacker, target) || !target.armor) return false;
  const kind = weapon.kind as WeaponKind;
  const def = WEAPONS[kind];
  if (!def || !def.targetTypes.includes(target.armor.kind)) return false;
  if (target.armor.kind === 'air') return !!def.canTargetAir && def.vs.air > 0;
  return true;
}

function isTargetable(sim: GameSim, attacker: Entity, target: Entity): boolean {
  if (attacker === target) return false;
  if (!attacker.team || !target.team) return false;
  return targetableByTeam(sim, attacker.team.id, target);
}

// Intentional design: when a base building/harvester is hit, nearby defenders rally
// toward the attacker even if they can't personally see it — a "base alarm". This
// only drives MOVEMENT toward the attacker's last known spot; actual firing stays
// vision-gated in validTarget/acquireTarget, so it is not a fog-honesty violation
// (defenders that arrive without line of sight simply won't shoot).
function alertEconomyDefenders(sim: GameSim, damaged: Entity, attacker?: Entity): void {
  if (!sim.rules.autoDefense) return;
  if (!attacker?.team || (!damaged.building && !damaged.harvester) || !damaged.team || damaged.destroyed) return;
  if (!areTeamsHostile(sim, attacker.team.id, damaged.team.id)) return;
  for (const defender of sim.world.entities) {
    if (defender.team?.id !== damaged.team.id || defender.destroyed || defender.playerControlled) continue;
    if (!defender.mover || !defender.health || defender.building) continue;
    const slots = weaponSlots(defender);
    if (slots.length === 0 || !slots.some((weapon) => isWeaponTargetable(sim, defender, weapon, attacker))) continue;
    const dx = defender.transform.x - damaged.transform.x;
    const dz = defender.transform.z - damaged.transform.z;
    if (Math.hypot(dx, dz) > DEFENSE_ALERT_RADIUS) continue;
    defender.mover.defenseAlert = { targetId: attacker.id, x: attacker.transform.x, z: attacker.transform.z, ttl: DEFENSE_ALERT_TTL };
    if (!defender.mover.target) defender.mover.engage = { x: attacker.transform.x, z: attacker.transform.z };
    for (const weapon of slots) weapon.targetId = attacker.id;
  }
}

function targetableByTeam(sim: GameSim, teamId: number, target: Entity): boolean {
  if (!target.team || !areTeamsHostile(sim, teamId, target.team.id)) return false;
  if (!target.health || target.health.current <= 0 || target.destroyed) return false;
  return true;
}

interface DamageImpact {
  hitX: number;
  hitZ: number;
  hitY?: number;
  fromX: number;
  fromZ: number;
  splashRadius: number;
  trajectory?: 'arc' | 'drop' | 'flat';
  weaponKind: WeaponKind;
}

function applyDamage(sim: GameSim, target: Entity, amount: number, impact?: DamageImpact): number {
  if (!target.health || amount <= 0) return 0;
  const before = target.health.current;
  target.health.current = Math.max(0, target.health.current - amount);
  const dealt = before - target.health.current;
  if (dealt > 0 && impact && !target.building) applyImpactPhysics(sim, target, dealt, impact);
  if (dealt > 0 && target.building && impact) {
    applyStructureDamage(target, {
      hitX: impact.hitX,
      hitZ: impact.hitZ,
      hitY: impact.hitY,
      fromX: impact.fromX,
      fromZ: impact.fromZ,
      amount: dealt,
      splashRadius: impact.splashRadius,
      trajectory: impact.trajectory,
    });
  }
  if (target.health.current <= 0 && !target.destroyed) {
    target.destroyed = { remaining: 20 };
    target.selectable && (target.selectable.selected = false);
    stopEntities([target]);
    if (target.building) sim.nav.removeDynamicBlocker(target.id);
  }
  return dealt;
}

function applyImpactPhysics(sim: GameSim, target: Entity, dealt: number, impact: DamageImpact): void {
  if (!target.health || !target.velocity || !target.mover) return;
  const force = normalizedImpactForce(target, dealt, impact.weaponKind);
  if (force <= 0.012) return;
  const originX = impact.splashRadius > 0 ? impact.hitX : impact.fromX;
  const originZ = impact.splashRadius > 0 ? impact.hitZ : impact.fromZ;
  let dx = target.transform.x - originX;
  let dz = target.transform.z - originZ;
  let distance = Math.hypot(dx, dz);
  if (distance < 0.001) {
    dx = -Math.sin(target.transform.rot);
    dz = -Math.cos(target.transform.rot);
    distance = 1;
  }
  dx /= distance;
  dz /= distance;
  const impulseSpeed = force * (target.armor?.kind === 'infantry' ? 10.5 : target.armor?.kind === 'air' ? 7.5 : target.armor?.kind === 'heavy' ? 4.2 : 6.2);
  target.velocity.x += dx * impulseSpeed;
  target.velocity.z += dz * impulseSpeed;
  if (target.flight) {
    const side = Math.sin(Math.atan2(dx, dz) - target.transform.rot) >= 0 ? 1 : -1;
    target.flight.verticalVelocity += force * 3.8;
    target.flight.rollAttitude += side * force * 0.42;
    target.flight.pitchAttitude -= force * 0.18;
  }
  sim.events.push({
    kind: 'impact-reaction',
    impactKind: impact.weaponKind,
    force,
    fromX: originX,
    fromZ: originZ,
    toX: target.transform.x,
    toY: target.transform.y,
    toZ: target.transform.z,
    targetId: target.id,
    targetLabel: target.name ?? target.selectable?.type ?? 'unit',
    targetType: target.flight ? 'aircraft' : target.selectable?.type ?? 'unit',
    targetHealth: target.health.current,
    targetMaxHealth: target.health.max,
    damage: dealt,
    killed: target.health.current <= 0,
    trajectory: impact.trajectory,
  });
}

function normalizedImpactForce(target: Entity, damage: number, kind: WeaponKind): number {
  const damageRatio = damage / Math.max(1, target.health?.max ?? damage);
  const weaponEnergy =
    kind === 'tankBomb' || kind === 'annihilatorMissile' ? 1.9
      : kind === 'bomb' || kind === 'siegeMissile' || kind === 'agMissile' ? 1.55
        : kind === 'tankMissile' || kind === 'rocketLauncher' || kind === 'swarmRocket' ? 1.18
          : kind === 'grenade' || kind === 'clusterGrenade' || kind === 'aaMissile' ? 0.92
            : kind === 'sniperRifle' || kind === 'railShot' || kind === 'heavyCannon' ? 0.72
              : kind === 'cannon' || kind === 'scoutMissile' || kind === 'rocketPod' ? 0.58
                : 0.34;
  const armorResponse = target.armor?.kind === 'infantry' ? 1.35 : target.armor?.kind === 'air' ? 1.12 : target.armor?.kind === 'heavy' ? 0.68 : 1;
  return Math.max(0, Math.min(1, damageRatio * weaponEnergy * armorResponse * 4));
}

function directDamageForTarget(kind: WeaponKind, target: Entity): number {
  if (!target.armor) return 0;
  return damageForArmor(kind, target.armor.kind);
}

// Air targets use the weapon's dedicated airRange, but a unit may never auto-engage
// beyond its own vision (fog-honesty invariant). visionCap carries that limit; ground
// targets already had it folded into `range` by the caller.
function effectiveRangeForTarget(kind: WeaponKind, target: Entity, range: number, visionCap: number): number {
  const def = WEAPONS[kind];
  if (target.armor?.kind !== 'air') return range;
  return Math.min(def.airRange ?? range, visionCap);
}

function minimumRangeForWeapon(kind: WeaponKind): number {
  return WEAPONS[kind]?.minRange ?? 0;
}

function splashDamageForTarget(kind: WeaponKind, target: Entity, falloff: number): number {
  if (!target.armor) return 0;
  const def = WEAPONS[kind];
  if (target.armor.kind === 'air' && !def.canTargetAir) return 0;
  const multiplier = kind === 'bomb' || kind === 'tankBomb' || kind === 'agMissile' || kind === 'aaMissile' ? 1 : 0.55;
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
  trajectory?: 'arc' | 'drop' | 'flat',
): { damage: number; killed: boolean; hit?: HitSummary } {
  if (radius <= 0) return { damage: 0, killed: false };
  let damage = 0;
  let killed = false;
  let hit: HitSummary | undefined;
  for (const target of sim.world.entities) {
    if (target === primary || !targetableByTeam(sim, teamId, target) || !target.armor) continue;
    const dx = target.transform.x - x;
    const dz = target.transform.z - z;
    const d = Math.hypot(dx, dz);
    if (d > radius) continue;
    const falloff = 1 - d / radius;
    const dealt = applyDamage(sim, target, splashDamageForTarget(kind, target, falloff), {
      hitX: x,
      hitZ: z,
      hitY: trajectory ? structureHitY(target, attacker, trajectory) : structureHitY(target, attacker),
      fromX: attacker?.transform.x ?? x,
      fromZ: attacker?.transform.z ?? z,
      splashRadius: radius,
      trajectory: trajectory ?? (attacker?.flight ? 'flat' : 'flat'),
      weaponKind: kind,
    });
    if (dealt > 0) alertEconomyDefenders(sim, target, attacker);
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

function targetYForEvent(target: Entity | undefined, aimY?: number): number | undefined {
  if (target?.flight) return target.transform.y;
  return aimY;
}

function structureHitY(target: Entity, attacker?: Entity, trajectory?: 'arc' | 'drop' | 'flat'): number | undefined {
  if (!target.building) return target.transform.y;
  if (trajectory === 'arc' || trajectory === 'drop') return (target.transform.y ?? 0) + 3.0;
  return attacker?.flight ? (target.transform.y ?? 0) + 2.6 : (target.transform.y ?? 0) + 1.2;
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

function cooldownWeapons(entity: Entity): Weapon[] {
  const weapons = weaponSlots(entity);
  if (entity.specialWeapon) weapons.push(entity.specialWeapon);
  return weapons;
}

function weaponForSlot(entity: Entity, slot: 'primary' | 'secondary' | 'special'): Weapon | undefined {
  if (slot === 'special') return entity.specialWeapon;
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

function offsetSalvoImpact(x: number, z: number, aimYaw: number, count: number, index: number): { x: number; z: number } {
  if (count <= 1) return { x, z };
  const rightX = Math.cos(aimYaw);
  const rightZ = -Math.sin(aimYaw);
  const forwardX = Math.sin(aimYaw);
  const forwardZ = Math.cos(aimYaw);
  const center = (count - 1) / 2;
  const side = (index - center) * 3.4;
  const forward = (index % 2 === 0 ? -1 : 1) * Math.min(2.2, count * 0.45);
  return {
    x: x + rightX * side + forwardX * forward,
    z: z + rightZ * side + forwardZ * forward,
  };
}
