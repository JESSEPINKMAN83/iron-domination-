import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { UnitBatchLod } from './unitBatchLod';

function tankLike() {
  const hullMaterial = new MeshStandardMaterial();
  const flashMaterial = new MeshBasicMaterial({ transparent: true });
  const root = new Group();
  root.add(new Mesh(new BoxGeometry(4, 1, 6), hullMaterial));
  const track = new Mesh(new BoxGeometry(1, 1, 6), hullMaterial);
  track.position.x = 2;
  root.add(track);
  const turret = new Group();
  turret.position.y = 1.2;
  turret.add(new Mesh(new BoxGeometry(2, 1, 2), hullMaterial));
  turret.add(new Mesh(new BoxGeometry(0.4, 0.4, 0.4), flashMaterial));
  root.add(turret);
  return { root, turret };
}

const instancedMeshes = (lod: UnitBatchLod) => lod.group.children.filter((child): child is InstancedMesh => child instanceof InstancedMesh);

describe('UnitBatchLod', () => {
  it('merges static parts per material and skips transparent effects', () => {
    const lod = new UnitBatchLod();
    const { root, turret } = tankLike();
    lod.bake('tank:1', root, turret);
    expect(lod.has('tank:1')).toBe(true);
    // One hull draw and one turret draw; the transparent muzzle flash is not baked.
    expect(instancedMeshes(lod)).toHaveLength(2);
  });

  it('places the turret with the posed pivot and grows past its initial capacity', () => {
    const lod = new UnitBatchLod();
    const { root, turret } = tankLike();
    lod.bake('tank:1', root, turret);
    lod.begin();
    const pivot = new Matrix4().makeRotationY(Math.PI / 2);
    for (let i = 0; i < 40; i++) lod.add('tank:1', new Matrix4().makeTranslation(i * 10, 0, 0), pivot);
    lod.end();
    const [hull, turretBatch] = instancedMeshes(lod);
    expect(hull.count).toBe(40);
    expect(turretBatch.count).toBe(40);
    const placed = new Matrix4();
    turretBatch.getMatrixAt(3, placed);
    const expected = new Matrix4().makeTranslation(30, 0, 0).multiply(pivot);
    expect(placed.elements.map((v) => Number(v.toFixed(5)))).toEqual(expected.elements.map((v) => Number(v.toFixed(5))));
  });

  it('reports unknown keys so callers fall back to the detailed model', () => {
    const lod = new UnitBatchLod();
    lod.begin();
    expect(lod.add('missing', new Matrix4())).toBe(false);
  });
});
