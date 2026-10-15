import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial } from 'three';

export function buildInfantryWeapon(kind: string): Group {
  const root = new Group();
  root.name = kind;
  const metal = new MeshBasicMaterial({ color: 0x252c30, fog: false, toneMapped: false, depthTest: false, depthWrite: false });
  const stock = metal.clone(); stock.color.setHex(kind === 'sniperRifle' ? 0x68734e : kind === 'grenade' ? 0x8a7150 : 0x46564a);
  const glass = metal.clone(); glass.color.setHex(0x63b7b0);
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, material = metal) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), material); mesh.position.set(x, y, z); root.add(mesh); return mesh;
  };
  const tube = (r: number, length: number, x: number, y: number, z: number, material = metal) => {
    const mesh = new Mesh(new CylinderGeometry(r, r, length, 10), material); mesh.rotation.x = Math.PI / 2; mesh.position.set(x, y, z); root.add(mesh); return mesh;
  };
  if (kind === 'rocketLauncher') {
    tube(0.12, 0.95, 0, 0.04, -0.18, stock);
    tube(0.15, 0.08, 0, 0.04, -0.67);
    box(0.05, 0.13, 0.13, -0.15, 0.12, -0.12);
    box(0.025, 0.07, 0.025, -0.15, 0.14, -0.2, glass);
  } else {
    box(0.1, 0.11, 0.32, 0, 0, 0);
    box(0.105, 0.1, 0.19, 0, 0, 0.24, stock);
    box(0.075, 0.14, 0.065, 0, -0.11, 0.12, stock);
    if (kind === 'sniperRifle') {
      tube(0.022, 0.62, 0, 0.02, -0.43);
      tube(0.039, 0.18, 0, 0.02, -0.76);
      box(0.055, 0.055, 0.18, 0, 0.1, -0.02);
      tube(0.047, 0.29, 0, 0.15, -0.04);
      tube(0.04, 0.012, 0, 0.15, 0.11, glass);
      box(0.025, 0.13, 0.025, 0.08, -0.07, -0.45);
      box(0.025, 0.13, 0.025, -0.08, -0.07, -0.45);
    } else if (kind === 'grenade') {
      tube(0.075, 0.3, 0, 0.015, -0.26);
      const drum = tube(0.11, 0.15, 0, -0.1, -0.03, stock); drum.rotation.z = Math.PI / 2;
      box(0.035, 0.08, 0.045, 0, 0.1, -0.23);
    } else {
      tube(0.018, 0.38, 0, 0.02, -0.3);
      box(0.07, 0.18, 0.09, 0, -0.12, -0.03);
      box(0.085, 0.075, 0.2, 0, 0, -0.2, stock);
      box(0.065, 0.05, 0.07, 0, 0.09, -0.04);
      box(0.02, 0.012, 0.02, 0, 0.12, -0.08, glass);
    }
  }
  box(0.095, 0.08, 0.2, 0.07, -0.15, 0.18, stock);
  box(0.095, 0.08, 0.2, -0.07, -0.12, -0.16, stock);
  root.traverse((object) => { object.renderOrder = 10000; object.frustumCulled = false; });
  return root;
}
