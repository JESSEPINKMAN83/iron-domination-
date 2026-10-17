import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
/** Render-only Code Red silhouettes. Shared primitive geometry keeps the LOD bake cheap. */
import { BoxGeometry, CylinderGeometry, Group, Mesh, type Material } from 'three';
import type { ArmyDoctrineId } from '../content/armyDoctrines';
const boxes = new Map<string, BoxGeometry>();
const cylinders = new Map<string, CylinderGeometry>();
const shared = <T extends BoxGeometry | CylinderGeometry>(g: T): T => { g.userData.ironDominionSharedUnitGeometry = true; return g; };
export function modelBox(parent: Group, name: string, m: Material, w: number, h: number, d: number, x = 0, y = 0, z = 0): Mesh {
  const key = `${w}:${h}:${d}`;
  if (!boxes.has(key)) boxes.set(key, shared(new BoxGeometry(w,h,d)));
  const part = new Mesh(boxes.get(key)!, m); part.name = name; part.position.set(x,y,z); parent.add(part); return part;
}
export function modelCylinder(parent: Group, name: string, m: Material, r: number, h: number, x = 0, y = 0, z = 0, sides = 10): Mesh {
  const key = `${r}:${h}:${sides}`;
  if (!cylinders.has(key)) cylinders.set(key, shared(new CylinderGeometry(r,r,h,sides)));
  const part = new Mesh(cylinders.get(key)!, m); part.name=name; part.position.set(x,y,z); parent.add(part); return part;
}
interface ArmorMaterials { hull: Material; dark: Material; accent: Material; lightBar: Material; canvas: Material }
export function createCodeRedVehicle(kind: string, doctrine: ArmyDoctrineId, m: ArmorMaterials, gunmetal: Material, muzzleMaterial: Material) {
  const root = new Group(); const turretPivot = new Group(); const barrelPivot = new Group();
  root.name = `${doctrine}:${kind}`;
  const east = doctrine === 'missile-command'; const scout = kind === 'jackal'; const artillery = kind === 'mauler';
  const truck = scout || (east && artillery); const wide = artillery ? 3.9 : scout ? 2.9 : 3.6; const length = artillery ? 6.6 : scout ? 4.7 : 5.5;
  const b = (p: Group,n:string,w:number,h:number,d:number,x:number,y:number,z:number,mat:Material=m.hull) => modelBox(p,n,mat,w,h,d,x,y,z);
  b(root,'armored-hull',wide,.8,length,0,.72,0);
  b(root,'sloped-glacis',wide*.92,.32,1.35,0,1.05,length*.4).rotation.x=-.24;
  for (const side of [-1,1]) {
    if (!truck) {
      b(root,'track-belt',.64,.7,length*1.02,side*(wide*.5+.25),.4,0,m.dark);
      b(root,'side-skirt',.18,.6,length*.9,side*(wide*.5+.58),.91,0);
    }
    const axles = scout ? (east ? [-1.5,1.5] : [-1.65,-.55,.55,1.65]) : truck ? [-2.3,-.7,.8,2.3] : [-2,-1,0,1,2];
    for (const z of axles) {
      modelCylinder(root,'road-wheel',m.dark,truck?.52:.43,.4,side*(wide*.5+.24),.42,z,12).rotation.z=Math.PI/2;
      modelCylinder(root,'wheel-hub',gunmetal,.2,.42,side*(wide*.5+.24),.42,z).rotation.z=Math.PI/2;
    }
    b(root,'team-stripe',.06,.14,length*.75,side*(wide*.5+.6),1.05,0,m.accent);
    b(root,'headlamp',.28,.18,.12,side*wide*.34,1,length*.51,m.lightBar);
  }
  root.add(turretPivot); turretPivot.name='turretPivot'; turretPivot.position.set(0,1.3,scout ? -.4 : east ? 0 : -.85);
  if (scout) {
    b(root,'crew-cabin',wide*.84,.65,2.4,0,1.25,.5);
    b(root,'split-windshield',wide*.65,.3,.07,0,1.5,1.73,m.lightBar);
    b(turretPivot,'remote-weapon-station',.9,.4,1.1,0,.7,0,m.dark);
    barrelPivot.position.set(0,.8,.2);
  } else if (east && artillery) {
    b(root,'truck-cab',wide*.88,1.3,1.6,0,1.3,2.35);
    b(root,'cab-windows',wide*.76,.43,.08,0,1.65,3.19,m.lightBar);
    b(turretPivot,'launcher-cradle',2.5,.4,3,0,.25,-.9,m.dark);
    barrelPivot.position.set(0,.8,-.7); barrelPivot.rotation.x=-.35;
    for (const x of [-.65,.65]) for (const y of [0,.72]) {
      modelCylinder(barrelPivot,'fajr-launch-tube',m.hull,.32,3.8,x,y,0,12).rotation.x=Math.PI/2;
      modelCylinder(barrelPivot,'tube-mouth',m.dark,.27,.08,x,y,1.94,12).rotation.x=Math.PI/2;
    }
  } else if (east) {
    modelCylinder(turretPivot,'karrar-rounded-turret',m.hull,1.4,.7,0,.3,0,12).scale.set(1,.85,1.02);
    for (const side of [-1,1]) for(let i=0;i<4;i++) {
      const era = b(turretPivot,'era-block',.5,.32,.5,side*(.65+i*.19),.55,.94-i*.43,m.dark); era.rotation.y=side*.4;
    }
    barrelPivot.position.set(0,.3,1.1);
  } else {
    b(turretPivot,artillery?'rochev-turret':'merkava-wedge-turret',artillery?2.8:2.6,artillery?1.15:.58,2.5,0,.3,0);
    for(const side of [-1,1]) {
      b(turretPivot,'wedge-cheek',1.2,.4,1.6,side*.8,.45,.55).rotation.y=side*.28;
      b(turretPivot,'trophy-radar',.32,.38,.42,side*1.43,.5,-.65,m.dark);
      if(!artillery) for(let i=0;i<4;i++) modelCylinder(turretPivot,'chain-ball-skirt',gunmetal,.09,.3,side*(.35+i*.27),-.18,-1.35,6);
    }
    for(let i=0;i<5;i++) b(root,'front-engine-grille',.28,.06,1.2,-.8+i*.4,1.17,1.5,gunmetal);
    barrelPivot.position.set(0,.35,1.1);
  }
  if (!(east && artillery)) {
    const barrelLength = scout ? 1.65 : artillery ? 5.2 : 3.6;
    modelCylinder(barrelPivot,'gun-barrel',gunmetal,scout?.07:.14,barrelLength,0,0,barrelLength*.5,10).rotation.x=Math.PI/2;
    b(barrelPivot,'mantlet',scout?.3:.6,.4,.6,0,0,0,m.dark);
    if (artillery) b(barrelPivot,'muzzle-brake',.5,.3,.3,0,0,barrelLength,gunmetal);
  }
  const muzzleFlash=modelBox(barrelPivot,'muzzle-flash',muzzleMaterial,.5,.5,.8,0,0,scout?1.8:artillery?5.3:3.8); muzzleFlash.visible=false;
  turretPivot.add(barrelPivot);
  modelCylinder(turretPivot,'commander-hatch',m.dark,.36,.12,.6,.82,-.55);
  b(turretPivot,'faction-panel',.85,.12,.07,0,.6,1.3,m.accent);
  const antenna=new Group(); antenna.position.set(-wide*.4,1.2,-length*.38); root.add(antenna);
  modelCylinder(antenna,'radio-whip',gunmetal,.015,1.2,0,.6,0,5);
  const roles: [string,Material][]=[...Object.entries(m),['metal',gunmetal]];
  for(const [part,parent] of [['hull',root],['turret',turretPivot],['barrel',barrelPivot]] as const) {
    for(const material of new Set(roles.map(([,m])=>m))) {
      const children=parent.children.filter((o):o is Mesh=>o instanceof Mesh && o.visible && o.material===material);
      if(children.length<2)continue;
      const key=`${doctrine}:${kind}:${part}:${roles.filter(([,m])=>m===material).map(([r])=>r).join(',')}`;
      let geometry=mergedArmor.get(key);
      if(!geometry){const pieces=children.map(o=>{o.updateMatrix();return o.geometry.clone().applyMatrix4(o.matrix);});geometry=mergeGeometries(pieces,false)!;pieces.forEach(g=>g.dispose());geometry.userData.ironDominionSharedUnitGeometry=true;mergedArmor.set(key,geometry);}
      parent.remove(...children);const mesh=new Mesh(geometry,material);mesh.name=`${part}-panels`;parent.add(mesh);
    }
  }
  return {root,refs:{turretPivot,barrelPivot,barrelHomeZ:barrelPivot.position.z,muzzleFlash,groundDrive:true,antenna}};
}

const mergedArmor = new Map<string, import('three').BufferGeometry>();
