import { FlowField, type DynamicBlockerSnapshot } from './flowfield';
import type { Entity, StructureDamage } from './components';
import type { EconomyState } from './economy';
import type { Heightfield } from './heightfield';
import { createGameSim, type GameSim, type Projectile, type ResourceNode, type CombatEvent } from './world';

export const MATCH_STATE_VERSION = 1;

export interface SerializedStructureDamage extends Omit<StructureDamage, 'cells'> {
  cells: number[];
}

export type SerializedEntity = Omit<Entity, 'structureDamage'> & {
  structureDamage?: SerializedStructureDamage;
};

export interface SerializedGameSim {
  version: typeof MATCH_STATE_VERSION;
  tick: number;
  nextEntityId: number;
  rules: GameSim['rules'];
  entities: SerializedEntity[];
  projectiles: Projectile[];
  resourceNodes: ResourceNode[];
  events: CombatEvent[];
  dynamicBlockers: DynamicBlockerSnapshot[];
}

export interface SerializedEconomyState extends Omit<EconomyState, 'pendingSpawned'> {
  pendingSpawnedIds: number[];
}

export interface SerializedMatchState {
  version: typeof MATCH_STATE_VERSION;
  sim: SerializedGameSim;
  economies: SerializedEconomyState[];
}

export function serializeMatchState(sim: GameSim, economies: Iterable<EconomyState>): SerializedMatchState {
  return {
    version: MATCH_STATE_VERSION,
    sim: serializeSim(sim),
    economies: Array.from(economies).map(serializeEconomy),
  };
}

export function serializeSim(sim: GameSim): SerializedGameSim {
  return {
    version: MATCH_STATE_VERSION,
    tick: sim.tick,
    nextEntityId: sim.nextEntityId,
    rules: clonePlain(sim.rules),
    entities: Array.from(sim.world.entities)
      .sort((a, b) => a.id - b.id)
      .map(serializeEntity),
    projectiles: clonePlain(sim.projectiles),
    resourceNodes: clonePlain(sim.resourceNodes),
    events: clonePlain(sim.events),
    dynamicBlockers: sim.nav.snapshotDynamicBlockers(),
  };
}

export function loadSerializedSim(hf: Heightfield, state: SerializedGameSim): GameSim {
  const sim = createGameSim(hf);
  restoreSerializedSim(sim, hf, state);
  return sim;
}

export function restoreSerializedSim(sim: GameSim, hf: Heightfield, state: SerializedGameSim): void {
  assertVersion(state.version);
  for (const entity of Array.from(sim.world.entities)) sim.world.remove(entity);
  sim.nav.restoreDynamicBlockers(state.dynamicBlockers ?? []);
  sim.projectiles.splice(0, sim.projectiles.length, ...clonePlain(state.projectiles));
  sim.resourceNodes.splice(0, sim.resourceNodes.length, ...clonePlain(state.resourceNodes));
  sim.events.splice(0, sim.events.length, ...clonePlain(state.events));
  sim.tick = state.tick;
  sim.nextEntityId = state.nextEntityId;
  sim.rules = clonePlain(state.rules);
  for (const entity of state.entities) sim.world.add(restoreEntity(sim, hf, entity));
}

export function serializeEconomy(economy: EconomyState): SerializedEconomyState {
  const { pendingSpawned: _pendingSpawned, ...rest } = economy;
  return {
    ...clonePlain(rest),
    pendingSpawnedIds: economy.pendingSpawned.map((entity) => entity.id),
  };
}

export function restoreEconomyState(target: EconomyState, sim: GameSim, state: SerializedEconomyState): void {
  const { pendingSpawnedIds, ...rest } = state;
  const restored = rest as EconomyState;
  target.team = restored.team;
  target.credits = restored.credits;
  target.incomeMultiplier = restored.incomeMultiplier;
  target.powerProduced = restored.powerProduced;
  target.powerUsed = restored.powerUsed;
  target.ledger = clonePlain(restored.ledger);
  target.selectedStructure = restored.selectedStructure;
  target.structureLine = clonePlain(restored.structureLine);
  target.readyStructure = restored.readyStructure;
  target.primaryProducerIds = clonePlain(restored.primaryProducerIds);
  target.placement = clonePlain(restored.placement);
  target.harvesterReplacementTimers = clonePlain(restored.harvesterReplacementTimers);
  target.pendingSpawned = pendingSpawnedIds.map((id) => sim.byId.get(id)).filter((entity): entity is Entity => entity !== undefined);
}

function serializeEntity(entity: Entity): SerializedEntity {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entity)) {
    if (value === undefined) continue;
    if (key === 'mover' && entity.mover) {
      const { flow: _flow, ...mover } = entity.mover;
      out.mover = clonePlain(mover);
    } else if (key === 'structureDamage' && entity.structureDamage) {
      out.structureDamage = {
        ...entity.structureDamage,
        cells: Array.from(entity.structureDamage.cells),
      };
    } else {
      out[key] = clonePlain(value);
    }
  }
  return out as SerializedEntity;
}

function restoreEntity(sim: GameSim, hf: Heightfield, serialized: SerializedEntity): Entity {
  const entity = clonePlain(serialized) as Entity;
  if (serialized.structureDamage) {
    entity.structureDamage = {
      ...serialized.structureDamage,
      cells: new Uint8Array(serialized.structureDamage.cells),
    };
  }
  if (entity.mover?.target && !entity.flight) {
    try {
      entity.mover.flow = new FlowField(sim.nav, entity.mover.target.x, entity.mover.target.z);
    } catch {
      entity.mover.flow = undefined;
    }
  }
  if (entity.transform.y === undefined) entity.transform.y = entity.flight ? entity.transform.y : undefined;
  void hf;
  return entity;
}

function assertVersion(version: number): void {
  if (version !== MATCH_STATE_VERSION) throw new Error(`unsupported match state version ${version}`);
}

function clonePlain<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}
