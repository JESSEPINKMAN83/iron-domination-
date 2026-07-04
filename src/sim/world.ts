import { World, type Query, type With } from 'miniplex';
import { normalizeAngle, slewAngle } from './angles';
import type { Entity } from './components';
import { copyTransform } from './components';
import { FlowField, NavigationGrid, type BlockedFootprint } from './flowfield';
import { sampleHeight, type Heightfield } from './heightfield';
import { mulberry32 } from './noise';

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

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
  trajectory?: 'arc' | 'drop';
}

/** In-flight ballistic ordnance. Damage happens on impact, at the aimed location. */
export interface Projectile {
  kind: 'bomb';
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  elapsed: number;
  duration: number;
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
  events: CombatEvent[];
  projectiles: Projectile[];
  resourceNodes: ResourceNode[];
  tick: number;
  /** monotonically increasing entity id — sim-scoped so runs stay deterministic */
  nextEntityId: number;
}

export function createGameSim(hf: Heightfield, footprints: BlockedFootprint[] = []): GameSim {
  const world = new World<Entity>();
  const resourceNodes = hf.oreFields.map((field, index) => {
    const capacity = Math.round(field.radius * field.radius * 5);
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
    events: [],
    projectiles: [],
    resourceNodes,
    tick: 0,
    nextEntityId: 1,
  };
}

export function spawnDebugTanks(sim: GameSim, hf: Heightfield, count = 120, seed = 0x2a11): Entity[] {
  const rng = mulberry32(seed);
  const spawned: Entity[] = [];
  // muster close to the player base so starting tanks actually defend it
  const start = sim.nav.nearestWalkableCell(-hf.size * 0.065, -hf.size * 0.055) ?? sim.nav.nearestWalkableCell(0, 0);
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
  const start = sim.nav.nearestWalkableCell(hf.size * 0.18, hf.size * 0.08) ?? sim.nav.nearestWalkableCell(hf.size * 0.12, hf.size * 0.12);
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
  health: number;
  speed: number;
  radius: number;
  turretRate: number;
  vision: number;
}

const STANDARD_TANK: TankVariant = {
  primary: 'cannon',
  secondary: 'bomb',
  primaryRange: 78,
  secondaryRange: 152,
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
    primary: 'autocannon',
    primaryRange: 62,
    health: 72,
    speed: 24,
    radius: 1.9,
    turretRate: 3.4,
    vision: 142,
  });
}

export function spawnSiegeTankAt(sim: GameSim, x: number, z: number, name: string, team = 1): Entity {
  return spawnTankVariantAt(sim, x, z, name, team, {
    primary: 'heavyCannon',
    secondary: 'bomb',
    primaryRange: 104,
    secondaryRange: 176,
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
      secondary: variant.secondary ? { kind: variant.secondary, range: variant.secondaryRange ?? variant.primaryRange, cooldown: 0 } : undefined,
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
    radius: 3.0,
    vision: 150,
  });
}

export function spawnWaspAt(sim: GameSim, hf: Heightfield, x: number, z: number, name: string, team = 1): Entity {
  return spawnAircraftAt(sim, hf, x, z, name, team, {
    primary: 'autocannon',
    secondary: 'rocketPod',
    health: 95,
    speed: 58,
    cruiseAltitude: 24,
    minAGL: 6,
    maxAltitude: 82,
    climbRate: 18,
    primaryRange: 68,
    secondaryRange: 96,
    radius: 2.5,
    vision: 172,
  });
}

export function spawnHammerheadAt(sim: GameSim, hf: Heightfield, x: number, z: number, name: string, team = 1): Entity {
  return spawnAircraftAt(sim, hf, x, z, name, team, {
    primary: 'rocketPod',
    secondary: 'bomb',
    health: 230,
    speed: 34,
    cruiseAltitude: 34,
    minAGL: 8,
    maxAltitude: 96,
    climbRate: 10,
    primaryRange: 118,
    secondaryRange: 188,
    radius: 3.8,
    vision: 138,
  });
}

interface AircraftVariant {
  primary: string;
  secondary?: string;
  primaryRange: number;
  secondaryRange?: number;
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
      bank: 0,
      verticalVelocity: 0,
    },
    weapon: { kind: variant.primary, range: variant.primaryRange, cooldown: 0 },
    weapons: {
      primary: { kind: variant.primary, range: variant.primaryRange, cooldown: 0 },
      secondary: variant.secondary ? { kind: variant.secondary, range: variant.secondaryRange ?? variant.primaryRange, cooldown: 0 } : undefined,
    },
    turret: { yaw: Math.PI * 0.25, turnRate: 4.0 },
    vision: { radius: variant.vision },
    possessable: { socketHeight: 1.6 },
    collider: { radius: variant.radius },
    armor: { kind: 'light' },
  });
}

