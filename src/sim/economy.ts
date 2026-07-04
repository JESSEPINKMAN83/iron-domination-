import { STRUCTURES, UNITS, type StructureKind, type UnitKind } from '../content/phase3';
import type { Entity, ProductionJob } from './components';
import type { Heightfield } from './heightfield';
import { sampleHeight } from './heightfield';
import type { GameSim } from './world';
import { issueMoveOrder, spawnHammerheadAt, spawnScoutTankAt, spawnSiegeTankAt, spawnTankAt, spawnVultureAt, spawnWaspAt } from './world';

export type UnitProducerType = 'infantry' | 'vehicles' | 'aircraft';
export const MAX_PRODUCER_JOBS = 10;

export interface LedgerEntry {
  tick: number;
  type: 'income' | 'spend' | 'refund';
  label: string;
  amount: number;
}

export interface EconomyState {
  /** which team this economy belongs to (player = 1) */
  team: number;
  credits: number;
  /** difficulty handicap applied to ore income (AI tiers use this) */
  incomeMultiplier: number;
  powerProduced: number;
  powerUsed: number;
  ledger: LedgerEntry[];
  selectedStructure?: StructureKind;
  structureLine?: ProductionJob;
  readyStructure?: StructureKind;
  primaryProducerIds: Partial<Record<UnitProducerType, number>>;
  placement?: PlacementState;
  lastIncomeTick: number;
}

export interface PlacementState {
  kind: StructureKind;
  x: number;
  z: number;
  valid: boolean;
  reason: string;
  wallLine?: Array<{ x: number; z: number }>;
  extraCost?: number;
}

const WALL_CHAIN_MAX_SEGMENTS = 28;

export function createEconomy(team = 1, initialCredits = 4600): EconomyState {
  return {
    team,
    credits: initialCredits,
    incomeMultiplier: 1,
    powerProduced: 0,
    powerUsed: 0,
    ledger: [],
    primaryProducerIds: {},
    lastIncomeTick: 0,
  };
}

export function createInitialBase(sim: GameSim, hf: Heightfield, economy: EconomyState, atX?: number, atZ?: number): Entity {
  const x = atX ?? -hf.size * 0.08;
  const z = atZ ?? -hf.size * 0.08;
  const cell = sim.nav.nearestWalkableCell(x, z) ?? sim.nav.nearestWalkableCell(0, 0);
  if (!cell) throw new Error('no walkable base cell');
  const p = sim.nav.cellCenter(cell.x, cell.y);
  const conyard = sim.world.add({
    id: sim.nextEntityId++,
    name: 'Command Yard',
    transform: { x: p.x, z: p.z, rot: 0 },
    previousTransform: { x: p.x, z: p.z, rot: 0 },
    health: { current: 2400, max: 2400 },
    team: { id: economy.team },
    vision: { radius: 110 },
    selectable: { selected: false, type: 'building', radius: 9 },
    building: {
      kind: 'command-yard',
      label: 'Command Yard',
      footprint: { w: 9, h: 8 },
      powerProduced: 20,
      powerUsed: 0,
      complete: true,
      buildProgress: 1,
    },
    producer: { queue: [] },
    collider: { radius: 9 },
    armor: { kind: 'building' },
  });
  recomputePower(sim, economy);
  return conyard;
}

export function canBuildStructure(sim: GameSim, economy: EconomyState, kind: StructureKind): { ok: boolean; reason: string } {
  const def = STRUCTURES[kind];
  if (economy.structureLine || economy.readyStructure) return { ok: false, reason: 'Structure line busy' };
  if (economy.credits < def.cost) return { ok: false, reason: 'Insufficient credits' };
  if (def.requires && !hasStructure(sim, def.requires, economy.team)) return { ok: false, reason: `Requires ${STRUCTURES[def.requires].label}` };
  return { ok: true, reason: '' };
}

export function canQueueUnit(sim: GameSim, economy: EconomyState, kind: UnitKind): { ok: boolean; reason: string; producers: Entity[] } {
  const def = UNITS[kind];
  const producers = buildings(sim, economy.team).filter(
    (entity) => entity.building?.complete && STRUCTURES[entity.building.kind as StructureKind]?.producer === def.producer,
  );
  if (!hasStructure(sim, def.requires, economy.team)) return { ok: false, reason: `Requires ${STRUCTURES[def.requires].label}`, producers };
  if (producers.length === 0) return { ok: false, reason: 'No producer', producers };
  if (economy.credits < def.cost) return { ok: false, reason: 'Insufficient credits', producers };
  if (producers.every((entity) => queueDepth(entity) >= MAX_PRODUCER_JOBS)) return { ok: false, reason: 'Queue full', producers };
  return { ok: true, reason: '', producers };
}

