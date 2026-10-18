import {describe,it,expect} from 'vitest';
import {generateHeightfield} from './heightfield';
import {createGameSim,spawnWaspAt,stepSim} from './world';
import {threatBearing} from '../ui/threatBearing';
import {updateBaseActivity} from '../render/baseActivity';
import {Group} from 'three';
import type {Entity} from './components';
describe('base departures',()=>{
 it('spools, lifts vertically and then follows the existing aircraft order',()=>{
  const hf=generateHeightfield({cells:32,cellSize:4,seed:7,waterLevel:-10,oreFieldCount:0});const sim=createGameSim(hf);
  const plane=spawnWaspAt(sim,hf,0,0,'Wasp',1);const fromY=plane.transform.y!;
  plane.flight!.launch={startedTick:0,fromY};plane.mover!.target={x:40,z:0};
  for(let i=0;i<70;i++){stepSim(sim,hf,1/30);expect(plane.transform.x).toBe(0);expect(plane.transform.z).toBe(0);}
  expect(plane.mover!.target).toEqual({x:40,z:0});
  for(let i=0;i<30;i++){stepSim(sim,hf,1/30);}
  expect(plane.flight!.launch).toBeUndefined();expect(plane.transform.x).toBeGreaterThan(0);
 });
 it('allocates bounded repair visuals only for active work and hides them in fog',()=>{
  const root=new Group();root.userData.hullSize={fullW:16,fullD:16,height:5};
  const entity={id:1,building:{repair:{elapsed:0}}} as Entity;
  updateBaseActivity(root,entity,0,false);expect(root.children).toHaveLength(0);
  for(let tick=0;tick<1000;tick++)updateBaseActivity(root,entity,tick,true);
  expect(root.children).toHaveLength(1);expect(root.children[0].children).toHaveLength(3);
  updateBaseActivity(root,entity,1001,false);expect(root.children[0].visible).toBe(false);
 });
});
describe('threat bearing',()=>{
 it('uses map compass directions even if the camera rotates',()=>{
  expect(threatBearing(20,0,0,0)).toBe('EAST');expect(threatBearing(0,-20,0,0)).toBe('NORTH');
  expect(threatBearing(-20,20,0,0)).toBe('SOUTHWEST');expect(threatBearing(1,1,1,1)).toBe('OVERHEAD');
 });
});
