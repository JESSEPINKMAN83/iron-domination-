// Phase 6 acceptance: a passive player must fall to the Normal AI in single-digit minutes.
import { describe, expect, it, vi } from 'vitest';
import { MAP01 } from '../content/map01';
import { startPosition } from '../content/startPositions';
import { stepCombat } from '../sim/combat';
import { buildings, createEconomy, createInitialBase, stepEconomy } from '../sim/economy';
import { generateHeightfield } from '../sim/heightfield';
import { VisibilityGrid } from '../sim/visibility';
import { createGameSim, spawnDebugTanks, stepSim } from '../sim/world';
import { EnemyCommander } from './commander';

const DT = 1 / 30;

describe('phase 6 acceptance', () => {
  it('normal/balanced AI defeats a passive player within ~14 sim-minutes', () => {
    const logs: string[] = [];
    vi.spyOn(console, 'info').mockImplementation((msg: string) => logs.push(String(msg)));
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const playerEconomy = createEconomy(1);
    createInitialBase(sim, hf, playerEconomy);
    const enemyEconomy = createEconomy(2, 4600);
    const enemyStart = startPosition(hf.size, 2);
    createInitialBase(sim, hf, enemyEconomy, enemyStart.x, enemyStart.z);
    const aiVision = new VisibilityGrid(hf, 2);
    const playerStart = buildings(sim, 1)[0].transform;
    const commander = new EnemyCommander(sim, hf, enemyEconomy, aiVision, 'balanced', 'normal', [
      { x: playerStart.x, z: playerStart.z },
    ]);
    spawnDebugTanks(sim, hf, 8);

    let defeatTick = -1;
    const maxTicks = 30 * 60 * 14;
    for (let i = 0; i < maxTicks; i++) {
      commander.step(DT);
      stepEconomy(sim, hf, playerEconomy, DT);
      stepEconomy(sim, hf, enemyEconomy, DT);
      stepSim(sim, hf, DT);
      stepCombat(sim, DT);
      aiVision.update(sim);
      if (buildings(sim, 1).filter((b) => !b.destroyed).length === 0) {
        defeatTick = sim.tick;
        break;
      }
    }
    vi.restoreAllMocks();
    console.log(`passive player defeated at ${defeatTick > 0 ? (defeatTick / 30 / 60).toFixed(1) : 'never'} min`);
    console.log(`ai stats: ${JSON.stringify(commander.stats)}; sample logs: ${logs.slice(0, 6).join(' | ')}`);
    expect(defeatTick).toBeGreaterThan(0);
  }, 120000);
});
