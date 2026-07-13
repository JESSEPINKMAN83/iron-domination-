import { World, type Query, type With } from 'miniplex';
import { normalizeAngle, slewAngle } from './angles';
import type { Entity } from './components';
import { copyTransform } from './components';
import { FlowField, NavigationGrid, type BlockedFootprint } from './flowfield';
import { sampleHeight, type Heightfield } from './heightfield';
import { mulberry32 } from './noise';
import { FLIGHT_MODELS } from '../content/flightModels';
import { startMusterPosition } from '../content/startPositions';
import { WEAPONS, type WeaponKind } from '../content/phase4';

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const damp = (lambda: number, dt: number): number => 1 - Math.exp(-lambda * dt);
const ARRIVAL_EPSILON = 0.35;
const ORE_CAPACITY_PER_RADIUS_SQUARED = 15;
const POSSESSION_BOOST_MULTIPLIER = 2;
const BOOSTED_BUMP_MAX_HEIGHT_RANGE = 7.5;
const BOOSTED_BUMP_MAX_STEP = 5.8;
const approach = (current: number, target: number, maxDelta: number): number => {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
};

export interface CombatEvent {
  kind: string;
  fromX: number;
  fromY?: number;
  fromZ: number;
  toX: number;
  toY?: number;
  toZ: number;
  sourceTeamId?: number;
  targetId?: number;
  targetLabel?: string;
  targetType?: string;
  targetHealth?: number;
  targetMaxHealth?: number;
  damage: number;
  killed: boolean;
  /** flight time in seconds for ballistic launches ('bomb') */
  duration?: number;
  trajectory?: 'arc' | 'drop' | 'flat' | 'homing';
  /** Original weapon and normalized physical force for per-target hit reactions. */
  impactKind?: string;
  force?: number;
}

/** In-flight ballistic ordnance. Damage happens on impact, at the aimed location. */
export interface Projectile {
  kind: 'bomb' | 'tankBomb' | 'grenade' | 'atRocket' | 'scoutMissile' | 'tankMissile' | 'siegeMissile' | 'agMissile' | 'aaMissile';
  fromX: number;
  fromY?: number;
  fromZ: number;
  x?: number;
  y?: number;
  z?: number;
  toX: number;
  toY?: number;
  toZ: number;
  elapsed: number;
  duration: number;
  speed?: number;
  maxDistance?: number;
  weaponKind?: string;
  directTargetId?: number;
  trajectory?: 'arc' | 'drop' | 'flat' | 'homing';
  homing?: { targetId: number; speed: number; fizzleRange: number };
  teamId: number;
  attackerId: number;
}

export interface ResourceNode {
  id: number;
  kind: 'oil';
  x: number;
  z: number;
  radius: number;
  capacity: number;
  remaining: number;
}

export interface GameSim {
  world: World<Entity>;
  nav: NavigationGrid;
  movers: Query<With<Entity, 'transform' | 'previousTransform' | 'velocity' | 'mover'>>;
  selectables: Query<With<Entity, 'transform' | 'selectable'>>;
  /** incrementally-maintained query of all buildings — avoids full-world rescans per tick */
  buildingsQuery: Query<With<Entity, 'building'>>;
  events: CombatEvent[];
  projectiles: Projectile[];
  resourceNodes: ResourceNode[];
  tick: number;
  /** monotonically increasing entity id — sim-scoped so runs stay deterministic */
  nextEntityId: number;
  /** id → entity index, kept in sync with world add/remove for O(1) lookups */
  byId: Map<number, Entity>;
  rules: {
    autoCombat: boolean;
    autoDefense: boolean;
    allianceSides: Record<number, number>;
  };
}

export function createGameSim(hf: Heightfield, footprints: BlockedFootprint[] = []): GameSim {
  const world = new World<Entity>();
  const byId = new Map<number, Entity>();
  world.onEntityAdded.subscribe((entity) => {
    if (entity.id !== undefined) byId.set(entity.id, entity);
  });
  world.onEntityRemoved.subscribe((entity) => {
    if (entity.id !== undefined) byId.delete(entity.id);
  });
  const resourceNodes = hf.oreFields.map((field, index) => {
    const capacity = Math.round(field.radius * field.radius * ORE_CAPACITY_PER_RADIUS_SQUARED);
    return {
      id: index + 1,
      kind: 'oil' as const,
      x: field.x,
      z: field.z,
      radius: field.radius,
      capacity,
      remaining: capacity,
    };
  });
  return {
    world,
    nav: new NavigationGrid(hf, footprints),
    movers: world.with('transform', 'previousTransform', 'velocity', 'mover'),
    selectables: world.with('transform', 'selectable'),
    buildingsQuery: world.with('building'),
    events: [],
    projectiles: [],
    resourceNodes,
    tick: 0,
    nextEntityId: 1,
    byId,
    rules: {
      autoCombat: true,
      autoDefense: true,
      allianceSides: { 1: 1, 2: 2 },
    },
  };
}

export function allianceSide(sim: GameSim, teamId: number | undefined): number | undefined {
  if (teamId === undefined) return undefined;
  return sim.rules.allianceSides[teamId] ?? teamId;
}

export function areTeamsHostile(sim: GameSim, teamA: number | undefined, teamB: number | undefined): boolean {
  if (teamA === undefined || teamB === undefined) return false;
  return allianceSide(sim, teamA) !== allianceSide(sim, teamB);
}

/** O(1) entity lookup by id (see GameSim.byId). */
export function entityById(sim: GameSim, id: number | undefined): Entity | undefined {
  return id === undefined ? undefined : sim.byId.get(id);
}

