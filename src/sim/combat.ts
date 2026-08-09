import { WEAPONS, type ArmorClass, type WeaponKind } from '../content/phase4';
import { FORTRESS_TOWER, isFortressTower } from '../content/fortress';
import { angleDelta, slewAngle } from './angles';
import type { Entity, Weapon } from './components';
import {
  combatRankAccuracyMultiplier,
  combatRankCooldownMultiplier,
  combatRankDamageMultiplier,
  combatRankName,
  combatRankScatterMultiplier,
  creditCombatKill,
} from './combatRank';
import { hash2i, smoothstep } from './noise';
import { hasTerrainLineOfSight, sampleHeight } from './heightfield';
import { directionalImpactResponse } from './impactModel';
import { applyStructureDamage } from './structureDamage';
import { areTeamsHostile, attackStandoffPoint, entityById, issueMoveOrder, stopEntities, type GameSim } from './world';

/** Cannons may only fire once the turret has traversed onto the bearing. */
const AIM_TOLERANCE = 0.12;
const BOMB_SPEED = 95; // meters per second of flight, drives travel time
const DEFENSE_ALERT_RADIUS = 145;
const DEFENSE_ALERT_TTL = 9;
interface PlayerFireScales {
  speed: number;
  damage: number;
  force: number;
  impact: number;
}

/**
 * V-mode no longer turns every primary into the same hyper-fast rocket.
 * Each weapon keeps the timing and physical character of its platform.
 */
function playerPrimaryScales(kind: WeaponKind): PlayerFireScales {
  switch (kind) {
    case 'cannon':
      return { speed: 1.18, damage: 1, force: 1.42, impact: 1.28 };
    case 'heavyCannon':
      return { speed: 1, damage: 1, force: 1.62, impact: 1.55 };
    case 'rocketPod':
      return { speed: 1.18, damage: 1.08, force: 1.18, impact: 1.2 };
    case 'agMissile':
      return { speed: 1.12, damage: 1.1, force: 1.3, impact: 1.32 };
    case 'autocannon':
    case 'waspAutocannon':
      return { speed: 1, damage: 1.06, force: 1.08, impact: 1.08 };
    case 'grenade':
      return { speed: 1, damage: 1.08, force: 1.22, impact: 1.2 };
    default:
      return { speed: 1, damage: 1.08, force: 1.12, impact: 1.1 };
  }
}
/** Locked ordnance trades raw velocity and impact for guidance that can be evaded. */
const LOCKED_MISSILE_SPEED_SCALE = 0.68;
const LOCKED_MISSILE_DAMAGE_SCALE = 0.96;
const LOCKED_MISSILE_FORCE_SCALE = 0.72;
const LOCKED_MISSILE_IMPACT_SCALE = 0.9;
const LOCKED_MISSILE_LIFETIME = 6.5;
const LOCKED_MISSILE_AIR_TURN_RATE = 0.9;
const LOCKED_MISSILE_GROUND_TURN_RATE = 1.4;
const DEFENSE_TOWER_MIN_LEAD_SPEED = 0.55;
const DEFENSE_TOWER_MAX_GROUND_LEAD_SECONDS = 1.9;
const DEFENSE_TOWER_MAX_AIR_LEAD_SECONDS = 2.35;
const DEFENSE_TOWER_MAX_GROUND_LEAD_DISTANCE = 30;
const DEFENSE_TOWER_MAX_AIR_LEAD_DISTANCE = 48;

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
  // Movement rebuilds this grid with movers; combat needs all targetable
  // entities, including buildings. One linear rebuild replaces many O(n²)
  // battlefield scans below.
  sim.spatial.rebuild(sim.world.entities);
  stepProjectiles(sim, dt);
  tickWeaponCooldowns(sim, dt);
  stepEscortDrones(sim, dt, options.autoFire !== false);
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
    let engagementTarget: Entity | undefined;
    for (const weapon of weaponSlots(attacker)) {
      // Secondary fortress salvos are a deliberate V-mode advantage. Leaving
      // them on auto made unattended tower clusters disproportionately lethal.
      if (isFortressTower(attacker) && weapon === attacker.weapons?.secondary) continue;
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
      engagementTarget ??= target;
      const defenseAim = predictiveDefenseTowerAimPoint(sim, attacker, weapon, target);
      const bearing = Math.atan2(defenseAim.x - attacker.transform.x, defenseAim.z - attacker.transform.z);
      // direct-fire weapons wait for the turret; bombs are lobbed from the hull
      if (def.kind !== 'bomb' && attacker.turret) {
        turretGoalYaw ??= bearing;
        if (Math.abs(angleDelta(attacker.turret.yaw, bearing)) > AIM_TOLERANCE) continue;
      }
      if (weapon.cooldown > 0) continue;
      if (def.kind === 'bomb' || def.kind === 'tankBomb') {
        const aim = autoAimPoint(sim, attacker, weapon, target, defenseAim.x, defenseAim.z, 'bomb');
        launchBomb(sim, attacker, weapon, aim.x, aim.z, def.range);
      } else if (def.projectile) {
        launchWeaponProjectileAtEntity(sim, attacker, weapon, target, defenseAim.x, defenseAim.z);
      } else {
        fireHitscanAtEntity(sim, attacker, weapon, target);
      }
    }
    if (attacker.turret) {
      attacker.turret.yaw = slewAngle(attacker.turret.yaw, turretGoalYaw ?? attacker.transform.rot, attacker.turret.turnRate, dt);
    }
    updateGuardBehavior(sim, attacker, dt, engagementTarget);
  }
  tickDestroyed(sim, dt);
}

export interface PredictiveDefenseAimPoint {
  x: number;
  z: number;
  /** Seconds of target travel applied after the intentionally imperfect confidence factor. */
  leadSeconds: number;
}

/**
 * Static defense towers cannot chase a target, so unguided ordnance leads a
 * target that is already moving. The solution deliberately under-leads: a
 * steady convoy is threatened, while a pilot or driver can still dodge by
 * changing velocity after launch. Player-controlled tower fire remains fully
 * manual and homing AA missiles keep their own in-flight guidance.
 */
