import { describe, expect, it } from 'vitest';
import { STRUCTURES, type StructureKind } from '../content/phase3';
import { createFortressWeapons } from '../content/fortress';
import { createEconomy } from './economy';
import { generateHeightfield, sampleHeight } from './heightfield';
import { createGameSim, hashCriticalSimState, hashSim, spawnTankAt, spawnWaspAt } from './world';
import { loadSerializedSim, serializeSim } from './serialize';
import { manualFireAt, stepCombat } from './combat';
import { defenseLevel, defensePower, purchaseDefenseUpgrade } from './defenseUpgrades';
import type { Entity } from './components';

function fixture(kind: StructureKind = 'guard-tower', team = 1) {
  const hf = generateHeightfield({ cells: 128, cellSize: 4, seed: 7, waterLevel: -10, oreFieldCount: 0 });
  const sim = createGameSim(hf), economy = createEconomy(team, 2000);
  const health = STRUCTURES[kind].health!;
  const weapons = kind === 'guard-tower' || kind === 'aa-tower' ? createFortressWeapons(kind) : undefined;
  const tower = sim.world.add({ id: sim.nextEntityId++, team: { id: team }, transform: { x: 20, y: sampleHeight(hf, 20, 20), z: 20, rot: 0 },
    health: { current: health, max: health }, armor: { kind: 'building' }, vision: { radius: 400 },
    building: { kind, label: kind, footprint: STRUCTURES[kind].footprint, powerProduced: 0, powerUsed: 0, complete: true, buildProgress: 1 }, ...weapons,
  } as Entity);
  return { hf, sim, economy, tower };
}

describe('three defense upgrade tiers', () => {
  it.each(['guard-tower', 'aa-tower', 'missile-defense', 'skylance-ciws'] as const)('upgrades %s for 100/250/500, caps at three and preserves damage percentage', kind => {
    const { sim, economy, tower } = fixture(kind);
    tower.health!.current *= .5;
    for (let level = 0; level < 3; level++) expect(purchaseDefenseUpgrade(sim, economy, tower.id, level).ok).toBe(true);
    expect(economy.credits).toBe(1150);
    expect(defenseLevel(tower)).toBe(3);
    expect(tower.health!.max).toBe(Math.round(STRUCTURES[kind].health! * 2.6));
    expect(tower.health!.current / tower.health!.max).toBeCloseTo(.5);
    expect(purchaseDefenseUpgrade(sim, economy, tower.id, 3).ok).toBe(false);
    expect(economy.credits).toBe(1150);
  });
  it('rejects stale, hostile, unfinished, destroyed and unaffordable purchases without charging', () => {
    const { sim, economy, tower } = fixture();
    expect(purchaseDefenseUpgrade(sim, economy, tower.id, 1).ok).toBe(false);
    tower.team!.id = 2; expect(purchaseDefenseUpgrade(sim, economy, tower.id, 0).ok).toBe(false); tower.team!.id = 1;
    tower.building!.complete = false; expect(purchaseDefenseUpgrade(sim, economy, tower.id, 0).ok).toBe(false); tower.building!.complete = true;
    tower.destroyed = { remaining: 1 }; expect(purchaseDefenseUpgrade(sim, economy, tower.id, 0).ok).toBe(false); delete tower.destroyed;
    expect(economy.credits).toBe(2000);
    economy.credits = 99; expect(purchaseDefenseUpgrade(sim, economy, tower.id, 0).ok).toBe(false); expect(economy.credits).toBe(99);
  });
  it('gives the guard tower a separate working anti-air mount without replacing ground weapons', () => {
    const { sim, economy, tower, hf } = fixture();
    const primary = tower.weapon, secondary = tower.weapons!.secondary;
    const aircraft = spawnWaspAt(sim, hf, 90, 20, 'Enemy Wasp', 2);
    purchaseDefenseUpgrade(sim, economy, tower.id, 0);
    stepCombat(sim, 1 / 30, { autoFire: true });
    expect(tower.weapon).toBe(primary); expect(tower.weapons!.secondary).toBe(secondary);
    expect(sim.projectiles.some(p => p.attackerId === tower.id && p.directTargetId === aircraft.id && p.weaponKind === 'aaMissile')).toBe(true);
  });
  it('increases actual ground damage, projectile speed and rate of fire at tier three', () => {
    const shoot = (upgraded: boolean) => {
      const { sim, economy, tower } = fixture();
      const target = spawnTankAt(sim, 100, 20, 'Target', 2); target.health!.max = target.health!.current = 10000;
      if (upgraded) for (let level = 0; level < 3; level++) purchaseDefenseUpgrade(sim, economy, tower.id, level);
      expect(manualFireAt(sim, tower, target.transform.x, target.transform.z)).toBe(true);
      const speed = sim.projectiles[0].speed, cooldown = tower.weapon!.cooldown;
      for (let i = 0; i < 300 && sim.projectiles.length; i++) { sim.tick++; stepCombat(sim, 1 / 30, { autoFire: false }); }
      return { damage: 10000 - target.health!.current, speed, cooldown };
    };
    const base = shoot(false), elite = shoot(true);
    expect(base.damage).toBeGreaterThan(0); expect(elite.damage).toBeGreaterThan(base.damage * 1.9);
    expect(elite.speed).toBeCloseTo(base.speed! * 1.5); expect(elite.cooldown).toBeCloseTo(base.cooldown * .65);
  });
  it('persists upgrades and AA cooldowns through recovery and includes levels in multiplayer hashes', () => {
    const { sim, economy, tower, hf } = fixture('guard-tower', 2);
    const before = hashCriticalSimState(sim);
    purchaseDefenseUpgrade(sim, economy, tower.id, 0); tower.building!.airDefenseWeapon!.cooldown = .4;
    const restored = loadSerializedSim(hf, serializeSim(sim));
    expect(defenseLevel(restored.byId.get(tower.id))).toBe(1);
    expect(defensePower(restored.byId.get(tower.id))).toBe(1.2);
    expect(hashSim(restored)).toBe(hashSim(sim));
    expect(hashCriticalSimState(sim)).not.toBe(before);
  });
});