export function issueMoveOrder(sim: GameSim, entities: Entity[], targetX: number, targetZ: number, attackMove = false, faceYaw?: number): boolean {
  let issued = false;
  const flyers = entities.filter((entity) => entity.flight);
  if (flyers.length > 0) {
    const spacing = 8;
    const width = formationWidth(flyers.length, faceYaw);
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
  const target = sim.nav.nearestWalkableCell(targetX, targetZ, 96);
  if (!target) return issued;
  const p = sim.nav.cellCenter(target.x, target.y);
  const flow = new FlowField(sim.nav, p.x, p.z);
  const spacing = 5.2;
  const width = formationWidth(groundUnits.length, faceYaw);
  groundUnits.forEach((entity, i) => {
    if (!entity.mover) return;
    const col = i % width;
    const row = Math.floor(i / width);
    const offset = formationOffset(col, row, width, groundUnits.length, spacing, faceYaw);
    entity.mover.target = { x: p.x, z: p.z };
    entity.mover.formationOffset = { x: offset.x, z: offset.z };
    entity.mover.flow = flow;
    entity.mover.attackMove = attackMove;
    entity.mover.faceYaw = faceYaw;
    entity.mover.defenseAlert = undefined;
    issued = true;
  });
  return issued;
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

export function selectedEntities(sim: GameSim): Entity[] {
  const out: Entity[] = [];
  for (const entity of sim.selectables) if (entity.selectable.selected) out.push(entity);
  return out;
}

export function setSelected(sim: GameSim, entities: Entity[], add = false): void {
  if (!add) {
    for (const entity of sim.selectables) entity.selectable.selected = false;
  }
  for (const entity of entities) {
    if (entity.selectable) entity.selectable.selected = true;
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
    let playerFlightBank: number | undefined;

    if (entity.flight) {
      if (entity.playerControlled) {
        mover.target = undefined;
        mover.formationOffset = undefined;
        mover.flow = undefined;
        mover.attackMove = false;
        const throttle = clamp(entity.playerControlled.throttle, -1, 1);
        const turn = clamp(entity.playerControlled.turn, -1, 1);
        const aimYaw = entity.playerControlled.aimYaw;
        const previousRot = transform.rot;
        transform.rot = slewAngle(transform.rot, normalizeAngle(aimYaw), 3.4, dt);
        const yawStep = normalizeAngle(transform.rot - previousRot);
        playerFlightBank = clamp(yawStep * 18 + turn * 0.18, -0.45, 0.45);
        const cruise = mover.speed * (throttle >= 0 ? throttle : throttle * 0.28);
        desiredX = Math.sin(transform.rot) * cruise;
        desiredZ = Math.cos(transform.rot) * cruise;
        if (entity.turret) entity.turret.yaw = slewAngle(entity.turret.yaw, aimYaw, entity.turret.turnRate, dt);
      } else if (mover.target) {
        const dx = mover.target.x - transform.x;
        const dz = mover.target.z - transform.z;
        const dist = Math.hypot(dx, dz);
        if (dist < mover.radius * 1.8) {
          mover.target = undefined;
          velocity.x *= 0.7;
          velocity.z *= 0.7;
        } else {
          const slow = clamp(dist / 36, 0.25, 1);
          desiredX = (dx / dist) * mover.speed * slow;
          desiredZ = (dz / dist) * mover.speed * slow;
        }
      } else if (mover.engage) {
        const dx = mover.engage.x - transform.x;
        const dz = mover.engage.z - transform.z;
        const d = Math.hypot(dx, dz);
        if (d > 2) {
          desiredX = (dx / d) * mover.speed;
          desiredZ = (dz / d) * mover.speed;
        }
        mover.engage = undefined;
      } else if (mover.faceYaw !== undefined) {
        transform.rot = slewAngle(transform.rot, mover.faceYaw, 2.8, dt);
        if (entity.turret) entity.turret.yaw = slewAngle(entity.turret.yaw, mover.faceYaw, entity.turret.turnRate, dt);
      }
    } else if (entity.playerControlled) {
      mover.target = undefined;
      mover.formationOffset = undefined;
      mover.flow = undefined;
      mover.attackMove = false;
      const throttle = Math.max(-1, Math.min(1, entity.playerControlled.throttle));
      const turn = Math.max(-1, Math.min(1, entity.playerControlled.turn));
      const turnRate = throttle === 0 ? 1.55 : 1.15;
      transform.rot = normalizeAngle(transform.rot + turn * turnRate * dt);
      const driveSpeed = mover.speed * (throttle < 0 ? 0.42 : 0.78);
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
      const commandDist = Math.hypot(mover.target.x - transform.x, mover.target.z - transform.z);
      if (finalDist < mover.radius * 1.15 || (commandDist < 42 && finalDist < 58)) {
        mover.target = undefined;
        mover.formationOffset = undefined;
        mover.flow = undefined;
      } else if (finalDist < 18) {
        desiredX = finalDx / finalDist;
        desiredZ = finalDz / finalDist;
      } else {
        const dir = mover.flow.directionAt(transform.x, transform.z);
        desiredX = dir.x;
        desiredZ = dir.z;
      }
    } else if (mover.engage) {
      // guard response set by combat: advance until back in weapon range
      const dx = mover.engage.x - transform.x;
      const dz = mover.engage.z - transform.z;
      const d = Math.hypot(dx, dz);
      if (d > 2) {
        desiredX = dx / d;
        desiredZ = dz / d;
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
    if (desiredLen > 0 && !entity.playerControlled && !entity.flight) {
      desiredX = (desiredX / desiredLen) * mover.speed;
      desiredZ = (desiredZ / desiredLen) * mover.speed;
    }
    velocity.x += (desiredX - velocity.x) * Math.min(1, dt * 8);
    velocity.z += (desiredZ - velocity.z) * Math.min(1, dt * 8);

    const nextX = transform.x + velocity.x * dt;
    const nextZ = transform.z + velocity.z * dt;
    if (entity.flight) {
      transform.x = nextX;
      transform.z = nextZ;
      const speed = Math.hypot(velocity.x, velocity.z);
      if (speed > 0.05) {
        if (entity.playerControlled) {
          const targetBank = playerFlightBank ?? 0;
          entity.flight.bank += (targetBank - entity.flight.bank) * Math.min(1, dt * 6);
        } else {
          const nextRot = Math.atan2(velocity.x, velocity.z);
          const yawDelta = normalizeAngle(nextRot - transform.rot);
          transform.rot = nextRot;
          entity.flight.bank = clamp(yawDelta * speed * 0.08, -0.45, 0.45);
        }
      } else {
        entity.flight.bank *= Math.max(0, 1 - dt * 4);
      }
      const ground = sampleHeight(hf, transform.x, transform.z);
      const ahead = sampleHeight(hf, transform.x + velocity.x * 1.5, transform.z + velocity.z * 1.5);
      const playerClimb = entity.playerControlled?.climb ?? 0;
      const baselineY = entity.playerControlled
        ? (transform.y ?? ground + entity.flight.cruiseAltitude) + playerClimb * entity.flight.climbRate * 0.85
        : ground + entity.flight.cruiseAltitude;
      const desiredY = Math.min(entity.flight.maxAltitude, Math.max(baselineY, ahead + entity.flight.minAGL, ground + entity.flight.minAGL));
      const desiredVy = clamp((desiredY - (transform.y ?? desiredY)) * 2.2, -entity.flight.climbRate, entity.flight.climbRate);
      entity.flight.verticalVelocity += (desiredVy - entity.flight.verticalVelocity) * Math.min(1, dt * 5);
      transform.y = (transform.y ?? desiredY) + entity.flight.verticalVelocity * dt;
      if (transform.y < ground + 1) {
        if (entity.health) entity.health.current = 0;
        entity.destroyed = { remaining: 20 };
        sim.events.push({ kind: 'crash', fromX: transform.x, fromZ: transform.z, toX: transform.x, toZ: transform.z, damage: 999, killed: true });
      }
    } else {
      const cell = sim.nav.worldToCell(nextX, nextZ);
      if (sim.nav.isWalkableCell(cell.x, cell.y)) {
        transform.x = nextX;
        transform.z = nextZ;
      } else {
        const xCell = sim.nav.worldToCell(nextX, transform.z);
        const zCell = sim.nav.worldToCell(transform.x, nextZ);
        if (sim.nav.isWalkableCell(xCell.x, xCell.y)) {
          transform.x = nextX;
          velocity.z = 0;
        } else if (sim.nav.isWalkableCell(zCell.x, zCell.y)) {
          transform.z = nextZ;
          velocity.x = 0;
        } else {
          velocity.x = 0;
          velocity.z = 0;
        }
      }

      const speed = Math.hypot(velocity.x, velocity.z);
      if (!entity.playerControlled && speed > 0.05) transform.rot = Math.atan2(velocity.x, velocity.z);
      transform.y = sampleHeight(hf, transform.x, transform.z);
    }
  }

  sim.tick++;
}

function formationWidth(count: number, faceYaw?: number): number {
  if (count <= 1) return 1;
  if (faceYaw === undefined) return Math.max(1, Math.ceil(Math.sqrt(count)));
  return Math.min(count, Math.max(2, Math.ceil(Math.sqrt(count) * 1.8)));
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
    if (entity.health) mix(Math.round(entity.health.current * 100));
  }
  for (const projectile of sim.projectiles) {
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
  return h >>> 0;
}