export function predictiveDefenseTowerAimPoint(
  sim: GameSim,
  attacker: Entity,
  weapon: Weapon,
  target: Entity,
): PredictiveDefenseAimPoint {
  const current = { x: target.transform.x, z: target.transform.z, leadSeconds: 0 };
  if (!isFortressTower(attacker) || attacker.playerControlled || !target.velocity) return current;

  const def = WEAPONS[weapon.kind as WeaponKind];
  if (!def) return current;
  // AA seekers continually steer toward their target. Pre-leading their launch
  // point would double-correct and make those missiles feel unfair.
  if (def.projectile?.trajectory === 'homing') return current;

  const velocityX = target.velocity.x;
  const velocityZ = target.velocity.z;
  const targetSpeed = Math.hypot(velocityX, velocityZ);
  if (targetSpeed < DEFENSE_TOWER_MIN_LEAD_SPEED) return current;

  const projectileSpeed = def.kind === 'bomb' || def.kind === 'tankBomb'
    ? BOMB_SPEED
    : def.projectile?.speed;
  if (!projectileSpeed || projectileSpeed <= targetSpeed * 0.35) return current;

  const relativeX = target.transform.x - attacker.transform.x;
  const relativeZ = target.transform.z - attacker.transform.z;
  const intercept = interceptTime2d(relativeX, relativeZ, velocityX, velocityZ, projectileSpeed);
  if (intercept <= 0 || !Number.isFinite(intercept)) return current;

  // Stable per tower/target/weapon variation prevents every battery from using
  // an identical perfect solution without introducing nondeterministic multiplayer state.
  const confidenceSeed = Math.round(def.range * 31 + projectileSpeed * 7);
  const confidence = 0.68 + hash2i(attacker.id, target.id, confidenceSeed) * 0.22;
  const maxSeconds = target.flight
    ? DEFENSE_TOWER_MAX_AIR_LEAD_SECONDS
    : DEFENSE_TOWER_MAX_GROUND_LEAD_SECONDS;
  let leadSeconds = Math.min(intercept, maxSeconds) * confidence;
  const maxDistance = target.flight
    ? DEFENSE_TOWER_MAX_AIR_LEAD_DISTANCE
    : DEFENSE_TOWER_MAX_GROUND_LEAD_DISTANCE;
  const requestedDistance = targetSpeed * leadSeconds;
  if (requestedDistance > maxDistance) leadSeconds *= maxDistance / requestedDistance;

  const mapLimit = sim.nav.size / 2 - 2;
  return {
    x: Math.max(-mapLimit, Math.min(mapLimit, target.transform.x + velocityX * leadSeconds)),
    z: Math.max(-mapLimit, Math.min(mapLimit, target.transform.z + velocityZ * leadSeconds)),
    leadSeconds,
  };
}

function interceptTime2d(
  relativeX: number,
  relativeZ: number,
  velocityX: number,
  velocityZ: number,
  projectileSpeed: number,
): number {
  const a = velocityX * velocityX + velocityZ * velocityZ - projectileSpeed * projectileSpeed;
  const b = 2 * (relativeX * velocityX + relativeZ * velocityZ);
  const c = relativeX * relativeX + relativeZ * relativeZ;
  if (c <= 0.0001) return 0;
  if (Math.abs(a) < 0.000001) return b < -0.000001 ? -c / b : 0;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return 0;
  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  if (first > 0 && second > 0) return Math.min(first, second);
  return Math.max(first, second, 0);
}

const ESCORT_DRONE_INFANTRY_DEFENSE_RANGE = 48;

export function escortDroneLocalPosition(angle: number): { x: number; y: number; z: number } {
  return {
    x: Math.cos(angle) * 3.25,
    y: 2.75 + Math.sin(angle * 2.15) * 0.28,
    z: Math.sin(angle) * 2.45,
  };
}

function stepEscortDrones(sim: GameSim, dt: number, canFire: boolean): void {
  const def = WEAPONS.microLaser;
  const weapon: Weapon = { kind: 'microLaser', range: def.range, cooldown: 0 };
  for (const owner of sim.world.entities) {
    if (!owner.unitUpgrades?.ids.includes('reactive-plating') || !owner.team || !owner.health || owner.destroyed) continue;
    const state = owner.unitUpgrades.escortDrone ??= {
      cooldown: 0,
      orbitAngle: (owner.id * 2.399963229728653) % (Math.PI * 2),
    };
    state.orbitAngle = (state.orbitAngle + dt * 1.55) % (Math.PI * 2);
    state.cooldown = Math.max(0, state.cooldown - dt);
    if (!canFire || state.cooldown > 0) continue;

    const target = nearbyInfantryThreat(sim, owner, weapon)
      ?? escortOwnerTarget(sim, owner, weapon, def.range);
    if (!target?.health || !target.armor) {
      state.targetId = undefined;
      continue;
    }

    const local = escortDroneLocalPosition(state.orbitAngle);
    const sin = Math.sin(owner.transform.rot);
    const cos = Math.cos(owner.transform.rot);
    const fromX = owner.transform.x + local.x * cos + local.z * sin;
    const fromZ = owner.transform.z - local.x * sin + local.z * cos;
    const damage = applyDamage(sim, target, directDamageForTarget('microLaser', target), undefined, owner);
    state.cooldown = def.cooldown;
    state.targetId = target.id;
    const hit = damage > 0 ? summarizeHit(target, damage) : undefined;
    sim.events.push({
      kind: 'microLaser',
      fromX,
      fromZ,
      toX: target.transform.x,
      toY: targetYForEvent(target),
      toZ: target.transform.z,
      sourceTeamId: owner.team.id,
      targetId: target.id,
      damage,
      killed: target.health.current <= 0,
      impactScale: 0.28,
      ...hit,
    });
  }
}

function nearbyInfantryThreat(sim: GameSim, owner: Entity, weapon: Weapon): Entity | undefined {
  let best: Entity | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  sim.spatial.visitNearby(owner.transform.x, owner.transform.z, ESCORT_DRONE_INFANTRY_DEFENSE_RANGE, (candidate) => {
    if (candidate.armor?.kind !== 'infantry' || !isWeaponTargetable(sim, owner, weapon, candidate)) return;
    const d = distance(owner, candidate);
    if (d > ESCORT_DRONE_INFANTRY_DEFENSE_RANGE) return;
    if (d < bestDistance || (d === bestDistance && candidate.id < (best?.id ?? Number.POSITIVE_INFINITY))) {
      best = candidate;
      bestDistance = d;
    }
  });
  return best;
}

