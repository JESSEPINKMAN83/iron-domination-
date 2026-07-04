import { describe, expect, it, vi } from 'vitest';
import { MAP01 } from '../content/map01';
import { stepCombat } from '../sim/combat';
import { createEconomy, createInitialBase, buildings, stepEconomy } from '../sim/economy';
import { generateHeightfield } from '../sim/heightfield';
import { VisibilityGrid } from '../sim/visibility';
import { createGameSim, hashSim, spawnDebugTanks, stepSim } from '../sim/world';
import { EnemyCommander } from './commander';

const DT = 1 / 30;

function runMatch(ticks: number) {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  const playerEconomy = createEconomy(1);
  createInitialBase(sim, hf, playerEconomy);
  const enemyEconomy = createEconomy(2, 4600);
  createInitialBase(sim, hf, enemyEconomy, hf.size * 0.18, hf.size * 0.08);
  const aiVision = new VisibilityGrid(hf, 2);
  const commander = new EnemyCommander(sim, hf, enemyEconomy, aiVision, 'rusher', 'normal');
  spawnDebugTanks(sim, hf, 6);

  for (let i = 0; i < ticks; i++) {
    commander.step(DT);
    stepEconomy(sim, hf, playerEconomy, DT);
    stepEconomy(sim, hf, enemyEconomy, DT);
    stepSim(sim, hf, DT);
    stepCombat(sim, DT);
    aiVision.update(sim);
  }
  vi.restoreAllMocks();
  return { sim, commander, enemyEconomy };
}

describe('phase 6 enemy commander', () => {
  it('builds its base, produces an army, and launches attacks', () => {
    const { sim, commander } = runMatch(30 * 240); // 4 sim-minutes
    const aiBuildings = buildings(sim, 2).filter((entity) => entity.building?.complete);
    expect(aiBuildings.length).toBeGreaterThanOrEqual(4); // yard + power + refinery + factory
    expect(commander.stats.structuresPlaced).toBeGreaterThanOrEqual(3);
    const aiTanks = Array.from(sim.world.entities).filter(
      (entity) => entity.team?.id === 2 && entity.selectable?.type === 'tank' && !entity.destroyed,
    );
    expect(aiTanks.length).toBeGreaterThanOrEqual(4);
    expect(commander.stats.attacksLaunched).toBeGreaterThanOrEqual(1);
  });

  it('is deterministic: same setup → identical sim hash', () => {
    const first = runMatch(30 * 60);
    const second = runMatch(30 * 60);
    expect(hashSim(first.sim)).toBe(hashSim(second.sim));
    expect(first.commander.stats).toEqual(second.commander.stats);
  });
});
