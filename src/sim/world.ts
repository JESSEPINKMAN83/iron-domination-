import { World, type Query, type With } from 'miniplex';
import { normalizeAngle, slewAngle } from './angles';
import type { Entity } from './components';
import { copyTransform } from './components';
import { FlowField, NavigationGrid, type BlockedFootprint } from './flowfield';
import { sampleHeight, type Heightfield } from './heightfield';
import { mulberry32 } from './noise';

export interface CombatEvent {
  kind: string;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  damage: number;
  killed: boolean;
  /** flight time in seconds for ballistic launches ('bomb') */
  duration?: number;
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

export interface GameSim {
  world: World<Entity>;
  nav: NavigationGrid;
  movers: Query<With<Entity, 'transform' | 'previousTransform' | 'velocity' | 'mover'>>;
  selectables: Query<With<Entity, 'transform' | 'selectable'>>;
  events: CombatEvent[];
  projectiles: Projectile[];
  tick: number;
}

let nextEntityId = 1;

export function createGameSim(hf: Heightfield, footprints: BlockedFootprint[] = []): GameSim {
  nextEntityId = 1;
  const world = new World<Entity>();
  return {
    world,
    nav: new NavigationGrid(hf, footprints),
    movers: world.with('transform', 'previousTransform', 'velocity', 'mover'),
    selectables: world.with('transform', 'selectable'),
    events: [],
    projectiles: [],
    tick: 0,
  };
}

export function spawnDebugTanks(sim: GameSim, hf: Heightfield, count = 120, seed = 0x2a11): Entity[] {
  const rng = mulberry32(seed);
  const spawned: Entity[] = [];
  const start = sim.nav.nearestWalkableCell(-hf.size * 0.04, -hf.size * 0.04) ?? sim.nav.nearestWalkableCell(0, 0);
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

export function spawnTankAt(sim: GameSim, x: number, z: number, name: string, team = 1): Entity {
  const primaryWeapon = { kind: 'cannon', range: 78, cooldown: 0 };
  return sim.world.add({
    id: nextEntityId++,
    name,
    transform: { x, z, rot: Math.PI * 0.25 },
    previousTransform: { x, z, rot: Math.PI * 0.25 },
    velocity: { x: 0, z: 0 },
    health: { current: 100, max: 100 },
    team: { id: team },
    selectable: { selected: false, type: 'tank', radius: 2.4 },
    mover: { speed: 18, radius: 2.2 },
    weapon: primaryWeapon,
    weapons: {
      primary: primaryWeapon,
      secondary: { kind: 'bomb', range: 152, cooldown: 0 },
    },
    turret: { yaw: Math.PI * 0.25, turnRate: 2.2 },
    vision: { radius: 120 },
    possessable: { socketHeight: 2.4 },
    collider: { radius: 2.2 },
    armor: { kind: 'heavy' },
  });
}

export function issueMoveOrder(sim: GameSim, entities: Entity[], targetX: number, targetZ: number, attackMove = false): void {
  const target = sim.nav.nearestWalkableCell(targetX, targetZ);
  if (!target) return;
  const p = sim.nav.cellCenter(target.x, target.y);
  const flow = new FlowField(sim.nav, p.x, p.z);
  const spacing = 5.2;
  const width = Math.max(1, Math.ceil(Math.sqrt(entities.length)));
  entities.forEach((entity, i) => {
    if (!entity.mover) return;
    const col = i % width;
    const row = Math.floor(i / width);
    const ox = (col - (width - 1) / 2) * spacing;
    const oz = (row - Math.floor(entities.length / width) / 2) * spacing;
    entity.mover.target = { x: p.x, z: p.z };
    entity.mover.formationOffset = { x: ox, z: oz };
    entity.mover.flow = flow;
    entity.mover.attackMove = attackMove;
  });
}

export function stopEntities(entities: Entity[]): void {
  for (const entity of entities) {
    if (!entity.mover || !entity.velocity) continue;
    entity.mover.target = undefined;
    entity.mover.formationOffset = undefined;
    entity.mover.flow = undefined;
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
    let desiredX = 0;
    let desiredZ = 0;

    if (entity.playerControlled) {
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
    }

    for (let j = 0; j < movers.length; j++) {
      if (i === j) continue;
      const other = movers[j];
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
    void sampleHeight(hf, transform.x, transform.z);
  }

  sim.tick++;
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
  return h >>> 0;
}