function escortOwnerTarget(sim: GameSim, owner: Entity, weapon: Weapon, range: number): Entity | undefined {
  const targetIds = [
    ...weaponSlots(owner).map((slot) => slot.targetId),
    owner.mover?.attackTargetId,
  ];
  for (const targetId of targetIds) {
    if (targetId === undefined) continue;
    const target = entityById(sim, targetId);
    if (!target || !isWeaponTargetable(sim, owner, weapon, target) || distance(owner, target) > range) continue;
    return target;
  }
  return undefined;
}

function tickWeaponCooldowns(sim: GameSim, dt: number): void {
  for (const entity of sim.world.entities) {
    for (const weapon of cooldownWeapons(entity)) weapon.cooldown = Math.max(0, weapon.cooldown - dt);
  }
}

/** Idle units don't stand and take bombardment — they close on visible foes. */
function updateGuardBehavior(sim: GameSim, attacker: Entity, dt: number, engagementTarget?: Entity): void {
  if (!attacker.mover || attacker.mover.target || attacker.mover.attackTargetId !== undefined || !attacker.vision) return;
  const slots = weaponSlots(attacker);
  if (slots.length === 0) return;
  let weaponRange = 0;
  for (const weapon of slots) {
    const def = WEAPONS[weapon.kind as WeaponKind];
    if (def && def.kind !== 'bomb') weaponRange = Math.max(weaponRange, def.range);
  }
  if (weaponRange === 0) weaponRange = WEAPONS[slots[0].kind as WeaponKind]?.range ?? 42;
  // Reuse the target already found by the weapon pass. Previously every idle
  // combatant performed a second full acquisition scan on the same tick.
  const foe = engagementTarget ?? acquireTarget(sim, attacker, slots[0], attacker.vision.radius);
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
  lockedTargetId?: number,
): boolean {
  if (!attacker.team || attacker.destroyed) return false;
  const weapon = weaponForSlot(attacker, slot);
  if (!weapon) return false;
  const def = WEAPONS[weapon.kind as WeaponKind];
  if (!def || weapon.cooldown > 0) return false;
  const boostedPrimary = slot === 'primary' && !!attacker.playerControlled;
  const primaryScales = boostedPrimary
    ? playerPrimaryScales(def.kind)
    : { speed: 1, damage: 1, force: 1, impact: 1 };
  const speedScale = primaryScales.speed;
  const damageScale = primaryScales.damage;
  const forceScale = primaryScales.force;
  const impactScale = primaryScales.impact;
  const lockedTarget = validManualLockTarget(sim, attacker, weapon, lockedTargetId);
  if (lockedTarget) {
    targetX = lockedTarget.transform.x;
    targetZ = lockedTarget.transform.z;
    targetY = lockedTarget.transform.y;
  }

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
  const playerAircraftDirectFire = Boolean(attacker.playerControlled && attacker.flight);
  const range = isTankDirectMissile(def.kind) || playerAircraftDirectFire
    ? len
    : Math.min(weapon.range || def.range, len);
  if (def.minRange !== undefined && len < def.minRange) return false;
  const target = lockedTarget ?? acquireLineTarget(
    sim,
    attacker,
    weapon,
    ux,
    uz,
    range,
    aimRay,
    isTankDirectMissile(def.kind) && !!attacker.playerControlled,
    Boolean(attacker.playerControlled),
  );
  const hitX = target?.transform.x ?? attacker.transform.x + ux * range;
  const hitZ = target?.transform.z ?? attacker.transform.z + uz * range;
  if (def.projectile || lockedTarget) {
    // A terrain reticle can be far behind a unit caught by the ray. Once an
    // entity is acquired, use its own center height; otherwise ground vehicles
    // can inherit the distant terrain height and make the projectile dive into
    // the ground before reaching them.
    const clampedRayTargetY = targetY === undefined
      ? undefined
      : muzzleY + (targetY - muzzleY) * Math.min(1, range / len);
    const manualGroundArc = Boolean(
      attacker.playerControlled
      && !target
      && def.projectile?.trajectory === 'arc',
    );
    const projectileTargetY = target
      ? targetYForEvent(target)
      : manualGroundArc
        ? sampleHeight(sim.nav.heightfield, hitX, hitZ) + 0.4
        : clampedRayTargetY;
    launchWeaponProjectile(
      sim,
      attacker,
      weapon,
      target,
      hitX,
      projectileTargetY,
      hitZ,
      lockedTarget?.id === target?.id,
      speedScale,
      damageScale,
      forceScale,
      impactScale,
    );
    return true;
  }
  let damage = 0;
  let killed = false;
  let hit: HitSummary | undefined;
  if (target?.health && target.armor) {
    const direct = applyDamage(sim, target, directDamageForTarget(def.kind, target) * damageScale, {
      hitX,
      hitZ,
      hitY: structureHitY(target, attacker),
      fromX: attacker.transform.x,
      fromY: directMuzzleY(attacker),
      fromZ: attacker.transform.z,
      splashRadius: 0,
      trajectory: attacker.flight ? 'flat' : 'flat',
      weaponKind: def.kind,
      forceScale,
    }, attacker);
    if (direct > 0) alertEconomyDefenders(sim, target, attacker);
    damage = direct;
    hit = direct > 0 ? summarizeHit(target, direct) : undefined;
    const area = applyAreaDamage(sim, attacker.team.id, hitX, hitZ, def.splashRadius, def.kind, target, attacker, undefined, damageScale, forceScale);
    damage += area.damage;
    killed = target.health.current <= 0 || area.killed;
    weapon.targetId = target.id;
  } else {
    const area = applyAreaDamage(sim, attacker.team.id, hitX, hitZ, def.splashRadius, def.kind, undefined, attacker, undefined, damageScale, forceScale);
    damage = area.damage;
    killed = area.killed;
    hit = area.hit;
    weapon.targetId = undefined;
  }
  weapon.cooldown = weaponCooldown(def.cooldown, attacker);
  sim.events.push({
    kind: def.kind,
    weaponKind: def.kind,
    fromX: attacker.transform.x,
    fromY: directMuzzleY(attacker),
    fromZ: attacker.transform.z,
    toX: hitX,
    toY: target ? targetYForEvent(target) : targetY,
    toZ: hitZ,
    sourceTeamId: attacker.team.id,
    damage,
    killed,
    impactScale,
    ...hit,
  });
  return true;
}