export function updatePlacement(
  sim: GameSim,
  hf: Heightfield,
  kind: StructureKind,
  x: number,
  z: number,
  team = 1,
  economy?: Pick<EconomyState, 'credits'>,
): PlacementState {
  const def = STRUCTURES[kind];
  const snapped = snapToGrid(hf, x, z);
  if (kind === 'wall') return updateWallPlacement(sim, hf, snapped.x, snapped.z, team, economy);
  const blocked = footprintBlocked(sim, hf, snapped.x, snapped.z, def.footprint);
  const near = nearFriendlyStructure(sim, snapped.x, snapped.z, 92, team);
  const valid = !blocked && near;
  return {
    kind,
    x: snapped.x,
    z: snapped.z,
    valid,
    reason: blocked ? 'Blocked terrain or overlap' : near ? '' : 'Place near base',
  };
}

export function placeStructure(sim: GameSim, hf: Heightfield, economy: EconomyState, placement: PlacementState): Entity | undefined {
  const def = STRUCTURES[placement.kind];
  if (!placement.valid || economy.readyStructure !== placement.kind) return undefined;
  const points = placement.wallLine?.length ? placement.wallLine : [{ x: placement.x, z: placement.z }];
  const extraCost = placement.extraCost ?? Math.max(0, points.length - 1) * def.cost;
  if (extraCost > 0) {
    if (economy.credits < extraCost) return undefined;
    spend(economy, sim.tick, `${def.label} line`, extraCost);
  }
  let first: Entity | undefined;
  for (const point of points) {
    const entity = createPlacedStructure(sim, hf, economy, def, point.x, point.z);
    first ??= entity;
  }
  economy.readyStructure = undefined;
  recomputePower(sim, economy);
  return first;
}

function createPlacedStructure(
  sim: GameSim,
  hf: Heightfield,
  economy: EconomyState,
  def: (typeof STRUCTURES)[StructureKind],
  x: number,
  z: number,
): Entity {
  const entity = sim.world.add({
    id: sim.nextEntityId++,
    name: def.label,
    transform: { x, z, rot: 0 },
    previousTransform: { x, z, rot: 0 },
    health: { current: def.health ?? 900, max: def.health ?? 900 },
    team: { id: economy.team },
    vision: { radius: def.visionRadius ?? 90 },
    selectable: { selected: false, type: 'building', radius: Math.max(def.footprint.w, def.footprint.h) },
    building: {
      kind: def.kind,
      label: def.label,
      footprint: def.footprint,
      powerProduced: def.powerProduced,
      powerUsed: def.powerUsed,
      complete: true,
      buildProgress: 0,
    },
    producer: def.producer ? { queue: [] } : undefined,
    weapon: def.weaponKind ? { kind: def.weaponKind, range: def.weaponRange ?? 80, cooldown: 0 } : undefined,
    turret: def.weaponKind ? { yaw: 0, turnRate: 2.4 } : undefined,
    collider: { radius: def.blocksMovement ? footprintRadius(hf, def.footprint) : Math.max(def.footprint.w, def.footprint.h) },
    armor: { kind: 'building' },
  });
  if (def.blocksMovement) sim.nav.setDynamicBlocker(entity.id, entity.transform.x, entity.transform.z, entity.collider?.radius ?? 4);
  return entity;
}

export function startStructureBuild(sim: GameSim, economy: EconomyState, kind: StructureKind): boolean {
  const check = canBuildStructure(sim, economy, kind);
  if (!check.ok) return false;
  const def = STRUCTURES[kind];
  spend(economy, sim.tick, def.label, def.cost);
  economy.structureLine = { kind, label: def.label, remaining: def.buildTime, total: def.buildTime, cost: def.cost };
  economy.readyStructure = undefined;
  return true;
}

export function enterReadyStructurePlacement(sim: GameSim, hf: Heightfield, economy: EconomyState, x = 0, z = 0): boolean {
  if (!economy.readyStructure) return false;
  economy.selectedStructure = economy.readyStructure;
  economy.placement = updatePlacement(sim, hf, economy.readyStructure, x, z, economy.team);
  return true;
}

