import { AmbientLight, Box3, BoxGeometry, Color, DirectionalLight, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, Scene, Vector3, WebGLRenderer, type Object3D } from 'three';
import { createCodeRedVehicle } from '../render/codeRedModels';
import { createAircraftObject, createVehicleObject } from '../render/unitView';
import { createBuildingDetails, heightForStructure } from '../render/buildingView';
import { buildSoldier } from '../render/soldier';
import { FACTION } from '../render/palette';
import { applyArmyNations } from '../content/nations';
import type { Entity } from '../sim/components';
import type { ArmyDoctrineId } from '../content/armyDoctrines';


export async function showCodeRedStudio():Promise<void> {
  applyArmyNations(['iron-legion','missile-command']);
  document.body.innerHTML=`<style>html,body{height:auto!important;overflow:auto!important}body{margin:0;background:#0b1418;color:#e6ebe5;font:15px system-ui}main{max-width:1400px;margin:auto;padding:32px}h1{font-size:40px;margin:10px 0}p{color:#aebdbb}nav{display:flex;gap:12px;margin:24px 0;flex-wrap:wrap}a,button{background:#1d343c;border:1px solid #46606a;color:#d5eee8;padding:12px;border-radius:8px;text-decoration:none;cursor:pointer}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}article{border:1px solid #34474a;border-radius:12px;overflow:hidden;background:#152227}img{width:100%;aspect-ratio:4/3;display:block}h2{font-size:17px;margin:16px 16px 4px}article p{margin:0 16px 16px;font-size:13px}#status{white-space:pre-wrap}</style><main><small>CODE RED / PHASE 2 / LOCAL MODEL REVIEW</small><h1>Two sides. Distinct silhouettes.</h1><p>Actual game models, rendered once. Inspect the armor, launchers, flags and infantry equipment below, then test them in a match.</p><nav><a href="?start=lineup&armies=2&doctrines=iron-legion,missile-command&time=day&weather=clear">Unit lineup</a><a href="?start=test&building-showcase=defense&armies=2&doctrines=iron-legion,missile-command&time=day&weather=clear">Defense showcase</a><a href="?start=test&building-showcase=industry&armies=2&doctrines=iron-legion,missile-command&time=day&weather=clear">Base showcase</a><a href="?start=battle-test&performance-test=1&seed=7&armies=4&stress-bases=26&stress-infantry=60&code-red-preview=1">Stress battle</a><button id="benchmark">Compare armor draw calls</button></nav><p id="status">Loading models…</p><section id="models"></section></main>`;
  const renderer=new WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(640,480);renderer.setPixelRatio(1);
  const scene=new Scene();scene.background=new Color('#192a30');scene.add(new AmbientLight(0xffffff,2));
  const key=new DirectionalLight(0xffe7c1,3.5);key.position.set(10,20,12);scene.add(key);
  const rim=new DirectionalLight(0x8ed9fa,2);rim.position.set(-10,8,-10);scene.add(rim);
  const camera=new OrthographicCamera(-8,8,6,-6,.1,500);
  const steel=new MeshStandardMaterial({color:0x303a3d,roughness:.65,metalness:.3});
  const muzzle=new MeshBasicMaterial({transparent:true,opacity:.5});
  const models: {object:Object3D;title:string;side:string;kind:string;team:number}[]=[];
  const armies:ArmyDoctrineId[]=['iron-legion','missile-command'];
  for(const [index,doctrine] of armies.entries()) {
    const team=index+1;const f=FACTION[team as 1|2];const side=index?'Iran':'Israel';
    const mat=(color:number)=>new MeshStandardMaterial({color,roughness:.8});
    const m={hull:mat(f.hull),dark:mat(f.hullDark),accent:mat(f.accent),lightBar:mat(f.lightBar),canvas:mat(f.canvas),uniform:mat(0x59664a)};
    for(const [kind,title] of [['jackal',index?'Rakhsh 4×4':'Eitan 8×8'],['m17',index?'Karrar':'Merkava Mk4'],['mauler',index?'Fajr-5':'Rochev']] as const)models.push({object:createCodeRedVehicle(kind,doctrine,m,steel,muzzle).root,title,side,kind,team});
    for(const kit of ['rifle','grenadier','rocket','sniper'] as const) {
      const rig=buildSoldier({...m,gear:m.dark,skin:mat(0xbfa381),gunmetal:steel,visor:steel,muzzle},kit,doctrine);
      rig.combatBike.visible=false;models.push({object:rig.root,title:`${index?'IRGC':'IDF'} ${kit}`,side,kind:kit,team});
    }
    for(const kind of ['wasp','vulture'] as const)models.push({object:createAircraftObject(kind,m,steel).root,title:kind==='wasp'?'Cobra':'Apache',side,kind,team});
    for(const kind of ['command-yard','aa-tower','missile-defense','skylance-ciws','strategic-silo','intelligence-center']) {
      const h=heightForStructure(kind),w=kind==='command-yard'?20:16,d=16;
      const entity={team:{id:team},building:{kind}} as Entity;
      const root=new Group();const base=new Mesh(new BoxGeometry(w,h,d),m.hull);base.position.y=h*.5;root.add(base,createBuildingDetails(entity,w,d,h,m.accent));
      const names:Record<string,string>={'command-yard':'Command HQ','aa-tower':index?'Khordad-15':'Iron Dome','missile-defense':'Arrow 3','skylance-ciws':'Phalanx','strategic-silo':index?'Missile City':'Strategic silo','intelligence-center':index?'IRGC Aerospace HQ':'Intelligence center'};
      models.push({object:root,title:names[kind],side,kind,team});
    }
  }
  function render(object:Object3D):string {
    scene.add(object); object.updateMatrixWorld(true);
    const bounds=new Box3();object.traverse(child=>{if(child instanceof Mesh){let visible=true;for(let p:Object3D|null=child;p;p=p.parent)if(!p.visible)visible=false;if(visible)bounds.expandByObject(child);}});
    const center=bounds.getCenter(new Vector3()),size=bounds.getSize(new Vector3());const radius=size.length()*.58;
    camera.left=-radius*4/3;camera.right=radius*4/3;camera.top=radius;camera.bottom=-radius;
    camera.position.copy(center).add(new Vector3(radius*1.5,radius*1.1,radius*1.8));camera.lookAt(center);camera.updateProjectionMatrix();renderer.render(scene,camera);
    const data=renderer.domElement.toDataURL('image/webp',.88);scene.remove(object);return data;
  }
  for(const model of models){
    const card=document.createElement('article');const image=document.createElement('img');image.src=render(model.object);image.alt=`${model.side} ${model.title}`;image.dataset.asset=`${model.team}-${model.kind}`;
    const title=document.createElement('h2');title.textContent=model.title;const caption=document.createElement('p');caption.textContent=model.side;card.append(image,title,caption);document.querySelector('#models')!.append(card);
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  document.querySelector('#status')!.textContent='30 model views ready. Gameplay and weapon balance are unchanged.';
  document.querySelector('#benchmark')!.addEventListener('click',()=>{
    const m={hull:steel,dark:new MeshStandardMaterial(),accent:new MeshStandardMaterial(),canvas:new MeshStandardMaterial(),lightBar:new MeshStandardMaterial(),uniform:steel};
    const results=[];
    for(const kind of ['jackal','m17','mauler'] as const){
      for(const mode of ['baseline','new'] as const){
        const built=mode==='baseline'?createVehicleObject(kind,m,steel,muzzle):createCodeRedVehicle(kind,'iron-legion',m,steel,muzzle);
        render(built.root);results.push(`${kind} ${mode}: ${renderer.info.render.calls} calls, ${renderer.info.render.triangles} triangles`);
      }
    }
    document.querySelector('#status')!.textContent=results.join('\n');
  });
}
