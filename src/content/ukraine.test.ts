import { canManualWeaponLockTarget } from '../sim/combat';
import { createEconomy, createInitialBase, queueUnit, stepEconomy } from '../sim/economy';
import { describe, expect, it } from 'vitest';
import { doctrineAllows, sanitizeArmyDoctrines } from './armyDoctrines';
import { nationsForDoctrines, applyArmyNations, armyName } from './nations';
import { applyUkraineProfile } from './ukraine';
import { WEAPONS } from './phase4';
import { MAP01 } from './map01';
import { generateHeightfield } from '../sim/heightfield';
import { createGameSim, spawnWaspAt, spawnHammerheadAt, spawnTankAt } from '../sim/world';
import { unitKindForUpgrade } from '../sim/upgrades';
import { unitVisualKind } from '../render/unitKinds';
import { serializeSim, restoreSerializedSim } from '../sim/serialize';

describe('Ukraine faction', () => {
  it('retains the third faction through setup and assigns its actual country', () => {
    expect(sanitizeArmyDoctrines(['drone-network','iron-legion','missile-command'])?.[0]).toBe('drone-network');
    expect(nationsForDoctrines(['drone-network','iron-legion','missile-command'])).toEqual(['ukraine','israel','iran']);
    applyArmyNations(['drone-network','iron-legion','missile-command']);
    expect(armyName(1)).toBe('Ukraine');
  });
  it('permits aviation and counter-UAS but reserves strategic programs for other factions', () => {
    expect(doctrineAllows('iron-legion','drone-network','helipad')).toBe(true);
    expect(doctrineAllows('iron-legion','drone-network','wasp')).toBe(true);
    expect(doctrineAllows('iron-legion','drone-network','skylance-ciws')).toBe(true);
    expect(doctrineAllows('iron-legion','drone-network','missile-defense')).toBe(false);
    expect(doctrineAllows('missile-command','drone-network','strategic-silo')).toBe(false);
    expect(doctrineAllows('iron-legion','missile-command','helipad')).toBe(false);
  });
  it('gives the FPV a single-use ground impact weapon and fragile hull without corrupting identity', () => {
    const hf = generateHeightfield(MAP01), sim = createGameSim(hf);
    const drone = spawnWaspAt(sim,hf,0,0,'Wasp',1);
    applyUkraineProfile(drone,'wasp');
    expect(drone.weapon?.kind).toBe('fpvStrike');
    expect(drone.weapons?.secondary).toBeUndefined();
    expect(drone.health?.max).toBeCloseTo(43.2);
    expect(drone.vision?.radius).toBeGreaterThan(230);
    expect(unitKindForUpgrade(drone)).toBe('wasp');
    expect(unitVisualKind(drone)).toBe('wasp');
    applyUkraineProfile(drone,'wasp');
    expect(drone.health?.max).toBeCloseTo(43.2);
    const state = serializeSim(sim);
    restoreSerializedSim(sim,hf,state);
    expect(sim.byId.get(drone.id)?.rosterKind).toBe('wasp');
  });
  it('applies the faction profile to a paid aircraft leaving production', () => {
    const hf = generateHeightfield({cells:128,cellSize:2,waterLevel:-100,seed:41,oreFieldCount:0});
    hf.heights.fill(10);hf.walkable.fill(1);
    const sim = createGameSim(hf), economy = createEconomy(1,5000,'drone-network');
    const base = createInitialBase(sim,hf,economy,0,0);
    sim.world.add({...base,id:sim.nextEntityId++,transform:{x:50,z:0,rot:0},previousTransform:{x:50,z:0,rot:0},
      building:{...base.building!,kind:'helipad',complete:true,powerProduced:40,powerUsed:0},
      producer:{tab:'aircraft',queue:[]}});
    expect(queueUnit(sim,economy,'wasp')).toBe(true);
    const produced = stepEconomy(sim,hf,economy,30).find(unit=>unit.flight);
    expect(produced?.rosterKind).toBe('wasp');
    expect(produced?.weapon?.kind).toBe('fpvStrike');
    expect(produced?.health?.max).toBeCloseTo(43.2);
  });
  it('trades strike payload and armor for reconnaissance and mobility', () => {
    const hf = generateHeightfield(MAP01), sim = createGameSim(hf);
    const tb2 = spawnHammerheadAt(sim,hf,0,0,'Hammerhead',1);
    applyUkraineProfile(tb2,'hammerhead');
    expect(tb2.weapons?.secondary?.salvoCount).toBe(1);
    expect(tb2.weapon?.kind).toBe('precisionMissile');
    expect(WEAPONS[tb2.weapon!.kind as keyof typeof WEAPONS].vs.air).toBe(0);
    expect(tb2.health?.max).toBeLessThan(130);
    expect(tb2.vision?.radius).toBeGreaterThan(220);
    const tank = spawnTankAt(sim,50,0,'M-17',1), health = tank.health!.max, speed = tank.mover!.speed;
    expect(canManualWeaponLockTarget(tb2.weapon!.kind, tank)).toBe(true);
    applyUkraineProfile(tank,'tank');
    expect(tank.health!.max).toBeCloseTo(health*.9);
    expect(tank.mover!.speed).toBeCloseTo(speed*1.1);
  });
});
