import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../content/phase4';
import { reticleReloadState } from './hud';

describe('V-mode reticle reload indicators', () => {
  it('fills from empty to ready using the selected weapon reload duration', () => {
    const reload = WEAPONS.tankMissile.cooldown;

    expect(reticleReloadState('tankMissile', reload)).toEqual({
      available: true,
      ready: false,
      progress: 0,
    });
    expect(reticleReloadState('tankMissile', reload / 2)).toEqual({
      available: true,
      ready: false,
      progress: 0.5,
    });
    expect(reticleReloadState('tankMissile', 0)).toEqual({
      available: true,
      ready: true,
      progress: 1,
    });
  });

  it('hides a rail when that click slot has no weapon', () => {
    expect(reticleReloadState(undefined, 0)).toEqual({
      available: false,
      ready: false,
      progress: 0,
    });
  });
});
