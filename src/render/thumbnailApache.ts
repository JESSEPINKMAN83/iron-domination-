import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Group, Mesh, type BufferGeometry, type Material } from 'three';
import { modelArmor, modelBox, modelCylinder } from './codeRedModels';

/** Thumbnail-inspired Apache trial. Fixed primitives; existing rotor/weapon refs. */
export function createThumbnailApache(m: {hull:Material;dark:Material;accent:Material;lightBar:Material;canvas:Material}, metal:Material) {
  const root=new Group();root.name='thumbnail-apache';
  const mainRotors:Group[]=[],tailRotors:Group[]=[],missileRack:Group[]=[];
  const b=(p:Group,n:string,w:number,h:number,d:number,x:number,y:number,z:number,mat:Material=m.hull)=>modelBox(p,n,mat,w,h,d,x,y,z);
  modelArmor(root,'narrow-armored-fuselage',m.hull,1.6,1.05,5.0,0,.2,.1);
  b(root,'tapered-tail-boom',.32,.35,4.3,0,.35,-4.1);
  b(root,'tail-fin',.14,1.3,.75,0,.95,-5.8).rotation.x=-.18;
  b(root,'horizontal-tail',2.7,.1,.55,0,.5,-5.1);
  for(const [y,z] of [[.75,1.7],[1.02,.45]]) {
    modelArmor(root,'tandem-canopy',metal,1.05,.7,1.4,0,y,z);
    b(root,'canopy-center-frame',.065,.76,1.3,0,y+.03,z,m.hull).rotation.x=-.15;
    b(root,'canopy-cross-frame',1.04,.07,.08,0,y+.34,z+.12,m.hull);
  }
  for(const side of [-1,1]) {
    modelCylinder(root,'engine-nacelle',m.hull,.4,2.1,side*.88,.68,-1.1,10).rotation.x=Math.PI/2;
    modelCylinder(root,'engine-exhaust',metal,.31,.12,side*.88,.68,-2.2,10).rotation.x=Math.PI/2;
    b(root,'stub-wing',1.55,.12,.75,side*1.3,.06,.15).rotation.z=side*.06;
    const pod=new Group();pod.position.set(side*1.75,-.24,.3);root.add(pod);
    modelCylinder(pod,'rocket-pod',metal,.3,1.7,0,0,0,10).rotation.x=Math.PI/2;
    for(const x of [-.11,.11]) for(const y of [-.1,.1]) modelCylinder(pod,'rocket-tube-mouth',m.dark,.07,.05,x,y,.88,6).rotation.x=Math.PI/2;
    b(root,'main-gear-strut',.12,.7,.16,side*.8,-.65,.65,metal).rotation.z=side*.3;
    modelCylinder(root,'landing-wheel',m.dark,.28,.2,side*1.05,-.98,.65,10).rotation.z=Math.PI/2;
  }
  b(root,'tail-wheel-strut',.1,.45,.1,0,-.25,-4.65,metal);
  modelCylinder(root,'tail-wheel',m.dark,.19,.15,0,-.52,-4.65,8).rotation.z=Math.PI/2;
  modelCylinder(root,'chin-optics',m.dark,.32,.4,0,-.35,2.45,10);
  b(root,'optical-window',.24,.18,.05,.12,-.34,2.75,m.lightBar);
  b(root,'chain-gun',.11,.11,1.25,0,-.73,1.9,metal);
  modelCylinder(root,'rotor-mast',metal,.11,.95,0,1.35,-.35,8);
  const rotor=new Group();rotor.position.set(0,1.8,-.35);root.add(rotor);mainRotors.push(rotor);
  for(const angle of [0,Math.PI/2]) {const blade=b(rotor,'main-rotor',8,.045,.22,0,0,0,metal);blade.rotation.y=angle;}
  modelCylinder(root,'longbow-radar',m.dark,.62,.3,0,2.15,-.35,12);
  const tail=new Group();tail.position.set(.22,.85,-5.85);root.add(tail);tailRotors.push(tail);
  for(const angle of [.3,1.8]) {const blade=b(tail,'tail-rotor',.05,1.5,.12,0,0,0,metal);blade.rotation.x=angle;}
  // Merge only static panels; the rotor groups stay independent for animation.
  const roles:[string,Material][]=[...Object.entries(m),['metal',metal]];
  for(const child of root.children) if(child instanceof Group && child!==rotor && child!==tail) compact(child,'pod',roles);
  compact(root,'airframe',roles);
  return {root,refs:{mainRotors,tailRotors,missileRack}};
}

const staticGeometry=new Map<string,BufferGeometry>();
function compact(group:Group,label:string,roles:[string,Material][]):void {
  const meshes=group.children.filter((child):child is Mesh=>child instanceof Mesh);
  for(const material of new Set(meshes.map(mesh=>mesh.material))) {
    const parts=meshes.filter(mesh=>mesh.material===material);
    if(parts.length<2 || Array.isArray(material)) continue;
    const key=`${label}:${roles.filter(([,m])=>m===material).map(([role])=>role).join(',')}`;
    let geometry=staticGeometry.get(key);
    if(!geometry) {
      const pieces=parts.map(mesh=>{mesh.updateMatrix();return mesh.geometry.clone().applyMatrix4(mesh.matrix);});
      geometry=mergeGeometries(pieces,false)!;pieces.forEach(piece=>piece.dispose());
      geometry.userData.ironDominionSharedUnitGeometry=true;staticGeometry.set(key,geometry);
    }
    group.remove(...parts);group.add(new Mesh(geometry,material));
  }
}