export function spawnDebugTanks(sim: GameSim, hf: Heightfield, count = 120, seed = 0x2a11): Entity[] {
  const rng = mulberry32(seed);
  const spawned: Entity[] = [];
  // muster close to the player base so starting tanks actually defend it
  const anchor = startMusterPosition(hf.size, 1);
  const start = sim.nav.nearestWalkableCell(anchor.x, anchor.z, 96) ?? sim.nav.nearestWalkableCell(0, 0);
  if (!start) throw new Error('no walkable spawn cell');
  const center = sim.nav.cellCenter(start.x, start.y);
  let cursor = 0;
  let guard = 0;

  while (spawned.length < count && guard++ < count * 60) {
    const col = cursor % 15;
    const row = Math.floor(cursor / 15);
    cursor++;
    const x = center.x + (col - 7) * 4.6 + (rng() - 0.5) * 0.5;
    const z = center.z + row * 4.6 + (rng() - 0.5) * 0.5;
    const cell = sim.nav.nearestWalkableCell(x, z, 3);
    if (!cell) continue;
    const p = sim.nav.cellCenter(cell.x, cell.y);
    if (Math.hypot(p.x - x, p.z - z) > 4.5) continue;
    const entity = spawnTankAt(sim, p.x, p.z, `M-17 ${spawned.length + 1}`);
    spawned.push(entity);
  }
  return spawned;
}

export function spawnEnemyTanks(sim: GameSim, hf: Heightfield, count = 40): Entity[] {
  const spawned: Entity[] = [];
  const anchor = startMusterPosition(hf.size, 2);
  const start = sim.nav.nearestWalkableCell(anchor.x, anchor.z, 96) ?? sim.nav.nearestWalkableCell(0, 0);
  if (!start) return spawned;
  const center = sim.nav.cellCenter(start.x, start.y);
  let cursor = 0;
  let guard = 0;
  while (spawned.length < count && guard++ < count * 80) {
    const col = cursor % 10;
    const row = Math.floor(cursor / 10);
    cursor++;
    const x = center.x + (col - 5) * 5.2;
    const z = center.z + row * 5.2;
    const cell = sim.nav.nearestWalkableCell(x, z, 4);
    if (!cell) continue;
    const p = sim.nav.cellCenter(cell.x, cell.y);
    spawned.push(spawnTankAt(sim, p.x, p.z, `Ash Tank ${spawned.length + 1}`, 2));
  }
  return spawned;
}

interface TankVariant {
  primary: string;
  secondary?: string;
  primaryRange: number;
  secondaryRange?: number;
  secondarySalvoCount?: number;
  health: number;
  speed: number;
  radius: number;
  turretRate: number;
  vision: number;
}

const STANDARD_TANK: TankVariant = {
  primary: 'tankMissile',
  secondary: 'tankBomb',
  primaryRange: 92,
  secondaryRange: 152,
  secondarySalvoCount: 2,
  health: 100,
  speed: 18,
  radius: 2.2,
  turretRate: 2.2,
  vision: 120,
};

export function spawnTankAt(sim: GameSim, x: number, z: number, name: string, team = 1): Entity {
  return spawnTankVariantAt(sim, x, z, name, team, STANDARD_TANK);
}

export function spawnScoutTankAt(sim: GameSim, x: number, z: number, name: string, team = 1): Entity {
  return spawnTankVariantAt(sim, x, z, name, team, {
    primary: 'scoutMissile',
    secondary: 'tankBomb',
    primaryRange: 72,
    secondaryRange: 132,
    secondarySalvoCount: 1,
    health: 72,
    speed: 24,
    radius: 1.9,
    turretRate: 3.4,
    vision: 142,
  });
}

export function spawnSiegeTankAt(sim: GameSim, x: number, z: number, name: string, team = 1): Entity {
  return spawnTankVariantAt(sim, x, z, name, team, {
    primary: 'siegeMissile',
    secondary: 'tankBomb',
    primaryRange: 118,
    secondaryRange: 176,
    secondarySalvoCount: 4,
    health: 138,
    speed: 13,
    radius: 2.7,
    turretRate: 1.35,
    vision: 132,
  });
}

function spawnTankVariantAt(sim: GameSim, x: number, z: number, name: string, team: number, variant: TankVariant): Entity {
  const primaryWeapon = { kind: variant.primary, range: variant.primaryRange, cooldown: 0 };
  return sim.world.add({
    id: sim.nextEntityId++,
    name,
    transform: { x, z, rot: Math.PI * 0.25 },
    previousTransform: { x, z, rot: Math.PI * 0.25 },
    velocity: { x: 0, z: 0 },
    health: { current: variant.health, max: variant.health },
    team: { id: team },
    selectable: { selected: false, type: 'tank', radius: variant.radius + 0.2 },
    mover: { speed: variant.speed, radius: variant.radius },
    weapon: primaryWeapon,
    weapons: {
      primary: primaryWeapon,
      secondary: variant.secondary
        ? { kind: variant.secondary, range: variant.secondaryRange ?? variant.primaryRange, cooldown: 0, salvoCount: variant.secondarySalvoCount }
        : undefined,
    },
    turret: { yaw: Math.PI * 0.25, turnRate: variant.turretRate },
    vision: { radius: variant.vision },
    possessable: { socketHeight: 2.4 },
    collider: { radius: variant.radius },
    armor: { kind: 'heavy' },
  });
}

export function spawnVultureAt(sim: GameSim, hf: Heightfield, x: number, z: number, name: string, team = 1): Entity {
  return spawnAircraftAt(sim, hf, x, z, name, team, {
    primary: 'rocketPod',
    secondary: 'bomb',
    health: 160,
    speed: 46,
    cruiseAltitude: 28,
    minAGL: 6,
    maxAltitude: 90,
    climbRate: 14,
    primaryRange: 92,
    secondaryRange: 152,
    secondarySalvoCount: 2,
    radius: 3.0,
    vision: 150,
  });
}

export function spawnWaspAt(sim: GameSim, hf: Heightfield, x: number, z: number, name: string, team = 1): Entity {
  return spawnAircraftAt(sim, hf, x, z, name, team, {
    primary: 'waspAutocannon',
    secondary: 'bomb',
    health: 90,
    speed: 60,
    cruiseAltitude: 24,
    minAGL: 6,
    maxAltitude: 82,
    climbRate: 18,
    primaryRange: 72,
    secondaryRange: 132,
    secondarySalvoCount: 1,
    radius: 2.5,
    vision: 172,
  });
}

