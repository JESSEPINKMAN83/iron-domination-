// Procedural low-poly infantry rig. It stays render-only and keeps the
// turretPivot contract, but now reads as a small soldier: human proportions,
// helmet/goggles, camo uniform, kit silhouettes, held weapons, and cached refs
// for aim/recoil/death animation.
import { BoxGeometry, CylinderGeometry, Group, Mesh, type BufferGeometry, type Material } from 'three';
import type { UnitVisualKind } from './unitKinds';

export interface SoldierMaterials {
  uniform: Material;
  gear: Material;
  skin: Material;
  gunmetal: Material;
  accent: Material;
  canvas: Material;
  lightBar: Material;
  visor: Material;
  muzzle: Material;
}

export interface SoldierRig {
  root: Group;
  torso: Group;
  chest: Mesh;
  abdomen: Mesh;
  hipL: Group;
  hipR: Group;
  kneeL: Group;
  kneeR: Group;
  shoulderL: Group;
  shoulderR: Group;
  elbowL: Group;
  elbowR: Group;
  rifle: Group;
  muzzleFlash: Mesh;
  backBlast?: Mesh;
  antenna?: Group;
  combatBike: Group;
  kit: SoldierKit;
}

type SoldierKit = Extract<UnitVisualKind, 'rifle' | 'grenadier' | 'rocket' | 'sniper'>;

const sharedGeometryTag = 'ironDominionSharedUnitGeometry';
const boxGeometryCache = new Map<string, BoxGeometry>();
const cylinderGeometryCache = new Map<string, CylinderGeometry>();

function markShared<T extends BufferGeometry>(geom: T): T {
  geom.userData[sharedGeometryTag] = true;
  return geom;
}

function sharedBoxGeometry(x: number, y: number, z: number): BoxGeometry {
  const key = `${x}:${y}:${z}`;
  let geom = boxGeometryCache.get(key);
  if (!geom) {
    geom = markShared(new BoxGeometry(x, y, z));
    boxGeometryCache.set(key, geom);
  }
  return geom;
}

function sharedCylinderGeometry(radiusTop: number, radiusBottom: number, height: number, radialSegments: number): CylinderGeometry {
  const key = `${radiusTop}:${radiusBottom}:${height}:${radialSegments}`;
  let geom = cylinderGeometryCache.get(key);
  if (!geom) {
    geom = markShared(new CylinderGeometry(radiusTop, radiusBottom, height, radialSegments));
    cylinderGeometryCache.set(key, geom);
  }
  return geom;
}

function box(x: number, y: number, z: number, material: Material, px: number, py: number, pz: number): Mesh {
  const mesh = new Mesh(sharedBoxGeometry(x, y, z), material);
  mesh.position.set(px, py, pz);
  return mesh;
}

function cyl(radiusTop: number, radiusBottom: number, height: number, segments: number, material: Material, px: number, py: number, pz: number): Mesh {
  const mesh = new Mesh(sharedCylinderGeometry(radiusTop, radiusBottom, height, segments), material);
  mesh.position.set(px, py, pz);
  return mesh;
}

function buildLeg(m: SoldierMaterials, side: 1 | -1): { hip: Group; knee: Group } {
  const hip = new Group();
  hip.position.set(side * 0.12, 0.98, 0);
  hip.add(box(0.125, 0.54, 0.14, m.uniform, 0, -0.27, 0));

  const knee = new Group();
  knee.position.set(0, -0.52, 0);
  knee.add(box(0.115, 0.48, 0.13, m.uniform, 0, -0.22, 0));
  knee.add(box(0.145, 0.11, 0.26, m.gear, 0, -0.18, 0.055)); // kneepad
  knee.add(box(0.18, 0.1, 0.32, m.gear, 0, -0.48, 0.08)); // boot
  hip.add(knee);
  return { hip, knee };
}

