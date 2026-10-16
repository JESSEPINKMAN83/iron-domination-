import { STRUCTURES, type StructureKind, type UnitKind } from '../content/phase3';
import type { Entity } from '../sim/components';
import { placeStructure, recomputePower, spawnInfantryAt, updatePlacement, type EconomyState } from '../sim/economy';
import type { Heightfield } from '../sim/heightfield';
import type { GameSim } from '../sim/world';

// Late-game base mix used by the local `?stress-bases=N` performance scenario.
const LATE_GAME_BASE: readonly StructureKind[] = [
  'power-plant', 'refinery', 'barracks', 'factory', 'power-plant', 'helipad',
  'guard-tower', 'aa-tower', 'power-plant', 'refinery', 'intelligence-center',
  'missile-defense', 'guard-tower', 'skylance-ciws', 'factory', 'power-plant',
  'aa-tower', 'barracks', 'guard-tower', 'strategic-silo', 'power-plant',
  'helipad', 'refinery', 'guard-tower', 'aa-tower', 'factory', 'power-plant',
];

const STRESS_INFANTRY: readonly UnitKind[] = ['infantry', 'grenadier', 'sniper', 'rocket-infantry'];

/** Fill a base with structures on the first valid spots of a spiral around its command yard. */
export function spawnStressBase(
  sim: GameSim,
  hf: Heightfield,
  economy: EconomyState,
  base: Entity,
  count: number,
): Entity[] {
  const placed: Entity[] = [];
  let ring = 0;
  for (let i = 0; i < count; i++) {
    const kind = LATE_GAME_BASE[i % LATE_GAME_BASE.length];
    let entity: Entity | undefined;
    for (let attempt = 0; attempt < 80 && !entity; attempt++, ring++) {
      const angle = ring * 2.399963; // golden angle spiral
      const radius = 26 + Math.sqrt(ring) * 13;
      const placement = updatePlacement(
        sim,
        hf,
        kind,
        base.transform.x + Math.cos(angle) * radius,
        base.transform.z + Math.sin(angle) * radius,
        economy.team,
      );
      if (!placement.valid) continue;
      if (STRUCTURES[kind].tab === 'defense') economy.readyDefenseStructure = kind;
      else economy.readyStructure = kind;
      entity = placeStructure(sim, hf, economy, placement);
    }
    if (entity) placed.push(entity);
  }
  recomputePower(sim, economy);
  return placed;
}

export function spawnStressInfantry(sim: GameSim, base: Entity, team: number, count: number): Entity[] {
  const units: Entity[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / 10);
    units.push(spawnInfantryAt(
      sim,
      base.transform.x + (i % 10 - 4.5) * 5,
      base.transform.z - 60 - row * 5,
      team,
      STRESS_INFANTRY[i % STRESS_INFANTRY.length],
    ));
  }
  return units;
}
