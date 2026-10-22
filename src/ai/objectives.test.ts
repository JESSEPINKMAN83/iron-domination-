import { afterEach,describe,expect,it,vi } from 'vitest';
import { MAP01 } from '../content/map01';
import { createEconomy,createInitialBase } from '../sim/economy';
import { generateHeightfield } from '../sim/heightfield';
import { seedObjectives } from '../sim/objectives';
import { VisibilityGrid } from '../sim/visibility';
import { createGameSim,spawnTankAt } from '../sim/world';
import { EnemyCommander } from './commander';
afterEach(()=>vi.restoreAllMocks());
describe('AI capture detachments',()=>{
  it.each(['iron-legion','missile-command'] as const)('%s contests sites without consuming its assault army',doctrine=>{
    vi.spyOn(console,'info').mockImplementation(()=>{});
    const hf=generateHeightfield(MAP01);hf.heights.fill(0);hf.walkable.fill(1);
    const sim=createGameSim(hf), economy=createEconomy(2,5000,doctrine);
    createInitialBase(sim,hf,economy,-220,0);seedObjectives(sim,hf);
    const units=Array.from({length:10},(_,i)=>spawnTankAt(sim,-150+i*8,0,`AI ${i}`,2));
    const commander=new EnemyCommander(sim,hf,economy,new VisibilityGrid(hf,2),'balanced','hard');
    const control=commander as unknown as {elapsed:number;commandObjectives():void;commandSquads():void;squads:{units:typeof units}[]};
    control.elapsed=50;control.commandObjectives();
    const scouts=units.filter(unit=>unit.mover!.objectiveDuty);expect(scouts).toHaveLength(2);
    expect(scouts.every(unit=>!!unit.mover!.target)).toBe(true);
    const target=scouts[0].mover!.target;
    control.commandObjectives();expect(scouts[0].mover!.target).toBe(target);
    control.commandSquads();expect(control.squads.flatMap(squad=>squad.units).every(unit=>!scouts.includes(unit))).toBe(true);
    for(const site of sim.objectivesQuery)site.objective.ownerTeam=2;
    control.commandObjectives();expect(units.every(unit=>unit.mover!.objectiveDuty===undefined)).toBe(true);
  });
});
