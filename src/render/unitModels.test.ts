import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Box3, Mesh, Object3D, OrthographicCamera, Vector3 } from 'three';
import { frameBuildingPortrait } from './buildingPortraits';
import { createUnitPreview, disposeUnitPreview, UNIT_PORTRAIT_MODELS } from './unitView';

beforeAll(() => {
  const context = new Proxy({}, { get: (_target, key) => {
    if (key === 'measureText') return () => ({ width: 100 });
    if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
    return () => {};
  } });
  vi.stubGlobal('document', { createElement: () => ({ width: 512, height: 128, getContext: () => context }) });
});
afterAll(() => vi.unstubAllGlobals());

describe('unit model rendering contracts', () => {
  for (const kind of Object.keys(UNIT_PORTRAIT_MODELS)) it(`frames and shares ${kind} geometry within a bounded detail budget`, () => {
    const model = createUnitPreview(kind);
    const camera = new OrthographicCamera();
    frameBuildingPortrait(camera, model);
    const bounds = new Box3().setFromObject(model);
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const point = new Vector3(x, y, z).project(camera);
      expect(Math.abs(point.x)).toBeLessThan(1);
      expect(Math.abs(point.y)).toBeLessThan(1);
      expect(Math.abs(point.z)).toBeLessThan(1);
    }
    const meshes: Mesh[] = [];
    model.traverse(child => { if (child instanceof Mesh) meshes.push(child); });
    expect(meshes.length).toBeLessThan(100);
    const triangles = meshes.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3, 0);
    expect(triangles).toBeLessThan(15000);
    const shared = meshes.filter(mesh => mesh.geometry.userData.ironDominionSharedUnitGeometry);
    expect(shared.length).toBeGreaterThan(0);
    const onDispose = vi.fn();
    shared[0].geometry.addEventListener('dispose', onDispose);
    disposeUnitPreview(model);
    expect(onDispose).not.toHaveBeenCalled();
    const second = createUnitPreview(kind, 2);
    let reused = false;
    second.traverse(child => { if (child instanceof Mesh && child.geometry === shared[0].geometry) reused = true; });
    expect(reused).toBe(true);
    shared[0].geometry.removeEventListener('dispose', onDispose);
    disposeUnitPreview(second);
  });

  it('preserves independent rotor, missile, recoil, and harvesting animation pivots', () => {
    for (const kind of ['wasp', 'vulture', 'hammerhead', 'tank', 'harvester']) {
      const model = createUnitPreview(kind);
      const refs = model.userData.unitRefs;
      const attached = (object: Object3D) => {
        let current: Object3D | null = object;
        while (current && current !== model) current = current.parent;
        expect(current).toBe(model);
      };
      if (kind === 'tank') { attached(refs.turretPivot); attached(refs.barrelPivot); }
      else if (kind === 'harvester') { attached(refs.harvestingRotor); attached(refs.scoop); attached(refs.cargoLoad); }
      else {
        expect(refs.mainRotors).toHaveLength(kind === 'hammerhead' ? 2 : 1);
        refs.mainRotors.forEach(attached);
        if (kind === 'hammerhead') { expect(refs.missileRack).toHaveLength(8); refs.missileRack.forEach(attached); }
        else { expect(refs.tailRotors).toHaveLength(1); refs.tailRotors.forEach(attached); }
      }
      disposeUnitPreview(model);
    }
  });
});
