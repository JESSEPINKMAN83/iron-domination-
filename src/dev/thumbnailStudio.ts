import { commandIconPath } from '../ui/commandIcons';
import { ACESFilmicToneMapping, AmbientLight, Box3, DirectionalLight, Group, HemisphereLight, InstancedMesh, Material, Matrix4, Mesh, MeshStandardMaterial, OrthographicCamera, PCFSoftShadowMap, PlaneGeometry, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { STRUCTURES, UNITS, type UnitKind } from '../content/phase3';
import { MAP01 } from '../content/maps';
import { generateHeightfield } from '../sim/heightfield';
import type { Entity } from '../sim/components';
import { createGameSim, spawnTankAt, spawnScoutTankAt, spawnSiegeTankAt, spawnWaspAt, spawnVultureAt, spawnHammerheadAt } from '../sim/world';
import { spawnInfantryAt } from '../sim/economy';
import { BuildingView } from '../render/buildingView';
import { UnitView } from '../render/unitView';
import type { RenderContext } from '../render/renderer';

/** Local authoring tool; generated WebP files are served as ordinary static assets. */
export async function showThumbnailStudio(): Promise<void> {
  if (new URLSearchParams(location.search).get('render-models') !== '1') {
    showPortraitGallery();
    return;
  }
  document.body.innerHTML = '<main class="thumbnail-studio"><header><small>IRON DOMINATION / ART DIRECTION</small><h1>FIELD EQUIPMENT ATLAS</h1><p>Current-model equipment portraits and cinematic infantry character art.</p><a href="/?start=test&building-showcase=1&armies=2">Test in game ↗</a></header><div class="thumbnail-grid"></div></main>';
  const style = document.createElement('style');
  style.textContent = `body{margin:0;background:#091219;color:#eaf2ef;font-family:system-ui,sans-serif;overflow:auto!important}.thumbnail-studio{max-width:1440px;margin:auto;padding:40px 32px}.thumbnail-studio header{margin-bottom:32px}.thumbnail-studio small{font:11px monospace;letter-spacing:.18em;color:#8ee0bf}.thumbnail-studio h1{font:800 clamp(28px,4vw,48px) system-ui;letter-spacing:-.04em;margin:10px 0}.thumbnail-studio p{color:#a8bbb9}.thumbnail-studio a{color:#a2e8ce}.thumbnail-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:20px}.thumbnail-studio article{background:#111f28;border:1px solid #2a3f48;border-radius:12px;overflow:hidden}.thumbnail-studio img{display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:cover}.thumbnail-studio article div{padding:14px 16px}.thumbnail-studio h2{font:700 15px system-ui;margin:0 0 6px}.thumbnail-studio article small{font-size:9px;color:#8faaa8}`;
  document.head.append(style);
  const renderer = new WebGLRenderer({ antialias:true, alpha:true, preserveDrawingBuffer:true });
  renderer.setSize(512,384); renderer.setPixelRatio(1);
  renderer.outputColorSpace=SRGBColorSpace; renderer.toneMapping=ACESFilmicToneMapping; renderer.toneMappingExposure=1.15;
  renderer.shadowMap.enabled=true; renderer.shadowMap.type=PCFSoftShadowMap;
  const scene=new Scene();
  scene.add(new HemisphereLight(0xc4eaff,0x182c38,2.2),new AmbientLight(0xffffff,.4));
  const key=new DirectionalLight(0xffe1b6,3.5); key.position.set(-12,20,18); key.castShadow=true;
  key.shadow.mapSize.set(1024,1024); key.shadow.camera.left=-14;key.shadow.camera.right=14;key.shadow.camera.top=14;key.shadow.camera.bottom=-14; key.shadow.bias=-.001; key.shadow.normalBias=.035;scene.add(key);
  const rim=new DirectionalLight(0x68d9ff,2.5);rim.position.set(10,12,-12);scene.add(rim);
  const floor=new Mesh(new PlaneGeometry(200,200),new MeshStandardMaterial({color:0x10222d,roughness:.88,metalness:.1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.05;floor.receiveShadow=true;scene.add(floor);
  const camera=new OrthographicCamera(-12,12,9,-9,.1,200);
  const ctx={setupLitMaterial:<T extends Material>(m:T)=>m} as RenderContext;
  const hf=generateHeightfield(MAP01);const sim=createGameSim(hf);
  const buildings=new BuildingView(sim,hf,ctx);const units=new UnitView([],hf,ctx);
  let id=10000;
  const entries: {kind:string;label:string;category:string;model:Group | import('three').Object3D}[]=[];
  const defs=[{kind:'command-yard',label:'Command Yard',footprint:{w:9,h:8}},...Object.values(STRUCTURES)];
  for(const def of defs){
    const entity:Entity={id:id++,transform:{x:0,z:0,rot:0},previousTransform:{x:0,z:0,rot:0},team:{id:3},health:{current:100,max:100},building:{kind:def.kind,label:def.label,footprint:def.footprint,powerProduced:0,powerUsed:0,complete:true,buildProgress:1}};
    entries.push({kind:def.kind,label:def.label,category:'BASE / '+('tab' in def && def.tab==='defense'?'DEFENSE':'INFRASTRUCTURE'),model:buildings.createThumbnailModel(entity)});
  }
  for(const def of Object.values(UNITS)){
    const kind=def.kind; let entity:Entity;
    if(['infantry','sniper','grenadier','rocket-infantry'].includes(kind)) entity=spawnInfantryAt(sim,0,0,3,kind as UnitKind);
    else if(kind==='tank')entity=spawnTankAt(sim,0,0,def.label,3);
    else if(kind==='scout-tank')entity=spawnScoutTankAt(sim,0,0,def.label,3);
    else if(kind==='siege-tank')entity=spawnSiegeTankAt(sim,0,0,def.label,3);
    else if(kind==='wasp')entity=spawnWaspAt(sim,hf,0,0,def.label,3);
    else if(kind==='hammerhead')entity=spawnHammerheadAt(sim,hf,0,0,def.label,3);
    else entity=spawnVultureAt(sim,hf,0,0,def.label,3);
    entries.push({kind,label:def.label,category:def.tab.toUpperCase(),model:units.createThumbnailModel(entity)});
  }
  const harvester:Entity={id:id++,transform:{x:0,z:0,rot:0},previousTransform:{x:0,z:0,rot:0},team:{id:3},selectable:{type:'harvester',radius:3,selected:false}};
  entries.push({kind:'harvester',label:'Ore Collector',category:'ECONOMY',model:units.createThumbnailModel(harvester)});
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=384;const art=canvas.getContext('2d')!;
  for(const entry of entries){
    const model=entry.model; model.position.set(0,0,0);model.rotation.set(0,0,0);model.updateMatrixWorld(true);
    const bounds=visibleBounds(model);const size=bounds.getSize(new Vector3());const center=bounds.getCenter(new Vector3());
    const infantry=entry.category==='INFANTRY';
    const scale=infantry?12/size.y:17/Math.max(size.x,size.z,size.y*1.3);
    model.scale.multiplyScalar(scale);model.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale);
    model.traverse(o=>{if(o instanceof Mesh){o.castShadow=true;o.receiveShadow=true;}});
    scene.add(model);
    floor.visible=!infantry;
    const framed=visibleBounds(model);const midpoint=framed.getCenter(new Vector3());
    camera.left=-12;camera.right=12;camera.top=9;camera.bottom=-9;
    camera.position.set(infantry?14:23,infantry?11:24,32);
    camera.lookAt(0,infantry?size.y*scale*.68:midpoint.y,0);camera.updateMatrixWorld(true);camera.updateProjectionMatrix();
    if(infantry){camera.top=4.8;camera.bottom=-4.8;camera.right=6.4;camera.left=-6.4;}
    else {
      let fit=.1;
      for(const x of [framed.min.x,framed.max.x])for(const y of [framed.min.y,framed.max.y])for(const z of [framed.min.z,framed.max.z]){
        const projected=new Vector3(x,y,z).project(camera);fit=Math.max(fit,Math.abs(projected.x)/.86,Math.abs(projected.y)/.82);
      }
      camera.left*=fit;camera.right*=fit;camera.top*=fit;camera.bottom*=fit;
    }
    camera.updateProjectionMatrix();
    renderer.render(scene,camera);
    const gradient=art.createLinearGradient(0,0,512,384);gradient.addColorStop(0,'#25495a');gradient.addColorStop(.6,'#142c38');gradient.addColorStop(1,'#09151d');art.fillStyle=gradient;art.fillRect(0,0,512,384);
    art.drawImage(renderer.domElement,0,0);
    const fade=art.createLinearGradient(0,240,0,384);fade.addColorStop(0,'#06101800');fade.addColorStop(1,'#061018aa');art.fillStyle=fade;art.fillRect(0,0,512,384);
    art.strokeStyle='#9ce6cf26';art.lineWidth=1;art.beginPath();art.moveTo(24,41);art.lineTo(24,24);art.lineTo(44,24);art.moveTo(468,360);art.lineTo(488,360);art.lineTo(488,343);art.stroke();
    art.fillStyle='#a9e9d2';art.fillRect(24,350,30,3);
    const card=document.createElement('article');const img=document.createElement('img');img.src=infantry?commandIconPath(entry.kind):canvas.toDataURL('image/webp',.92);img.alt=entry.label;img.dataset.asset=entry.kind;
    const copy=document.createElement('div');const title=document.createElement('h2');title.textContent=entry.label;const category=document.createElement('small');category.textContent=entry.category;copy.append(title,category);card.append(img,copy);document.querySelector('.thumbnail-grid')!.append(card);
    scene.remove(model);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  }
  renderer.dispose();
}

function visibleBounds(root: import('three').Object3D): Box3 {
  root.updateMatrixWorld(true);
  const result=new Box3();const matrix=new Matrix4();const instance=new Matrix4();
  root.traverseVisible(part=>{
    if(!(part instanceof Mesh))return;
    part.geometry.computeBoundingBox();if(!part.geometry.boundingBox)return;
    const count=part instanceof InstancedMesh?part.count:1;
    for(let i=0;i<count;i++){
      if(part instanceof InstancedMesh){part.getMatrixAt(i,instance);matrix.multiplyMatrices(part.matrixWorld,instance);}else matrix.copy(part.matrixWorld);
      result.union(part.geometry.boundingBox.clone().applyMatrix4(matrix));
    }
  });
  return result;
}


function showPortraitGallery(): void {
  document.body.innerHTML = '';
  const main = document.createElement('main');
  main.className = 'portrait-atlas';
  main.innerHTML = `<header><small>IRON DOMINATION / EQUIPMENT ATLAS</small><h1>Built for the battlefield.</h1><p>Cinematic portraits. Recognizable equipment. One unified roster.</p><a href="/?start=test&combat-readability-test=1&armies=2&sides=1,2&combat=manual">Test the command cards ↗</a></header><nav aria-label="Filter portraits"></nav><section class="portrait-atlas__grid" aria-label="Unit and building portraits"></section>`;
  const style = document.createElement('style');
  style.textContent = `body{margin:0!important;background:#091219;color:#edf3ef;font-family:system-ui,sans-serif;overflow:auto!important}.portrait-atlas{max-width:1440px;margin:auto;padding:40px 28px 64px}.portrait-atlas header small{color:#9de5c4;font:11px monospace;letter-spacing:.17em}.portrait-atlas h1{font:800 clamp(30px,4vw,48px)/1.1 system-ui;letter-spacing:-.04em;margin:12px 0}.portrait-atlas p{color:#9eb1b7}.portrait-atlas a{color:#b5e8d2}.portrait-atlas nav{display:flex;flex-wrap:wrap;gap:8px;margin:30px 0 22px}.portrait-atlas nav button{font:600 12px system-ui;border:1px solid #2f444e;border-radius:7px;padding:10px 15px;background:#14242e;color:#c3d0d3;cursor:pointer}.portrait-atlas nav button[aria-pressed=true]{background:#a0e3c5;color:#10251e;border-color:#a0e3c5}.portrait-atlas__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px}.portrait-atlas article{overflow:hidden;border:1px solid #2d3d46;border-radius:10px;background:#111f28}.portrait-atlas article[hidden]{display:none}.portrait-atlas img{display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:cover}.portrait-atlas article div{padding:14px 16px 18px}.portrait-atlas h2{margin:0 0 6px;font:700 15px system-ui}.portrait-atlas article small{font:9px monospace;color:#9fb8b9;letter-spacing:.13em}`;
  document.head.append(style); document.body.append(main);
  const entries = [
    {kind:'command-yard',label:'Command Yard',category:'Infrastructure'},
    ...Object.values(STRUCTURES).map(d=>({kind:d.kind,label:d.label,category:d.tab==='defense'?'Defense':'Infrastructure'})),
    ...Object.values(UNITS).map(d=>({kind:d.kind,label:d.label,category:d.tab==='infantry'?'Infantry':d.tab==='aircraft'?'Aircraft':'Vehicles'})),
    {kind:'harvester',label:'Ore Collector',category:'Vehicles'},
  ];
  const grid=main.querySelector('section')!;
  for(const entry of entries){
    const card=document.createElement('article');card.dataset.category=entry.category;
    const image=document.createElement('img');image.src=commandIconPath(entry.kind);image.alt=entry.label;image.dataset.asset=entry.kind;image.width=512;image.height=384;
    // During art authoring, incomplete groups keep their model reference visible.
    image.onerror=()=>{image.onerror=null;image.src=`/assets/ui/command-icons/${entry.kind}.webp`;};
    const copy=document.createElement('div');const title=document.createElement('h2');title.textContent=entry.label;
    const tag=document.createElement('small');tag.textContent=entry.category.toUpperCase();copy.append(title,tag);card.append(image,copy);grid.append(card);
  }
  const nav=main.querySelector('nav')!;
  for(const category of ['All','Infrastructure','Defense','Infantry','Vehicles','Aircraft']){
    const button=document.createElement('button');button.type='button';button.textContent=category;button.setAttribute('aria-pressed',String(category==='All'));
    button.onclick=()=>{
      for(const tab of Array.from(nav.querySelectorAll('button')))tab.setAttribute('aria-pressed',String(tab===button));
      for(const card of Array.from(grid.querySelectorAll<HTMLElement>('article')))card.hidden=category!=='All'&&card.dataset.category!==category;
    };
    nav.append(button);
  }
}
