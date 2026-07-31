import { describe, expect, it } from 'vitest';
import { directionalImpactResponse, type DirectionalImpactInput } from './impactModel';

const BASE: DirectionalImpactInput = {
  targetX: 0,
  targetY: 0,
  targetZ: 0,
  targetRot: 0,
  targetRadius: 2.5,
  armor: 'light',
  force: 0.72,
  fromX: 16,
  fromZ: 0,
  hitX: 0,
  hitZ: 0,
  splashRadius: 0,
  trajectory: 'flat',
};

describe('directional impact model', () => {
  it('identifies the struck side and pushes away from it', () => {
    const response = directionalImpactResponse(BASE);
    expect(response.zone).toBe('right');
    expect(response.directionX).toBeLessThan(-0.99);
    expect(response.angularImpulse).toBeLessThan(0);
  });

  it('makes a top strike more vertical and less horizontal', () => {
    const side = directionalImpactResponse(BASE);
    const top = directionalImpactResponse({
      ...BASE,
      fromX: 0,
      fromY: 30,
      fromZ: -2,
      hitY: 2.5,
      trajectory: 'drop',
    });
    expect(top.zone).toBe('top');
    expect(top.verticalImpulse).toBeGreaterThan(side.verticalImpulse);
    expect(top.impulseSpeed).toBeLessThan(side.impulseSpeed);
  });

  it('moves a light vehicle more than a heavy tank for the same strike', () => {
    const light = directionalImpactResponse(BASE);
    const heavy = directionalImpactResponse({ ...BASE, armor: 'heavy' });
    expect(light.impulseSpeed).toBeGreaterThan(heavy.impulseSpeed);
    expect(Math.abs(light.angularImpulse)).toBeGreaterThan(Math.abs(heavy.angularImpulse));
  });

  it('keeps a near miss directional but weaker than a direct hit', () => {
    const direct = directionalImpactResponse(BASE);
    const near = directionalImpactResponse({
      ...BASE,
      fromX: 18,
      hitX: 5,
      splashRadius: 8,
    });
    expect(near.zone).toBe('near');
    expect(near.directness).toBeLessThan(1);
    expect(near.impulseSpeed).toBeLessThan(direct.impulseSpeed);
    expect(near.directionX).toBeLessThan(0);
  });
});