export function cancelStructureBuild(sim: GameSim, economy: EconomyState): boolean {
  const job = economy.structureLine;
  if (job) {
    economy.structureLine = undefined;
    refund(economy, sim.tick, job.label, job.cost);
    return true;
  }
  const ready = economy.readyStructure;
  if (ready) {
    const def = STRUCTURES[ready];
    economy.readyStructure = undefined;
    if (economy.selectedStructure === ready) economy.selectedStructure = undefined;
    economy.placement = undefined;
    refund(economy, sim.tick, def.label, def.cost);
    return true;
  }
  return false;
}

export function queueUnit(sim: GameSim, economy: EconomyState, kind: UnitKind, preferredProducer?: Entity): boolean {
  const check = canQueueUnit(sim, economy, kind);
  if (!check.ok) return false;
  const def = UNITS[kind];
  const primary = economy.primaryProducerIds[def.producer];
  const primaryProducer = primary ? check.producers.find((entity) => entity.id === primary) : undefined;
  const preferred = preferredProducer && check.producers.includes(preferredProducer) ? preferredProducer : primaryProducer;
  const producer = preferred ?? check.producers.reduce((best, entity) => {
    const bestDepth = queueDepth(best);
    const depth = queueDepth(entity);
    return depth < bestDepth ? entity : best;
  }, check.producers[0]);
  if (!producer.producer || queueDepth(producer) >= MAX_PRODUCER_JOBS) return false;
  spend(economy, sim.tick, def.label, def.cost);
  producer.producer.queue.push({ kind, label: def.label, remaining: def.buildTime, total: def.buildTime, cost: def.cost });
  return true;
}

export function cancelUnitQueue(sim: GameSim, economy: EconomyState, kind: UnitKind, preferredProducer?: Entity): boolean {
  const def = UNITS[kind];
  const producers = buildings(sim, economy.team).filter(
    (entity) => entity.building?.complete && entity.producer && STRUCTURES[entity.building.kind as StructureKind]?.producer === def.producer,
  );
  const ordered = preferredProducer && producers.includes(preferredProducer) ? [preferredProducer, ...producers.filter((p) => p !== preferredProducer)] : producers;
  for (const producer of ordered) {
    const queue = producer.producer?.queue;
    if (!queue) continue;
    const index = findLastIndex(queue, (job) => job.kind === kind);
    if (index >= 0) {
      const [job] = queue.splice(index, 1);
      refund(economy, sim.tick, job.label, job.cost);
      return true;
    }
  }
  for (const producer of ordered) {
    const active = producer.producer?.active;
    if (active?.kind === kind) {
      producer.producer!.active = undefined;
      refund(economy, sim.tick, active.label, active.cost);
      return true;
    }
  }
  return false;
}

export function setPrimaryProducer(economy: EconomyState, producer: Entity): boolean {
  if (!producer.producer || !producer.building?.complete) return false;
  const producerType = STRUCTURES[producer.building.kind as StructureKind]?.producer;
  if (producerType !== 'infantry' && producerType !== 'vehicles' && producerType !== 'aircraft') return false;
  if (producer.team?.id !== economy.team) return false;
  economy.primaryProducerIds[producerType] = producer.id;
  return true;
}

export function setProducerRally(sim: GameSim, economy: EconomyState, producer: Entity, x: number, z: number): { x: number; z: number } | undefined {
  if (!producer.producer || !producer.building?.complete || producer.team?.id !== economy.team) return undefined;
  const target = sim.nav.nearestWalkableCell(x, z);
  if (!target) return undefined;
  const p = sim.nav.cellCenter(target.x, target.y);
  producer.producer.rally = { x: p.x, z: p.z };
  return producer.producer.rally;
}

