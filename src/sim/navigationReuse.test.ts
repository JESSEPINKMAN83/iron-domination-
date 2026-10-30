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
describe('flow field build',()=>{
  // The pre-optimisation breadth-first fill, kept as the reference result.
  const referenceDistances=(nav:NavigationGrid,targetX:number,targetZ:number):Int32Array=>{
    const target=nav.nearestWalkableCell(targetX,targetZ)!;const distance=new Int32Array(nav.cells*nav.cells).fill(-1);
    const queue=new Int32Array(nav.cells*nav.cells);let head=0,tail=0;const start=nav.index(target.x,target.y);distance[start]=0;queue[tail++]=start;
    const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]] as const;
    while(head<tail){const cell=queue[head++];const cx=cell%nav.cells;const cy=Math.floor(cell/nav.cells);const base=distance[cell];
      for(const [dx,dy] of dirs){const nx=cx+dx,ny=cy+dy;if(!nav.isWalkableCell(nx,ny))continue;
        if(dx!==0&&dy!==0&&(!nav.isWalkableCell(cx+dx,cy)||!nav.isWalkableCell(cx,cy+dy)))continue;
        const ni=nav.index(nx,ny);if(distance[ni]!==-1)continue;distance[ni]=base+(dx===0||dy===0?10:14);queue[tail++]=ni;}}
    return distance;
  };
  it('matches the reference fill on obstructed terrain, including map edges',()=>{
    const hf=generateHeightfield({cells:96,cellSize:2,seed:7,waterLevel:-100,oreFieldCount:0});
    let rng=12345;const next=()=>((rng=(rng*1103515245+12345)>>>0)/2**32);
    for(let i=0;i<hf.walkable.length;i++) hf.walkable[i]=next()<0.22?0:1;
    const nav=new NavigationGrid(hf);
    for(const [x,z] of [[0,0],[-94,-94],[94,94],[-94,60],[37,-81]]){
      expect(new FlowField(nav,x,z).distance).toEqual(referenceDistances(nav,x,z));
    }
  });
});