export function spawnHammerheadAt(sim: GameSim, hf: Heightfield, x: number, z: number, name: string, team = 1): Entity {
  return spawnAircraftAt(sim, hf, x, z, name, team, {
    primary: 'agMissile',
    secondary: 'bomb',
    health: 230,
    speed: 34,
    cruiseAltitude: 34,
    minAGL: 8,
    maxAltitude: 96,
    climbRate: 10,
    primaryRange: 150,
    secondaryRange: 188,
    secondarySalvoCount: 4,
    radius: 3.8,
    vision: 138,
  });
}

interface AircraftVariant {
  primary: string;
  secondary?: string;
  primaryRange: number;
  secondaryRange?: number;
  secondarySalvoCount?: number;
  health: number;
  speed: number;
  radius: number;
  cruiseAltitude: number;
  minAGL: number;
  maxAltitude: number;
  climbRate: number;
  vision: number;
}

function spawnAircraftAt(sim: GameSim, hf: Heightfield, x: number, z: number, name: string, team: number, variant: AircraftVariant): Entity {
  const ground = sampleHeight(hf, x, z);
  const y = ground + variant.cruiseAltitude;
  const aircraftPrimaryWeapon = { kind: variant.primary, range: variant.primaryRange, cooldown: 0 };
  return sim.world.add({
    id: sim.nextEntityId++,
    name,
    transform: { x, y, z, rot: Math.PI * 0.25 },
    previousTransform: { x, y, z, rot: Math.PI * 0.25 },
    velocity: { x: 0, z: 0 },
    health: { current: variant.health, max: variant.health },
    team: { id: team },
    selectable: { selected: false, type: 'vulture', radius: variant.radius + 0.2 },
    mover: { speed: variant.speed, radius: variant.radius },
    flight: {
      cruiseAltitude: variant.cruiseAltitude,
      minAGL: variant.minAGL,
      maxAltitude: variant.maxAltitude,
      climbRate: variant.climbRate,
      pitchAttitude: 0,
      rollAttitude: 0,
      previousPitchAttitude: 0,
      previousRollAttitude: 0,
      model: 'gunship',
      bank: 0,
      verticalVelocity: 0,
    },
    // primary shares one object with weapons.primary so cooldown ticks stay in sync
    weapon: aircraftPrimaryWeapon,
    weapons: {
      primary: aircraftPrimaryWeapon,
      secondary: variant.secondary
        ? { kind: variant.secondary, range: variant.secondaryRange ?? variant.primaryRange, cooldown: 0, salvoCount: variant.secondarySalvoCount }
        : undefined,
    },
    turret: { yaw: Math.PI * 0.25, turnRate: 4.0 },
    vision: { radius: variant.vision },
    possessable: { socketHeight: 1.6 },
    collider: { radius: variant.radius },
    armor: { kind: 'air' },
  });
}

export function issueMoveOrder(
  sim: GameSim,
  entities: Entity[],
  targetX: number,
  targetZ: number,
  attackMove = false,
  faceYaw?: number,
  formationSpread?: number,
): boolean {
  let issued = false;
  const flyers = entities.filter((entity) => entity.flight);
  if (flyers.length > 0) {
    const spacing = formationSpacing(8, flyers.length, formationSpread);
    const width = formationWidth(flyers.length, faceYaw, formationSpread);
    flyers.forEach((entity, i) => {
      if (!entity.mover) return;
      const col = i % width;
      const row = Math.floor(i / width);
      const offset = formationOffset(col, row, width, flyers.length, spacing, faceYaw);
      entity.mover.target = {
        x: clamp(targetX + offset.x, -sim.nav.size / 2, sim.nav.size / 2),
        z: clamp(targetZ + offset.z, -sim.nav.size / 2, sim.nav.size / 2),
      };
      entity.mover.formationOffset = undefined;
      entity.mover.flow = undefined;
      entity.mover.attackMove = attackMove;
      entity.mover.faceYaw = faceYaw;
      entity.mover.defenseAlert = undefined;
      issued = true;
    });
  }

  const groundUnits = entities.filter((entity) => !entity.flight);
  if (groundUnits.length === 0) return issued;
  const targetPoint = walkableOrderPoint(sim, targetX, targetZ);
  if (!targetPoint) return issued;
  const target = sim.nav.nearestWalkableCell(targetPoint.x, targetPoint.z, 4);
  if (!target) return issued;
  const flow = new FlowField(sim.nav, targetPoint.x, targetPoint.z);
  const spacing = formationSpacing(5.2, groundUnits.length, formationSpread);
  const width = formationWidth(groundUnits.length, faceYaw, formationSpread);
  groundUnits.forEach((entity, i) => {
    if (!entity.mover) return;
    const col = i % width;
    const row = Math.floor(i / width);
    const offset = formationOffset(col, row, width, groundUnits.length, spacing, faceYaw);
    entity.mover.target = { x: targetPoint.x, z: targetPoint.z };
    entity.mover.formationOffset = { x: offset.x, z: offset.z };
    entity.mover.flow = flow;
    entity.mover.attackMove = attackMove;
    entity.mover.faceYaw = faceYaw;
    entity.mover.defenseAlert = undefined;
    issued = true;
  });
  return issued;
}

export function attackStandoffPoint(sim: GameSim, attackers: Entity[], target: Entity): { x: number; z: number } {
  const movers = attackers.filter((entity) => entity.mover && !entity.destroyed);
  if (movers.length === 0) return { x: target.transform.x, z: target.transform.z };

  let avgX = 0;
  let avgZ = 0;
  for (const entity of movers) {
    avgX += entity.transform.x;
    avgZ += entity.transform.z;
  }
  avgX /= movers.length;
  avgZ /= movers.length;

  let dx = avgX - target.transform.x;
  let dz = avgZ - target.transform.z;
  let len = Math.hypot(dx, dz);
  if (len < 0.001) {
    dx = -Math.sin(target.transform.rot);
    dz = -Math.cos(target.transform.rot);
    len = 1;
  }

  const centerDistance = attackCenterDistance(movers, target);
  const raw = {
    x: clamp(target.transform.x + (dx / len) * centerDistance, -sim.nav.size / 2, sim.nav.size / 2),
    z: clamp(target.transform.z + (dz / len) * centerDistance, -sim.nav.size / 2, sim.nav.size / 2),
  };

  if (movers.some((entity) => !entity.flight)) return walkableOrderPoint(sim, raw.x, raw.z) ?? raw;
  return raw;
}

