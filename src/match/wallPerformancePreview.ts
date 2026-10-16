import { STRUCTURES } from '../content/phase3';
import { placeStructure, spawnInfantryAt, type EconomyState } from '../sim/economy';
import type { Heightfield } from '../sim/heightfield';
import type { GameSim } from '../sim/world';

/** Reproduce a long fence with almost no units or combat, on localhost only. */
export function stageWallPerformancePreview(sim: GameSim, hf: Heightfield, economy: EconomyState) {
  // Keep the benchmark fence away from both armies' real starting buildings.
  const focus = { x: 0, z: 0 };
  const spacing = hf.cellSize * 2;
  const points: { x: number; z: number }[] = [];
  for (let x = -60; x < 60; x++) {
    points.push({ x: focus.x + x * spacing, z: focus.z - 40 * spacing });
    points.push({ x: focus.x + x * spacing, z: focus.z + 40 * spacing });
  }
  for (let z = -40; z < 40; z++) {
    points.push({ x: focus.x - 60 * spacing, z: focus.z + z * spacing });
    points.push({ x: focus.x + 60 * spacing, z: focus.z + z * spacing });
  }
  const priorCredits = economy.credits;
  economy.credits = 100000;
  economy.readyDefenseStructure = 'wall';
  placeStructure(sim, hf, economy, { kind: 'wall', ...points[0], valid: true, reason: '', wallLine: points, extraCost: (points.length - 1) * STRUCTURES.wall.cost });
  economy.credits = priorCredits;
  for (const wall of sim.buildingsQuery) if (wall.building.kind === 'wall') wall.building.buildProgress = 1;
  const observer = spawnInfantryAt(sim, focus.x, focus.z, economy.team, 'sniper');
  return { focus, units: [observer] };
}
