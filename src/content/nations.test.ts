import { afterEach, describe, expect, it } from 'vitest';
import { defaultArmyDoctrines } from './armyDoctrines';
import { applyArmyNations, armyName, armyTag, nationsForDoctrines } from './nations';

describe('Code Red nations', () => {
  afterEach(() => applyArmyNations(defaultArmyDoctrines()));

  it('names the default single-player match Israel vs Iran, Hezbollah and the Houthis', () => {
    expect(nationsForDoctrines(defaultArmyDoctrines())).toEqual(['israel', 'iran', 'hezbollah', 'houthis']);
  });

  it('follows the player’s chosen side and adds allies in order', () => {
    expect(nationsForDoctrines(['missile-command', 'iron-legion', 'iron-legion', 'missile-command']))
      .toEqual(['iran', 'israel', 'usa', 'hezbollah']);
  });

  it('exposes display names per team for the active match', () => {
    applyArmyNations(['missile-command', 'iron-legion']);
    expect(armyName(1)).toBe('Iran');
    expect(armyTag(2)).toBe('ISRAEL');
    expect(armyName(3)).toBe('Army 3');
  });
});
