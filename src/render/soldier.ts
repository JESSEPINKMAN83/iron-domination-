// Procedural low-poly soldier rig: articulated legs (hip + knee), an aimable
// upper body (named 'turretPivot' so the standard turret-yaw path drives it),
// arms in a rifle-ready pose. Placeholder art, but it reads as a person —
// replaced by skeletal GLB animation in Phase 7.
import { BoxGeometry, CylinderGeometry, Group, Mesh, type Material } from 'three';

export interface SoldierMaterials {
  uniform: Material;
  gear: Material;
  skin: Material;
  gunmetal: Material;
  accent: Material;
}

export interface SoldierRig {
  root: Group;
  torso: Group;
  hipL: Group;
  hipR: Group;
  kneeL: Group;
  kneeR: Group;
  rifle: Group;
}

function part(geometry: BoxGeometry | CylinderGeometry, material: Material, x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return mesh;
}

function buildLeg(m: SoldierMaterials, side: 1 | -1): { hip: Group; knee: Group } {
  const hip = new Group();
  hip.position.set(side * 0.115, 0.92, 0);
  hip.add(part(new BoxGeometry(0.14, 0.46, 0.17), m.uniform, 0, -0.23, 0));

  const knee = new Group();
  knee.position.set(0, -0.46, 0);
  knee.add(part(new BoxGeometry(0.12, 0.4, 0.15), m.uniform, 0, -0.2, 0));
  knee.add(part(new BoxGeometry(0.14, 0.1, 0.27), m.gear, 0, -0.41, 0.05)); // boot
  hip.add(knee);
  return { hip, knee };
}

function buildArm(m: SoldierMaterials, side: 1 | -1, reach: number): Group {
  const shoulder = new Group();
  shoulder.position.set(side * 0.24, 0.44, 0.02);
  shoulder.rotation.set(-1.1, 0, side * -0.18);
  shoulder.add(part(new BoxGeometry(0.11, 0.32, 0.12), m.uniform, 0, -0.15, 0));

  const elbow = new Group();
  elbow.position.set(0, -0.3, 0);
  elbow.rotation.x = -reach;
  elbow.add(part(new BoxGeometry(0.1, 0.26, 0.1), m.uniform, 0, -0.12, 0));
  elbow.add(part(new BoxGeometry(0.09, 0.08, 0.09), m.skin, 0, -0.27, 0)); // hand
  shoulder.add(elbow);
  return shoulder;
}

function buildRifle(m: SoldierMaterials): Group {
  const rifle = new Group();
  rifle.position.set(0.09, 0.3, 0.28);
  rifle.rotation.x = -0.04;
  rifle.add(part(new BoxGeometry(0.055, 0.09, 0.6), m.gunmetal, 0, 0, 0.1));
  rifle.add(part(new BoxGeometry(0.05, 0.13, 0.18), m.gear, 0, -0.02, -0.24)); // stock
  rifle.add(part(new BoxGeometry(0.045, 0.15, 0.06), m.gunmetal, 0, -0.11, 0.06)); // magazine
  const barrel = new Mesh(new CylinderGeometry(0.018, 0.018, 0.3, 6), m.gunmetal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.015, 0.52);
  rifle.add(barrel);
  return rifle;
}

export function buildSoldier(m: SoldierMaterials): SoldierRig {
  const root = new Group();

  const legL = buildLeg(m, -1);
  const legR = buildLeg(m, 1);
  root.add(legL.hip, legR.hip);
  root.add(part(new BoxGeometry(0.36, 0.2, 0.24), m.gear, 0, 1.0, 0)); // pelvis/belt

  const torso = new Group();
  torso.name = 'turretPivot'; // aimed by the same code path as tank turrets
  torso.position.set(0, 1.1, 0);
  torso.add(part(new BoxGeometry(0.42, 0.52, 0.24), m.uniform, 0, 0.26, 0));
  torso.add(part(new BoxGeometry(0.44, 0.3, 0.29), m.gear, 0, 0.24, 0)); // vest
  torso.add(part(new BoxGeometry(0.1, 0.08, 0.1), m.skin, 0, 0.56, 0)); // neck
  torso.add(part(new BoxGeometry(0.2, 0.2, 0.2), m.skin, 0, 0.7, 0.01)); // head
  torso.add(part(new BoxGeometry(0.27, 0.13, 0.27), m.uniform, 0, 0.83, 0)); // helmet
  torso.add(part(new BoxGeometry(0.29, 0.04, 0.31), m.uniform, 0, 0.77, 0.02)); // brim
  torso.add(part(new BoxGeometry(0.3, 0.045, 0.3), m.accent, 0, 0.8, 0)); // team band
  torso.add(buildArm(m, 1, 0.55)); // trigger arm
  torso.add(buildArm(m, -1, 0.85)); // support arm reaches the barrel
  const rifle = buildRifle(m);
  torso.add(rifle);
  root.add(torso);

  return { root, torso, hipL: legL.hip, hipR: legR.hip, kneeL: legL.knee, kneeR: legR.knee, rifle };
}