export function stepEconomy(sim: GameSim, hf: Heightfield, economy: EconomyState, dt: number): Entity[] {
  const spawned: Entity[] = [];
  const powered = economy.powerProduced >= economy.powerUsed;
  const productionScale = powered ? 1 : 0.45;

  const structureJob = economy.structureLine;
  if (structureJob) {
    structureJob.remaining -= dt * productionScale;
    if (structureJob.remaining <= 0) {
      economy.readyStructure = structureJob.kind as StructureKind;
      economy.structureLine = undefined;
    }
  }

  for (const entity of buildings(sim, economy.team)) {
    if (!entity.building) continue;
    if (!entity.building.complete) {
      const def = STRUCTURES[entity.building.kind as StructureKind];
      entity.building.buildProgress = Math.min(1, entity.building.buildProgress + dt / (def?.buildTime ?? 5));
      if (entity.building.buildProgress >= 1) {
        entity.building.complete = true;
        recomputePower(sim, economy);
      }
    } else if (entity.building.buildProgress < 1) {
      entity.building.buildProgress = Math.min(1, entity.building.buildProgress + dt);
    }
  }

  for (const producer of buildings(sim, economy.team)) {
    if (!producer.producer || !producer.building?.complete) continue;
    if (!producer.producer.active) producer.producer.active = producer.producer.queue.shift();
    const job = producer.producer.active;
    if (!job) continue;
    job.remaining -= dt * productionScale;
    if (job.remaining <= 0) {
      const unit = spawnProducedUnit(sim, hf, producer, job.kind as UnitKind);
      if (unit) spawned.push(unit);
      producer.producer.active = undefined;
    }
  }

  const incomePeriod = 30 * 2;
  if (sim.tick - economy.lastIncomeTick >= incomePeriod) {
    const refineries = buildings(sim, economy.team).filter((entity) => entity.building?.kind === 'refinery' && entity.building.complete).length;
    if (refineries > 0) {
      const amount = Math.round(refineries * 140 * economy.incomeMultiplier);
      economy.credits += amount;
      economy.ledger.push({ tick: sim.tick, type: 'income', label: 'Ore delivered', amount });
    }
    economy.lastIncomeTick = sim.tick;
  }
  recomputePower(sim, economy);
  return spawned;
}

export function buildings(sim: GameSim, team?: number): Entity[] {
  return Array.from(sim.world.entities).filter((entity) => entity.building && (team === undefined || entity.team?.id === team));
}

export function hasStructure(sim: GameSim, kind: StructureKind, team = 1): boolean {
  return buildings(sim, team).some((entity) => entity.building?.kind === kind && entity.building.complete);
}

export function recomputePower(sim: GameSim, economy: EconomyState): void {
  economy.powerProduced = 0;
  economy.powerUsed = 0;
  for (const entity of buildings(sim, economy.team)) {
    if (!entity.building?.complete) continue;
    economy.powerProduced += entity.building.powerProduced;
    economy.powerUsed += entity.building.powerUsed;
  }
}

function spend(economy: EconomyState, tick: number, label: string, amount: number): void {
  economy.credits -= amount;
  economy.ledger.push({ tick, type: 'spend', label, amount: -amount });
}

function refund(economy: EconomyState, tick: number, label: string, amount: number): void {
  economy.credits += amount;
  economy.ledger.push({ tick, type: 'refund', label: `${label} refund`, amount });
}

function queueDepth(entity: Entity): number {
  return (entity.producer?.queue.length ?? 0) + (entity.producer?.active ? 1 : 0);
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (predicate(items[i])) return i;
  return -1;
}

function spawnProducedUnit(sim: GameSim, hf: Heightfield, producer: Entity, kind: UnitKind): Entity | undefined {
  const team = producer.team?.id ?? 1;
  const p = sim.nav.nearestWalkableCell(producer.transform.x + 14, producer.transform.z + 9, 24);
  if (!p) return undefined;
  const pos = sim.nav.cellCenter(p.x, p.y);
  let entity: Entity | undefined;
  const suffix = sim.world.entities.length + 1;
  if (kind === 'scout-tank') entity = spawnScoutTankAt(sim, pos.x, pos.z, `${team === 2 ? 'Ash Jackal' : 'Jackal'} ${suffix}`, team);
  else if (kind === 'tank') entity = spawnTankAt(sim, pos.x, pos.z, `${team === 2 ? 'Ash M-17' : 'M-17'} ${suffix}`, team);
  else if (kind === 'siege-tank') entity = spawnSiegeTankAt(sim, pos.x, pos.z, `${team === 2 ? 'Ash Mauler' : 'Mauler'} ${suffix}`, team);
  else if (kind === 'wasp') entity = spawnWaspAt(sim, hf, pos.x, pos.z, `${team === 2 ? 'Ash Wasp' : 'Wasp'} ${suffix}`, team);
  else if (kind === 'vulture') entity = spawnVultureAt(sim, hf, pos.x, pos.z, `${team === 2 ? 'Ash Vulture' : 'Vulture'} ${suffix}`, team);
  else if (kind === 'hammerhead') entity = spawnHammerheadAt(sim, hf, pos.x, pos.z, `${team === 2 ? 'Ash Hammerhead' : 'Hammerhead'} ${suffix}`, team);
  else entity = spawnInfantryAt(sim, pos.x, pos.z, team, kind);
  if (!entity) return undefined;
  void sampleHeight(hf, pos.x, pos.z);
  orderToRally(sim, producer, entity);
  return entity;
}

