import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '../sim/world';
import { projectileTrailProfile, selectCombatVisualEvents } from './combatView';

function event(index: number, sourceTeamId: number, overrides: Partial<CombatEvent> = {}): CombatEvent {
  return {
    kind: 'rifle',
    fromX: index,
    fromZ: 0,
    toX: index + 1,
    toZ: 1,
    sourceTeamId,
    damage: 4,
    killed: false,
    ...overrides,
  };
}

describe('combat visual load shedding', () => {
  it('keeps ordinary battles intact', () => {
    const events = Array.from({ length: 12 }, (_, index) => event(index, (index % 3) + 1));
    expect(selectCombatVisualEvents(events, 1, 0)).toEqual(events);
  });

  it('bounds a three-army event storm while reserving local and critical feedback', () => {
    const events = [
      ...Array.from({ length: 30 }, (_, index) => event(index, 2, { killed: true })),
      ...Array.from({ length: 120 }, (_, index) => event(100 + index, 1)),
      ...Array.from({ length: 150 }, (_, index) => event(300 + index, index % 2 === 0 ? 2 : 3)),
    ];

    const selected = selectCombatVisualEvents(events, 1, 0);
    expect(selected).toHaveLength(48);
    expect(selected.filter((candidate) => candidate.killed)).toHaveLength(12);
    expect(selected.filter((candidate) => !candidate.killed && candidate.sourceTeamId === 1)).toHaveLength(24);
    expect(selected.some((candidate) => candidate.sourceTeamId === 2 || candidate.sourceTeamId === 3)).toBe(true);
    expect(selected.map((candidate) => candidate.fromX)).toEqual(
      [...selected].sort((a, b) => a.fromX - b.fromX).map((candidate) => candidate.fromX),
    );
  });

  it('tightens the allocation ceiling as adaptive quality drops', () => {
    const events = Array.from({ length: 200 }, (_, index) => event(index, (index % 3) + 1));
    expect(selectCombatVisualEvents(events, 1, 0)).toHaveLength(48);
    expect(selectCombatVisualEvents(events, 1, 1)).toHaveLength(34);
    expect(selectCombatVisualEvents(events, 1, 2)).toHaveLength(22);
    expect(selectCombatVisualEvents(events, 1, 0, 7)).toHaveLength(7);
    expect(selectCombatVisualEvents(events, 1, 0, 0)).toEqual([]);
  });

  it('ignores non-visual bookkeeping before applying the budget', () => {
    const bookkeeping = Array.from({ length: 100 }, (_, index) => event(index, 1, { kind: 'impact-reaction' }));
    const visible = Array.from({ length: 8 }, (_, index) => event(200 + index, 1));
    expect(selectCombatVisualEvents([...bookkeeping, ...visible], 1, 0)).toEqual(visible);
  });
});

describe('missile trail profiles', () => {
  it('gives every missile weapon a long, readable, distinct trail', () => {
    const missiles = [
      ['rocketPod', 'atRocket', false],
      ['rocketLauncher', 'atRocket', true],
      ['scoutMissile', 'scoutMissile', true],
      ['tankMissile', 'tankMissile', true],
      ['siegeMissile', 'siegeMissile', false],
      ['agMissile', 'agMissile', true],
      ['aaMissile', 'aaMissile', true],
      ['swarmRocket', 'agMissile', false],
      ['annihilatorMissile', 'siegeMissile', false],
    ] as const;
    const profiles = missiles.map(([weapon, projectile, homing]) => projectileTrailProfile(weapon, projectile, homing));

    expect(profiles.every((profile) => profile.missile)).toBe(true);
    expect(profiles.every((profile) => profile.capacity >= 24 && profile.width >= 2)).toBe(true);
    expect(new Set(profiles.map((profile) => `${profile.capacity}:${profile.width}:${profile.tailColor}:${profile.headColor}`)).size).toBe(profiles.length);
  });

  it('does not turn shells, grenades, or bombs into long missile streaks', () => {
    expect(projectileTrailProfile('grenadeLauncher', 'grenade', false).missile).toBe(false);
    expect(projectileTrailProfile('heavyCannon', 'kineticShell', false).missile).toBe(false);
    expect(projectileTrailProfile('bomb', 'bomb', false).missile).toBe(false);
  });
});