export function stopEntities(entities: Entity[]): void {
  for (const entity of entities) {
    if (!entity.mover || !entity.velocity) continue;
    entity.mover.target = undefined;
    entity.mover.formationOffset = undefined;
    entity.mover.flow = undefined;
    entity.mover.faceYaw = undefined;
    entity.mover.defenseAlert = undefined;
    entity.velocity.x = 0;
    entity.velocity.z = 0;
  }
}

function walkableOrderPoint(sim: GameSim, x: number, z: number): { x: number; z: number } | undefined {
  const clampedX = clamp(x, -sim.nav.size / 2, sim.nav.size / 2);
  const clampedZ = clamp(z, -sim.nav.size / 2, sim.nav.size / 2);
  const clicked = sim.nav.worldToCell(clampedX, clampedZ);
  if (sim.nav.isWalkableCell(clicked.x, clicked.y)) return { x: clampedX, z: clampedZ };
  const fallback = sim.nav.nearestWalkableCell(clampedX, clampedZ, 96);
  return fallback ? sim.nav.cellCenter(fallback.x, fallback.y) : undefined;
}

export function selectedEntities(sim: GameSim, team = 1): Entity[] {
  const out: Entity[] = [];
  for (const entity of sim.selectables) {
    if (entity.team?.id === team && entity.selectable.selected) out.push(entity);
  }
  return out;
}

export function setSelected(sim: GameSim, entities: Entity[], add = false, team = 1): void {
  for (const entity of sim.selectables) {
    if (entity.team?.id !== team || !add) entity.selectable.selected = false;
  }
  for (const entity of entities) {
    if (entity.team?.id === team && entity.selectable) entity.selectable.selected = true;
  }
}

export function stepSim(sim: GameSim, hf: Heightfield, dt: number): void {
  const movers = Array.from(sim.movers);
  for (const entity of movers) entity.previousTransform = copyTransform(entity.transform);

  for (let i = 0; i < movers.length; i++) {
    const entity = movers[i];
    if (entity.destroyed) continue;
    const { transform, velocity, mover } = entity;
    transform.y ??= sampleHeight(hf, transform.x, transform.z);
    let desiredX = 0;
    let desiredZ = 0;
    let orientToMovement = false;

    if (entity.flight) {
      stepFlightEntity(sim, hf, movers, entity, i, dt);
      continue;
    }

    if (entity.playerControlled) {
      mover.target = undefined;
      mover.formationOffset = undefined;
      mover.flow = undefined;
      mover.attackMove = false;
      const throttle = Math.max(-1, Math.min(1, entity.playerControlled.throttle));
      const turn = Math.max(-1, Math.min(1, entity.playerControlled.turn));
      const boost = entity.playerControlled.boost ? POSSESSION_BOOST_MULTIPLIER : 1;
      const turnRate = throttle === 0 ? 1.55 : 1.15;
      transform.rot = normalizeAngle(transform.rot + turn * turnRate * dt);
      const driveSpeed = mover.speed * boost * (throttle < 0 ? 0.42 : 0.78);
      desiredX = Math.sin(transform.rot) * driveSpeed * throttle;
      desiredZ = Math.cos(transform.rot) * driveSpeed * throttle;
      // real traverse speed — you feel the turret's weight chasing the crosshair
      if (entity.turret) entity.turret.yaw = slewAngle(entity.turret.yaw, entity.playerControlled.aimYaw, entity.turret.turnRate, dt);
    } else if (mover.target && mover.flow) {
      const finalX = mover.target.x + (mover.formationOffset?.x ?? 0);
      const finalZ = mover.target.z + (mover.formationOffset?.z ?? 0);
      const finalDx = finalX - transform.x;
      const finalDz = finalZ - transform.z;
      const finalDist = Math.hypot(finalDx, finalDz);
      if (finalDist < Math.max(ARRIVAL_EPSILON, mover.radius * 0.72)) {
        mover.target = undefined;
        mover.formationOffset = undefined;
        mover.flow = undefined;
        velocity.x = 0;
        velocity.z = 0;
      } else if (finalDist < 18) {
        desiredX = finalDx / finalDist;
        desiredZ = finalDz / finalDist;
        orientToMovement = true;
      } else {
        const dir = mover.flow.directionAt(transform.x, transform.z);
        desiredX = dir.x;
        desiredZ = dir.z;
        orientToMovement = true;
      }
    } else if (mover.engage) {
      // guard response set by combat: advance until back in weapon range
      const dx = mover.engage.x - transform.x;
      const dz = mover.engage.z - transform.z;
      const d = Math.hypot(dx, dz);
      if (d > 2) {
        desiredX = dx / d;
        desiredZ = dz / d;
        orientToMovement = true;
      }
      mover.engage = undefined; // re-issued next combat tick while the foe stays visible
    } else if (mover.faceYaw !== undefined) {
      transform.rot = slewAngle(transform.rot, mover.faceYaw, 2.8, dt);
      if (entity.turret) entity.turret.yaw = slewAngle(entity.turret.yaw, mover.faceYaw, entity.turret.turnRate, dt);
    }

    for (let j = 0; j < movers.length; j++) {
      if (i === j) continue;
      const other = movers[j];
      if (!!entity.flight !== !!other.flight) continue;
      const dx = transform.x - other.transform.x;
      const dz = transform.z - other.transform.z;
      const minD = mover.radius + other.mover.radius + 1.2;
      const d2 = dx * dx + dz * dz;
      if (d2 <= 0.0001 || d2 > minD * minD) continue;
      const d = Math.sqrt(d2);
      const push = (minD - d) / minD;
      desiredX += (dx / d) * push * 1.35;
      desiredZ += (dz / d) * push * 1.35;
    }

    const desiredLen = Math.hypot(desiredX, desiredZ);
    if (desiredLen > 0 && !entity.playerControlled) {
      desiredX = (desiredX / desiredLen) * mover.speed;
      desiredZ = (desiredZ / desiredLen) * mover.speed;
    }
    velocity.x += (desiredX - velocity.x) * Math.min(1, dt * 8);
    velocity.z += (desiredZ - velocity.z) * Math.min(1, dt * 8);

    const nextX = transform.x + velocity.x * dt;
    const nextZ = transform.z + velocity.z * dt;
    const cell = sim.nav.worldToCell(nextX, nextZ);
    if (sim.nav.isWalkableCell(cell.x, cell.y) || boostedTerrainPassable(sim, hf, entity, nextX, nextZ)) {
      transform.x = nextX;
      transform.z = nextZ;
    } else {
      const xCell = sim.nav.worldToCell(nextX, transform.z);
      const zCell = sim.nav.worldToCell(transform.x, nextZ);
      if (sim.nav.isWalkableCell(xCell.x, xCell.y) || boostedTerrainPassable(sim, hf, entity, nextX, transform.z)) {
        transform.x = nextX;
        velocity.z = 0;
      } else if (sim.nav.isWalkableCell(zCell.x, zCell.y) || boostedTerrainPassable(sim, hf, entity, transform.x, nextZ)) {
        transform.z = nextZ;
        velocity.x = 0;
      } else {
        velocity.x = 0;
        velocity.z = 0;
      }
    }

    const speed = Math.hypot(velocity.x, velocity.z);
    if (!entity.playerControlled && orientToMovement && speed > 0.05) transform.rot = Math.atan2(velocity.x, velocity.z);
    transform.y = sampleHeight(hf, transform.x, transform.z);
  }

  sim.tick++;
}