function spawnInfantryAt(sim: GameSim, x: number, z: number, team: number, kind: UnitKind): Entity {
  const config =
    kind === 'grenadier'
      ? { label: 'Grenadier', enemyLabel: 'Ash Grenadier', weapon: 'grenade', range: 48, health: 52, speed: 11, vision: 82 }
      : kind === 'rocket-infantry'
        ? { label: 'Rocket Team', enemyLabel: 'Ash Rockets', weapon: 'rocketLauncher', range: 72, health: 50, speed: 10, vision: 94 }
        : { label: 'Rifle Team', enemyLabel: 'Ash Rifles', weapon: 'rifle', range: 42, health: 45, speed: 12, vision: 78 };
  const entity = sim.world.add({
    id: sim.nextEntityId++,
    name: team === 2 ? config.enemyLabel : config.label,
    transform: { x, z, rot: Math.PI * 0.25 },
    previousTransform: { x, z, rot: Math.PI * 0.25 },
    velocity: { x: 0, z: 0 },
    health: { current: config.health, max: config.health },
    team: { id: team },
    selectable: { selected: false, type: 'infantry', radius: 1.4 },
    mover: { speed: config.speed, radius: 1.1 },
    weapon: { kind: config.weapon, range: config.range, cooldown: 0 },
    // soldiers aim with their upper body — same slew path as a (fast) turret
    turret: { yaw: Math.PI * 0.25, turnRate: 5.5 },
    vision: { radius: config.vision },
    possessable: { socketHeight: 1.7 },
    collider: { radius: 1.1 },
    armor: { kind: 'infantry' },
  });
  return entity;
}

function orderToRally(sim: GameSim, producer: Entity, entity: Entity): void {
  const rally = producer.producer?.rally;
  if (!rally) return;
  issueMoveOrder(sim, [entity], rally.x, rally.z, false);
}

function snapToGrid(hf: Heightfield, x: number, z: number): { x: number; z: number } {
  const g = hf.cellSize * 2;
  return { x: Math.round(x / g) * g, z: Math.round(z / g) * g };
}

function updateWallPlacement(
  sim: GameSim,
  hf: Heightfield,
  x: number,
  z: number,
  team: number,
  economy?: Pick<EconomyState, 'credits'>,
): PlacementState {
  const def = STRUCTURES.wall;
  const chain = bestWallChain(sim, hf, x, z, team);
  if (chain) {
    const missing = chain.points.filter((point) => !existingWallAt(sim, point.x, point.z, team));
    const blocked = missing.some((point) => wallFootprintBlocked(sim, hf, point.x, point.z, team));
    const extraCost = Math.max(0, missing.length - 1) * def.cost;
    const affordable = economy ? economy.credits >= extraCost : true;
    const valid = missing.length > 0 && !blocked && affordable;
    return {
      kind: 'wall',
      x: chain.end.x,
      z: chain.end.z,
      valid,
      reason: missing.length === 0 ? 'Already walled' : blocked ? 'Wall line blocked' : affordable ? '' : `Needs $${extraCost}`,
      wallLine: missing,
      extraCost,
    };
  }

  const blocked = wallFootprintBlocked(sim, hf, x, z, team);
  const near = nearFriendlyStructure(sim, x, z, 92, team);
  return {
    kind: 'wall',
    x,
    z,
    valid: !blocked && near,
    reason: blocked ? 'Blocked terrain or overlap' : near ? '' : 'Place near base',
    wallLine: [{ x, z }],
    extraCost: 0,
  };
}

function bestWallChain(
  sim: GameSim,
  hf: Heightfield,
  x: number,
  z: number,
  team: number,
): { end: { x: number; z: number }; points: Array<{ x: number; z: number }>; score: number } | undefined {
  const g = hf.cellSize * 2;
  let best: { end: { x: number; z: number }; points: Array<{ x: number; z: number }>; score: number } | undefined;
  for (const wall of buildings(sim, team)) {
    if (wall.building?.kind !== 'wall' || !wall.building.complete) continue;
    if (!isOpenWallEnd(sim, hf, wall.transform.x, wall.transform.z, team)) continue;
    const chain = wallChainFromAnchor(hf, wall.transform.x, wall.transform.z, x, z);
    if (!chain || chain.points.length > WALL_CHAIN_MAX_SEGMENTS || chain.score > g * 1.55) continue;
    const first = chain.points[0];
    if (existingWallAt(sim, first.x, first.z, team)) continue;
    if (!best || chain.score < best.score) best = chain;
  }
  return best;
}

