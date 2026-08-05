import { describe, expect, it } from 'vitest';
import {
  combatRankCooldownMultiplier,
  combatRankDamageMultiplier,
  combatRankName,
  combatRankSpeedMultiplier,
  creditCombatKill,
  ensureCombatRank,
  rankThreshold,
  summarizeCombatRankShares,
} from './combatRank';
import type { Entity } from './components';

function makeUnit(partial: Partial<Entity> & Pick<Entity, 'id'>): Entity {
  return {
    id: partial.id,
    name: partial.name ?? 'M-17 Test',
    transform: partial.transform ?? { x: 0, z: 0, rot: 0 },
    previousTransform: partial.previousTransform ?? { x: 0, z: 0, rot: 0 },
    health: partial.health ?? { current: 100, max: 100 },
    team: partial.team ?? { id: 1 },
    selectable: partial.selectable ?? { selected: false, type: 'tank', radius: 2 },
    mover: partial.mover ?? { speed: 10, radius: 1.5 },
    weapon: partial.weapon ?? { kind: 'cannon', range: 40, cooldown: 0 },
    armor: partial.armor ?? { kind: 'heavy' },
    combatRank: partial.combatRank,
    destroyed: partial.destroyed,
  };
}

describe('combat ranks', () => {
  it('names ranks Recruit through Ace', () => {
    expect(combatRankName(0)).toBe('Recruit');
    expect(combatRankName(1)).toBe('Veteran');
    expect(combatRankName(2)).toBe('Elite');
    expect(combatRankName(3)).toBe('Ace');
  });

  it('promotes on kill value thresholds and boosts combat stats', () => {
    const attacker = makeUnit({ id: 1, name: 'M-17 Alpha' });
    const state = ensureCombatRank(attacker)!;
    expect(state.rank).toBe(0);
    expect(combatRankDamageMultiplier(attacker)).toBe(1);

    const victimCost = state.unitCost;
    expect(rankThreshold(victimCost, 1)).toBe(victimCost * 2);

    // Two peer-cost kills → Veteran (2× cost threshold)
    const peer = makeUnit({ id: 2, team: { id: 2 }, name: 'M-17 Enemy' });
    expect(creditCombatKill(attacker, peer)).toBeUndefined();
    expect(creditCombatKill(attacker, makeUnit({ id: 3, team: { id: 2 }, name: 'M-17 Enemy' }))).toBe(1);
    expect(attacker.combatRank?.rank).toBe(1);
    expect(combatRankDamageMultiplier(attacker)).toBeCloseTo(1.12);
    expect(combatRankCooldownMultiplier(attacker)).toBeLessThan(1);
    expect(combatRankSpeedMultiplier(attacker)).toBeGreaterThan(1);

    // Push through Elite (5×) then Ace (9×)
    for (let id = 4; id <= 6; id++) creditCombatKill(attacker, makeUnit({ id, team: { id: 2 }, name: 'M-17 Enemy' }));
    expect(attacker.combatRank?.rank).toBe(2);
    for (let id = 7; id <= 10; id++) creditCombatKill(attacker, makeUnit({ id, team: { id: 2 }, name: 'M-17 Enemy' }));
    expect(attacker.combatRank?.rank).toBe(3);
    expect(combatRankDamageMultiplier(attacker)).toBeCloseTo(1.4);
    expect(combatRankSpeedMultiplier(attacker)).toBeCloseTo(1.24);
    expect(creditCombatKill(attacker, makeUnit({ id: 11, team: { id: 2 }, name: 'M-17 Enemy' }))).toBeUndefined();
  });

  it('summarizes rank shares for Wix match-end telemetry', () => {
    const units = [
      makeUnit({ id: 1, combatRank: { rank: 0, killValue: 0, unitCost: 550 } }),
      makeUnit({ id: 2, combatRank: { rank: 0, killValue: 0, unitCost: 550 } }),
      makeUnit({ id: 3, combatRank: { rank: 1, killValue: 550, unitCost: 550 } }),
      makeUnit({ id: 4, combatRank: { rank: 3, killValue: 4000, unitCost: 550 } }),
      makeUnit({ id: 5, team: { id: 2 }, combatRank: { rank: 3, killValue: 4000, unitCost: 550 } }),
    ];
    const summary = summarizeCombatRankShares(units, 1);
    expect(summary.combatUnitCount).toBe(4);
    expect(summary.rankRecruitShare).toBe(0.5);
    expect(summary.rankVeteranShare).toBe(0.25);
    expect(summary.rankEliteShare).toBe(0);
    expect(summary.rankAceShare).toBe(0.25);
    expect(summary.rankCounts).toBe('recruit:2,veteran:1,elite:0,ace:1');
  });
});