function boostedTerrainPassable(sim: GameSim, hf: Heightfield, entity: MovingEntity, x: number, z: number): boolean {
  const controlled = entity.playerControlled;
  if (!controlled?.boost || controlled.throttle < 0.85 || entity.flight) return false;
  const cell = sim.nav.worldToCell(x, z);
  if (!sim.nav.inBounds(cell.x, cell.y)) return false;
  const index = sim.nav.index(cell.x, cell.y);
  if (sim.nav.blocked[index] === 0) return true;
  if (hf.walkable[index] !== 0) return false; // dynamic/building blocker, not a terrain bump

  const targetHeight = sampleHeight(hf, x, z);
  if (targetHeight < hf.waterLevel + 0.55) return false;
  const currentHeight = sampleHeight(hf, entity.transform.x, entity.transform.z);
  if (Math.abs(targetHeight - currentHeight) > BOOSTED_BUMP_MAX_STEP) return false;

  const range = terrainCellHeightRange(hf, cell.x, cell.y);
  if (range > BOOSTED_BUMP_MAX_HEIGHT_RANGE) return false;

  const clearance = (entity.collider?.radius ?? entity.mover.radius) + 1.4;
  for (const building of sim.buildingsQuery) {
    if (building.destroyed) continue;
    const radius = (building.collider?.radius ?? Math.max(building.building.footprint.w, building.building.footprint.h) * hf.cellSize) + clearance;
    if ((building.transform.x - x) ** 2 + (building.transform.z - z) ** 2 < radius ** 2) return false;
  }
  return true;
}

function terrainCellHeightRange(hf: Heightfield, cx: number, cy: number): number {
  if (cx < 0 || cy < 0 || cx >= hf.cells || cy >= hf.cells) return Infinity;
  const i00 = cy * hf.samples + cx;
  const h00 = hf.heights[i00];
  const h10 = hf.heights[i00 + 1];
  const h01 = hf.heights[i00 + hf.samples];
  const h11 = hf.heights[i00 + hf.samples + 1];
  return Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11);
}

type MovingEntity = With<Entity, 'transform' | 'previousTransform' | 'velocity' | 'mover'>;

interface FlightCommand {
  throttle: number;
  turn: number;
  strafe: number;
  climb: number;
  aimYaw?: number;
}

