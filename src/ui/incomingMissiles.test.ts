import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { createEconomy, createInitialBase } from '../sim/economy';
import { generateHeightfield } from '../sim/heightfield';
import { createGameSim, type Projectile } from '../sim/world';
import { incomingMissileContacts } from './incomingMissiles';

function fixture() {
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  createInitialBase(sim, hf, createEconomy(1), 0, 0);
  const missile: Projectile = {
    kind: 'agMissile', weaponKind: 'agMissile', fromX: 300, fromZ: 300,
    toX: 0, toZ: 0,
    elapsed: 2, duration: 10, teamId: 2, attackerId: 999,
  };
  sim.projectiles.push(missile);
  return { sim, missile };
}

describe('incoming missile radar contacts', () => {
  it('shows approaching hostile missiles without needing visibility of their launch site', () => {
    const { sim } = fixture();
    const contacts = incomingMissileContacts(sim, 1);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].x).toBeCloseTo(240);
    expect(contacts[0].z).toBeCloseTo(240);
  });

  it('tracks live guided positions and removes intercepted/impacted rounds', () => {
    const { sim, missile } = fixture();
    missile.x = 123;
    missile.z = 98;
    expect(incomingMissileContacts(sim, 1)).toEqual([{ x: 123, z: 98 }]);
    sim.projectiles.length = 0;
    expect(incomingMissileContacts(sim, 1)).toEqual([]);
  });

  it('ignores allied missiles, queued launches, and rounds aimed elsewhere', () => {
    const { sim, missile } = fixture();
    sim.rules.allianceSides = { 1: 1, 2: 1 };
    expect(incomingMissileContacts(sim, 1)).toEqual([]);
    sim.rules.allianceSides = { 1: 1, 2: 2 };
    missile.launchDelay = 1;
    expect(incomingMissileContacts(sim, 1)).toEqual([]);
    missile.launchDelay = 0;
    missile.toX = 300;
    missile.toZ = -300;
    expect(incomingMissileContacts(sim, 1)).toEqual([]);
    missile.strategicTargetTeamId = 1;
    missile.strategic = true;
    expect(incomingMissileContacts(sim, 1)).toHaveLength(1);
  });

  it('ignores bombs and defensive interception rounds', () => {
    const { sim, missile } = fixture();
    missile.strategicInterceptor = { targetStrategicId: 99, damage: 10, sourceKind: 'tower' };
    expect(incomingMissileContacts(sim, 1)).toEqual([]);
    missile.strategicInterceptor = undefined;
    missile.kind = 'bomb';
    missile.weaponKind = 'bomb';
    expect(incomingMissileContacts(sim, 1)).toEqual([]);
  });
});