/** Fire each armed unit's primary weapon at a player-designated world point. */
export function issueGroundAttack(sim: GameSim, attackers: Entity[], targetX: number, targetZ: number): boolean {
  let fired = false;
  for (const attacker of attackers) {
    if (!attacker.weapons || !attacker.team || attacker.destroyed) continue;
    const aimYaw = Math.atan2(targetX - attacker.transform.x, targetZ - attacker.transform.z);
    if (attacker.turret) attacker.turret.yaw = aimYaw;
    fired = manualFireAt(sim, attacker, targetX, targetZ, 'primary') || fired;
  }
  return fired;
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
  const manuallyAimed = Boolean(attacker.playerControlled);
  const baseImpact = manuallyAimed ? { x: targetX, z: targetZ } : scatterBombImpact(sim, attacker, targetX, targetZ, range, maxRange);
  const aimYaw = Math.atan2(targetX - attacker.transform.x, targetZ - attacker.transform.z);
  const impactLimit = sim.nav.size / 2 - 2;
  for (let i = 0; i < salvoCount; i++) {
    const salvoImpact = manuallyAimed ? baseImpact : offsetSalvoImpact(baseImpact.x, baseImpact.z, aimYaw, salvoCount, i);
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
      fromY: absoluteBombMuzzleY(sim, attacker),
      fromZ: attacker.transform.z,
      toX: impact.x,
      toY: sampleHeight(sim.nav.heightfield, impact.x, impact.z) + 0.35,
      toZ: impact.z,
      elapsed: 0,
      duration,
      trajectory: attacker.flight ? 'drop' : 'arc',
      teamId: attacker.team.id,
      attackerId: attacker.id,
    });
    sim.events.push({
      kind: projectileKind,
      weaponKind,
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

function launchWeaponProjectileAtEntity(
  sim: GameSim,
  attacker: Entity,
  weapon: Weapon,
  target: Entity,
  intendedX = target.transform.x,
  intendedZ = target.transform.z,
): void {
  const aim = autoAimPoint(sim, attacker, weapon, target, intendedX, intendedZ, 'projectile');
  // Ground entities store terrain height in transform.y. Passing that raw
  // value as an explicit aim height made shells dive into the soil beneath a
  // tank or building. Let the projectile resolver add the correct hull/facade
  // height whenever the accuracy model retained a direct target.
  launchWeaponProjectile(sim, attacker, weapon, aim.directTarget, aim.x, targetYForEvent(aim.directTarget), aim.z);
}

function launchWeaponProjectile(
  sim: GameSim,
  attacker: Entity,
  weapon: Weapon,
  target: Entity | undefined,
  targetX: number,
  targetY: number | undefined,
  targetZ: number,
  forceHoming = false,
  speedScale = 1,
  damageScale = 1,
  forceScale = 1,
  impactScale = 1,
): void {
  if (!attacker.team) return;
  const def = WEAPONS[weapon.kind as WeaponKind];
  if (!def) return;
  const projectileDef = def.projectile ?? (forceHoming && isManualTargetLockWeapon(def.kind)
    ? { kind: 'atRocket' as const, speed: 96, trajectory: 'flat' as const, impactRadius: 2.2 }
    : undefined);
  if (!projectileDef) return;
  const fromY = absoluteDirectMuzzleY(sim, attacker);
  const resolvedTargetY = absoluteProjectileTargetY(sim, target, targetX, targetZ, targetY);
  const dx = targetX - attacker.transform.x;
  const dz = targetZ - attacker.transform.z;
  const distanceToAim = Math.max(0.001, Math.hypot(dx, dz));
  // In V-mode a target crossing the raw aim ray is not the same as a completed
  // lock. Unlocked shots retain full speed and fly straight; AI fire and an
  // explicit player lock use the guided flight model.
  const isLocked = target?.id !== undefined && (
    forceHoming || (!attacker.playerControlled && projectileDef.trajectory === 'homing')
  );
  const speed = projectileDef.speed * (isLocked ? LOCKED_MISSILE_SPEED_SCALE : speedScale);
  const aimDy = resolvedTargetY - fromY;
  const aimDistance = Math.max(0.001, Math.hypot(dx, aimDy, dz));
  const duration = isLocked
    ? LOCKED_MISSILE_LIFETIME
    : Math.min(3.2, Math.max(0.045, distanceToAim / speed));
  const homing =
    isLocked && target
      ? {
          targetId: target.id,
          speed,
          fizzleRange: forceHoming
            ? Math.max(projectileDef.fizzleRange ?? 0, sim.nav.size * Math.SQRT2 + 64)
            : projectileDef.fizzleRange ?? def.range * 1.15,
          remainingLifetime: LOCKED_MISSILE_LIFETIME,
          traveledDistance: 0,
          directionX: dx / aimDistance,
          directionY: aimDy / aimDistance,
          directionZ: dz / aimDistance,
          turnRate: target.flight ? LOCKED_MISSILE_AIR_TURN_RATE : LOCKED_MISSILE_GROUND_TURN_RATE,
        }
      : undefined;
  const trajectory = homing ? 'homing' : projectileDef.trajectory === 'homing' ? 'flat' : projectileDef.trajectory;
  sim.projectiles.push({
    kind: projectileDef.kind,
    weaponKind: def.kind,
    fromX: attacker.transform.x,
    fromY,
    fromZ: attacker.transform.z,
    x: attacker.transform.x,
    y: fromY,
    z: attacker.transform.z,
    toX: targetX,
    toY: resolvedTargetY,
    toZ: targetZ,
    elapsed: 0,
    duration,
    speed,
    damageScale: isLocked ? Math.min(1, damageScale) * LOCKED_MISSILE_DAMAGE_SCALE : damageScale,
    forceScale: isLocked ? Math.min(1, forceScale) * LOCKED_MISSILE_FORCE_SCALE : forceScale,
    impactScale: isLocked ? Math.min(1, impactScale) * LOCKED_MISSILE_IMPACT_SCALE : impactScale,
    manualAim: Boolean(attacker.playerControlled),
    maxDistance: projectileDef.fizzleRange ?? (isTankDirectMissile(def.kind) ? distanceToAim : def.range),
    directTargetId: target?.id,
    trajectory,
    homing,
    teamId: attacker.team.id,
    attackerId: attacker.id,
  });
  weapon.cooldown = weaponCooldown(def.cooldown, attacker);
  sim.events.push({
    kind: projectileDef.kind,
    weaponKind: def.kind,
    fromX: attacker.transform.x,
    fromY,
    fromZ: attacker.transform.z,
    toX: targetX,
    toY: resolvedTargetY,
    toZ: targetZ,
    targetId: target?.id,
    targetLabel: target?.name ?? target?.building?.label ?? target?.selectable?.type,
    sourceTeamId: attacker.team.id,
    damage: 0,
    killed: false,
    duration,
    impactScale: isLocked ? Math.min(1, impactScale) * LOCKED_MISSILE_IMPACT_SCALE : impactScale,
    trajectory,
    homingSpeed: homing?.speed,
    homingTurnRate: homing?.turnRate,
  });
}

function validManualLockTarget(sim: GameSim, attacker: Entity, weapon: Weapon, targetId: number | undefined): Entity | undefined {
  if (targetId === undefined || !attacker.playerControlled || !isManualTargetLockWeapon(weapon.kind) || !attacker.team) return undefined;
  const target = entityById(sim, targetId);
  if (!target || (!isFortressTower(attacker) && !target.flight && target.selectable?.type !== 'tank')) return undefined;
  if (!canManualWeaponLockTarget(weapon.kind, target)) return undefined;
  if (!targetableByTeam(sim, attacker.team.id, target)) return undefined;
  return target;
}

export function isManualTargetLockWeapon(kind: string | undefined): boolean {
  return kind === 'scoutMissile'
    || kind === 'tankMissile'
    || kind === 'siegeMissile'
    || kind === 'rocketLauncher'
    || kind === 'agMissile'
    || kind === 'aaMissile';
}

export function canManualWeaponLockTarget(kind: string | undefined, target: Entity): boolean {
  if (!kind || !isManualTargetLockWeapon(kind) || !target.armor) return false;
  const def = WEAPONS[kind as WeaponKind];
  // Manual locks may use a weapon's reduced off-role damage (for example an
  // M-17 missile against aircraft), but never promise a lock for a zero-damage
  // pairing such as an anti-air seeker against a ground structure.
  return Boolean(def && def.vs[target.armor.kind] > 0);
}

function isTankDirectMissile(kind: WeaponKind): boolean {
  return kind === 'scoutMissile' || kind === 'tankMissile' || kind === 'siegeMissile';
}

function bombMuzzleY(attacker: Entity): number | undefined {
  if (attacker.transform.y === undefined) return undefined;
  if (isFortressTower(attacker)) return attacker.transform.y + FORTRESS_TOWER.muzzleHeight;
  return attacker.flight ? attacker.transform.y - 0.45 : attacker.transform.y + 3.1;
}

function directMuzzleY(attacker: Entity): number | undefined {
  if (attacker.transform.y === undefined) return undefined;
  if (isFortressTower(attacker)) return attacker.transform.y + FORTRESS_TOWER.muzzleHeight;
  if (attacker.flight) return attacker.transform.y - 0.15;
  if (attacker.weapon?.kind === 'sniperRifle' || attacker.weapons?.primary.kind === 'sniperRifle') return attacker.transform.y + 1.72;
  return attacker.transform.y + (attacker.selectable?.type === 'infantry' ? 1.35 : 2.2);
}

function absoluteDirectMuzzleY(sim: GameSim, attacker: Entity): number {
  return directMuzzleY(attacker)
    ?? sampleHeight(sim.nav.heightfield, attacker.transform.x, attacker.transform.z)
      + (attacker.selectable?.type === 'infantry' ? 1.35 : 2.2);
}

function absoluteBombMuzzleY(sim: GameSim, attacker: Entity): number {
  return bombMuzzleY(attacker)
    ?? sampleHeight(sim.nav.heightfield, attacker.transform.x, attacker.transform.z) + 3.1;
}

function absoluteProjectileTargetY(sim: GameSim, target: Entity | undefined, x: number, z: number, aimY?: number): number {
  if (aimY !== undefined) return aimY;
  const ground = sampleHeight(sim.nav.heightfield, x, z);
  if (!target) return ground + 0.7;
  if (target.flight) return target.transform.y ?? ground + 8;
  return ground + (target.building ? 2.8 : target.selectable?.type === 'infantry' ? 1.15 : 1.7);
}

function stepProjectiles(sim: GameSim, dt: number): void {
  for (let i = sim.projectiles.length - 1; i >= 0; i--) {
    const projectile = sim.projectiles[i];
    projectile.elapsed += dt;
    if (projectile.homing) {
      projectile.homing.remainingLifetime -= dt;
      if (projectile.homing.remainingLifetime <= 0) {
        sim.projectiles.splice(i, 1);
        continue;
      }
      const target = entityById(sim, projectile.homing.targetId);
      if (!target || !target.health || target.health.current <= 0 || target.destroyed) {
        sim.projectiles.splice(i, 1);
        continue;
      }
      const px = projectile.x ?? projectile.fromX;
      const py = projectile.y ?? projectile.fromY
        ?? sampleHeight(sim.nav.heightfield, projectile.fromX, projectile.fromZ) + 2;
      const pz = projectile.z ?? projectile.fromZ;
      // Ground transforms contain terrain elevation, not the center of the
      // vehicle hull. Resolve the live target center from its entity type.
      const ty = absoluteProjectileTargetY(sim, target, target.transform.x, target.transform.z);
      const vx = target.transform.x - px;
      const vy = ty - py;
      const vz = target.transform.z - pz;
      const d = Math.max(0.001, Math.hypot(vx, vy, vz));
      const desiredX = vx / d;
      const desiredY = vy / d;
      const desiredZ = vz / d;
      const maxDirectionDelta = projectile.homing.turnRate * dt;
      const deltaX = desiredX - projectile.homing.directionX;
      const deltaY = desiredY - projectile.homing.directionY;
      const deltaZ = desiredZ - projectile.homing.directionZ;
      const directionDelta = Math.hypot(deltaX, deltaY, deltaZ);
      const blend = directionDelta > maxDirectionDelta ? maxDirectionDelta / directionDelta : 1;
      const steeredX = projectile.homing.directionX + deltaX * blend;
      const steeredY = projectile.homing.directionY + deltaY * blend;
      const steeredZ = projectile.homing.directionZ + deltaZ * blend;
      const steeredLength = Math.max(0.001, Math.hypot(steeredX, steeredY, steeredZ));
      projectile.homing.directionX = steeredX / steeredLength;
      projectile.homing.directionY = steeredY / steeredLength;
      projectile.homing.directionZ = steeredZ / steeredLength;
      const step = projectile.homing.speed * dt;
      projectile.homing.traveledDistance += step;
      projectile.x = px + projectile.homing.directionX * step;
      projectile.y = py + projectile.homing.directionY * step;
      projectile.z = pz + projectile.homing.directionZ * step;
      const weaponKind = (projectile.weaponKind ?? projectile.kind) as WeaponKind;
      const impactRadius = WEAPONS[weaponKind]?.projectile?.impactRadius ?? 2.5;
      const targetRadius = target.collider?.radius ?? target.selectable?.radius ?? 1.4;
      const segmentX = projectile.x - px;
      const segmentY = (projectile.y ?? py) - py;
      const segmentZ = projectile.z - pz;
      const segmentLengthSq = Math.max(0.0001, segmentX * segmentX + segmentY * segmentY + segmentZ * segmentZ);
      const closestT = Math.max(0, Math.min(1, (
        (target.transform.x - px) * segmentX
        + (ty - py) * segmentY
        + (target.transform.z - pz) * segmentZ
      ) / segmentLengthSq));
      const closestX = px + segmentX * closestT;
      const closestY = py + segmentY * closestT;
      const closestZ = pz + segmentZ * closestT;
      const targetDistance = Math.hypot(
        target.transform.x - closestX,
        ty - closestY,
        target.transform.z - closestZ,
      );
      // Continuous collision prevents a fast missile from tunnelling through
      // a large aircraft or tank between two fixed simulation ticks.
      if (targetDistance <= targetRadius + impactRadius) {
        impactProjectile(sim, projectile, target.transform.x, ty, target.transform.z, target);
        sim.projectiles.splice(i, 1);
        continue;
      }
      // A locked air-to-air missile must stay in pursuit until it hits, is
      // evaded, or exhausts its range. Treating its flight path like a ground
      // shot allowed terrain beneath a low aircraft to detonate the missile
      // before it reached the target. Keep it visibly above the surface while
      // preserving terrain collision for missiles locked to ground targets.
      const terrainY = sampleHeight(sim.nav.heightfield, projectile.x, projectile.z);
      if (target.flight && (projectile.y ?? py) <= terrainY + 0.35) {
        projectile.y = terrainY + 0.65;
        projectile.homing.directionY = Math.max(0.04, projectile.homing.directionY);
        const correctedLength = Math.max(0.001, Math.hypot(
          projectile.homing.directionX,
          projectile.homing.directionY,
          projectile.homing.directionZ,
        ));
        projectile.homing.directionX /= correctedLength;
        projectile.homing.directionY /= correctedLength;
        projectile.homing.directionZ /= correctedLength;
      } else if (!target.flight && (projectile.y ?? py) <= terrainY + 0.35) {
        impactProjectile(sim, projectile, projectile.x, projectile.y, projectile.z);
        sim.projectiles.splice(i, 1);
        continue;
      }
      if (projectile.homing.traveledDistance > projectile.homing.fizzleRange) {
        sim.projectiles.splice(i, 1);
        continue;
      }
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
    // Indirect rounds must first clear the launcher and crest the arc. Testing
    // terrain during ascent made high-angle shells detonate near their apex on
    // noisy terrain samples, visibly before they began the attack descent.
    // A V-mode shot is already resolved against the reticle or a real entity.
    // Let it reach that terminal point; late terrain sampling used to pull
    // otherwise accurate shots into the ground just before their target.
    const mayStrikeTerrain = projectile.manualAim
      ? false
      : projectile.trajectory === 'arc'
        ? t >= 0.58
        : true;
    if (mayStrikeTerrain && t > 0.04 && t < 1 && (projectile.y ?? 0) <= sampleHeight(sim.nav.heightfield, projectile.x, projectile.z) + 0.35) {
      impactProjectile(sim, projectile, projectile.x, projectile.y, projectile.z);
      sim.projectiles.splice(i, 1);
      continue;
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
      directDamage = applyDamage(sim, directTarget, directDamageForTarget(weaponKind, directTarget) * (projectile.damageScale ?? 1), {
        hitX: x,
        hitZ: z,
        hitY: structureHitY(directTarget, attacker, impactTrajectory),
        fromX: projectile.fromX,
        fromY: projectile.fromY,
        fromZ: projectile.fromZ,
        splashRadius: 0,
        trajectory: impactTrajectory,
        weaponKind,
        forceScale: projectile.forceScale,
      }, attacker);
      if (directDamage > 0) {
        alertEconomyDefenders(sim, directTarget, attacker);
        hit = summarizeHit(directTarget, directDamage);
      }
    }
  }
  const area = applyAreaDamage(
    sim,
    projectile.teamId,
    x,
    z,
    def.splashRadius,
    weaponKind,
    directTarget,
    attacker,
    impactTrajectory,
    projectile.damageScale,
    projectile.forceScale,
  );
  if (!hit) hit = area.hit;
  sim.events.push({
    kind: `${projectile.kind}-impact`,
    weaponKind: weaponKind as WeaponKind,
    fromX: x,
    fromY: y,
    fromZ: z,
    toX: x,
    toY: y,
    toZ: z,
    sourceTeamId: projectile.teamId,
    damage: directDamage + area.damage,
    killed: directTarget?.health?.current === 0 || area.killed,
    impactScale: projectile.impactScale,
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
      fromY: directMuzzleY(attacker),
      fromZ: attacker.transform.z,
      splashRadius: 0,
      trajectory: attacker.flight ? 'flat' : 'flat',
      weaponKind: def.kind,
    }, attacker);
    if (directDamage > 0) alertEconomyDefenders(sim, target, attacker);
    hit = directDamage > 0 ? summarizeHit(target, directDamage) : undefined;
  }
  const area = applyAreaDamage(sim, attacker.team.id, aim.x, aim.z, def.splashRadius, def.kind, aim.directTarget, attacker);
  weapon.cooldown = weaponCooldown(def.cooldown, attacker);
  sim.events.push({
    kind: def.kind,
    weaponKind: def.kind,
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
  return baseCooldown * (attacker.aiCombat?.cooldownMultiplier ?? 1) * combatRankCooldownMultiplier(attacker);
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
  const accuracy = Math.min(1, ai.accuracy * combatRankAccuracyMultiplier(attacker));
  const hitsCleanly = hitRoll <= accuracy;
  if (hitsCleanly && mode === 'direct') return { x: targetX, z: targetZ, directTarget: target };

  const scatterBase = ai.projectileScatter * combatRankScatterMultiplier(attacker) * (mode === 'bomb' ? 1.15 : mode === 'projectile' ? 0.82 : 0.62);
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
  return d <= effectiveRangeForTarget(weapon.kind as WeaponKind, target, range, visionCap) &&
    d >= minimumRangeForWeapon(weapon.kind as WeaponKind) &&
    hasWeaponTerrainLineOfSight(sim, attacker, weapon, target)
    ? target
    : undefined;
}

function acquireTarget(sim: GameSim, attacker: Entity, weapon: Weapon, range: number): Entity | undefined {
  let best: Entity | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  const visionCap = attacker.vision?.radius ?? range;
  const searchRadius = Math.max(range, visionCap);
  sim.spatial.visitNearby(attacker.transform.x, attacker.transform.z, searchRadius, (candidate) => {
    if (!isWeaponTargetable(sim, attacker, weapon, candidate)) return;
    const d = distance(attacker, candidate);
    if (d > effectiveRangeForTarget(weapon.kind as WeaponKind, candidate, range, visionCap)) return;
    if (d < minimumRangeForWeapon(weapon.kind as WeaponKind)) return;
    if (!hasWeaponTerrainLineOfSight(sim, attacker, weapon, candidate)) return;
    // the player's possessed unit reads as high-value — AI applies pressure to it
    const score = candidate.playerControlled ? d * (attacker.aiCombat?.possessedTargetPriority ?? 0.55) : d;
    if (score < bestScore || (score === bestScore && candidate.id < (best?.id ?? Number.POSITIVE_INFINITY))) {
      bestScore = score;
      best = candidate;
    }
  });
  return best;
}

function hasWeaponTerrainLineOfSight(sim: GameSim, attacker: Entity, weapon: Weapon, target: Entity): boolean {
  const def = WEAPONS[weapon.kind as WeaponKind];
  const trajectory = def?.projectile?.trajectory;
  if (def?.kind === 'bomb' || def?.kind === 'tankBomb' || trajectory === 'arc' || trajectory === 'drop') return true;
  const terrain = sim.nav.heightfield;
  const fromY = directMuzzleY(attacker) ?? sampleHeight(terrain, attacker.transform.x, attacker.transform.z) + 1.6;
  const targetBaseY = target.transform.y ?? sampleHeight(terrain, target.transform.x, target.transform.z);
  const targetY = target.flight
    ? targetBaseY
    : targetBaseY + (target.building ? 2.8 : target.selectable?.type === 'infantry' ? 1.15 : 1.7);
  return hasTerrainLineOfSight(
    terrain,
    attacker.transform.x,
    fromY,
    attacker.transform.z,
    target.transform.x,
    targetY,
    target.transform.z,
  );
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
  allowManualTankAir = false,
  strictManualAim = false,
): Entity | undefined {
  let best: Entity | undefined;
  let bestAlong = Number.POSITIVE_INFINITY;
  const visionCap = attacker.vision?.radius ?? range;
  for (const candidate of sim.world.entities) {
    const manualTankAirTarget =
      allowManualTankAir &&
      candidate.armor?.kind === 'air' &&
      attacker.team !== undefined &&
      targetableByTeam(sim, attacker.team.id, candidate);
    if (!manualTankAirTarget && !isWeaponTargetable(sim, attacker, weapon, candidate)) continue;
    const dx = candidate.transform.x - attacker.transform.x;
    const dz = candidate.transform.z - attacker.transform.z;
    const horizontalAlong = dx * ux + dz * uz;
    const targetRange = effectiveRangeForTarget(weapon.kind as WeaponKind, candidate, range, visionCap);
    if (horizontalAlong < 0 || horizontalAlong > targetRange) continue;
    if (horizontalAlong < minimumRangeForWeapon(weapon.kind as WeaponKind)) continue;
    const radius = candidate.collider?.radius ?? candidate.selectable?.radius ?? 2.4;
    let along = horizontalAlong;
    let perp = Math.abs(dx * uz - dz * ux);
    let tolerance = strictManualAim ? radius * 0.82 : radius + 2.2;
    if (aimRay) {
      const baseY = candidate.transform.y;
      const centerOffset = candidate.flight ? 0 : candidate.building ? 2.4 : candidate.selectable?.type === 'infantry' ? 1 : 1.4;
      const candidateY = baseY === undefined ? aimRay.fromY : baseY + centerOffset;
      const dy = candidateY - aimRay.fromY;
      along = dx * aimRay.x + dy * aimRay.y + dz * aimRay.z;
      if (along < 0) continue;
      perp = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - along * along));
      tolerance = strictManualAim ? radius * (candidate.flight ? 0.9 : 0.82) : radius + (candidate.flight ? 1.35 : 0.8);
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
  const damagedTeamId = damaged.team.id;
  sim.spatial.visitNearby(damaged.transform.x, damaged.transform.z, DEFENSE_ALERT_RADIUS, (defender) => {
    if (defender.team?.id !== damagedTeamId || defender.destroyed || defender.playerControlled) return;
    if (!defender.mover || !defender.health || defender.building) return;
    const slots = weaponSlots(defender);
    if (slots.length === 0 || !slots.some((weapon) => isWeaponTargetable(sim, defender, weapon, attacker))) return;
    const dx = defender.transform.x - damaged.transform.x;
    const dz = defender.transform.z - damaged.transform.z;
    if (Math.hypot(dx, dz) > DEFENSE_ALERT_RADIUS) return;
    defender.mover.defenseAlert = { targetId: attacker.id, x: attacker.transform.x, z: attacker.transform.z, ttl: DEFENSE_ALERT_TTL };
    if (!defender.mover.target) defender.mover.engage = { x: attacker.transform.x, z: attacker.transform.z };
    for (const weapon of slots) weapon.targetId = attacker.id;
  });
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
  fromY?: number;
  fromZ: number;
  splashRadius: number;
  trajectory?: 'arc' | 'drop' | 'flat' | 'homing';
  weaponKind: WeaponKind;
  forceScale?: number;
}

function applyDamage(sim: GameSim, target: Entity, amount: number, impact?: DamageImpact, source?: Entity): number {
  if (!target.health || amount <= 0) return 0;
  const scaled = amount * (source ? combatRankDamageMultiplier(source) : 1);
  const before = target.health.current;
  target.health.current = Math.max(0, target.health.current - scaled);
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
      trajectory: impact.trajectory === 'homing' ? 'flat' : impact.trajectory,
    });
  }
  if (target.health.current <= 0 && !target.destroyed) {
    target.destroyed = { remaining: 20 };
    target.selectable && (target.selectable.selected = false);
    stopEntities([target]);
    if (target.building) sim.nav.removeDynamicBlocker(target.id);
    if (source) {
      const promoted = creditCombatKill(source, target);
      if (promoted !== undefined) {
        sim.events.push({
          kind: 'rank-up',
          fromX: source.transform.x,
          fromY: source.transform.y,
          fromZ: source.transform.z,
          toX: source.transform.x,
          toY: source.transform.y,
          toZ: source.transform.z,
          sourceTeamId: source.team?.id,
          targetId: source.id,
          targetLabel: combatRankName(promoted),
          targetType: source.selectable?.type,
          damage: 0,
          killed: false,
        });
      }
    }
  }
  return dealt;
}

function applyImpactPhysics(sim: GameSim, target: Entity, dealt: number, impact: DamageImpact): void {
  if (!target.health || !target.velocity || !target.mover) return;
  const force = Math.min(1, normalizedImpactForce(target, dealt, impact.weaponKind) * (impact.forceScale ?? 1));
  if (force <= 0.012) return;
  const response = directionalImpactResponse({
    targetX: target.transform.x,
    targetY: target.transform.y,
    targetZ: target.transform.z,
    targetRot: target.transform.rot,
    targetRadius: target.collider?.radius ?? target.mover.radius,
    armor: target.armor?.kind ?? 'light',
    force,
    fromX: impact.fromX,
    fromY: impact.fromY,
    fromZ: impact.fromZ,
    hitX: impact.hitX,
    hitY: impact.hitY,
    hitZ: impact.hitZ,
    splashRadius: impact.splashRadius,
    trajectory: impact.trajectory,
  });
  if (!target.flight) {
    const existing = target.impactMomentum;
    const carry = existing ? 0.62 : 0;
    const physicalScale = target.playerControlled ? 1 : 0.12;
    const stagger = target.armor?.kind === 'infantry' && force > 0.18
      ? Math.min(1.28, 0.34 + force * 0.9)
      : 0;
    // Preserve a small velocity kick for existing movement/combat consumers;
    // the momentum layer below carries the readable, slower recoil.
    target.velocity.x += response.directionX * response.impulseSpeed * 0.18;
    target.velocity.z += response.directionZ * response.impulseSpeed * 0.18;
    target.impactMomentum = {
      x: Math.max(-8, Math.min(8, response.directionX * response.impulseSpeed * physicalScale + (existing?.x ?? 0) * carry)),
      z: Math.max(-8, Math.min(8, response.directionZ * response.impulseSpeed * physicalScale + (existing?.z ?? 0) * carry)),
      yaw: Math.max(-1.25, Math.min(1.25, response.angularImpulse * 0.56 * physicalScale + (existing?.yaw ?? 0) * carry)),
      ttl: Math.max(existing?.ttl ?? 0, 0.72 + force * 0.48, stagger),
      stagger: Math.max(existing?.stagger ?? 0, stagger),
    };
  }
  if (target.flight) {
    target.velocity.x += response.directionX * response.impulseSpeed;
    target.velocity.z += response.directionZ * response.impulseSpeed;
    target.flight.verticalVelocity += response.verticalImpulse * 1.5;
    target.flight.rollAttitude += response.angularImpulse * 0.42;
    target.flight.pitchAttitude -= response.localForward * force * 0.18;
  }
  sim.events.push({
    kind: 'impact-reaction',
    impactKind: impact.weaponKind,
    force,
    fromX: impact.fromX,
    fromY: impact.fromY,
    fromZ: impact.fromZ,
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
    impactZone: response.zone,
    impulseX: response.directionX * response.impulseSpeed,
    impulseZ: response.directionZ * response.impulseSpeed,
    verticalImpulse: response.verticalImpulse,
    angularImpulse: response.angularImpulse,
    topFactor: response.topFactor,
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
  damageScale = 1,
  forceScale = 1,
): { damage: number; killed: boolean; hit?: HitSummary } {
  if (radius <= 0) return { damage: 0, killed: false };
  let damage = 0;
  let killed = false;
  let hit: HitSummary | undefined;
  sim.spatial.visitNearby(x, z, radius, (target) => {
    if (target === primary || !targetableByTeam(sim, teamId, target) || !target.armor) return;
    const dx = target.transform.x - x;
    const dz = target.transform.z - z;
    const d = Math.hypot(dx, dz);
    if (d > radius) return;
    const falloff = 1 - d / radius;
    const dealt = applyDamage(sim, target, splashDamageForTarget(kind, target, falloff) * damageScale, {
      hitX: x,
      hitZ: z,
      hitY: trajectory ? structureHitY(target, attacker, trajectory) : structureHitY(target, attacker),
      fromX: attacker?.transform.x ?? x,
      fromY: attacker ? directMuzzleY(attacker) : undefined,
      fromZ: attacker?.transform.z ?? z,
      splashRadius: radius,
      trajectory: trajectory ?? (attacker?.flight ? 'flat' : 'flat'),
      weaponKind: kind,
      forceScale,
    }, attacker);
    if (dealt > 0) alertEconomyDefenders(sim, target, attacker);
    damage += dealt;
    if (dealt > 0 && (!hit || dealt > hit.damage)) hit = summarizeHit(target, dealt);
    killed ||= target.health?.current === 0;
  });
  return { damage, killed, hit };
}

function summarizeHit(target: Entity, damage: number): HitSummary | undefined {
  if (!target.health) return undefined;
  return {
    targetId: target.id,
    targetLabel: target.name ?? target.building?.label ?? target.selectable?.type ?? 'target',
    targetType: target.flight ? 'aircraft' : target.building ? 'building' : target.selectable?.type ?? 'unit',
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