function stepFlightEntity(sim: GameSim, hf: Heightfield, movers: MovingEntity[], entity: MovingEntity, index: number, dt: number): void {
  const { transform, velocity, mover } = entity;
  const flight = entity.flight;
  if (!flight) return;

  flight.previousPitchAttitude = flight.pitchAttitude;
  flight.previousRollAttitude = flight.rollAttitude;

  const model = FLIGHT_MODELS[flight.model];
  const boost = entity.playerControlled?.boost ? POSSESSION_BOOST_MULTIPLIER : 1;
  const maxSpeed = model.maxSpeed * boost;
  const maxReverse = model.maxReverse * boost;
  const maxStrafe = model.maxStrafe * boost;
  const speed = Math.hypot(velocity.x, velocity.z);
  const command = entity.playerControlled ? possessedFlightCommand(entity) : aiFlightCommand(entity);
  const yawSpeedT = clamp(speed / maxSpeed, 0, 1);
  const yawRate = lerp(model.yawRateHover, model.yawRateAtSpeed, yawSpeedT);
  let yawApplied = command.turn * yawRate * dt;
  let aimDeltaForVane = 0;

  if (command.aimYaw !== undefined) {
    const aimDelta = normalizeAngle(command.aimYaw - transform.rot);
    aimDeltaForVane = aimDelta;
    if (entity.playerControlled) {
      const absAim = Math.abs(aimDelta);
      const hardTurnBoost = absAim > Math.PI * 0.62 ? 2.05 : absAim > Math.PI * 0.34 ? 1.55 : 1.1;
      yawApplied += Math.sign(aimDelta) * Math.min(absAim, model.mouseFollowRate * hardTurnBoost * dt);
    } else {
      const outsideGimbal = Math.max(0, Math.abs(aimDelta) - model.gimbalHalfAngle);
      if (outsideGimbal > 0) yawApplied += Math.sign(aimDelta) * Math.min(outsideGimbal, model.mouseFollowRate * dt);
    }
    if (entity.turret) entity.turret.yaw = slewAngle(entity.turret.yaw, command.aimYaw, entity.turret.turnRate, dt);
  }

  if (speed > maxSpeed * 0.4) {
    const velocityYaw = Math.atan2(velocity.x, velocity.z);
    const vaneDelta = normalizeAngle(velocityYaw - transform.rot);
    const playerTurnSuppression = entity.playerControlled ? clamp(Math.abs(aimDeltaForVane) / Math.PI + Math.abs(command.turn) * 0.65, 0, 0.95) : 0;
    const vaneStep = model.weathervane * (1 - playerTurnSuppression) * yawRate * dt;
    yawApplied += clamp(vaneDelta, -vaneStep, vaneStep);
  }

  transform.rot = normalizeAngle(transform.rot + yawApplied);

  const noInput = Math.abs(command.throttle) < 0.001 && Math.abs(command.strafe) < 0.001 && Math.abs(command.turn) < 0.001 && Math.abs(command.climb) < 0.001;
  const brakingFromSpeed = command.throttle <= 0 && speed > 8;
  let pitchCmd = command.throttle >= 0 ? -command.throttle * model.maxTiltPitch : -command.throttle * model.maxTiltPitch * 0.38;
  if (brakingFromSpeed) pitchCmd = Math.max(pitchCmd, model.maxTiltPitch * 0.3);
  const turnLean = -(yawApplied / Math.max(0.0001, dt)) * speed * 0.01;
  const rollCmd = clamp(command.strafe * model.maxTiltRoll + turnLean, -model.maxTiltRoll, model.maxTiltRoll);
  const attitudeT = damp(model.attitudeLag, dt);
  flight.pitchAttitude += (pitchCmd - flight.pitchAttitude) * attitudeT;
  flight.rollAttitude += (rollCmd - flight.rollAttitude) * attitudeT;
  flight.bank = flight.rollAttitude;

  const forwardX = Math.sin(transform.rot);
  const forwardZ = Math.cos(transform.rot);
  const rightX = Math.cos(transform.rot);
  const rightZ = -Math.sin(transform.rot);
  const powerScale = Math.abs(command.climb) > 0.5 ? 0.75 : 1;
  const pitchDenom = Math.max(0.001, Math.sin(model.maxTiltPitch));
  const rollDenom = Math.max(0.001, Math.sin(model.maxTiltRoll));
  const accelBoost = entity.playerControlled?.boost ? POSSESSION_BOOST_MULTIPLIER : 1;
  const accelFwd = (-Math.sin(flight.pitchAttitude) / pitchDenom) * model.tiltAccel * powerScale * accelBoost;
  const accelSide = (Math.sin(flight.rollAttitude) / rollDenom) * model.strafeAccel * powerScale * accelBoost;
  let accelX = accelFwd * forwardX + accelSide * rightX;
  let accelZ = accelFwd * forwardZ + accelSide * rightZ;
  const currentSpeed = Math.hypot(velocity.x, velocity.z);
  const dragK = entity.playerControlled?.boost ? model.dragK / (POSSESSION_BOOST_MULTIPLIER * POSSESSION_BOOST_MULTIPLIER) : model.dragK;
  accelX -= velocity.x * dragK * currentSpeed;
  accelZ -= velocity.z * dragK * currentSpeed;

  velocity.x += accelX * dt;
  velocity.z += accelZ * dt;

  if (noInput) {
    const hoverT = damp(model.hoverDamp, dt);
    velocity.x += (0 - velocity.x) * hoverT;
    velocity.z += (0 - velocity.z) * hoverT;
  }

  limitBodyFlightVelocity(velocity, transform.rot, maxSpeed, maxReverse, maxStrafe);

  for (let j = 0; j < movers.length; j++) {
    if (j === index) continue;
    const other = movers[j];
    if (!other.flight) continue;
    const dx = transform.x - other.transform.x;
    const dz = transform.z - other.transform.z;
    const minD = mover.radius + other.mover.radius + 2.2;
    const d2 = dx * dx + dz * dz;
    if (d2 <= 0.0001 || d2 > minD * minD) continue;
    const d = Math.sqrt(d2);
    const push = ((minD - d) / minD) * 8.5 * dt;
    velocity.x += (dx / d) * push;
    velocity.z += (dz / d) * push;
  }

  transform.x = clamp(transform.x + velocity.x * dt, -sim.nav.size / 2, sim.nav.size / 2);
  transform.z = clamp(transform.z + velocity.z * dt, -sim.nav.size / 2, sim.nav.size / 2);

  const ground = sampleHeight(hf, transform.x, transform.z);
  const lookahead = Math.min(2.4, Math.max(0.8, Math.hypot(velocity.x, velocity.z) * 0.08));
  const ahead = sampleHeight(hf, transform.x + velocity.x * lookahead, transform.z + velocity.z * lookahead);
  const currentY = transform.y ?? ground + flight.cruiseAltitude;
  const climbRate = model.climbRate * boost;
  const climbAccel = model.climbAccel * boost;
  let targetVy = command.climb * climbRate;
  if (!entity.playerControlled) {
    const desiredY = Math.min(flight.maxAltitude, Math.max(ground + flight.cruiseAltitude, ahead + flight.minAGL));
    targetVy = clamp((desiredY - currentY) * 1.6, -climbRate, climbRate);
  } else if (currentY < ahead + flight.minAGL + 0.5) {
    targetVy = Math.max(targetVy, climbRate * 0.7);
  }
  flight.verticalVelocity = approach(flight.verticalVelocity, targetVy, climbAccel * dt);
  const agl = currentY - ground;
  let appliedVy = flight.verticalVelocity;
  if (agl < 8 && appliedVy < 0) appliedVy *= model.groundEffect;
  transform.y = currentY + appliedVy * dt;

  const minFlightY = ground + flight.minAGL;
  if (transform.y < minFlightY) {
    const hardImpact = flight.verticalVelocity < -9 || Math.hypot(velocity.x, velocity.z) > 18;
    if (hardImpact && transform.y < ground + 1.2) {
      if (entity.health) entity.health.current = 0;
      entity.destroyed = { remaining: 20 };
      sim.events.push({ kind: 'crash', fromX: transform.x, fromZ: transform.z, toX: transform.x, toZ: transform.z, damage: 999, killed: true });
      return;
    }
    transform.y = minFlightY + 0.5;
    flight.verticalVelocity = Math.max(1.5, -flight.verticalVelocity * 0.18);
    velocity.x *= 0.55;
    velocity.z *= 0.55;
    if (entity.health) entity.health.current = Math.max(1, entity.health.current - 10);
    sim.events.push({ kind: 'hard-bounce', fromX: transform.x, fromZ: transform.z, toX: transform.x, toZ: transform.z, damage: 10, killed: false });
  }
  transform.y = Math.min(transform.y, flight.maxAltitude);
}

