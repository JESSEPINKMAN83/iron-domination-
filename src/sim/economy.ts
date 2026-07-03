import { STRUCTURES, UNITS, type StructureKind, type UnitKind } from '../content/phase3';
import type { Entity } from './components';
import type { Heightfield } from './heightfield';
import { sampleHeight } from './heightfield';
import type { GameSim } from './world';
import { spawnTankAt } from './world';

export interface LedgerEntry {
  tick: number;
  type: 'income' | 'spend' | 'refund';
  label: string;
  amount: number;
}

export interface EconomyState {
  credits: number;
  powerProduced: number;
  powerUsed: number;
  ledger: LedgerEntry[];
  selectedStructure?: StructureKind;
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

let nextBuildingId = 10000;

export function createEconomy(initialCredits = 4600): EconomyState {
  return {
    credits: initialCredits,
    powerProduced: 0,
    powerUsed: 0,
    ledger: [],
    lastIncomeTick: 0,
  };
}

export function createInitialBase(sim: GameSim, hf: Heightfield, economy: EconomyState): Entity {
  const cell = sim.nav.nearestWalkableCell(-hf.size * 0.08, -hf.size * 0.08) ?? sim.nav.nearestWalkableCell(0, 0);
  if (!cell) throw new Error('no walkable base cell');
  const p = sim.nav.cellCenter(cell.x, cell.y);
  const conyard = sim.world.add({
    id: nextBuildingId++,
    name: 'Command Yard',
    transform: { x: p.x, z: p.z, rot: 0 },
    previousTransform: { x: p.x, z: p.z, rot: 0 },
    health: { current: 2400, max: 2400 },
    team: { id: 1 },
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
  });
  recomputePower(sim, economy);
  return conyard;
}

export function canBuildStructure(sim: GameSim, economy: EconomyState, kind: StructureKind): { ok: boolean; reason: string } {
  const def = STRUCTURES[kind];
  if (economy.credits < def.cost) return { ok: false, reason: 'Insufficient credits' };
  if (def.requires && !hasStructure(sim, def.requires)) return { ok: false, reason: `Requires ${STRUCTURES[def.requires].label}` };
  return { ok: true, reason: '' };
}

export function canQueueUnit(sim: GameSim, economy: EconomyState, kind: UnitKind): { ok: boolean; reason: string; producers: Entity[] } {
  const def = UNITS[kind];
  const producers = buildings(sim).filter((entity) => entity.building?.complete && STRUCTURES[entity.building.kind as StructureKind]?.producer === def.producer);
  if (!hasStructure(sim, def.requires)) return { ok: false, reason: `Requires ${STRUCTURES[def.requires].label}`, producers };
  if (producers.length === 0) return { ok: false, reason: 'No producer', producers };
  if (economy.credits < def.cost) return { ok: false, reason: 'Insufficient credits', producers };
  return { ok: true, reason: '', producers };
}

export function updatePlacement(sim: GameSim, hf: Heightfield, kind: StructureKind, x: number, z: number): PlacementState {
  const def = STRUCTURES[kind];
  const snapped = snapToGrid(hf, x, z);
  const blocked = footprintBlocked(sim, hf, snapped.x, snapped.z, def.footprint);
  const near = nearFriendlyStructure(sim, snapped.x, snapped.z, 92);
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
  const affordable = canBuildStructure(sim, economy, placement.kind);
  if (!placement.valid || !affordable.ok) return undefined;
  spend(economy, sim.tick, def.label, def.cost);
  const entity = sim.world.add({
    id: nextBuildingId++,
    name: def.label,
    transform: { x: placement.x, z: placement.z, rot: 0 },
    previousTransform: { x: placement.x, z: placement.z, rot: 0 },
    health: { current: 900, max: 900 },
    team: { id: 1 },
    selectable: { selected: false, type: 'building', radius: Math.max(def.footprint.w, def.footprint.h) },
    building: {
      kind: def.kind,
      label: def.label,
      footprint: def.footprint,
      powerProduced: def.powerProduced,
      powerUsed: def.powerUsed,
      complete: false,
      buildProgress: 0,
    },
    producer: def.producer ? { queue: [] } : undefined,
    collider: { radius: Math.max(def.footprint.w, def.footprint.h) },
  });
  return entity;
}

export function queueUnit(sim: GameSim, economy: EconomyState, kind: UnitKind): boolean {
  const check = canQueueUnit(sim, economy, kind);
  if (!check.ok) return false;
  const producer = check.producers.reduce((best, entity) => {
    const bestDepth = (best.producer?.queue.length ?? 0) + (best.producer?.active ? 1 : 0);
    const depth = (entity.producer?.queue.length ?? 0) + (entity.producer?.active ? 1 : 0);
    return depth < bestDepth ? entity : best;
  }, check.producers[0]);
  if (!producer.producer || producer.producer.queue.length >= 5) return false;
  const def = UNITS[kind];
  spend(economy, sim.tick, def.label, def.cost);
  producer.producer.queue.push({ kind, label: def.label, remaining: def.buildTime, total: def.buildTime, cost: def.cost });
  return true;
}

export function stepEconomy(sim: GameSim, hf: Heightfield, economy: EconomyState, dt: number): Entity[] {
  const spawned: Entity[] = [];
  for (const entity of buildings(sim)) {
    if (!entity.building) continue;
    if (!entity.building.complete) {
      const def = STRUCTURES[entity.building.kind as StructureKind];
      entity.building.buildProgress = Math.min(1, entity.building.buildProgress + dt / (def?.buildTime ?? 5));
      if (entity.building.buildProgress >= 1) {
        entity.building.complete = true;
        recomputePower(sim, economy);
      }
    }
  }

  const powered = economy.powerProduced >= economy.powerUsed;
  const productionScale = powered ? 1 : 0.45;
  for (const producer of buildings(sim)) {
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
    const refineries = buildings(sim).filter((entity) => entity.building?.kind === 'refinery' && entity.building.complete).length;
    if (refineries > 0) {
      const amount = refineries * 140;
      economy.credits += amount;
      economy.ledger.push({ tick: sim.tick, type: 'income', label: 'Ore delivered', amount });
    }
    economy.lastIncomeTick = sim.tick;
  }
  recomputePower(sim, economy);
  return spawned;
}

export function buildings(sim: GameSim): Entity[] {
  return Array.from(sim.world.entities).filter((entity) => entity.building);
}

export function hasStructure(sim: GameSim, kind: StructureKind): boolean {
  return buildings(sim).some((entity) => entity.building?.kind === kind && entity.building.complete);
}

export function recomputePower(sim: GameSim, economy: EconomyState): void {
  economy.powerProduced = 0;
  economy.powerUsed = 0;
  for (const entity of buildings(sim)) {
    if (!entity.building?.complete) continue;
    economy.powerProduced += entity.building.powerProduced;
    economy.powerUsed += entity.building.powerUsed;
  }
}

function spend(economy: EconomyState, tick: number, label: string, amount: number): void {
  economy.credits -= amount;
  economy.ledger.push({ tick, type: 'spend', label, amount: -amount });
}

function spawnProducedUnit(sim: GameSim, hf: Heightfield, producer: Entity, kind: UnitKind): Entity | undefined {
  const p = sim.nav.nearestWalkableCell(producer.transform.x + 14, producer.transform.z + 9, 24);
  if (!p) return undefined;
  const pos = sim.nav.cellCenter(p.x, p.y);
  if (kind === 'tank') return spawnTankAt(sim, pos.x, pos.z, `M-17 ${sim.world.entities.length + 1}`);
  const entity = sim.world.add({
    id: 20000 + sim.world.entities.length,
    name: 'Rifle Team',
    transform: { x: pos.x, z: pos.z, rot: Math.PI * 0.25 },
    previousTransform: { x: pos.x, z: pos.z, rot: Math.PI * 0.25 },
    velocity: { x: 0, z: 0 },
    health: { current: 45, max: 45 },
    team: { id: 1 },
    selectable: { selected: false, type: 'infantry', radius: 1.4 },
    mover: { speed: 12, radius: 1.1 },
    weapon: { kind: 'rifle', range: 42, cooldown: 0 },
    vision: { radius: 78 },
    possessable: { socketHeight: 1.7 },
    collider: { radius: 1.1 },
  });
  void sampleHeight(hf, pos.x, pos.z);
  return entity;
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

function nearFriendlyStructure(sim: GameSim, x: number, z: number, radius: number): boolean {
  return buildings(sim).some((entity) => entity.building?.complete && Math.hypot(entity.transform.x - x, entity.transform.z - z) <= radius);
}
