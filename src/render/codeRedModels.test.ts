import { describe,it,expect } from 'vitest';
import { Box3, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3 } from 'three';
import { createCodeRedVehicle } from './codeRedModels';
import { UnitBatchLod } from './unitBatchLod';
import { createBuildingDetails } from './buildingView';
import { applyArmyNations } from '../content/nations';
import type { Entity } from '../sim/components';
const material=()=>new MeshStandardMaterial();
const m={hull:material(),dark:material(),accent:material(),canvas:material(),lightBar:material()};
const gun=material(),flash=new MeshBasicMaterial({transparent:true});
function visibleBounds(root:Group){const b=new Box3();root.updateMatrixWorld(true);root.traverse(o=>{if(o instanceof Mesh&&o.visible)b.expandByObject(o);});return b;}
describe('Code Red armor render contracts',()=>{
  for(const doctrine of ['iron-legion','missile-command'] as const)for(const kind of ['jackal','m17','mauler']) {
    it(`${doctrine} ${kind} keeps its silhouette in the distant bake`,()=>{
      const model=createCodeRedVehicle(kind,doctrine,m,gun,flash);
      const near=visibleBounds(model.root); const lod=new UnitBatchLod();
      lod.bake(kind,model.root,model.refs.turretPivot);lod.begin();lod.add(kind,new Matrix4(),model.refs.turretPivot.matrix);lod.end();
      const far=new Box3();lod.group.updateMatrixWorld(true);lod.group.traverse(o=>{if(o instanceof InstancedMesh){o.computeBoundingBox();far.expandByObject(o);}});
      expect(far.min.distanceTo(near.min)).toBeLessThan(.001);expect(far.max.distanceTo(near.max)).toBeLessThan(.001);
      let meshes=0;model.root.traverse(o=>{if(o instanceof Mesh&&o.visible)meshes++;});expect(meshes).toBeLessThanOrEqual(20);
      expect(model.refs.muzzleFlash.visible).toBe(false);
      expect(model.refs.barrelPivot.parent).toBe(model.refs.turretPivot);
    });
  }
  it('keeps doctrine-specific cached geometry separate',()=>{
    const west=createCodeRedVehicle('jackal','iron-legion',m,gun,flash),east=createCodeRedVehicle('jackal','missile-command',m,gun,flash);
    const westMesh=west.root.getObjectByName('hull-panels') as Mesh,eastMesh=east.root.getObjectByName('hull-panels') as Mesh;
    expect(westMesh.geometry).not.toBe(eastMesh.geometry);
  });
});
describe('Code Red structure assemblies',()=>{
  for(const team of [1,2])for(const kind of ['aa-tower','missile-defense','skylance-ciws','strategic-silo','intelligence-center'])it(`${team} ${kind} remains destructible`,()=>{
    applyArmyNations(['iron-legion','missile-command']);
    const details=createBuildingDetails({building:{kind},team:{id:team}} as Entity,16,16,2.4,m.accent);
    expect(details.userData.detailParts.length).toBeGreaterThan(0);
    if(['aa-tower','missile-defense','skylance-ciws'].includes(kind)){
      const pivot=details.userData.turretPivot as Group;expect(pivot).toBeDefined();
      let meshes=0;pivot.traverse(o=>{if(o instanceof Mesh)meshes++;});expect(meshes).toBeLessThanOrEqual(6);
      expect(details.userData.detailParts.some((p:{object:unknown})=>p.object===pivot)).toBe(true);
    }
  });
});