function possessedFlightCommand(entity: MovingEntity): FlightCommand {
  const controlled = entity.playerControlled;
  const mover = entity.mover;
  mover.target = undefined;
  mover.formationOffset = undefined;
  mover.flow = undefined;
  mover.attackMove = false;
  mover.defenseAlert = undefined;
  return {
    throttle: clamp(controlled?.throttle ?? 0, -1, 1),
    turn: clamp(controlled?.turn ?? 0, -1.65, 1.65),
    strafe: clamp(controlled?.strafe ?? 0, -1, 1),
    climb: clamp(controlled?.climb ?? 0, -1, 1),
    aimYaw: controlled?.aimYaw ?? entity.transform.rot,
  };
}

function aiFlightCommand(entity: MovingEntity): FlightCommand {
  const { transform, velocity, mover } = entity;
  const command: FlightCommand = { throttle: 0, turn: 0, strafe: 0, climb: 0 };
  const target = mover.target ?? mover.engage;
  if (target) {
    const dx = target.x - transform.x;
    const dz = target.z - transform.z;
    const dist = Math.hypot(dx, dz);
    if (dist < mover.radius * 2.2) {
      if (mover.target) mover.target = undefined;
      velocity.x *= 0.9;
      velocity.z *= 0.9;
      command.throttle = -0.35;
    } else if (dist > 0.001) {
      const dirX = dx / dist;
      const dirZ = dz / dist;
      const forwardX = Math.sin(transform.rot);
      const forwardZ = Math.cos(transform.rot);
      const rightX = Math.cos(transform.rot);
      const rightZ = -Math.sin(transform.rot);
      const desiredYaw = Math.atan2(dx, dz);
      const yawDelta = normalizeAngle(desiredYaw - transform.rot);
      const slow = clamp(dist / 44, 0.25, 1);
      const forwardDot = dirX * forwardX + dirZ * forwardZ;
      const sideDot = dirX * rightX + dirZ * rightZ;
      command.throttle = clamp(Math.max(0.18, forwardDot) * slow, -0.35, 1);
      command.strafe = clamp(sideDot * 1.15 * slow, -1, 1);
      command.turn = clamp(yawDelta * 1.2, -1, 1);
      command.aimYaw = desiredYaw;
    }
    mover.engage = undefined;
  } else if (mover.faceYaw !== undefined) {
    const yawDelta = normalizeAngle(mover.faceYaw - transform.rot);
    command.turn = clamp(yawDelta * 1.2, -1, 1);
    command.aimYaw = mover.faceYaw;
  }
  return command;
}

function limitBodyFlightVelocity(velocity: { x: number; z: number }, yaw: number, maxSpeed: number, maxReverse: number, maxStrafe: number): void {
  const forwardX = Math.sin(yaw);
  const forwardZ = Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  let fwd = velocity.x * forwardX + velocity.z * forwardZ;
  let side = velocity.x * rightX + velocity.z * rightZ;
  if (fwd > maxSpeed) fwd = maxSpeed;
  if (maxReverse >= 0 && fwd < -maxReverse) fwd = -maxReverse;
  side = clamp(side, -maxStrafe, maxStrafe);
  velocity.x = forwardX * fwd + rightX * side;
  velocity.z = forwardZ * fwd + rightZ * side;
  const speed = Math.hypot(velocity.x, velocity.z);
  const cap = maxSpeed * 1.12;
  if (speed > cap) {
    const scale = cap / speed;
    velocity.x *= scale;
    velocity.z *= scale;
  }
}

function formationWidth(count: number, faceYaw?: number, formationSpread?: number): number {
  if (count <= 1) return 1;
  if (faceYaw === undefined) return Math.max(1, Math.ceil(Math.sqrt(count)));
  if (formationSpread !== undefined) return count;
  return Math.min(count, Math.max(2, Math.ceil(Math.sqrt(count) * 1.8)));
}

function formationSpacing(baseSpacing: number, count: number, formationSpread?: number): number {
  if (formationSpread === undefined || count <= 1) return baseSpacing;
  return clamp(formationSpread / Math.max(1, count - 1), baseSpacing * 0.75, baseSpacing * 3.5);
}

function formationOffset(col: number, row: number, width: number, count: number, spacing: number, faceYaw?: number): { x: number; z: number } {
  const rows = Math.ceil(count / width);
  const localX = (col - (width - 1) / 2) * spacing;
  const localZ = (row - (rows - 1) / 2) * spacing;
  if (faceYaw === undefined) return { x: localX, z: localZ };
  const rightX = Math.cos(faceYaw);
  const rightZ = -Math.sin(faceYaw);
  const backX = -Math.sin(faceYaw);
  const backZ = -Math.cos(faceYaw);
  return {
    x: rightX * localX + backX * localZ,
    z: rightZ * localX + backZ * localZ,
  };
}

