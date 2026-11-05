import { describe, expect, it } from 'vitest';
import { Mesh, MeshBasicMaterial } from 'three';
import { createUkraineAircraft } from './unitView';

const hull = new MeshBasicMaterial(), metal = new MeshBasicMaterial(), accent = new MeshBasicMaterial();
const materials = {hull, dark:metal, canvas:hull, uniform:hull, accent, lightBar:accent};
describe('lightweight Ukrainian UAV models', () => {
  it.each(['wasp','hammerhead'] as const)('%s keeps geometry and draw calls bounded and shares immutable geometry', kind => {
    const first = createUkraineAircraft(kind,materials,metal);
    const second = createUkraineAircraft(kind,materials,metal);
    const meshes: Mesh[] = [], next: Mesh[] = [];
    first.root.traverse(part => { if (part instanceof Mesh) meshes.push(part); });
    second.root.traverse(part => { if (part instanceof Mesh) next.push(part); });
    expect(meshes.length).toBeLessThanOrEqual(12);
    expect(meshes.reduce((sum,m)=>sum+(m.geometry.index?.count ?? m.geometry.attributes.position.count)/3,0)).toBeLessThan(1800);
    expect(meshes.every((m,i)=>m.geometry === next[i].geometry)).toBe(true);
  });
});
