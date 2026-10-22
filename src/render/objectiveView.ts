import { nationForTeam } from '../content/nations';
import { nationFlagMaterial } from './codeRedFlags';
import { objectiveStatus } from '../ui/objectiveStatus';
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, RingGeometry, DoubleSide, PlaneGeometry, Raycaster, Vector2, type PerspectiveCamera } from 'three';
import type { GameSim } from '../sim/world';
import { allianceSide } from '../sim/world';
import { CAPTURE_RADIUS, CAPTURE_TICKS, OBJECTIVE_INFO } from '../sim/objectives';

/** Three static landmarks: shared geometry, no shadows, lights, particles or frame-time rebuilds. */
export class ObjectiveView {
  readonly group = new Group();
  onInspect?: (site: import('../sim/components').Entity) => void;
  private readonly picker = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly sites = new Map<number, { ring: Mesh; material: MeshBasicMaterial; flag: Mesh; progress: HTMLElement; button: HTMLButtonElement }>();
  readonly panel = document.createElement('div');
  private readonly neutralFlagMaterial = new MeshBasicMaterial({color:0xffffff,side:DoubleSide});
  constructor(private readonly sim: GameSim, private readonly localTeam: number, focus: (x:number,z:number)=>void, private readonly visible: (x:number,z:number)=>boolean) {
    this.panel.className = 'battle-objectives';
    this.panel.setAttribute('aria-label', 'Contested battlefield objectives');
    this.panel.addEventListener('pointerdown', event => event.stopPropagation());
    const box = new BoxGeometry(1,1,1);
    const flagGeometry = new PlaneGeometry(6,4);
    const neutralFlag = this.neutralFlagMaterial;
    const pole = new CylinderGeometry(0.35,0.35,1,6);
    const ringGeometry = new RingGeometry(CAPTURE_RADIUS-0.6,CAPTURE_RADIUS,48);
    const steel = new MeshLambertMaterial({color:0x4f625d});
    const dark = new MeshLambertMaterial({color:0x283732});
    for (const site of sim.objectivesQuery) {
      const root = new Group(); root.position.set(site.transform.x,(site.transform.y ?? 0)+0.2,site.transform.z);
      const add = (x:number,y:number,z:number,w:number,h:number,d:number, material=steel) => { const mesh = new Mesh(box, material); mesh.position.set(x,y,z);mesh.scale.set(w,h,d);root.add(mesh);return mesh; };
      add(0,0.7,0,12,1.4,10,dark);
      const mast = new Mesh(pole,steel); mast.position.set(5,7,0);mast.scale.y=14;root.add(mast);
      const material = new MeshBasicMaterial({ color:0xa3afa9,transparent:true,opacity:0.7,side:DoubleSide,depthWrite:false });
      const ring = new Mesh(ringGeometry,material);ring.rotation.x=-Math.PI/2;ring.position.y=0.15;root.add(ring);
      const flag = new Mesh(flagGeometry,neutralFlag); flag.position.set(8,12,0);root.add(flag);
      if(site.objective.kind==='radar') {const dish=add(0,8,0,9,5,0.7);dish.rotation.x=-0.5;add(0,4,0,1.2,7,1.2);}
      else if(site.objective.kind==='oil') {add(-2,4,0,1.4,7,2);const beam=add(0,7,0,11,1.2,1.5);beam.rotation.z=-0.3;add(4,3,0,0.5,6,0.5);}
      else {for(let i=0;i<3;i++)add(i*3-3,2.6,0,2.6,3.8,5);add(0,5,0,6,0.5,1);add(0,5,0,1,0.5,5);}
      root.userData.objectiveId = site.id;
      ring.userData.captureRing = true;
      this.group.add(root);
      const button = document.createElement('button');button.type='button';
      button.title=`${OBJECTIVE_INFO[site.objective.kind].label}: ${OBJECTIVE_INFO[site.objective.kind].benefit}. Hold with ground combat units for 8 seconds. Click to locate.`;
      const text=document.createElement('span');button.append(text);
      const progress=document.createElement('i');button.append(progress);
      button.onclick=()=>{ focus(site.transform.x,site.transform.z); this.onInspect?.(site); };
      this.panel.append(button);this.sites.set(site.id,{ring,material,flag,button,progress});
    }
    if(this.sites.size)document.body.append(this.panel);
    this.update();
  }
  inspectAtScreen(camera: PerspectiveCamera, x: number, y: number, width: number, height: number): boolean {
    this.pointer.set(x / width * 2 - 1, -(y / height) * 2 + 1);
    this.picker.setFromCamera(this.pointer,camera);
    const hit = this.picker.intersectObject(this.group,true).find(hit => !hit.object.userData.captureRing);
    if (!hit) return false;
    let object = hit.object;
    while (object.parent && object.userData.objectiveId === undefined) object = object.parent;
    const site = this.sim.byId.get(object.userData.objectiveId);
    if (!site?.objective) return false;
    this.onInspect?.(site);
    return true;
  }
  update():void {
    for(const site of this.sim.objectivesQuery) {
      const view=this.sites.get(site.id);if(!view)continue;
      const o=site.objective;
      const friendly=o.ownerTeam!==undefined&&allianceSide(this.sim,o.ownerTeam)===allianceSide(this.sim,this.localTeam);
      const known=this.visible(site.transform.x,site.transform.z)||friendly;
      const color=o.ownerTeam===undefined?'#95a69c':friendly?'#9de5c4':'#ed8674';
      view.material.color.set(color);view.button.style.setProperty('--site-color',color);
      const status = objectiveStatus(o,known,this.localTeam);
      const nation = nationForTeam(status.flagTeam);
      // Reuse HQ country flag textures: no per-frame canvas or texture uploads.
      const flagMaterial = nation ? nationFlagMaterial(nation.id) : undefined;
      if (flagMaterial) view.flag.material = flagMaterial;
      else if (!(view.flag.material instanceof MeshBasicMaterial) || view.flag.material.map) {
        view.flag.material = this.neutralFlagMaterial;
      }
      const label = status.label;
      if (view.button.firstElementChild!.textContent !== label) view.button.firstElementChild!.textContent = label;
      view.progress.style.transform=`scaleX(${known?o.captureTicks/CAPTURE_TICKS:0})`;
      if (view.button.title !== status.description) {
        view.button.title = status.description;
        view.button.setAttribute('aria-label',status.description);
      }
    }
  }
}