function buildArm(m: SoldierMaterials, side: 1 | -1, rotationZ: number): { shoulder: Group; elbow: Group } {
  const shoulder = new Group();
  shoulder.position.set(side * 0.3, 0.47, 0.02);
  shoulder.rotation.set(-0.78, 0, rotationZ);
  shoulder.add(box(0.12, 0.34, 0.12, m.uniform, 0, -0.16, 0));

  const elbow = new Group();
  elbow.position.set(0, -0.32, 0);
  elbow.rotation.x = -0.62;
  elbow.add(box(0.105, 0.29, 0.1, m.uniform, 0, -0.13, 0));
  elbow.add(box(0.105, 0.075, 0.1, m.skin, 0, -0.29, 0.02)); // palm
  elbow.add(box(0.045, 0.05, 0.055, m.skin, side * -0.045, -0.28, 0.07)); // thumb
  shoulder.add(elbow);
  return { shoulder, elbow };
}

function buildRifle(m: SoldierMaterials): { rifle: Group; muzzleFlash: Mesh } {
  const rifle = new Group();
  rifle.position.set(0.08, 0.31, 0.28);
  rifle.rotation.x = -0.08;
  rifle.add(box(0.045, 0.075, 0.66, m.gunmetal, 0, 0, 0.08));
  rifle.add(box(0.055, 0.12, 0.2, m.gear, 0, -0.015, -0.28)); // stock
  rifle.add(box(0.04, 0.14, 0.055, m.gunmetal, 0, -0.105, 0.05)); // magazine
  rifle.add(box(0.035, 0.06, 0.18, m.gear, 0, -0.08, 0.28)); // foregrip
  const barrel = cyl(0.014, 0.014, 0.36, 6, m.gunmetal, 0, 0.012, 0.58);
  barrel.rotation.x = Math.PI / 2;
  rifle.add(barrel);
  const muzzleFlash = box(0.16, 0.16, 0.16, m.muzzle, 0, 0.02, 0.82);
  muzzleFlash.visible = false;
  rifle.add(muzzleFlash);
  return { rifle, muzzleFlash };
}

function addSoldierBody(torso: Group, m: SoldierMaterials): { chest: Mesh; abdomen: Mesh } {
  const abdomen = box(0.34, 0.34, 0.22, m.uniform, 0, 0.19, 0);
  const chest = box(0.44, 0.42, 0.25, m.uniform, 0, 0.52, 0.005);
  chest.rotation.x = -0.05;
  torso.add(abdomen, chest);
  torso.add(box(0.48, 0.3, 0.28, m.gear, 0, 0.42, 0.02)); // plate carrier
  torso.add(box(0.42, 0.055, 0.08, m.accent, 0, 0.62, 0.17)); // chest team strip
  torso.add(box(0.42, 0.055, 0.06, m.gear, 0, 0.12, 0.13)); // belt
  for (const x of [-0.14, 0, 0.14]) torso.add(box(0.075, 0.105, 0.055, m.gear, x, 0.02, 0.16));
  torso.add(box(0.085, 0.13, 0.065, m.gear, 0.22, 0.07, -0.02)); // canteen
  torso.add(box(0.08, 0.055, 0.08, m.skin, 0, 0.78, 0)); // short neck
  return { chest, abdomen };
}

function addHead(torso: Group, m: SoldierMaterials): void {
  torso.add(box(0.17, 0.21, 0.16, m.skin, 0, 0.91, 0.015)); // smaller head
  torso.add(box(0.185, 0.055, 0.17, m.visor, 0, 0.955, 0.095)); // goggles
  torso.add(box(0.16, 0.035, 0.155, m.gear, 0, 0.895, 0.102)); // face shadow
  const helmet = cyl(0.135, 0.155, 0.125, 8, m.uniform, 0, 1.07, 0);
  helmet.scale.y = 0.72;
  torso.add(helmet);
  torso.add(box(0.25, 0.035, 0.09, m.uniform, 0, 1.03, 0.105)); // brim
  torso.add(box(0.055, 0.1, 0.09, m.uniform, -0.13, 1.0, 0.005));
  torso.add(box(0.055, 0.1, 0.09, m.uniform, 0.13, 1.0, 0.005));
  torso.add(box(0.23, 0.035, 0.175, m.accent, 0, 1.055, 0.01)); // camo/team band
  torso.add(box(0.055, 0.05, 0.04, m.gear, 0, 1.055, 0.13)); // NVG mount
  torso.add(box(0.14, 0.022, 0.04, m.gear, 0, 0.84, 0.08)); // chin strap
}

