import { describe, expect, it } from 'vitest';
import { groundVehicleImpactPose, impactReactionProfile } from './unitView';

describe('groundVehicleImpactPose', () => {
  it('rocks a surviving vehicle briefly and returns it exactly upright', () => {
    const weak = groundVehicleImpactPose(0.25, 0.3);
    const strong = groundVehicleImpactPose(1, 0.3);

    expect(weak.angle).toBeGreaterThan(0);
    expect(strong.angle).toBeGreaterThan(weak.angle);
    expect(strong.angle).toBeLessThanOrEqual(Math.PI / 15);
    expect(groundVehicleImpactPose(1, 0)).toEqual({ angle: 0, lift: 0 });
    expect(groundVehicleImpactPose(1, 1).angle).toBeCloseTo(0, 10);
    expect(groundVehicleImpactPose(1, 1).lift).toBeCloseTo(0, 10);
  });
});

describe('impactReactionProfile', () => {
  it('throws infantry much farther when struck by a siege missile than by rifle fire', () => {
    const rifle = impactReactionProfile(0.7, 'rifle', 'rifle');
    const missile = impactReactionProfile(0.7, 'siegeMissile', 'rifle');

    expect(missile.shove).toBeGreaterThan(rifle.shove * 2);
    expect(missile.lift).toBeGreaterThan(rifle.lift * 2);
    expect(missile.angular).toBeGreaterThan(rifle.angular * 2);
  });

  it('makes a scout tank react more than a siege tank to the same heavy hit', () => {
    const scout = impactReactionProfile(0.8, 'siegeMissile', 'jackal');
    const siege = impactReactionProfile(0.8, 'siegeMissile', 'mauler');

    expect(scout.intensity).toBeGreaterThan(siege.intensity);
    expect(scout.shove).toBeGreaterThan(siege.shove);
    expect(scout.angular).toBeGreaterThan(siege.angular);
  });

  it('extends fatal infantry reactions so the death pose follows the airborne hit', () => {
    const surviving = impactReactionProfile(1, 'tankBomb', 'grenadier');
    const fatal = impactReactionProfile(1, 'tankBomb', 'grenadier', true);

    expect(fatal.duration).toBeGreaterThan(surviving.duration);
    expect(fatal.shove).toBeGreaterThan(surviving.shove);
    expect(fatal.lift).toBeGreaterThan(surviving.lift);
  });
});
