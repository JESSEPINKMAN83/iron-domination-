import {describe,expect,it} from 'vitest';
import {terrainLodIndices,terrainDetailStep} from './terrainLod';
describe('terrain detail budget',()=>{
  it.each([96,128,160,226])('covers the whole %s-cell chunk without cracks at either detail',cells=>{
    for(const step of [2,4] as const){
      const indices=terrainLodIndices(cells,step);let area=0;
      const edges=new Set<string>();
      const point=(i:number)=>({x:i%(cells+1),z:Math.floor(i/(cells+1))});
      for(let i=0;i<indices.length;i+=3){
        const p=[point(indices[i]),point(indices[i+1]),point(indices[i+2])];
        const twice=(p[1].z-p[0].z)*(p[2].x-p[0].x)-(p[1].x-p[0].x)*(p[2].z-p[0].z);
        expect(twice).toBeGreaterThan(0);area+=twice/2;
        for(let e=0;e<3;e++){const a=p[e],b=p[(e+1)%3];
          if(a.x===b.x&&(a.x===0||a.x===cells)||a.z===b.z&&(a.z===0||a.z===cells)){
            expect(Math.abs(a.x-b.x)+Math.abs(a.z-b.z)).toBe(1);
            edges.add([indices[i+e],indices[i+(e+1)%3]].sort((a,b)=>a-b).join(':'));
          }
        }
      }
      expect(area).toBe(cells*cells);expect(edges.size).toBe(cells*4);
      if(step===4) expect(indices.length).toBeLessThan(cells*cells*6*.1);
    }
  });
  it('uses hysteresis so small camera changes do not switch geometry repeatedly',()=>{
    expect(terrainDetailStep(200)).toBe(1);
    expect(terrainDetailStep(400)).toBe(2);
    expect(terrainDetailStep(650)).toBe(4);
    expect(terrainDetailStep(500,4)).toBe(4);
    expect(terrainDetailStep(250,2)).toBe(2);
    expect(terrainDetailStep(200,2)).toBe(1);
  });
});
