import { describe, expect, it } from 'vitest';
import { MAP01 } from './map01';
import { UNIT_ARSENALS } from './unitArsenal';
import { spawnInfantryAt } from '../sim/economy';
import { generateHeightfield } from '../sim/heightfield';
import {
  createGameSim,
  spawnHammerheadAt,
  spawnScoutTankAt,
  spawnSiegeTankAt,
  spawnTankAt,
  spawnVultureAt,
  spawnWaspAt,
} from '../sim/world';

describe('unit-specific arsenals', () => {
  it('gives every playable platform an explicit combat and HUD identity', () => {
    expect(Object.keys(UNIT_ARSENALS)).toHaveLength(10);
    expect(new Set(Object.values(UNIT_ARSENALS).map((arsenal) => `${arsenal.primary}/${arsenal.secondary ?? '-'}`)).size).toBe(10);
    expect(new Set(Object.values(UNIT_ARSENALS).map((arsenal) => arsenal.hud)).size).toBeGreaterThanOrEqual(7);
  });

  it('spawns the roster with the weapons described by its arsenal', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const roster = [
      ['infantry', spawnInfantryAt(sim, -50, 0, 1, 'infantry')],
      ['grenadier', spawnInfantryAt(sim, -40, 0, 1, 'grenadier')],
      ['sniper', spawnInfantryAt(sim, -30, 0, 1, 'sniper')],
      ['rocket-infantry', spawnInfantryAt(sim, -20, 0, 1, 'rocket-infantry')],
      ['scout-tank', spawnScoutTankAt(sim, -10, 0, 'Jackal')],
      ['tank', spawnTankAt(sim, 0, 0, 'M-17')],
      ['siege-tank', spawnSiegeTankAt(sim, 10, 0, 'Mauler')],
      ['wasp', spawnWaspAt(sim, hf, 20, 0, 'Wasp')],
      ['vulture', spawnVultureAt(sim, hf, 30, 0, 'Vulture')],
      ['hammerhead', spawnHammerheadAt(sim, hf, 40, 0, 'Hammerhead')],
    ] as const;

    for (const [kind, entity] of roster) {
      expect(entity.weapons?.primary.kind, `${kind} primary`).toBe(UNIT_ARSENALS[kind].primary);
      expect(entity.weapons?.secondary?.kind, `${kind} secondary`).toBe(UNIT_ARSENALS[kind].secondary);
      expect(entity.weapons?.secondary?.salvoCount, `${kind} salvo`).toBe(UNIT_ARSENALS[kind].secondarySalvoCount);
    }
  });
});
