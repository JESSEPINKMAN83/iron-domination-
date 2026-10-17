import { describe, expect, it } from 'vitest';
import { Mesh, MeshStandardMaterial } from 'three';
import { createAircraftObject } from './unitView';

const material = () => new MeshStandardMaterial();
const materials = { hull: material(), dark: material(), accent: material(), canvas: material(), lightBar: material(), uniform: material() };

describe('compacted Code Red helicopters', () => {
  for (const kind of ['wasp', 'vulture', 'hammerhead'] as const) {
    it(`${kind} keeps rotors and reloadable missiles independent of static panels`, () => {
      const model = createAircraftObject(kind, materials, material());
      for (const rotor of [...model.refs.mainRotors!, ...model.refs.tailRotors!]) {
        expect(rotor.parent).toBe(model.root);
        const before = rotor.matrix.clone();
        rotor.rotation.y += 1;
        rotor.updateMatrix();
        expect(rotor.matrix.equals(before)).toBe(false);
      }
      for (const missile of model.refs.missileRack!) {
        expect(missile.parent).toBe(model.root);
        missile.visible = false;
        expect(model.root.visible).toBe(true);
      }
      if (kind === 'hammerhead') expect(model.refs.missileRack).toHaveLength(8);
      let meshes = 0;
      model.root.traverse(object => { if (object instanceof Mesh && object.visible) meshes++; });
      expect(meshes).toBeLessThanOrEqual(kind === 'hammerhead' ? 22 : 14);
    });
  }
});
