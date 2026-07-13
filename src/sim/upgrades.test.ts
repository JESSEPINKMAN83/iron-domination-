import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { createEconomy, spawnInfantryAt } from './economy';
import { generateHeightfield } from './heightfield';
import { purchaseUnitUpgrade } from './upgrades';
import { createGameSim, hashSim, spawnTankAt } from './world';

describe('unit upgrades', () => {
  it('charges per selected unit and applies a combat bike only once', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 2000);
    const first = spawnInfantryAt(sim, 10, 10, 1, 'infantry');
    const second = spawnInfantryAt(sim, 14, 10, 1, 'infantry');
    const baseSpeed = first.mover!.speed;

    const result = purchaseUnitUpgrade(sim, economy, [first.id, second.id], 'combat-bike');
    expect(result).toMatchObject({ ok: true, upgraded: 2, cost: 340 });
    expect(economy.credits).toBe(1660);
    expect(first.mover!.speed).toBeCloseTo(baseSpeed * 2.65);
    expect(first.health!.max).toBeGreaterThan(first.health!.current - 1);

    const duplicate = purchaseUnitUpgrade(sim, economy, [first.id, second.id], 'combat-bike');
    expect(duplicate.ok).toBe(false);
    expect(economy.credits).toBe(1660);
    expect(first.mover!.speed).toBeCloseTo(baseSpeed * 2.65);
  });

  it('installs a special weapon only on the purchased tank and includes it in the sim hash', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 2000);
    const upgraded = spawnTankAt(sim, 20, 20, 'Upgraded', 1);
    const stock = spawnTankAt(sim, 28, 20, 'Stock', 1);
    const before = hashSim(sim);

    const result = purchaseUnitUpgrade(sim, economy, [upgraded.id], 'ion-spear');
    expect(result.ok).toBe(true);
    expect(upgraded.specialWeapon?.kind).toBe('annihilatorMissile');
    expect(stock.specialWeapon).toBeUndefined();
    expect(hashSim(sim)).not.toBe(before);
  });

  it('rejects enemy entities and unaffordable purchases', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 100);
    const enemy = spawnTankAt(sim, 20, 20, 'Enemy', 2);
    expect(purchaseUnitUpgrade(sim, economy, [enemy.id], 'ion-spear', 1).ok).toBe(false);
    const friendly = spawnTankAt(sim, 28, 20, 'Friendly', 1);
    const result = purchaseUnitUpgrade(sim, economy, [friendly.id], 'ion-spear', 1);
    expect(result).toMatchObject({ ok: false, cost: 560 });
    expect(economy.credits).toBe(100);
  });
});
