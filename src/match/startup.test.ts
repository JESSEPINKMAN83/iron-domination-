import { describe, expect, it } from 'vitest';
import { aiControlledTeams, ensureOpposingSides, formatArmyMatchup, isVictoryFromHostileBuildingCounts, shouldAutostartFromUrl } from './startup';

describe('match startup routing', () => {
  it('keeps multiplayer invite links on the setup lobby', () => {
    expect(shouldAutostartFromUrl(new URLSearchParams('room=ABC123'))).toBe(false);
  });

  it('autostarts explicit match and QA query links', () => {
    expect(shouldAutostartFromUrl(new URLSearchParams('map=frostbite-pass&seed=42'))).toBe(true);
    expect(shouldAutostartFromUrl(new URLSearchParams('start=test'))).toBe(true);
  });

  it('does not autostart for unrelated tracking parameters', () => {
    expect(shouldAutostartFromUrl(new URLSearchParams('utm_source=invite'))).toBe(false);
  });

  it('assigns every multiplayer army without a joined commander to AI control', () => {
    expect(aiControlledTeams(2, [1])).toEqual([2]);
    expect(aiControlledTeams(4, [1, 3])).toEqual([2, 4]);
    expect(aiControlledTeams(3, [1, 2, 3])).toEqual([]);
  });

  it('keeps at least one opposing side when reducing an allied 2v2 to two armies', () => {
    expect(ensureOpposingSides(2, [1, 1, 2, 2])).toEqual([1, 2, 2, 2]);
    expect(ensureOpposingSides(4, [1, 1, 2, 2])).toEqual([1, 1, 2, 2]);
  });

  it('describes which armies are allied and opposing', () => {
    expect(formatArmyMatchup(4, [1, 1, 2, 2])).toBe('SIDE 1: ARMY 1 + ARMY 2  VS  SIDE 2: ARMY 3 + ARMY 4');
    expect(formatArmyMatchup(3, [1, 2, 3, 4])).toBe('SIDE 1: ARMY 1  VS  SIDE 2: ARMY 2  VS  SIDE 3: ARMY 3');
  });

  it('does not declare victory when the match has no hostile team', () => {
    expect(isVictoryFromHostileBuildingCounts([])).toBe(false);
    expect(isVictoryFromHostileBuildingCounts([0])).toBe(true);
    expect(isVictoryFromHostileBuildingCounts([0, 1])).toBe(false);
  });
});
