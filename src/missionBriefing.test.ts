import { describe, expect, it } from 'vitest';
import { enemyForceLabel } from './missionBriefing';

describe('mission briefing enemy count', () => {
  it('uses the singular label for one hostile army', () => {
    expect(enemyForceLabel(1)).toBe('1 ENEMY ARMY');
  });

  it('uses the plural label for multiple hostile armies', () => {
    expect(enemyForceLabel(2)).toBe('2 ENEMY ARMIES');
    expect(enemyForceLabel(3)).toBe('3 ENEMY ARMIES');
  });
});
