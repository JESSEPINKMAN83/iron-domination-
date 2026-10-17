import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import type { Entity } from '../sim/components';
const beam = new BoxGeometry(1,1,1);
beam.userData.baseActivitySharedGeometry=true;
const steel = new MeshStandardMaterial({color:0x9b8760,roughness:.8});
const beacon = new MeshStandardMaterial({color:0xe8b659,emissive:0xffa820,emissiveIntensity:1,roughness:.6});
/** One shutter per producer. Repair equipment is allocated only while repairing. */
export function updateBaseActivity(root:Group,entity:Entity,tick:number,visible:boolean):void {
  const shutter=root.userData.productionShutter as Object3D|undefined;
  if(shutter) {
    const job=entity.producer?.active;
    const departing=tick-(entity.producer?.lastDepartureTick ?? -10000)<85;
    const opening=departing || !!job && job.remaining<2;
    const old=(root.userData.shutterOpen as number|undefined)??0;
    const next=visible ? old+(Number(opening)-old)*.12 : old;
    root.userData.shutterOpen=next;
    const home=shutter.userData.homeY as number, height=shutter.userData.height as number;
    shutter.scale.y=1-next*.94;shutter.position.y=home+height*next*.47;
  }
  let repair=root.userData.repairActivity as Group|undefined;
  const repairing=visible && !!entity.building?.repair && !entity.destroyed;
  if(repairing && !repair) {
    const hull=root.userData.hullSize as {fullW:number;fullD:number;height:number};
    repair=new Group();repair.name='repair-service-rig';
    const pole=new Mesh(beam,steel);pole.scale.set(.15,2.5,.15);pole.position.set(hull.fullW*.46,hull.height+1.1,hull.fullD*.4);
    const arm=new Mesh(beam,steel);arm.scale.set(2.6,.13,.13);arm.position.set(hull.fullW*.46-1.2,hull.height+2.3,hull.fullD*.4);
    const lamp=new Mesh(beam,beacon);lamp.scale.set(.45,.35,.45);lamp.position.set(hull.fullW*.46,hull.height+2.5,hull.fullD*.4);
    repair.add(pole,arm,lamp);root.add(repair);root.userData.repairActivity=repair;
  }
  if(repair){repair.visible=repairing;if(repairing)repair.children[2].scale.y=.22+.13*(.5+.5*Math.sin(tick*.3));}
}

steel.userData.baseActivitySharedMaterial=true;beacon.userData.baseActivitySharedMaterial=true;
