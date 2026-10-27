import {describe,expect,it,vi,afterEach} from 'vitest';
import {EnemyCommander} from './commander';
import {generateHeightfield} from '../sim/heightfield';
import {createGameSim,spawnWaspAt,spawnVultureAt,spawnTankAt} from '../sim/world';
import {createEconomy,createInitialBase} from '../sim/economy';
import {VisibilityGrid} from '../sim/visibility';
import type {Difficulty} from '../content/phase6';

function fixture(difficulty:Difficulty='hard',doctrine:'iron-legion'|'missile-command'='iron-legion'){
  vi.spyOn(console,'info').mockImplementation(()=>{});
  const hf=generateHeightfield({cells:128,cellSize:2,waterLevel:-100,seed:41,oreFieldCount:0});hf.heights.fill(10);hf.walkable.fill(1);
  const sim=createGameSim(hf),economy=createEconomy(2,10000,doctrine);
  const base=createInitialBase(sim,hf,economy,-70,-70),vision=new VisibilityGrid(hf,2);
  const commander=new EnemyCommander(sim,hf,economy,vision,'balanced',difficulty,[{x:70,z:70}]);
  const control=commander as unknown as {buildQueue:string[];commandAirWings():void;commandSquads():void;maintainProduction():void;commandStrategicStrike():void;elapsed:number;nextAircraftKind(count:number):string};
  return {hf,sim,economy,base,vision,commander,control};
}
afterEach(()=>vi.restoreAllMocks());
describe('enemy air command',()=>{
  it.each(['normal','hard','extra-hard'] as const)('funds an early air base on %s instead of leaving air tech until after ground expansion',difficulty=>{
    const {control}=fixture(difficulty);expect(control.buildQueue.indexOf('helipad')).toBe(control.buildQueue.indexOf('factory')+1);
  });
  it('sends a fighter to intercept visible hostile aircraft and engages its air-to-air weapon',()=>{
    const {hf,sim,vision,control,commander}=fixture();
    const fighter=spawnWaspAt(sim,hf,-40,0,'Interceptor',2),enemy=spawnVultureAt(sim,hf,50,0,'Enemy aircraft',1);
    vision.update(sim);control.commandAirWings();
    expect(fighter.mover!.target).toBeDefined();expect(fighter.mover!.aggressive).toBe(true);
    expect(fighter.weapons!.secondary!.targetId).toBe(enemy.id);expect(commander.stats.airIntercepts).toBe(1);
    expect(control.nextAircraftKind(2)).toBe('wasp');
  });
  it('keeps hidden aircraft out of target selection and sends spare aircraft scouting without a ground squad',()=>{
    const {hf,sim,vision,control,commander}=fixture();
    const strike=spawnVultureAt(sim,hf,-40,0,'Strike wing',2);
    spawnWaspAt(sim,hf,100,100,'Hidden enemy',1);
    vi.spyOn(vision,'isVisibleWorld').mockReturnValue(false);control.commandAirWings();
    expect(strike.weapon!.targetId).toBeUndefined();expect(strike.mover!.target).toBeDefined();expect(commander.stats.airRaids).toBe(1);
  });
  it('Extra Hard strikes known air defenses before exposed ground units',()=>{
    const {hf,sim,vision,control}=fixture('extra-hard');
    const strike=spawnVultureAt(sim,hf,-30,0,'Raid',2);
    const defense=spawnTankAt(sim,30,0,'AA tower',1);defense.building={kind:'aa-tower',label:'AA',complete:true,buildProgress:1,footprint:{w:1,h:1},powerProduced:0,powerUsed:0};
    spawnTankAt(sim,10,0,'Decoy tank',1);vision.update(sim);control.commandAirWings();expect(strike.weapon!.targetId).toBe(defense.id);
  });
  it('Extra Hard Iran pays for missile accuracy upgrades once its real prerequisites exist',()=>{
    const {sim,economy,base,control}=fixture('extra-hard','missile-command');
    for(const kind of ['intelligence-center','strategic-silo']) sim.world.add({...base,id:sim.nextEntityId++,transform:{...base.transform},building:{...base.building!,kind}});
    control.elapsed=200;const credits=economy.credits;control.commandStrategicStrike();
    expect(economy.strategicAccuracyLevel).toBe(1);expect(economy.credits).toBeLessThan(credits);
  });
  it('keeps Iran doctrine-specific and gives Extra Hard coordinated ground assaults',()=>{
    const {sim,control,commander}=fixture('extra-hard','missile-command');
    expect(control.buildQueue).not.toContain('helipad');
    for(let i=0;i<24;i++) spawnTankAt(sim,-30+i%6*8,-30+Math.floor(i/6)*8,'Assault',2);
    control.elapsed=200;control.commandSquads();control.commandSquads();expect(commander.stats.coordinatedAttacks).toBeGreaterThan(0);
  });
});
