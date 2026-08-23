import type { Entity, InboundMissile, InboundProfile } from './components';
import { copyTransform } from './components';
import { hash2i } from './noise';
import { sampleHeight, type Heightfield } from './heightfield';
import { areTeamsHostile, type GameSim } from './world';

/** Impact must land this close to a friendly building before a battery spends an interceptor. */
export const INBOUND_PROTECT_RADIUS = 110;

export const INBOUND_PROFILES: Record<InboundProfile, {
  health: number;
  flightTime: number;
  peakAltitude: number;
  warheadDamage: number;
  splashRadius: number;
  cep: number;
  radius: number;
  name: string;
}> = {
  ballistic: {
    health: 50,
    flightTime: 7.2,
    peakAltitude: 92,
    warheadDamage: 168,
    splashRadius: 12,
    cep: 22,
    radius: 2.2,
    name: 'Ashfall Missile',
  },
  drone: {
    health: 34,
    flightTime: 14,
    peakAltitude: 16,
    warheadDamage: 38,
    splashRadius: 4.6,
    cep: 10,
    radius: 1.35,
    name: 'Ember Drone',
  },
};

export function isInboundMissile(entity: Entity | undefined): entity is Entity & { inboundMissile: InboundMissile } {
  return Boolean(entity?.inboundMissile);
}

export function isDroneThreat(entity: Entity | undefined): boolean {
  return entity?.inboundMissile?.profile === 'drone' || entity?.flight?.model === 'drone';
}

export function isBallisticInbound(entity: Entity | undefined): boolean {
  return entity?.inboundMissile?.profile === 'ballistic';
}

/** True when this inbound will detonate on or next to the team's buildings. */
export function inboundThreatensTeam(sim: GameSim, inbound: Entity, teamId: number): boolean {
  const missile = inbound.inboundMissile;
  if (!missile) return false;
  for (const entity of sim.world.entities) {
    if (entity.destroyed || entity.team?.id !== teamId || !entity.building) continue;
    if (Math.hypot(missile.toX - entity.transform.x, missile.toZ - entity.transform.z) <= INBOUND_PROTECT_RADIUS) {
      return true;
    }
  }
  return false;
}

export function skyguardInterceptRange(sim: GameSim): number {
  return sim.nav.size * Math.SQRT2 + 96;
}

export function launchStrategicMissile(
  sim: GameSim,
  hf: Heightfield,
  options: {
    teamId: number;
    fromX: number;
    fromZ: number;
    toX: number;
    toZ: number;
    profile?: InboundProfile;
    sizeScale?: number;
    launcherId?: number;
  },
): Entity {
  const profile = options.profile ?? 'ballistic';
  const spec = INBOUND_PROFILES[profile];
  const sizeScale = Math.max(0.6, options.sizeScale ?? 1);
  const salt = (options.launcherId ?? options.teamId) * 17 + sim.tick;
  const angle = hash2i(Math.round(options.toX * 10), Math.round(options.toZ * 10), salt) * Math.PI * 2;
  const spread = hash2i(salt, Math.round(options.fromX * 10), 0x51ed) * spec.cep;
  const impactX = options.toX + Math.cos(angle) * spread;
  const impactZ = options.toZ + Math.sin(angle) * spread;
  const launchY = sampleHeight(hf, options.fromX, options.fromZ) + (profile === 'drone' ? 6 : 3.4);
  const impactY = sampleHeight(hf, impactX, impactZ) + 0.4;
  const health = Math.round(spec.health * sizeScale);
  const inbound: InboundMissile = {
    profile,
    fromX: options.fromX,
    fromZ: options.fromZ,
    toX: impactX,
    toZ: impactZ,
    elapsed: 0,
    flightTime: spec.flightTime * (0.92 + sizeScale * 0.08),
    peakAltitude: spec.peakAltitude * (0.85 + sizeScale * 0.15),
    launchY,
    impactY,
    warheadDamage: spec.warheadDamage * sizeScale,
    splashRadius: spec.splashRadius * (0.85 + sizeScale * 0.15),
    sizeScale,
  };
  const yaw = Math.atan2(impactX - options.fromX, impactZ - options.fromZ);
  const entity = sim.world.add({
    id: sim.nextEntityId++,
    name: spec.name,
    transform: { x: options.fromX, y: launchY, z: options.fromZ, rot: yaw },
    previousTransform: { x: options.fromX, y: launchY, z: options.fromZ, rot: yaw },
    health: { current: health, max: health },
    team: { id: options.teamId },
    selectable: { selected: false, type: 'inbound-missile', radius: spec.radius + 0.4 },
    inboundMissile: inbound,
    flight: {
      cruiseAltitude: spec.peakAltitude,
      minAGL: profile === 'drone' ? 4 : 12,
      maxAltitude: spec.peakAltitude + 24,
      climbRate: 0,
      pitchAttitude: 0,
      rollAttitude: 0,
      previousPitchAttitude: 0,
      previousRollAttitude: 0,
      model: profile === 'drone' ? 'drone' : 'jet',
      bank: 0,
      verticalVelocity: 0,
    },
    collider: { radius: spec.radius },
    armor: { kind: 'air' },
  });
  sim.events.push({
    kind: 'inbound-warning',
    fromX: options.fromX,
    fromY: launchY,
    fromZ: options.fromZ,
    toX: impactX,
    toY: impactY,
    toZ: impactZ,
    sourceTeamId: options.teamId,
    targetId: entity.id,
    targetLabel: spec.name,
    targetType: profile,
    targetHealth: health,
    targetMaxHealth: health,
    damage: 0,
    killed: false,
  });
  return entity;
}

