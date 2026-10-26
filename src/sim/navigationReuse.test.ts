import {describe,expect,it} from 'vitest';
import {FlowField,NavigationGrid} from './flowfield';
import {generateHeightfield} from './heightfield';
describe('navigation reuse',()=>{
  it('returns equivalent routes, reuses scratch memory and invalidates cached routes when buildings change',()=>{
    const hf=generateHeightfield({cells:64,cellSize:2,seed:41,waterLevel:-100,oreFieldCount:0});hf.walkable.fill(1);
    const nav=new NavigationGrid(hf);const field=nav.flowTo(30,30);
    expect(nav.flowTo(30,30)).toBe(field);
    expect(nav.flowTo(30,30).distance).toEqual(new FlowField(nav,30,30).distance);
    const queue=nav.flowBuildQueue();nav.flowTo(-30,-30);expect(nav.flowBuildQueue()).toBe(queue);
    nav.setDynamicBlocker(1,0,0,8);
    const changed=nav.flowTo(30,30);expect(changed).not.toBe(field);
    expect(changed.distance).toEqual(new FlowField(nav,30,30).distance);
    const blocked=nav.worldToCell(0,0);expect(changed.distance[nav.index(blocked.x,blocked.y)]).toBe(-1);
  });
});
