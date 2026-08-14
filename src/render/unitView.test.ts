import { describe, expect, it } from 'vitest';
import {
  groundVehicleTerrainAttitude,
  groundVehicleImpactPose,
  impactReactionProfile,
  infantryImpactPose,
  shouldKeepDetailedUnitInPerformanceMode,
  unitDamageStage,
} from './unitView';
import type { Heightfield } from '../sim/heightfield';

function planarHeightfield(slopeX: number, slopeZ: number): Heightfield {
  const cells = 16;
  const cellSize = 2;
  const samples = cells + 1;
  const size = cells * cellSize;
  const half = size / 2;
  const heights = new Float32Array(samples * samples);
  for (let z = 0; z < samples; z++) {
    for (let x = 0; x < samples; x++) {
      heights[z * samples + x] = (x * cellSize - half) * slopeX + (z * cellSize - half) * slopeZ;
    }
  }
  return {
    kind: 'highlands', cells, cellSize, samples, size, waterLevel: -100, maxHeight: 100,
    heights, walkable: new Uint8Array(cells * cells).fill(1), splat: new Uint8Array(samples * samples * 4), oreFields: [],
  };
}

describe('ground vehicle terrain attitude', () => {
  it('pitches the nose uphill and follows cross-slope roll', () => {
    const uphill = groundVehicleTerrainAttitude(planarHeightfield(0, 0.5), 0, 0, 0, 2.2);
    expect(uphill.pitch).toBeLessThan(-0.4);
    expect(uphill.roll).toBeCloseTo(0, 5);

    const crossSlope = groundVehicleTerrainAttitude(planarHeightfield(0.4, 0), 0, 0, 0, 2.2);
    expect(crossSlope.pitch).toBeCloseTo(0, 5);
    expect(crossSlope.roll).toBeGreaterThan(0.35);
    expect(crossSlope.y).toBeCloseTo(0, 5);
  });

  it('uses vehicle heading when deciding which end is uphill', () => {
    const attitude = groundVehicleTerrainAttitude(planarHeightfield(0.5, 0), 0, 0, Math.PI / 2, 2.2);
    expect(attitude.pitch).toBeLessThan(-0.4);
    expect(attitude.roll).toBeCloseTo(0, 5);
  });

  it('keeps extreme traversable slopes within a stable visual tilt', () => {
    const forward = groundVehicleTerrainAttitude(planarHeightfield(0, 2), 0, 0, 0, 2.2);
    const sideways = groundVehicleTerrainAttitude(planarHeightfield(2, 0), 0, 0, 0, 2.2);

    expect(Math.abs(forward.pitch)).toBeLessThanOrEqual(Math.PI * (32 / 180) + 1e-8);
    expect(Math.abs(sideways.roll)).toBeLessThanOrEqual(Math.PI * (32 / 180) + 1e-8);
  });
});

describe('performance-mode unit detail', () => {
  const base = {
    distanceSquared: 900 * 900,
    selected: false,
    playerControlled: false,
    priority: false,
    resolvedByFortressOptics: false,
    crashingAircraft: false,
    destroyed: false,
  };

  it('keeps nearby, selected, controlled, and targeted units fully modeled', () => {
    expect(shouldKeepDetailedUnitInPerformanceMode({ ...base, distanceSquared: 100 * 100 })).toBe(true);
    expect(shouldKeepDetailedUnitInPerformanceMode({ ...base, selected: true })).toBe(true);
    expect(shouldKeepDetailedUnitInPerformanceMode({ ...base, playerControlled: true })).toBe(true);
    expect(shouldKeepDetailedUnitInPerformanceMode({ ...base, priority: true })).toBe(true);
    expect(shouldKeepDetailedUnitInPerformanceMode({ ...base, resolvedByFortressOptics: true })).toBe(true);
    expect(shouldKeepDetailedUnitInPerformanceMode({ ...base, crashingAircraft: true, destroyed: true })).toBe(true);
  });

  it('simplifies only distant background units and completed wrecks', () => {
    expect(shouldKeepDetailedUnitInPerformanceMode(base)).toBe(false);
    expect(shouldKeepDetailedUnitInPerformanceMode({ ...base, distanceSquared: 100, selected: true, destroyed: true })).toBe(false);
  });
});

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
  const sideHit = {
    zone: 'left' as const,
    localSide: 1,
    localForward: 0,
  };

  it('rocks a surviving vehicle and returns it upright without yawing', () => {
    const weak = groundVehicleImpactPose({ progress: 0.2, force: 0.25, ...sideHit });
    const strong = groundVehicleImpactPose({ progress: 0.2, force: 1, intensity: 1.2, ...sideHit });

    expect(Math.abs(weak.roll)).toBeGreaterThan(0);
    expect(Math.abs(strong.roll)).toBeGreaterThan(Math.abs(weak.roll));
    expect(Math.abs(strong.roll)).toBeLessThan(Math.PI);
    expect(Math.abs(groundVehicleImpactPose({ progress: 0, force: 1, ...sideHit }).pitch)).toBeCloseTo(0, 10);
    expect(Math.abs(groundVehicleImpactPose({ progress: 0, force: 1, ...sideHit }).roll)).toBeCloseTo(0, 10);
    expect(groundVehicleImpactPose({ progress: 0, force: 1, ...sideHit }).lift).toBeCloseTo(0, 10);
    expect(groundVehicleImpactPose({ progress: 1, force: 1, intensity: 1.2, ...sideHit }).roll).toBeCloseTo(0, 10);
    expect(groundVehicleImpactPose({ progress: 1, force: 1, intensity: 1.2, ...sideHit }).pitch).toBeCloseTo(0, 10);
  });

  it('can flip a tank onto its side from a fatal high-speed side strike', () => {
    const pose = groundVehicleImpactPose({
      progress: 1,
      force: 0.9,
      intensity: 1.2,
      killed: true,
      ...sideHit,
    });
    expect(pose.flip).toBe(true);
    expect(Math.abs(pose.roll)).toBeGreaterThan(Math.PI * 0.45);
    expect(Math.abs(pose.roll)).toBeLessThan(Math.PI);
    expect(Math.abs(pose.pitch)).toBeLessThan(0.4);
  });

  it('rolls opposite ways for left and right flank hits', () => {
    const left = groundVehicleImpactPose({
      progress: 0.25,
      force: 1,
      intensity: 1.2,
      zone: 'left',
      localSide: 1,
      localForward: 0,
    });
    const right = groundVehicleImpactPose({
      progress: 0.25,
      force: 1,
      intensity: 1.2,
      zone: 'right',
      localSide: -1,
      localForward: 0,
    });
    expect(left.roll).toBeLessThan(0);
    expect(right.roll).toBeGreaterThan(0);
  });

  it('never completes extra revolutions while tumbling', () => {
    for (const killed of [false, true]) {
      for (const t of [0, 0.15, 0.35, 0.55, 0.8, 1]) {
        const pose = groundVehicleImpactPose({
          progress: t,
          force: 1,
          intensity: 1.5,
          killed,
          ...sideHit,
        });
        expect(Math.abs(pose.roll)).toBeLessThanOrEqual(Math.PI);
        expect(Math.abs(pose.pitch)).toBeLessThanOrEqual(Math.PI);
      }
    }
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
