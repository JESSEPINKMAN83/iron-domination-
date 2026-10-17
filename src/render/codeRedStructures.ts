import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Group, Mesh, MeshStandardMaterial, SphereGeometry, type Object3D, type Material } from 'three';
import { nationForTeam } from '../content/nations';
import type { Entity } from '../sim/components';
import { modelBox, modelCylinder } from './codeRedModels';
import { nationFlagMaterial } from './codeRedFlags';
interface Helpers {
  add: <T extends Object3D>(object:T,fragility?:number)=>T;
  box:(name:string,w:number,h:number,d:number,x:number,y:number,z:number,m:Material,f?:number)=>Mesh;
}
const domeGeometry=new SphereGeometry(1,16,8,0,Math.PI*2,0,Math.PI/2);
/** Every assembly is registered with the existing damage-part system. */
export function codeRedStructure(entity:Entity,w:number,d:number,h:number,accent:Material,helpers:Helpers): {handled:boolean;turret?:Group} {
  const nation=nationForTeam(entity.team?.id); const east=nation?.doctrine==='missile-command';const kind=entity.building?.kind;
  const {add,box}=helpers;
  if(kind==='command-yard' && nation){
    box('hq-flag-mast',.12,h*1.6,.12,w*.37,h*1.8,-d*.2,steel,5);
    const flag=box('national-flag',w*.25,h*.4,.025,w*.37+w*.125,h*2.35,-d*.2,nationFlagMaterial(nation.id),4);
    flag.rotation.y=-.3;
    return {handled:false};
  }
  const b=(g:Group,n:string,mat:Material,bw:number,bh:number,bd:number,x=0,y=0,z=0)=>modelBox(g,n,mat,bw,bh,bd,x,y,z);
  const c=(g:Group,n:string,mat:Material,r:number,ch:number,x=0,y=0,z=0)=>modelCylinder(g,n,mat,r,ch,x,y,z);
  if(kind==='aa-tower'||kind==='missile-defense'||kind==='skylance-ciws'){
    const baseHeight=h; h=5.8;
    const pivot=new Group();pivot.name=`code-red-${kind}-pivot`;pivot.position.y=baseHeight+.25;
    c(pivot,'turntable',dark,w*.29,.45);
    if(kind==='skylance-ciws'){
      c(pivot,'phalanx-pedestal',armor,w*.2,h*.45,0,h*.2,0);
      const dome=new Mesh(domeGeometry,radome);dome.name='phalanx-radome';dome.scale.set(w*.23,h*.48,w*.23);dome.position.y=h*.5;pivot.add(dome);
      b(pivot,'gun-housing',armor,w*.35,h*.3,d*.24,0,h*.23,d*.2);
      for(let i=0;i<6;i++){const a=i*Math.PI/3;c(pivot,'gatling-barrel',steel,w*.018,d*.44,Math.cos(a)*w*.065,h*.22+Math.sin(a)*w*.065,d*.46,).rotation.x=Math.PI/2;}
    } else if(east && kind==='aa-tower'){
      b(pivot,'khordad-truck',armor,w*.7,h*.25,d*.72,0,.35,0);
      b(pivot,'khordad-cab',armor,w*.65,h*.4,d*.22,0,h*.3,d*.26);
      b(pivot,'truck-windscreen',glass,w*.5,h*.13,.06,0,h*.4,d*.38);
      for(const side of [-1,1])for(const z of [-d*.25,0,d*.25])c(pivot,'truck-wheel',dark,w*.075,w*.08,side*w*.36,.12,z).rotation.z=Math.PI/2;
      const rack=new Group();rack.position.set(0,h*.35,-d*.1);rack.rotation.x=-.7;
      for(const x of [-w*.16,w*.16]){c(rack,'khordad-canister',armor,w*.115,d*.8,x,0,0,).rotation.x=Math.PI/2;c(rack,'sealed-canister-cap',dark,w*.1,.06,x,0,d*.41).rotation.x=Math.PI/2;}
      pivot.add(rack);
    } else if(kind==='aa-tower'){
      for(const x of [-w*.3,0,w*.3]) {
        const rack=new Group();rack.name='iron-dome-20-cell-launcher';rack.position.set(x,h*.26,0);rack.rotation.x=-.75;
        b(rack,'launcher-box',armor,w*.26,h*.4,d*.55);
        // Recessed faces convey twenty tubes per box with a single merged grid in the LOD-free building detail.
        for(let row=0;row<5;row++)for(let col=0;col<4;col++)b(rack,'tamir-cell',dark,w*.045,h*.056,.035,(col-1.5)*w*.057,(row-2)*h*.073,d*.278);
        pivot.add(rack);
      }
      c(pivot,'radar-mast',steel,.13,h*.9,-w*.4,h*.45,-d*.32);
      b(pivot,'iron-dome-radar',armor,w*.24,h*.3,.18,-w*.4,h*.95,-d*.32).rotation.x=-.2;
    } else {
      for(const x of [-w*.18,w*.18]){
        const canister=c(pivot,'arrow-elevated-canister',armor,w*.105,h*1.05,x,h*.52,0);canister.rotation.x=-.2;
        c(pivot,'canister-cap',dark,w*.11,.1,x,h*1.04,-h*.1);
      }
      b(pivot,'green-pine-radar',armor,w*.3,h*.55,.22,w*.36,h*.35,-d*.25).rotation.x=-.2;
    }
    b(pivot,'team-identification',accent,w*.48,.18,.08,0,.2,d*.38);
    compactAssembly(pivot); add(pivot,5);return {handled:true,turret:pivot};
  }
  if(kind==='strategic-silo' && east){
    const berm=new Group();berm.name='missile-city-berm';berm.position.y=h;
    b(berm,'bunker-roof',armor,w*.9,h*.28,d*.8,0,h*.12,0);
    for(const side of [-1,1])b(berm,'sloping-earth-berm',earth,w*.29,h*.65,d*.8,side*w*.31,h*.17,0).rotation.z=side*.35;
    b(berm,'tunnel-mouth',dark,w*.36,h*.55,.08,0,h*.1,d*.41);
    b(berm,'tunnel-lintel',armor,w*.44,.3,.35,0,h*.4,d*.4);
    b(berm,'launcher-truck',armor,w*.25,h*.15,d*.5,0,-h*.08,d*.17);
    b(berm,'truck-cab',accent,w*.24,h*.22,d*.16,0,h*.04,d*.35);
    const tube=c(berm,'missile-city-canister',steel,w*.08,d*.55,0,h*.16,d*.08);tube.rotation.x=Math.PI/2-.22;
    compactAssembly(berm); add(berm,7);return {handled:true};
  }
  if(kind==='intelligence-center' && east){
    const roof=new Group();roof.name='aerospace-hq';roof.position.y=h;
    const dome=new Mesh(domeGeometry,armor);dome.name='command-dome';dome.scale.set(w*.3,h*.65,d*.3);roof.add(dome);
    for(const x of [-w*.36,w*.36]){
      c(roof,'communications-mast',steel,.09,h*.65,x,h*.28,0);
      const dish=new Mesh(domeGeometry,radome);dish.name='satellite-dish';dish.scale.set(w*.12,h*.16,w*.12);dish.position.set(x,h*.66,0);dish.rotation.x=Math.PI*.65;roof.add(dish);
    }
    b(roof,'hq-team-band',accent,w*.65,.17,.1,0,.1,d*.38);
    compactAssembly(roof); add(roof,6);return {handled:true};
  }
  return {handled:false};
}
const armor=new MeshStandardMaterial({color:0x81816b,roughness:.85});
const steel=new MeshStandardMaterial({color:0x454c49,roughness:.6,metalness:.3});
const dark=new MeshStandardMaterial({color:0x161e1b,roughness:.9});
const radome=new MeshStandardMaterial({color:0xc7c8b5,roughness:.8});
const glass=new MeshStandardMaterial({color:0x557b81,roughness:.3});
const earth=new MeshStandardMaterial({color:0x817257,roughness:1});

// Collapse the sixty launcher cells and all other static detail into one draw
// per material. The registered assembly still participates in destruction.
function compactAssembly(root:Group):void {
  root.updateMatrixWorld(true);
  const inverse=root.matrixWorld.clone().invert();
  const groups=new Map<Material, import('three').BufferGeometry[]>();
  root.traverse(object=>{
    if(!(object instanceof Mesh)||Array.isArray(object.material))return;
    const geometry=object.geometry.clone().applyMatrix4(inverse.clone().multiply(object.matrixWorld));
    const list=groups.get(object.material)??[];list.push(geometry);groups.set(object.material,list);
  });
  root.clear();
  for(const [material,geometries] of groups){
    const merged=mergeGeometries(geometries,false);
    geometries.forEach(g=>g.dispose());
    if(merged){const mesh=new Mesh(merged,material);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);}
  }
}

for (const material of [armor, steel, dark, radome, glass, earth]) material.userData.codeRedSharedMaterial = true;
