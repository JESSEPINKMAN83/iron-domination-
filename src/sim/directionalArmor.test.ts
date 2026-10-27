import {describe,expect,it} from 'vitest';
import {directionalArmorMultiplier} from './directionalArmor';
import {createGameSim,spawnTankAt} from './world';
import {generateHeightfield} from './heightfield';
import {manualFireAt,stepCombat} from './combat';

function fixture(){
  const hf=generateHeightfield({cells:64,cellSize:2,waterLevel:-100,oreFieldCount:0,seed:41});hf.heights.fill(0);hf.walkable.fill(1);
  const sim=createGameSim(hf),target=spawnTankAt(sim,0,0,'Target',2);target.transform.y=0;target.transform.rot=0;
  return {hf,sim,target};
}
describe('directional vehicle armor',()=>{
  it.each([0,Math.PI/2,Math.PI,-Math.PI/2])('uses hull orientation at rotation %s',rotation=>{
    const {target}=fixture();target.transform.rot=rotation;target.turret!.yaw=rotation+Math.PI;
    const shot=(angle:number)=>({fromX:Math.sin(angle)*40,fromZ:Math.cos(angle)*40,splashRadius:0,trajectory:'flat' as const});
    expect(directionalArmorMultiplier(target,shot(rotation))).toBe(1);
    expect(directionalArmorMultiplier(target,shot(rotation+Math.PI/2))).toBe(1.25);
    expect(directionalArmorMultiplier(target,shot(rotation-Math.PI/2))).toBe(1.25);
    expect(directionalArmorMultiplier(target,shot(rotation+Math.PI))).toBe(1.5);
  });
  it('does not multiply splash, artillery, bombs, steep top hits, infantry, buildings or aircraft',()=>{
    const {target}=fixture();const rear={fromX:0,fromY:2,fromZ:-40,splashRadius:0,trajectory:'flat' as const};
    expect(directionalArmorMultiplier(target,{...rear,splashRadius:12})).toBe(1);
    expect(directionalArmorMultiplier(target,{...rear,trajectory:'arc'})).toBe(1);
    expect(directionalArmorMultiplier(target,{...rear,trajectory:'drop'})).toBe(1);
    expect(directionalArmorMultiplier(target,{...rear,fromY:80})).toBe(1);
    expect(directionalArmorMultiplier({...target,armor:{kind:'infantry'}},rear)).toBe(1);
    expect(directionalArmorMultiplier({...target,building:{} as never},rear)).toBe(1);
    expect(directionalArmorMultiplier({...target,flight:{} as never},rear)).toBe(1);
  });
  it('applies the multiplier to real projectile damage in strategy/V-mode shared combat',()=>{
    const damage=(side:number)=>{
      const {sim,target}=fixture();target.health!.current=target.health!.max=1000;
      const attacker=spawnTankAt(sim,Math.sin(side)*40,Math.cos(side)*40,'Shooter',1);attacker.transform.y=0;attacker.turret!.yaw=Math.atan2(-attacker.transform.x,-attacker.transform.z);
      expect(manualFireAt(sim,attacker,0,0)).toBe(true);
      for(let i=0;i<90;i++)stepCombat(sim,1/30,{autoFire:false});
      return 1000-target.health!.current;
    };
    const front=damage(0),side=damage(Math.PI/2),rear=damage(Math.PI);
    expect(front).toBeGreaterThan(0);expect(side).toBeCloseTo(front*1.25);expect(rear).toBeCloseTo(front*1.5);
  });
});
