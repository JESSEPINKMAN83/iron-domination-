import { describe, expect, it } from 'vitest';
import { defaultArmyDoctrines, sanitizeArmyDoctrines } from './armyDoctrines';

describe('army doctrine assignments', () => {
  it('defaults the player to air command and opponents to long-range command', () => {
    expect(defaultArmyDoctrines()).toEqual([
      'iron-legion',
      'missile-command',
      'missile-command',
      'missile-command',
    ]);
  });

  it('preserves an independent faction choice for every army', () => {
    expect(sanitizeArmyDoctrines([
      'missile-command',
      'missile-command',
      'iron-legion',
      'iron-legion',
    ])).toEqual([
      'missile-command',
      'missile-command',
      'iron-legion',
      'iron-legion',
    ]);
  });

  it('migrates the legacy primary faction into an asymmetric matchup', () => {
    expect(sanitizeArmyDoctrines(undefined, 'missile-command')).toEqual([
      'missile-command',
      'iron-legion',
      'iron-legion',
      'iron-legion',
    ]);
  });
});
