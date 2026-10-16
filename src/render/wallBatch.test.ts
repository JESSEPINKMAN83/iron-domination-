import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import type { Entity } from '../sim/components';
import { WallBatch, canBatchWall } from './wallBatch';

function fixture() {
  const template = new Group();
  const grey = new MeshBasicMaterial({ color: 0x999999 });
  const blue = new MeshBasicMaterial({ color: 0x2244aa });
  const body = new InstancedMesh(new BoxGeometry(1, 1, 1), grey, 18);
  const matrix = new Matrix4();
  for (let i = 0; i < 18; i++) { matrix.makeTranslation(i % 3 - 1, Math.floor(i / 3) + 0.5, 0); body.setMatrixAt(i, matrix); }
  template.add(body);
  for (let i = 0; i < 20; i++) {
    const detail = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), i % 2 ? grey : blue);
    detail.position.set(i % 5 * 0.2 - 0.4, 6, Math.floor(i / 5) * 0.2);
    template.add(detail);
  }
  return { batch: new WallBatch(template), template };
}
const wall = (id: number) => ({ id, transform: { x: id * 10, z: 0, rot: 0 } } as Entity);

describe('shared fence renderer', () => {
  it('uses detailed destruction for damaged walls and returns fully repaired walls to the cheap representation', () => {
    const entity = { ...wall(1), building: { kind: 'wall' }, health: { current: 100, max: 100 }, structureDamage: { version: 0, cells: new Uint8Array(18) } } as Entity;
    expect(canBatchWall(entity)).toBe(true);
    entity.health!.current = 80;
    entity.structureDamage!.version++;
    entity.structureDamage!.cells[0] = 42;
    expect(canBatchWall(entity)).toBe(false);
    entity.health!.current = 100;
    expect(canBatchWall(entity)).toBe(false);
    entity.structureDamage!.cells.fill(0);
    expect(canBatchWall(entity)).toBe(true);
    entity.destroyed = { remaining: 20 };
    expect(canBatchWall(entity)).toBe(false);
  });

  it('renders 500 detailed wall models in two material submissions instead of 10,500 separate meshes', () => {
    const { batch } = fixture();
    batch.beginFrame();
    for (let i = 0; i < 500; i++) batch.add(wall(i), new Matrix4().makeTranslation(i * 10, 0, 0));
    batch.endFrame();
    expect(batch.root.children).toHaveLength(2);
    for (const mesh of batch.root.children as InstancedMesh[]) expect(mesh.count).toBe(500);
    expect(batch.pick(new Raycaster(new Vector3(4990, 2, 10), new Vector3(0, 0, -1)))?.entity.id).toBe(499);
    batch.dispose();
  });

  it('replaces frame membership without stale ghosts and preserves selection after instance compaction', () => {
    const { batch } = fixture();
    batch.beginFrame();
    batch.add(wall(1), new Matrix4().makeTranslation(10, 0, 0));
    batch.add(wall(2), new Matrix4().makeTranslation(20, 0, 0));
    batch.endFrame();
    batch.beginFrame();
    batch.add(wall(2), new Matrix4().makeTranslation(20, 0, 0));
    batch.endFrame();
    expect(batch.pick(new Raycaster(new Vector3(10, 2, 10), new Vector3(0, 0, -1)))).toBeUndefined();
    expect(batch.pick(new Raycaster(new Vector3(20, 2, 10), new Vector3(0, 0, -1)))?.entity.id).toBe(2);
    batch.beginFrame(); batch.endFrame();
    expect(batch.root.children.every((mesh) => !mesh.visible)).toBe(true);
    batch.dispose();
  });
});
