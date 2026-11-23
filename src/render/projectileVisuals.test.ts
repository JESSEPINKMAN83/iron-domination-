import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../content/phase4';
import { PROJECTILE_VISUAL_FAMILIES, isRocketPowered, projectileVisualKind } from './projectileVisuals';
import { missileTrailProfile } from './missileTrail';

describe('all weapon visual families', () => {
  it('explicitly maps every weapon in the game', () => {
    expect(Object.keys(PROJECTILE_VISUAL_FAMILIES).sort()).toEqual(Object.keys(WEAPONS).sort());
  });
  it.each([
    ['precisionMissile', 'agMissile'], ['swarmRocket', 'agMissile'], ['annihilatorMissile', 'siegeMissile'],
    ['mlrsRocket', 'rocketLauncher'], ['tankBomb', 'siegeMissile'],
  ])('gives %s its full %s trail instead of the generic fallback', (weapon, family) => {
    expect(projectileVisualKind(weapon)).toBe(family);
    expect(missileTrailProfile(weapon)).toEqual(missileTrailProfile(family));
    expect(missileTrailProfile(weapon).samples).toBeGreaterThan(10);
    expect(isRocketPowered(weapon)).toBe(true);
  });
  it.each(['heavyBomb', 'bomb', 'cannon', 'heavyCannon', 'siegeShell', 'grenade', 'clusterGrenade', 'rifleGrenade', 'emberDrone', 'fpvStrike'])('does not give %s a rocket motor', (weapon) => {
    expect(isRocketPowered(weapon)).toBe(false);
  });
});
