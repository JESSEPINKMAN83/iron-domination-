import { describe, expect, it } from 'vitest';
import { generateHeightfield } from '../sim/heightfield';
import { createEconomy } from '../sim/economy';
import { createGameSim } from '../sim/world';
import { BattleDebriefTracker } from './battleDebrief';

describe('BattleDebriefTracker', () => {
  it('reports per-army combat, force and economy results without mutating the sim', () => {
    const hf = generateHeightfield({ cells: 48, cellSize: 2, waterLevel: 1.5, seed: 91, oreFieldCount: 2 });
    const sim = createGameSim(hf);
    sim.rules.allianceSides = { 1: 1, 2: 2 };
    const friendlyEconomy = createEconomy(1, 1000);
    const enemyEconomy = createEconomy(2, 1000);
    friendlyEconomy.ledger.push({ tick: 10, type: 'income', label: 'Ore delivered', amount: 420 });
    friendlyEconomy.ledger.push({ tick: 20, type: 'spend', label: 'M-17 Tank', amount: -550 });
    const friendly = sim.world.add({
      id: sim.nextEntityId++,
      name: 'Friendly tank',
      transform: { x: 0, z: 0, rot: 0 },
      previousTransform: { x: 0, z: 0, rot: 0 },
      team: { id: 1 },
      health: { current: 300, max: 300 },
      selectable: { selected: false, type: 'tank', radius: 2 },
    });
    const enemy = sim.world.add({
      id: sim.nextEntityId++,
      name: 'Enemy tank',
      transform: { x: 10, z: 0, rot: 0 },
      previousTransform: { x: 10, z: 0, rot: 0 },
      team: { id: 2 },
      health: { current: 0, max: 200 },
      selectable: { selected: false, type: 'tank', radius: 2 },
      destroyed: { remaining: 4 },
    });
    const tracker = new BattleDebriefTracker(sim, [
      { team: 1, side: 1, economy: friendlyEconomy, label: 'YOUR ARMY' },
      { team: 2, side: 2, economy: enemyEconomy, label: 'AI ARMY 2' },
    ], 1);

    tracker.recordEvents([{
      kind: 'rifle',
      weaponKind: 'rifle',
      fromX: friendly.transform.x,
      fromZ: friendly.transform.z,
      toX: enemy.transform.x,
      toZ: enemy.transform.z,
      sourceTeamId: 1,
      targetId: enemy.id,
      targetType: 'tank',
      damage: 200,
      killed: true,
    }]);
    const snapshot = tracker.snapshot(125);
    const local = snapshot.armies[0];
    const hostile = snapshot.armies[1];

    expect(snapshot.elapsedSeconds).toBe(125);
    expect(local.damageDealt).toBe(200);
    expect(local.shotsFired).toBe(1);
    expect(local.hits).toBe(1);
    expect(local.unitKills).toBe(1);
    expect(local.income).toBe(420);
    expect(local.spent).toBe(550);
    expect(hostile.damageReceived).toBe(200);
    expect(hostile.unitLosses).toBe(1);
    expect(hostile.unitsSurviving).toBe(0);
    expect(Array.from(sim.world.entities)).toContain(friendly);
  });

  it('counts newly produced units and records losses when entities leave the world', () => {
    const hf = generateHeightfield({ cells: 48, cellSize: 2, waterLevel: 1.5, seed: 92, oreFieldCount: 2 });
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 1000);
    const tracker = new BattleDebriefTracker(sim, [{ team: 1, side: 1, economy }], 1);
    const unit = sim.world.add({
      id: sim.nextEntityId++,
      transform: { x: 0, z: 0, rot: 0 },
      previousTransform: { x: 0, z: 0, rot: 0 },
      team: { id: 1 },
      selectable: { selected: false, type: 'infantry', radius: 1 },
      destroyed: { remaining: 0 },
    });
    sim.world.remove(unit);

    const report = tracker.snapshot(1).armies[0];
    expect(report.unitsDeployed).toBe(1);
    expect(report.unitLosses).toBe(1);
    expect(report.unitsSurviving).toBe(0);
  });
});
