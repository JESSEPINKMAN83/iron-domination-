import { describe, expect, it } from 'vitest';
import { groundVehicleImpactPose, impactReactionProfile, infantryImpactPose, unitDamageStage } from './unitView';

describe('unitDamageStage', () => {
  it('uses three stable visual thresholds at 75%, 50%, and 25% health', () => {
    expect(unitDamageStage(100, 100)).toBe(0);
    expect(unitDamageStage(76, 100)).toBe(0);
    expect(unitDamageStage(75, 100)).toBe(1);
    expect(unitDamageStage(51, 100)).toBe(1);
    expect(unitDamageStage(50, 100)).toBe(2);
    expect(unitDamageStage(26, 100)).toBe(2);
    expect(unitDamageStage(25, 100)).toBe(3);
    expect(unitDamageStage(1, 100)).toBe(3);
  });

  it('clamps unusual values without creating a false damage state', () => {
    expect(unitDamageStage(150, 100)).toBe(0);
    expect(unitDamageStage(Number.NaN, 100)).toBe(0);
    expect(unitDamageStage(50, 0)).toBe(0);
  });
});

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

describe('infantryImpactPose', () => {
  it('uses a readable launch, ground contact, brace, and recovery sequence', () => {
    const airborne = infantryImpactPose(0.1, 1.1, 1, 0);
    const grounded = infantryImpactPose(0.36, 1.1, 1, 0);
    const brace = infantryImpactPose(0.62, 1.1, 1, 0);
    const recover = infantryImpactPose(0.86, 1.1, 1, 0);
    const finished = infantryImpactPose(1, 1.1, 1, 0);

    expect(airborne.phase).toBe('airborne');
    expect(airborne.lift).toBeGreaterThan(0);
    expect(grounded.phase).toBe('grounded');
    expect(grounded.grounded).toBe(1);
    expect(brace.phase).toBe('brace');
    expect(brace.brace).toBeGreaterThan(0);
    expect(recover.phase).toBe('recover');
    expect(recover.crouch).toBeGreaterThan(0);
    expect(finished.pitch).toBeCloseTo(0, 10);
    expect(finished.roll).toBeCloseTo(0, 10);
    expect(finished.limbBlend).toBeCloseTo(0, 10);
  });

  it('turns weak hits into a stumble instead of a full knockdown', () => {
    const weak = infantryImpactPose(0.35, 0.12, -1, 0);
    const heavy = infantryImpactPose(0.35, 1.2, -1, 0);

    expect(weak.phase).toBe('stumble');
    expect(weak.grounded).toBe(0);
    expect(heavy.phase).toBe('grounded');
    expect(Math.abs(heavy.roll)).toBeGreaterThan(Math.abs(weak.roll));
  });

  it('keeps a fatal reaction grounded rather than playing the stand-up phase', () => {
    const fatal = infantryImpactPose(0.9, 1.2, 0.8, 0.2, true);
    expect(fatal.phase).toBe('grounded');
    expect(fatal.grounded).toBe(1);
    expect(fatal.brace).toBe(0);
  });
});
