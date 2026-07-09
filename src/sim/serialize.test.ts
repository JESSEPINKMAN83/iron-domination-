import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { SIM_DT } from '../engine/loop';
import { stepCombat } from './combat';
import { createEconomy, createInitialBase, queueUnit, stepEconomy } from './economy';
import { generateHeightfield } from './heightfield';
import { createGameSim, hashSim, issueMoveOrder, spawnTankAt, spawnVultureAt, stepSim } from './world';
import { loadSerializedSim, restoreEconomyState, serializeMatchState } from './serialize';

describe('match state serialization', () => {
  it('round-trips sim and economy state, then stays deterministic after more ticks', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 6000);
    createInitialBase(sim, hf, economy, -80, -80);
    const tanks = [spawnTankAt(sim, -70, -62, 'A'), spawnTankAt(sim, -66, -62, 'B')];
    const aircraft = spawnVultureAt(sim, hf, -74, -70, 'Vulture');
    aircraft.playerControlled = { throttle: 0.5, turn: 0.1, aimYaw: aircraft.transform.rot, climb: 0.2, strafe: 0 };
    expect(issueMoveOrder(sim, tanks, 95, 88, true, Math.PI * 0.35, 18)).toBe(true);
    expect(queueUnit(sim, economy, 'infantry')).toBe(false);
    sim.resourceNodes[0].remaining -= 123.45;

    for (let i = 0; i < 40; i++) {
      stepEconomy(sim, hf, economy, SIM_DT);
      stepSim(sim, hf, SIM_DT);
      stepCombat(sim, SIM_DT);
      sim.events.splice(0);
    }

    const saved = serializeMatchState(sim, [economy]);
    const loaded = loadSerializedSim(hf, saved.sim);
    const loadedEconomy = createEconomy(1, 0);
    restoreEconomyState(loadedEconomy, loaded, saved.economies[0]);

    expect(hashSim(loaded)).toBe(hashSim(sim));
    expect(loaded.tick).toBe(sim.tick);
    expect(loaded.nextEntityId).toBe(sim.nextEntityId);
    expect(loadedEconomy.credits).toBe(economy.credits);
    expect(loadedEconomy.ledger).toEqual(economy.ledger);
    expect(Array.from(loaded.world.entities).length).toBe(Array.from(sim.world.entities).length);
    expect(Array.from(loaded.world.entities).some((entity) => entity.mover?.target && entity.mover.flow)).toBe(true);

    for (let i = 0; i < 100; i++) {
      stepEconomy(sim, hf, economy, SIM_DT);
      stepSim(sim, hf, SIM_DT);
      stepCombat(sim, SIM_DT);
      sim.events.splice(0);

      stepEconomy(loaded, hf, loadedEconomy, SIM_DT);
      stepSim(loaded, hf, SIM_DT);
      stepCombat(loaded, SIM_DT);
      loaded.events.splice(0);
    }

    expect(hashSim(loaded)).toBe(hashSim(sim));
    expect(loadedEconomy.credits).toBe(economy.credits);
  });
});
