import { describe, expect, it } from 'vitest';
import { Mesh, MeshBasicMaterial, Box3 } from 'three';
import { createUSAircraft } from './unitView';
const hull=new MeshBasicMaterial(),metal=new MeshBasicMaterial(),accent=new MeshBasicMaterial();
const materials={hull,dark:new MeshBasicMaterial(),canvas:hull,uniform:hull,accent,lightBar:accent};
describe('US specialist aircraft model budgets',()=>{
  it.each(['strike-jet','bomber'] as const)('%s shares geometry and bounds draw calls',kind=>{
    const first=createUSAircraft(kind,materials,metal),second=createUSAircraft(kind,materials,metal);
    const meshes:Mesh[]=[],next:Mesh[]=[];
    first.root.traverse(p=>{if(p instanceof Mesh)meshes.push(p);});second.root.traverse(p=>{if(p instanceof Mesh)next.push(p);});
    expect(meshes.length).toBeLessThanOrEqual(5);
    expect(meshes.reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0)).toBeLessThan(350);
    expect(meshes.every((m,i)=>m.geometry===next[i].geometry)).toBe(true);
    if(kind==='bomber'){
      const bounds=new Box3().setFromObject(first.root);expect(bounds.max.x-bounds.min.x).toBeGreaterThan(27);
      const wing=meshes.find(m=>m.geometry.attributes.position.count===24)!;
      expect(wing).toBeDefined();expect(wing.geometry.attributes.normal.getY(0)).toBeGreaterThan(0);
    }
  });
});