function attackCenterDistance(attackers: Entity[], target: Entity): number {
  const targetRadius = target.collider?.radius ?? target.selectable?.radius ?? 2.5;
  const ranges: number[] = [];
  for (const attacker of attackers) {
    for (const weapon of attackWeapons(attacker)) {
      if (!target.armor) continue;
      const def = WEAPONS[weapon.kind as WeaponKind];
      if (!def || !def.targetTypes.includes(target.armor.kind)) continue;
      ranges.push(weapon.range || def.range);
    }
  }
  const shortestRange = ranges.length > 0 ? Math.min(...ranges) : 48;
  const minimumEdgeGap = targetRadius + 10;
  const preferred = Math.max(targetRadius + 18, shortestRange * 0.76);
  const maximum = Math.max(minimumEdgeGap, shortestRange * 0.88);
  return clamp(preferred, minimumEdgeGap, maximum);
}

function attackWeapons(entity: Entity) {
  if (entity.weapons) return [entity.weapons.primary, entity.weapons.secondary].filter((weapon): weapon is NonNullable<typeof weapon> => weapon !== undefined);
  return entity.weapon ? [entity.weapon] : [];
}

// Stable numeric codes for enum values — hashing by string length collided
// equal-length states (e.g. 'seeking' vs 'to-node'), masking desyncs.
const HARVESTER_STATE_CODE: Record<string, number> = {
  seeking: 1,
  'to-node': 2,
  gathering: 3,
  'to-refinery': 4,
  depositing: 5,
};
const PROJECTILE_KIND_CODE: Record<string, number> = {
  bomb: 1,
  grenade: 2,
  atRocket: 3,
  agMissile: 4,
  aaMissile: 5,
  scoutMissile: 6,
  tankMissile: 7,
  siegeMissile: 8,
  tankBomb: 9,
};

export function hashSim(sim: GameSim): number {
  let h = 0x811c9dc5 >>> 0;
  const mix = (v: number) => {
    h = Math.imul(h ^ v, 0x01000193) >>> 0;
  };
  const entities = Array.from(sim.world.entities).sort((a, b) => a.id - b.id);
  for (const entity of entities) {
    mix(entity.id);
    mix(Math.round(entity.transform.x * 100));
    mix(Math.round((entity.transform.y ?? 0) * 100));
    mix(Math.round(entity.transform.z * 100));
    mix(Math.round(entity.transform.rot * 10000));
    if (entity.velocity) {
      mix(Math.round(entity.velocity.x * 100));
      mix(Math.round(entity.velocity.z * 100));
    }
    if (entity.turret) mix(Math.round(entity.turret.yaw * 10000));
    if (entity.mover) {
      mix(entity.mover.target ? Math.round(entity.mover.target.x * 10) : 0);
      mix(entity.mover.target ? Math.round(entity.mover.target.z * 10) : 0);
      mix(entity.mover.engage ? Math.round(entity.mover.engage.x * 10) : 0);
      mix(entity.mover.engage ? Math.round(entity.mover.engage.z * 10) : 0);
    }
    if (entity.weapon) {
      mix(Math.round(entity.weapon.cooldown * 1000));
      mix(entity.weapon.targetId ?? 0);
    }
    if (entity.weapons?.secondary) {
      mix(Math.round(entity.weapons.secondary.cooldown * 1000));
      mix(entity.weapons.secondary.targetId ?? 0);
    }
    if (entity.specialWeapon) {
      mix(Math.round(entity.specialWeapon.cooldown * 1000));
      mix(entity.specialWeapon.targetId ?? 0);
    }
    if (entity.unitUpgrades) {
      for (const id of entity.unitUpgrades.ids) for (let i = 0; i < id.length; i++) mix(id.charCodeAt(i));
    }
    if (entity.flight) {
      mix(Math.round(entity.flight.pitchAttitude * 1000));
      mix(Math.round(entity.flight.rollAttitude * 1000));
      mix(Math.round(entity.flight.verticalVelocity * 1000));
    }
    if (entity.structureDamage) {
      mix(entity.structureDamage.cols);
      mix(entity.structureDamage.rows);
      mix(entity.structureDamage.tiers);
      mix(entity.structureDamage.version);
      for (const cell of entity.structureDamage.cells) mix(cell);
    }
    if (entity.health) mix(Math.round(entity.health.current * 100));
    if (entity.cargo) {
      mix(entity.cargo.capacity);
      mix(Math.round(entity.cargo.amount * 100));
    }
    if (entity.harvester) {
      mix(HARVESTER_STATE_CODE[entity.harvester.state] ?? 0);
      mix(entity.harvester.nodeId ?? 0);
      mix(entity.harvester.refineryId ?? 0);
      mix(Math.round(entity.harvester.timer * 1000));
      mix(Math.round((entity.harvester.threatTimer ?? 0) * 1000));
      mix(Math.round((entity.harvester.lastHealth ?? 0) * 100));
    }
  }
  for (const projectile of sim.projectiles) {
    mix(PROJECTILE_KIND_CODE[projectile.kind] ?? 0);
    mix(Math.round((projectile.x ?? projectile.toX) * 100));
    mix(Math.round((projectile.y ?? 0) * 100));
    mix(Math.round((projectile.z ?? projectile.toZ) * 100));
    mix(Math.round(projectile.toX * 100));
    mix(Math.round(projectile.toZ * 100));
    mix(Math.round(projectile.elapsed * 1000));
    mix(projectile.attackerId);
  }
  for (const node of sim.resourceNodes) {
    mix(node.id);
    mix(Math.round(node.x * 100));
    mix(Math.round(node.z * 100));
    mix(Math.round(node.radius * 100));
    mix(node.capacity);
    mix(Math.round(node.remaining));
  }
  mix(sim.rules.autoCombat ? 1 : 0);
  mix(sim.rules.autoDefense ? 1 : 0);
  return h >>> 0;
}
