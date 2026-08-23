import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { generateHeightfield } from './heightfield';
import { createEconomy, createInitialBase } from './economy';
import { createGameSim, spawnTankAt } from './world';
import { stepCombat } from './combat';
import { INBOUND_PROFILES, inboundThreatensTeam, launchStrategicMissile, stepInboundMissiles, tryLaunchAiStrategicStrike } from './strategicWarfare';

describe('strategic inbound missiles', () => {
  it('keeps circular error probable deterministic for the same launch', () => {
    const hf = generateHeightfield(MAP01);
    const simA = createGameSim(hf);
    const simB = createGameSim(hf);
    const options = { teamId: 2, fromX: -80, fromZ: 12, toX: 40, toZ: -18, launcherId: 9 };
    const a = launchStrategicMissile(simA, hf, options);
    const b = launchStrategicMissile(simB, hf, options);
    expect(a.inboundMissile!.toX).toBe(b.inboundMissile!.toX);
    expect(a.inboundMissile!.toZ).toBe(b.inboundMissile!.toZ);
    expect(a.health!.max).toBe(INBOUND_PROFILES.ballistic.health);
  });

  it('climbs through a high arc and detonates on arrival', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const inbound = launchStrategicMissile(sim, hf, {
      teamId: 2,
      fromX: -90,
      fromZ: 0,
      toX: 40,
      toZ: 0,
    });
    const victim = spawnTankAt(sim, inbound.inboundMissile!.toX, inbound.inboundMissile!.toZ, 'Target', 1);
    const mid = inbound.inboundMissile!.flightTime * 0.5;
    for (let i = 0; i < Math.round(mid * 30); i++) stepInboundMissiles(sim, 1 / 30);
    expect(inbound.transform.y).toBeGreaterThan(inbound.inboundMissile!.launchY + inbound.inboundMissile!.peakAltitude * 0.7);

    for (let i = 0; i < Math.round((inbound.inboundMissile!.flightTime - mid + 0.2) * 30); i++) stepCombat(sim, 1 / 30);
    expect(sim.events.some((event) => event.kind === 'inbound-impact')).toBe(true);
    expect(inbound.destroyed).toBeDefined();
    expect(victim.health!.current).toBeLessThan(victim.health!.max);
  });

  it('scales health with missile size so larger warheads take more intercepts', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const heavy = launchStrategicMissile(sim, hf, {
      teamId: 2,
      fromX: 0,
      fromZ: 0,
      toX: 20,
      toZ: 0,
      sizeScale: 1.8,
    });
    expect(heavy.health!.max).toBe(Math.round(INBOUND_PROFILES.ballistic.health * 1.8));
  });

  it('lets an AI team fire a periodic strike at a hostile command yard', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    createInitialBase(sim, hf, createEconomy(1), -90, -80);
    const enemyYard = createInitialBase(sim, hf, createEconomy(2), 90, 80);
    expect(tryLaunchAiStrategicStrike(sim, hf, 2)).toBeUndefined();

    let missile: ReturnType<typeof tryLaunchAiStrategicStrike>;
    for (let tick = 0; tick <= 30 * 20; tick++) {
      sim.tick = tick;
      missile = tryLaunchAiStrategicStrike(sim, hf, 2);
      if (missile) break;
    }
    expect(missile?.inboundMissile).toBeDefined();
    expect(missile?.team?.id).toBe(2);
    expect(Math.hypot(
      (missile!.inboundMissile!.fromX - enemyYard.transform.x),
      (missile!.inboundMissile!.fromZ - enemyYard.transform.z),
    )).toBeLessThan(1);
    expect(tryLaunchAiStrategicStrike(sim, hf, 2)).toBeUndefined();
  });

  it('keeps AI strike profile and impact deterministic for the same tick', () => {
    const hf = generateHeightfield(MAP01);
    const simA = createGameSim(hf);
    const simB = createGameSim(hf);
    createInitialBase(simA, hf, createEconomy(1), -90, -80);
    createInitialBase(simA, hf, createEconomy(2), 90, 80);
    createInitialBase(simB, hf, createEconomy(1), -90, -80);
    createInitialBase(simB, hf, createEconomy(2), 90, 80);
    simA.tick = 256;
    simB.tick = 256;
    const a = tryLaunchAiStrategicStrike(simA, hf, 2);
    const b = tryLaunchAiStrategicStrike(simB, hf, 2);
    expect(a?.inboundMissile?.profile).toBe(b?.inboundMissile?.profile);
    expect(a?.inboundMissile?.toX).toBe(b?.inboundMissile?.toX);
    expect(a?.inboundMissile?.toZ).toBe(b?.inboundMissile?.toZ);
    expect(a?.inboundMissile?.sizeScale).toBe(b?.inboundMissile?.sizeScale);
  });

  it('treats an inbound as a battery threat only when it will hit friendly buildings', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const yard = createInitialBase(sim, hf, createEconomy(1), -40, -20);
    const atYard = launchStrategicMissile(sim, hf, {
      teamId: 2,
      fromX: 80,
      fromZ: 0,
      toX: yard.transform.x,
      toZ: yard.transform.z,
    });
    const intoDesert = launchStrategicMissile(sim, hf, {
      teamId: 2,
      fromX: 90,
      fromZ: 10,
      toX: yard.transform.x + 260,
      toZ: yard.transform.z + 260,
    });
    expect(inboundThreatensTeam(sim, atYard, 1)).toBe(true);
    expect(inboundThreatensTeam(sim, intoDesert, 1)).toBe(false);
  });
});
