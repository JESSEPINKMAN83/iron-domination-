import { STRUCTURES, UNITS, type StructureKind, type UnitKind } from '../content/phase3';
import type { Entity, ProductionJob } from './components';
import type { Heightfield } from './heightfield';
import { sampleHeight } from './heightfield';
import type { GameSim } from './world';
import { issueMoveOrder, spawnTankAt } from './world';

export type UnitProducerType = 'infantry' | 'vehicles';
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
}

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

export function updatePlacement(sim: GameSim, hf: Heightfield, kind: StructureKind, x: number, z: number, team = 1): PlacementState {
  const def = STRUCTURES[kind];
  const snapped = snapToGrid(hf, x, z);
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
  const entity = sim.world.add({
    id: sim.nextEntityId++,
    name: def.label,
    transform: { x: placement.x, z: placement.z, rot: 0 },
    previousTransform: { x: placement.x, z: placement.z, rot: 0 },
    health: { current: 900, max: 900 },
    team: { id: economy.team },
    vision: { radius: 90 },
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
    collider: { radius: Math.max(def.footprint.w, def.footprint.h) },
    armor: { kind: 'building' },
  });
  economy.readyStructure = undefined;
  recomputePower(sim, economy);
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
  if (producerType !== 'infantry' && producerType !== 'vehicles') return false;
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
  const designation = team === 2 ? 'Ash' : 'M-17';
  if (kind === 'tank') {
    const tank = spawnTankAt(sim, pos.x, pos.z, `${designation} ${sim.world.entities.length + 1}`, team);
    orderToRally(sim, producer, tank);
    return tank;
  }
  const entity = sim.world.add({
    id: sim.nextEntityId++,
    name: team === 2 ? 'Ash Rifles' : 'Rifle Team',
    transform: { x: pos.x, z: pos.z, rot: Math.PI * 0.25 },
    previousTransform: { x: pos.x, z: pos.z, rot: Math.PI * 0.25 },
    velocity: { x: 0, z: 0 },
    health: { current: 45, max: 45 },
    team: { id: team },
    selectable: { selected: false, type: 'infantry', radius: 1.4 },
    mover: { speed: 12, radius: 1.1 },
    weapon: { kind: 'rifle', range: 42, cooldown: 0 },
    // soldiers aim with their upper body — same slew path as a (fast) turret
    turret: { yaw: Math.PI * 0.25, turnRate: 5.5 },
    vision: { radius: 78 },
    possessable: { socketHeight: 1.7 },
    collider: { radius: 1.1 },
    armor: { kind: 'infantry' },
  });
  void sampleHeight(hf, pos.x, pos.z);
  orderToRally(sim, producer, entity);
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

function nearFriendlyStructure(sim: GameSim, x: number, z: number, radius: number, team: number): boolean {
  return buildings(sim, team).some((entity) => entity.building?.complete && Math.hypot(entity.transform.x - x, entity.transform.z - z) <= radius);
}