function isOpenWallEnd(sim: GameSim, hf: Heightfield, x: number, z: number, team: number): boolean {
  return wallNeighborCount(sim, hf, x, z, team) <= 1;
}

function wallNeighborCount(sim: GameSim, hf: Heightfield, x: number, z: number, team: number): number {
  const g = hf.cellSize * 2;
  let count = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      if (existingWallAt(sim, x + dx * g, z + dz * g, team)) count++;
    }
  }
  return count;
}

function wallChainFromAnchor(
  hf: Heightfield,
  anchorX: number,
  anchorZ: number,
  targetX: number,
  targetZ: number,
): { end: { x: number; z: number }; points: Array<{ x: number; z: number }>; score: number } | undefined {
  const g = hf.cellSize * 2;
  const dxSteps = Math.round((targetX - anchorX) / g);
  const dzSteps = Math.round((targetZ - anchorZ) / g);
  const absX = Math.abs(dxSteps);
  const absZ = Math.abs(dzSteps);
  if (absX === 0 && absZ === 0) return undefined;

  let stepX = 0;
  let stepZ = 0;
  let steps = 0;
  if (absX >= absZ * 2) {
    stepX = Math.sign(dxSteps);
    steps = absX;
  } else if (absZ >= absX * 2) {
    stepZ = Math.sign(dzSteps);
    steps = absZ;
  } else {
    stepX = Math.sign(dxSteps);
    stepZ = Math.sign(dzSteps);
    steps = Math.max(absX, absZ);
  }
  if (steps < 2) return undefined;

  const points: Array<{ x: number; z: number }> = [];
  for (let i = 1; i <= steps; i++) {
    points.push({ x: anchorX + stepX * g * i, z: anchorZ + stepZ * g * i });
  }
  const end = points[points.length - 1];
  return { end, points, score: Math.hypot(end.x - targetX, end.z - targetZ) };
}

function footprintBlocked(sim: GameSim, hf: Heightfield, x: number, z: number, footprint: { w: number; h: number }): boolean {
  const halfW = footprint.w * hf.cellSize;
  const halfH = footprint.h * hf.cellSize;
  for (let dz = -halfH; dz <= halfH; dz += hf.cellSize * 2) {
    for (let dx = -halfW; dx <= halfW; dx += hf.cellSize * 2) {
      const cell = sim.nav.worldToCell(x + dx, z + dz);
      if (!sim.nav.isWalkableCell(cell.x, cell.y)) return true;
    }
  }
  const radius = Math.hypot(halfW, halfH);
  return buildings(sim).some((entity) => Math.hypot(entity.transform.x - x, entity.transform.z - z) < (entity.collider?.radius ?? 5) + radius);
}

function wallFootprintBlocked(sim: GameSim, hf: Heightfield, x: number, z: number, team: number): boolean {
  const footprint = STRUCTURES.wall.footprint;
  const halfW = footprint.w * hf.cellSize;
  const halfH = footprint.h * hf.cellSize;
  for (let dz = -halfH; dz <= halfH; dz += hf.cellSize * 2) {
    for (let dx = -halfW; dx <= halfW; dx += hf.cellSize * 2) {
      const cell = sim.nav.worldToCell(x + dx, z + dz);
      if (!sim.nav.inBounds(cell.x, cell.y) || hf.walkable[sim.nav.index(cell.x, cell.y)] === 0) return true;
    }
  }
  const radius = Math.hypot(halfW, halfH);
  return buildings(sim).some((entity) => {
    if (entity.building?.kind === 'wall' && entity.team?.id === team) return false;
    return Math.hypot(entity.transform.x - x, entity.transform.z - z) < (entity.collider?.radius ?? 5) + radius;
  });
}

function existingWallAt(sim: GameSim, x: number, z: number, team: number): boolean {
  return buildings(sim, team).some(
    (entity) => entity.building?.kind === 'wall' && entity.building.complete && Math.hypot(entity.transform.x - x, entity.transform.z - z) < 0.1,
  );
}

function nearFriendlyStructure(sim: GameSim, x: number, z: number, radius: number, team: number): boolean {
  return buildings(sim, team).some((entity) => entity.building?.complete && Math.hypot(entity.transform.x - x, entity.transform.z - z) <= radius);
}

function footprintRadius(hf: Heightfield, footprint: { w: number; h: number }): number {
  return Math.hypot(footprint.w * hf.cellSize, footprint.h * hf.cellSize);
}
