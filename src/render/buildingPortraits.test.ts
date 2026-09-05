import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Box3, Mesh, OrthographicCamera, Raycaster, Vector3 } from 'three';
import { BUILDING_PORTRAIT_KINDS, frameBuildingPortrait, isBuildingPortrait } from './buildingPortraits';
import { createBuildingPreview, disposeBuildingPreview } from './buildingView';

// Canvas drawing is browser-verified; these checks exercise real Three geometry,
// complete-model framing, and the damage metadata used by the battlefield.
beforeAll(() => {
  const context = new Proxy({}, { get: (_target, key) => {
    if (key === 'measureText') return () => ({ width: 100 });
    if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
    return () => {};
  } });
  vi.stubGlobal('document', { createElement: () => ({ width: 512, height: 128, getContext: () => context }) });
});
afterAll(() => vi.unstubAllGlobals());

describe('building model and portrait parity', () => {
  it('keeps unit art separate and includes a distinct Skylance portrait', () => {
    expect(isBuildingPortrait('tank')).toBe(false);
    expect(isBuildingPortrait('toString')).toBe(false);
    expect(BUILDING_PORTRAIT_KINDS).toHaveLength(13);
    expect(isBuildingPortrait('skylance-ciws')).toBe(true);
  });
  for (const kind of BUILDING_PORTRAIT_KINDS) it(`frames the entire ${kind} and retains destructible architecture`, () => {
    const model = createBuildingPreview(kind);
    const camera = new OrthographicCamera();
    frameBuildingPortrait(camera, model);
    const box = new Box3().setFromObject(model);
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const point = new Vector3(x, y, z).project(camera);
      expect(Math.abs(point.x)).toBeLessThan(1);
      expect(Math.abs(point.y)).toBeLessThan(1);
      expect(Math.abs(point.z)).toBeLessThan(1);
    }
    const designation = model.getObjectByName('building-designation')!;
    expect(designation).toBeDefined();
    const parts = designation.parent!.userData.detailParts as { object: unknown }[];
    expect(parts.some((part) => part.object === designation)).toBe(true);
    let triangles = 0;
    let shadowCasters = 0;
    model.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      triangles += (child.geometry.index?.count ?? child.geometry.attributes.position.count) / 3;
      if (child.castShadow) shadowCasters++;
    });
    expect(triangles).toBeLessThan(12000);
    expect(shadowCasters).toBeLessThan(64);
    disposeBuildingPreview(model);
  });

  it('shares architecture geometry across copies and keeps it after preview disposal', () => {
    const first = createBuildingPreview('command-yard');
    const meshes: Mesh[] = [];
    first.traverse((child) => { if (child instanceof Mesh) meshes.push(child); });
    const shared = meshes.find((mesh) => mesh.geometry.userData.ironDominionSharedBuilding);
    expect(shared).toBeDefined();
    const onDispose = vi.fn();
    shared!.geometry.addEventListener('dispose', onDispose);
    disposeBuildingPreview(first);
    expect(onDispose).not.toHaveBeenCalled();
    const second = createBuildingPreview('command-yard');
    let reused = false;
    second.traverse((child) => { if (child instanceof Mesh && child.geometry === shared!.geometry) reused = true; });
    expect(reused).toBe(true);
    shared!.geometry.removeEventListener('dispose', onDispose);
    disposeBuildingPreview(second);
  });

  it('keeps the full building catalog well below the pre-regression GPU load', () => {
    let triangles = 0;
    let shadowCasters = 0;
    for (const kind of BUILDING_PORTRAIT_KINDS) {
      const model = createBuildingPreview(kind);
      model.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        triangles += (child.geometry.index?.count ?? child.geometry.attributes.position.count) / 3;
        if (child.castShadow) shadowCasters++;
      });
      disposeBuildingPreview(model);
    }
    expect(triangles).toBeLessThan(70_000);
    expect(shadowCasters).toBeLessThan(500);
  });
});


describe('replacement building spaces and launcher orientation', () => {
  it('keeps the factory loading entrance open to the assembly interior', () => {
    const model = createBuildingPreview('factory');
    model.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(-2.6 * 32 / 24, 2.3, 30), new Vector3(0, 0, -1));
    const hit = ray.intersectObject(model, true)[0];
    expect(hit?.object.name).toBe('assembly-chassis');
    disposeBuildingPreview(model);
  });
  it('leaves the barracks muster court open to the sky', () => {
    const model = createBuildingPreview('barracks');
    model.updateMatrixWorld(true);
    const hit = new Raycaster(new Vector3(0, 30, 1), new Vector3(0, -1, 0)).intersectObject(model, true)[0];
    expect(hit?.point.y).toBeLessThan(1.5);
    expect(hit?.point.y).toBeGreaterThan(0.8);
    disposeBuildingPreview(model);
  });
  it('aims the missile canister mouths above their rear ends', () => {
    const model = createBuildingPreview('missile-defense');
    const rack = model.getObjectByName('sam-six-cell-launch-rack')!;
    model.updateMatrixWorld(true);
    const front = rack.localToWorld(new Vector3(0, 0, 4));
    const back = rack.localToWorld(new Vector3(0, 0, -4));
    expect(front.y - back.y).toBeGreaterThan(3);
    expect(rack.parent).toBe(model.getObjectByName('missile-defense-pivot'));
    disposeBuildingPreview(model);
  });
});