function addShoulders(torso: Group, m: SoldierMaterials): void {
  torso.add(box(0.18, 0.09, 0.18, m.uniform, -0.31, 0.63, 0));
  torso.add(box(0.18, 0.09, 0.18, m.uniform, 0.31, 0.63, 0));
  torso.add(box(0.14, 0.035, 0.19, m.accent, -0.31, 0.685, 0));
}

function buildCombatBike(m: SoldierMaterials): Group {
  const bike = new Group();
  bike.name = 'combatBikeUpgrade';
  const wheel = (z: number): Mesh => {
    const mesh = cyl(0.43, 0.43, 0.14, 12, m.gunmetal, 0, 0.43, z);
    mesh.rotation.z = Math.PI / 2;
    return mesh;
  };
  bike.add(wheel(-0.82), wheel(0.86));
  const frame = box(0.15, 0.15, 1.42, m.accent, 0, 0.56, 0.04);
  frame.rotation.x = 0.06;
  bike.add(frame);
  const engine = box(0.56, 0.42, 0.56, m.gear, 0, 0.63, -0.08);
  bike.add(engine);
  bike.add(box(0.42, 0.12, 0.42, m.canvas, 0, 0.91, -0.28));
  bike.add(box(0.64, 0.09, 0.09, m.gunmetal, 0, 1.04, 0.62));
  bike.add(box(0.07, 0.58, 0.07, m.gunmetal, 0, 0.79, 0.62));
  bike.add(box(0.38, 0.3, 0.22, m.accent, 0, 0.68, 0.78));
  bike.add(box(0.27, 0.19, 0.12, m.lightBar, 0, 0.7, 0.91));
  bike.add(box(0.08, 0.08, 0.7, m.gunmetal, -0.3, 0.55, -0.35));
  bike.visible = false;
  return bike;
}