/** Advances inbound arcs. Returns missiles that reached their impact point this tick. */
export function stepInboundMissiles(sim: GameSim, dt: number): Entity[] {
  const arrived: Entity[] = [];
  for (const entity of sim.world.entities) {
    const inbound = entity.inboundMissile;
    if (!inbound || entity.destroyed) continue;
    entity.previousTransform = copyTransform(entity.transform);
    inbound.elapsed += dt;
    const t = Math.min(1, inbound.elapsed / inbound.flightTime);
    entity.transform.x = inbound.fromX + (inbound.toX - inbound.fromX) * t;
    entity.transform.z = inbound.fromZ + (inbound.toZ - inbound.fromZ) * t;
    entity.transform.y = inbound.launchY + (inbound.impactY - inbound.launchY) * t + 4 * inbound.peakAltitude * t * (1 - t);
    entity.transform.rot = Math.atan2(inbound.toX - inbound.fromX, inbound.toZ - inbound.fromZ);
    if (entity.flight) {
      const horiz = Math.max(8, Math.hypot(inbound.toX - inbound.fromX, inbound.toZ - inbound.fromZ));
      const climb = (inbound.impactY - inbound.launchY) + 4 * inbound.peakAltitude * (1 - 2 * t);
      entity.flight.previousPitchAttitude = entity.flight.pitchAttitude;
      entity.flight.pitchAttitude = Math.atan2(-climb, horiz);
    }
    if (inbound.elapsed >= inbound.flightTime) arrived.push(entity);
  }
  return arrived;
}

const AI_STRIKE_WARMUP_TICKS = 8 * 30;
const AI_STRIKE_PERIOD_TICKS = 16 * 30;
const AI_STRIKE_IN_FLIGHT_CAP = 2;

function commandYardForTeam(sim: GameSim, teamId: number): Entity | undefined {
  for (const entity of sim.world.entities) {
    if (entity.team?.id !== teamId || entity.destroyed || entity.building?.kind !== 'command-yard') continue;
    return entity;
  }
  return undefined;
}

function nearestHostileCommandYard(sim: GameSim, teamId: number): Entity | undefined {
  let best: Entity | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  const from = commandYardForTeam(sim, teamId);
  if (!from) return undefined;
  for (const entity of sim.world.entities) {
    if (!entity.building || entity.building.kind !== 'command-yard' || entity.destroyed || !entity.team) continue;
    if (!areTeamsHostile(sim, teamId, entity.team.id)) continue;
    const distance = Math.hypot(entity.transform.x - from.transform.x, entity.transform.z - from.transform.z);
    if (distance >= bestDistance) continue;
    best = entity;
    bestDistance = distance;
  }
  return best;
}

function isAiStrikeTick(tick: number, teamId: number): boolean {
  const elapsed = tick - AI_STRIKE_WARMUP_TICKS - ((teamId * 53) % 90);
  return elapsed >= 0 && elapsed % AI_STRIKE_PERIOD_TICKS === 0;
}

/** Deterministic AI volley from a living Command Yard at the nearest hostile yard. */
export function tryLaunchAiStrategicStrike(sim: GameSim, hf: Heightfield, teamId: number): Entity | undefined {
  if (!isAiStrikeTick(sim.tick, teamId)) return undefined;
  let inFlight = 0;
  for (const entity of sim.world.entities) {
    if (entity.team?.id !== teamId || !entity.inboundMissile || entity.destroyed) continue;
    if (entity.inboundMissile.elapsed === 0) return undefined;
    inFlight += 1;
  }
  if (inFlight >= AI_STRIKE_IN_FLIGHT_CAP) return undefined;
  const from = commandYardForTeam(sim, teamId);
  const to = nearestHostileCommandYard(sim, teamId);
  if (!from || !to) return undefined;
  const salt = sim.tick + teamId * 17;
  const profile: InboundProfile = hash2i(salt, teamId, 0xa11) < 0.3 ? 'drone' : 'ballistic';
  const sizeScale = hash2i(salt, teamId, 0xb0b) < 0.2 ? 1.7 : 1;
  return launchStrategicMissile(sim, hf, {
    teamId,
    fromX: from.transform.x,
    fromZ: from.transform.z,
    toX: to.transform.x,
    toZ: to.transform.z,
    profile,
    sizeScale,
    launcherId: from.id,
  });
}
