import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAP01 } from '../content/map01';
import { AI_DIFFICULTY, type Difficulty } from '../content/phase6';
import { WEAPONS } from '../content/phase4';
import { createEconomy, spawnInfantryAt } from '../sim/economy';
import { generateHeightfield } from '../sim/heightfield';
import { VisibilityGrid } from '../sim/visibility';
import { createGameSim, spawnTankAt } from '../sim/world';
import { stepCombat } from '../sim/combat';
import { EnemyCommander } from './commander';

function fixture(doctrine: 'iron-legion' | 'missile-command', difficulty: Difficulty) {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const hf = generateHeightfield(MAP01);
  hf.heights.fill(10);
  hf.walkable.fill(1);
  const sim = createGameSim(hf);
  const sniper = spawnInfantryAt(sim, 0, 0, 2, 'sniper');
  const friendly = spawnInfantryAt(sim, 250, 0, 1, 'sniper');
  const tank = spawnTankAt(sim, -50, 0, 'Tank', 2);
  const commander = new EnemyCommander(sim, hf, createEconomy(2, 7500, doctrine), new VisibilityGrid(hf, 2), 'balanced', difficulty);
  const apply = () => (commander as unknown as { applyCombatProfile(): void }).applyCombatProfile();
  apply();
  return { sim, sniper, friendly, tank, apply };
}
afterEach(() => vi.restoreAllMocks());

describe('enemy sniper balance', () => {
  for (const doctrine of ['iron-legion', 'missile-command'] as const) {
    it.each(['easy', 'normal', 'hard'] as const)(`${doctrine}: reduces sniper range and accuracy on %s without changing player snipers or other weapons`, (difficulty) => {
      const { sniper, friendly, tank, apply } = fixture(doctrine, difficulty);
      expect(sniper.weapon!.range).toBe(192);
      expect(sniper.aiCombat!.accuracy).toBeCloseTo(AI_DIFFICULTY[difficulty].combatAccuracy * 0.65);
      expect(sniper.aiCombat!.projectileScatter).toBeGreaterThanOrEqual(6);
      apply();
      expect(sniper.weapon!.range).toBe(192);
      expect(friendly.weapon!.range).toBe(WEAPONS.sniperRifle.range);
      expect(friendly.aiCombat).toBeUndefined();
      expect(tank.aiCombat!.accuracy).toBe(AI_DIFFICULTY[difficulty].combatAccuracy);
    });
  }

  it('cannot shoot beyond the shorter range and advances rather than stopping at its old range', () => {
    const { sim, sniper, friendly } = fixture('iron-legion', 'hard');
    friendly.weapon = undefined; friendly.weapons = undefined;
    stepCombat(sim, 1 / 30);
    expect(sim.events.filter((event) => event.weaponKind === 'sniperRifle')).toHaveLength(0);
    expect(friendly.health!.current).toBe(friendly.health!.max);
    expect(sniper.mover!.engage).toEqual({ x: 250, z: 0 });
  });

  it('still shoots within range but misses a meaningful portion of shots on Hard', () => {
    const { sim, sniper, friendly } = fixture('missile-command', 'hard');
    friendly.transform.x = 150;
    friendly.weapon = undefined; friendly.weapons = undefined;
    friendly.health!.current = friendly.health!.max = 100000;
    sniper.turret!.yaw = Math.PI / 2;
    for (let i = 0; i < 100; i++) {
      sim.tick = i * 90;
      sniper.weapon!.cooldown = 0;
      stepCombat(sim, 1 / 30);
    }
    const shots = sim.events.filter((event) => event.weaponKind === 'sniperRifle');
    const hits = shots.filter((event) => event.damage > 0);
    expect(shots).toHaveLength(100);
    expect(hits.length).toBeGreaterThan(45);
    expect(hits.length).toBeLessThan(80);
  });
});