function applyKit(root: Group, torso: Group, rifle: Group, m: SoldierMaterials, kit: SoldierKit): { antenna?: Group; backBlast?: Mesh } {
  if (kit !== 'rifle') torso.add(box(0.035, 0.58, 0.045, m.gear, -0.16, 0.42, -0.16).rotateZ(-0.55)); // sling
  if (kit === 'grenadier') {
    torso.scale.x = 1.08;
    torso.rotation.y = 0.16;
    torso.add(box(0.5, 0.28, 0.3, m.gear, 0, 0.38, 0.02));
    torso.add(box(0.46, 0.06, 0.3, m.accent, 0, 0.53, 0.04));
    torso.add(box(0.19, 0.13, 0.08, m.gear, -0.17, 0.62, 0.16));
    torso.add(box(0.19, 0.13, 0.08, m.gear, 0.17, 0.62, 0.16));
    const drum = cyl(0.1, 0.1, 0.18, 12, m.gear, 0, -0.11, 0.07);
    drum.rotation.x = Math.PI / 2;
    rifle.add(drum);
    const launcher = cyl(0.05, 0.06, 0.72, 10, m.gunmetal, 0, -0.025, 0.22);
    launcher.rotation.x = Math.PI / 2;
    rifle.add(launcher);
    rifle.position.set(0.02, 0.22, 0.32);
    rifle.rotation.x = -0.28;
    rifle.scale.set(1.2, 1.08, 1.12);
    root.scale.set(1.05, 1.02, 1.05);
  } else if (kit === 'rocket') {
    const pack = box(0.34, 0.58, 0.2, m.gear, 0, 0.42, -0.23);
    torso.add(pack);
    torso.add(box(0.3, 0.055, 0.21, m.accent, 0, 0.69, -0.35));
    for (const x of [-0.11, 0.11]) {
      const spare = cyl(0.024, 0.024, 0.56, 8, m.gunmetal, x, 0.46, -0.48);
      spare.rotation.x = Math.PI / 2;
      torso.add(spare);
    }
    const tube = cyl(0.068, 0.082, 1.24, 12, m.gunmetal, -0.02, 0.08, 0.46);
    tube.rotation.x = Math.PI / 2;
    rifle.add(tube);
    const backBlast = box(0.22, 0.22, 0.18, m.muzzle, -0.02, 0.08, -0.22);
    backBlast.visible = false;
    rifle.add(backBlast);
    rifle.position.set(0.0, 0.52, 0.33);
    rifle.rotation.x = 0.02;
    rifle.rotation.z = -0.05;
    rifle.scale.set(1.04, 1.06, 1.52);
    const antenna = new Group();
    antenna.name = 'kitAntenna';
    antenna.position.set(0.2, 0.73, -0.32);
    const whip = cyl(0.007, 0.011, 0.72, 5, m.gunmetal, 0, 0.36, 0);
    antenna.add(whip);
    torso.add(antenna);
    root.scale.set(0.98, 1.08, 0.98);
    return { antenna, backBlast };
  } else if (kit === 'sniper') {
    rifle.scale.set(1.04, 0.98, 1.5);
    rifle.position.set(0.08, 0.42, 0.31);
    rifle.rotation.x = -0.16;
    const longBarrel = cyl(0.012, 0.012, 0.7, 6, m.gunmetal, 0, 0.016, 0.9);
    longBarrel.rotation.x = Math.PI / 2;
    const suppressor = cyl(0.026, 0.026, 0.2, 8, m.gunmetal, 0, 0.016, 1.34);
    suppressor.rotation.x = Math.PI / 2;
    rifle.add(longBarrel, suppressor, box(0.075, 0.06, 0.34, m.gunmetal, 0, 0.095, 0.2), box(0.08, 0.064, 0.018, m.accent, 0, 0.095, 0.39));
    torso.add(box(0.5, 0.045, 0.065, m.canvas, 0, 0.66, -0.15));
    root.scale.set(0.96, 1.07, 0.96);
  }
  return {};
}

export function buildSoldier(m: SoldierMaterials, kit: SoldierKit = 'rifle'): SoldierRig {
  const root = new Group();
  const combatBike = buildCombatBike(m);
  root.add(combatBike);

  const legL = buildLeg(m, -1);
  const legR = buildLeg(m, 1);
  root.add(legL.hip, legR.hip);
  root.add(box(0.38, 0.18, 0.23, m.gear, 0, 1.04, 0));

  const torso = new Group();
  torso.name = 'turretPivot';
  torso.position.set(0, 1.12, 0);
  const body = addSoldierBody(torso, m);
  addHead(torso, m);
  addShoulders(torso, m);

  const rightArm = buildArm(m, 1, -0.22);
  const leftArm = buildArm(m, -1, 0.24);
  torso.add(rightArm.shoulder, leftArm.shoulder);
  const weapon = buildRifle(m);
  const kitRefs = applyKit(root, torso, weapon.rifle, m, kit);
  torso.add(weapon.rifle);
  root.add(torso);

  return {
    root,
    torso,
    chest: body.chest,
    abdomen: body.abdomen,
    hipL: legL.hip,
    hipR: legR.hip,
    kneeL: legL.knee,
    kneeR: legR.knee,
    shoulderL: leftArm.shoulder,
    shoulderR: rightArm.shoulder,
    elbowL: leftArm.elbow,
    elbowR: rightArm.elbow,
    rifle: weapon.rifle,
    muzzleFlash: weapon.muzzleFlash,
    backBlast: kitRefs.backBlast,
    antenna: kitRefs.antenna,
    combatBike,
    kit,
  };
}
