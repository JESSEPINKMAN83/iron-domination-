import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Group, Object3D } from 'three';
import { BattlefieldCulling, setEntityRenderActive } from './battlefieldCulling';

describe('coarse battlefield culling', () => {
  it('keeps visible and nearby shadow casters, rejects distant off-screen armies, and restores on camera movement', () => {
    const camera = new PerspectiveCamera(60, 1, 0.1, 1500);
    const culling = new BattlefieldCulling();
    culling.update(camera);
    expect(culling.contains(0, 0, -100, 10)).toBe(true);
    expect(culling.contains(85, 0, -100, 10)).toBe(true);
    expect(culling.contains(500, 0, -100, 10)).toBe(false);
    expect(culling.contains(0, 0, 300, 10)).toBe(false);
    camera.position.x = 500;
    culling.update(camera);
    expect(culling.contains(500, 0, -100, 10)).toBe(true);
  });

  it('skips off-screen entity matrix subtrees and restores them when visible', () => {
    const scene = new Group();
    const root = new Group();
    scene.add(root);
    const child = new Object3D();
    root.add(child);
    setEntityRenderActive(root, scene, false);
    child.position.x = 42;
    scene.updateMatrixWorld(true);
    expect(child.matrixWorld.elements[12]).toBe(0);
    setEntityRenderActive(root, scene, true);
    scene.updateMatrixWorld(true);
    expect(child.matrixWorld.elements[12]).toBe(42);
  });
});
