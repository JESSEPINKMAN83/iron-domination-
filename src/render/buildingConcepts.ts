import {
  BoxGeometry, CanvasTexture, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group, LatheGeometry,
  Mesh, MeshStandardMaterial, PlaneGeometry, RingGeometry, Shape, SRGBColorSpace, TorusGeometry,
  Vector2, Vector3, type Material, type Object3D,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createBuildingSurface } from './buildingSurfaces';

export const REBUILT_BUILDINGS = new Set(['strategic-silo', 'missile-defense', 'factory', 'barracks']);

/** Complete replacement architecture, on the existing simulation footprint.
 * Each assembly joins the ordinary building damage tree. No decorative old hull remains. */
export function createBuildingConcept(kind: string, width: number, depth: number, height: number, accent: Material): Group {
  const root = new Group(); root.name = `${kind}-redesigned`;
  const X = width / 24, Z = depth / 24, R = Math.min(X, Z);
  const concrete = new MeshStandardMaterial({ color: 0x8c9189, roughness: 0.91, metalness: 0.03, map: createBuildingSurface('concrete') });
  const steel = new MeshStandardMaterial({ color: 0x47585e, roughness: 0.54, metalness: 0.55, map: createBuildingSurface('steel') });
  const edge = new MeshStandardMaterial({ color: 0x99a49f, roughness: 0.43, metalness: 0.65 });
  const dark = new MeshStandardMaterial({ color: 0x121c20, roughness: 0.75, metalness: 0.25 });
  const sand = new MeshStandardMaterial({ color: 0xa69d81, roughness: 0.8, metalness: 0.12, map: createBuildingSurface('concrete') });
  const ochre = new MeshStandardMaterial({ color: 0xb88a3b, roughness: 0.65, metalness: 0.32 });
  const glass = new MeshStandardMaterial({ color: 0x183a45, roughness: 0.19, metalness: 0.66, emissive: 0x225166, emissiveIntensity: 0.14 });
  const light = new MeshStandardMaterial({ color: 0xf5deac, emissive: 0xffcf88, emissiveIntensity: 0.65 });
  const parts: { object: Object3D; y: number; sx: number; sy: number; sz: number; rx: number; ry: number; rz: number; fragility: number }[] = [];
  const add = <T extends Object3D>(object: T, fragility = 5): T => {
    root.add(object); parts.push({ object, y: 0, sx: 1, sy: 1, sz: 1, rx: 0, ry: 0, rz: 0, fragility }); return object;
  };
  const mesh = (name: string, geometry: Mesh['geometry'], mat: Material, x: number, y: number, z: number, parent?: Group): Mesh => {
    const item = new Mesh(geometry, mat); item.name = name; item.position.set(x * X, y, z * Z);
    item.castShadow = true; item.receiveShadow = true;
    if (parent) parent.add(item); else add(item);
    return item;
  };
  const b = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: Material = steel, parent?: Group) =>
    mesh(name, new RoundedBoxGeometry(w * X, h, d * Z, 1, Math.min(0.18, w * X * 0.1, h * 0.15, d * Z * 0.1)), mat, x, y, z, parent);
  const c = (name: string, rt: number, rb: number, h: number, x: number, y: number, z: number, mat: Material = steel, parent?: Group) =>
    mesh(name, new CylinderGeometry(rt * R, rb * R, h, 32), mat, x, y, z, parent);
  const ring = (name: string, r: number, tube: number, x: number, y: number, z: number, mat: Material = edge, parent?: Group) => {
    const item = mesh(name, new TorusGeometry(r * R, tube * R, 6, 48), mat, x, y, z, parent); item.rotation.x = Math.PI / 2; return item;
  };
  const beam = (name: string, from: number[], to: number[], r = 0.08, mat: Material = edge, parent?: Group) => {
    const a = new Vector3(from[0] * X, from[1], from[2] * Z), end = new Vector3(to[0] * X, to[1], to[2] * Z);
    const item = mesh(name, new CylinderGeometry(r, r, a.distanceTo(end), 8), mat, 0, 0, 0, parent);
    item.position.copy(a).add(end).multiplyScalar(0.5); item.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), end.sub(a).normalize()); return item;
  };
  const rails = (name: string, x1: number, z1: number, x2: number, z2: number, y: number) => {
    const group = add(new Group(), 4); group.name = name;
    beam(name, [x1,y+0.95,z1], [x2,y+0.95,z2], 0.055, ochre, group);
    beam(name, [x1,y+0.45,z1], [x2,y+0.45,z2], 0.045, edge, group);
    for (let i=0;i<=5;i++) { const x=x1+(x2-x1)*i/5,z=z1+(z2-z1)*i/5; beam(name,[x,y,z],[x,y+1,z],0.05,edge,group); }
  };
  const vent = (x: number, y: number, z: number, w = 2.5) => {
    const group = add(new Group(), 4); group.name = 'recessed-vent';
    b('vent-recess',w,1.35,0.2,x,y,z,dark,group);
    for(let i=0;i<6;i++) b('vent-louver',w*0.88,0.09,0.22,x,y-0.48+i*0.19,z+0.08,edge,group);
  };
  const sign = (text: string, w: number, x: number, y: number, z: number, roof = false) => {
    const canvas = document.createElement('canvas'); canvas.width=512;canvas.height=128;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#243034';ctx.fillRect(0,0,512,128);
    ctx.fillStyle='#ddd7be';ctx.font='bold 64px monospace';ctx.textAlign='center';ctx.fillText(text,256,85);
    ctx.fillStyle='#ae8038';ctx.fillRect(12,108,488,5);
    const texture = new CanvasTexture(canvas); texture.colorSpace=SRGBColorSpace;
    const item = mesh('building-designation',new PlaneGeometry(w*X,w*X/4),new MeshStandardMaterial({map:texture,roughness:0.8}),x,y,z);
    if(roof) item.rotation.x=-Math.PI/2;
    return item;
  };
  const hazard = (x: number, y: number, z: number, length: number) => {
    const group = add(new Group(), 6); group.name='painted-safety-boundary';
    b('boundary-black',length,0.045,0.5,x,y,z,dark,group);
    for(let i=0;i<Math.floor(length/0.65);i++) { const s=b('boundary-chevron',0.28,0.05,0.5,x-length/2+0.35+i*0.65,y+0.02,z,ochre,group);s.rotation.y=-0.35; }
  };
  // Low common engineering pad, rather than a full-height generic cube.
  b('reinforced-foundation',23.6,0.55,23.6,0,0.42,0,concrete);
  b('foundation-inset',22.9,0.12,22.9,0,0.75,0,dark);

  if (kind === 'strategic-silo') {
    // Two recessed vertical launch wells, with one exposed missile and one armored hatch.
    b('silo-launch-apron',13.5,0.48,21,-4.5,0.99,0,concrete);
    for(const z of [-5.5,5.5]) {
      c('silo-well-shadow',4.35,4.35,0.14,-4.5,1.29,z,dark);
      const collar = mesh('silo-armored-collar',new RingGeometry(3.6*R,4.65*R,48),steel,-4.5,1.38,z);
      collar.rotation.x=-Math.PI/2;
      ring('silo-well-rim',4.2,0.16,-4.5,1.45,z);
      for(let i=0;i<12;i++){ const a=i*Math.PI/6;c('silo-rim-bolt',0.1,0.1,0.1,-4.5+Math.cos(a)*4.3,1.52,z+Math.sin(a)*4.3,ochre); }
      for(const dx of [-4.8,4.8]) b('hatch-slider-track',0.25,0.2,8,-4.5+dx,1.38,z,edge);
    }
    // Closed front hatch: thick, split, ribbed armor flush with the well rim.
    c('sealed-launch-hatch',3.6,3.6,0.4,-4.5,1.48,5.5,steel);
    b('hatch-center-seal',0.09,0.05,6.8,-4.5,1.72,5.5,dark);
    for(const dx of [-1.8,1.8]) b('hatch-locking-rib',0.3,0.18,5.8,-4.5+dx,1.8,5.5,edge);
    sign('VLS 02',3,-4.5,1.74,5.5,true);
    // Rear well: retracted armored covers and a long, properly tapered missile.
    for(const x of [-9.1,0.1]) {
      const cover = b('retracted-blast-cover',1.8,0.42,7.8,x,1.65,-5.5,steel);
      cover.rotation.z=x<0?-0.16:0.16;
      b('cover-drive-cylinder',0.36,0.3,6.8,x,1.99,-5.5,edge);
    }
    const missile = add(new Group(),4);missile.name='silo-deployed-missile';missile.position.set(-4.5*X,1.26,-5.5*Z);
    c('missile-airframe',0.8,0.8,5.2,0,2.55,0,sand,missile);
    c('missile-stage-band',0.83,0.83,0.22,0,3.7,0,steel,missile);
    c('missile-identity-band',0.82,0.82,0.4,0,4.5,0,accent,missile);
    const nose = new LatheGeometry([new Vector2(0.8*R,0),new Vector2(0.74*R,0.65),new Vector2(0.52*R,1.3),new Vector2(0.18*R,1.9),new Vector2(0,2.15)],32);
    mesh('missile-ogive',nose,dark,0,5.12,0,missile);
    for(const side of [-1,1]) b('missile-guide-rail',0.12,4.4,0.15,side*1.15,2.2,0,edge,missile);
    // Hardened control block and independent exhaust/cooling services.
    b('silo-control-bunker',7,4.2,16,7,2.88,-1,sand);
    b('silo-bunker-overhang',7.7,0.5,16.6,7,5.25,-1,concrete);
    b('silo-blast-door',2.4,2.8,0.18,7,2.3,7.12,dark);
    b('silo-door-frame',3,0.28,0.7,7,3.85,7.2,edge);
    b('silo-ready-strip',2.2,0.11,0.14,7,3.53,7.25,light);
    sign('STRATEGIC / 08',5.3,7,4.55,7.33);
    for(const z of [-5,0,5]) {
      c('silo-exhaust-riser',0.55,0.7,1.5,7,6.2,z,steel);
      c('silo-exhaust-cap',0.75,0.75,0.18,7,7,z,dark);
    }
    for(const x of [4.6,9.3]) b('bunker-faction-inset',0.3,3,0.18,x,3.1,7.18,accent);
    for(const z of [-6,-1,4]) {
      b('bunker-reinforcing-buttress',0.4,3.5,0.45,10.55,2.9,z,steel);
      b('bunker-side-access-panel',0.15,1.65,2.7,10.58,2.75,z+1.5,steel);
      for(let i=0;i<4;i++) b('bunker-side-panel-louver',0.18,0.09,2.2,10.68,2.23+i*0.3,z+1.5,edge);
    }
    for(const x of [4.5,9.5]) beam('bunker-roof-conduit',[x,5.64,-7],[x,5.64,4.8],0.1,edge);
    b('bunker-roof-access',2.2,0.24,3.3,7,5.64,3.6,steel);
    rails('launch-crew-rail',-10.7,-10.7,1.2,-10.7,1.1);
    hazard(-4.5,1.27,10.4,12);
  } else if (kind === 'missile-defense') {
    // A low armored SAM emplacement with a six-cell elevated launcher and separate radar cabin.
    b('sam-command-cabin',8,3.3,12,-6.5,2.5,-3.5,sand);
    b('sam-cabin-roof',8.6,0.4,12.6,-6.5,4.35,-3.5,steel);
    b('sam-cabin-door',2.2,2.45,0.2,-6.5,2.2,2.62,dark);
    vent(-6.5,3.2,2.76,3.8);
    sign('SAM / 12',5,-6.5,4.04,2.84);
    b('sam-power-pack',6,2.8,5,-6.5,2.22,6.8,steel);vent(-6.5,2.3,9.4,4);
    // Heavy bearing, trunnion supports and visible hydraulic elevation gear.
    c('sam-bearing-base',4.5,5.2,1.1,3.4,1.45,0,concrete);
    c('sam-bearing-track',3.7,4.2,0.55,3.4,2.25,0,dark);
    ring('sam-bearing-flange',3.9,0.16,3.4,2.54,0);
    const turret = add(new Group(),4);turret.name='missile-defense-pivot';turret.position.set(3.4*X,2.5,0);root.userData.turretPivot=turret;
    b('sam-cradle',6.5,0.5,6.5,0,0.4,0,steel,turret);
    for(const x of [-3.2,3.2]) {
      b('sam-elevation-cheek',0.55,2.5,3.6,x,1.8,0,edge,turret);
      const axle=c('sam-trunnion',0.62,0.62,0.8,x,2.5,0,dark,turret);axle.rotation.z=Math.PI/2;
      beam('sam-hydraulic-ram',[x,0.7,2.4],[x,3.1,-0.6],0.16,edge,turret);
    }
    const rack=new Group();rack.name='sam-six-cell-launch-rack';rack.position.y=2.55;rack.rotation.x=-0.52;turret.add(rack);
    b('sam-rack-backbone',6.6,0.28,7.4,0,-1.86,0,steel,rack);
    for(const x of [-3.3,3.3]) b('sam-rack-side-frame',0.24,3.7,7.4,x,0,0,steel,rack);
    for(const x of [-2.1,0,2.1]) for(const y of [-0.9,0.9]) {
      b('sealed-missile-canister',1.85,1.6,8.7,x,y,0,edge,rack);
      b('canister-inset-panel',1.57,1.3,8.74,x,y,0,steel,rack);
      // Dark frangible end plates read as real launch tubes, not yellow missile noses.
      b('canister-front-end',1.7,1.45,0.18,x,y,4.5,dark,rack);
      b('canister-end-cross',1.28,0.09,0.19,x,y,4.62,edge,rack);
      b('canister-end-cross',0.09,1.05,0.2,x,y,4.63,edge,rack);
      for(const z of [-3.2,2.9]) b('canister-restraint-band',1.94,1.7,0.22,x,y,z,ochre,rack);
    }
    // Radar mounted on the cabin, separate from launcher movement.
    c('sam-radar-mast',0.22,0.4,3.2,-6.5,6.1,-4,edge);
    const radar=add(new Group(),4);radar.name='sam-search-array';radar.position.set(-6.5*X,7.8,-4*Z);radar.rotation.x=-0.18;
    b('radar-array-housing',5,3.1,0.55,0,0,0,edge,radar);
    b('radar-array-face',4.65,2.75,0.15,0,0,0.34,dark,radar);
    for(let x=0;x<6;x++)for(let y=0;y<4;y++)b('radar-transmit-module',0.53,0.48,0.1,-1.9+x*0.76,-1+y*0.66,0.47,steel,radar);
    b('radar-status',0.4,0.12,0.15,1.8,-1.22,0.5,light,radar);
    root.userData.activityParts=[{object:radar,kind:'spin-y',speed:0.22,amplitude:1,phase:0,baseX:radar.position.x,baseRy:0,baseRz:0}];
    hazard(3.4,0.85,9.8,11);
    for(const x of [-10,10])for(const z of [-10,10])c('sam-stabilizer',0.6,1,0.75,x,1.05,z,steel);
  } else if (kind === 'factory') {
    // Asymmetric sawtooth assembly hall with a genuinely open loading bay.
    b('factory-floor',16,0.24,20,-2.6,0.96,0,steel);
    b('factory-west-wall',0.65,6.6,19.5,-10.6,4.2,-0.5,concrete);
    b('factory-east-wall',0.65,6.6,19.5,5.4,4.2,-0.5,concrete);
    b('factory-rear-wall',16,6.6,0.6,-2.6,4.2,-10,concrete);
    for(const x of [-9.7,4.5]) b('factory-bay-column',1.1,7,1.3,x,4.4,9,steel);
    b('factory-bay-header',15.6,1.2,1.4,-2.6,7.4,9,steel);
    // Partly raised shutter leaves the lit assembly interior visible.
    for(let i=0;i<4;i++)b('factory-raised-shutter',12.8,0.27,0.2,-2.6,6.1+i*0.29,9.22,edge);
    b('factory-bay-light',11,0.14,0.3,-2.6,5.8,8.6,light);
    for(const z of [-7,-1,5]) {
      const roofShape=new Shape();roofShape.moveTo(-3,0);roofShape.lineTo(3,0);roofShape.lineTo(3,0.3);roofShape.lineTo(-3,2.1);roofShape.closePath();
      const roofGeometry=new ExtrudeGeometry(roofShape,{depth:16,bevelEnabled:false});roofGeometry.rotateY(Math.PI/2);
      const roof=mesh('factory-sawtooth-roof',roofGeometry,steel,-10.6,7.4,z);roof.scale.set(X,1,Z);
      b('factory-clerestory-glazing',15.4,1.5,0.12,-2.6,8.5,z+3.02,glass);
      b('factory-clerestory-cap',16.3,0.16,0.28,-2.6,9.55,z+3.02,edge);
      for(const x of [-8,-4,0,4]) {
        b('factory-glazing-mullion',0.09,1.65,0.19,x,8.5,z+3.05,edge);
        beam('factory-roof-purlin',[x,7.8,z-2.9],[x,9.55,z+2.9],0.055,edge);
      }
    }
    // Service wing, outdoor plant and suspended hoist on an actual portal frame.
    b('factory-service-wing',5,4.3,14,8.3,3,-3,sand);
    b('factory-wing-roof',5.4,0.35,14.5,8.3,5.3,-3,steel);
    for(const z of [-7,-3,1]) {c('factory-extractor',0.7,0.8,1.4,8.3,6.1,z,steel);c('extractor-weather-cap',0.95,0.95,0.2,8.3,6.85,z,dark);}
    for(const x of [-9,3.8]) b('gantry-leg',0.45,7.6,0.5,x,4.65,5.2,ochre);
    b('gantry-travel-beam',13.3,0.55,0.7,-2.6,8.3,5.2,ochre);
    const hoist=add(new Group(),4);hoist.name='factory-traveling-hoist';hoist.position.set(-2.6*X,7.85,5.2*Z);
    b('hoist-trolley',1.6,0.65,1.2,0,0,0,steel,hoist);beam('hoist-cable',[0,-0.2,0],[0,-2.9,0],0.045,dark,hoist);
    const hook=mesh('hoist-hook',new TorusGeometry(0.34,0.095,6,18,Math.PI*1.6),ochre,0,-3,0,hoist);hook.rotation.z=-Math.PI/2;
    root.userData.activityParts=[{object:hoist,kind:'slide-x',speed:0.35,amplitude:2*X,phase:0,baseX:hoist.position.x,baseRy:0,baseRz:0}];
    b('assembly-overhead-lamp',7,0.12,0.3,-2.6,5.2,6.8,light);
    // A half-built chassis visible inside the hall; not a gameplay unit.
    b('assembly-chassis',5.1,0.6,7,-2.6,2.3,5,edge);
    for(const x of [-5.2,0]) {b('assembly-track',0.8,0.8,7.6,x,1.7,5,dark);for(const z of [2.4,4.1,5.8,7.5]){const wheel=c('assembly-road-wheel',0.4,0.4,0.2,x,1.7,z,edge);wheel.rotation.z=Math.PI/2;}}
    for(const x of [-6.5,1.3])b('floor-guide-line',0.13,0.045,15,x,1.12,2,ochre);
    b('factory-loading-ramp',12.8,0.16,2.4,-2.6,0.97,10.7,concrete);
    hazard(-2.6,1.07,10.6,12.5);
    sign('ASSEMBLY / 05',6.8,-2.6,7.4,9.74);
    for(const x of [-9.5,4.3])b('factory-faction-panel',0.6,4.5,0.15,x,3.8,9.73,accent);
    for(const z of [-6,0,6])b('factory-west-buttress',0.9,5.4,0.8,-10.8,3.6,z,steel);
  } else if (kind === 'barracks') {
    // Two separate barrel-roof quarters flank an open muster court.
    b('barracks-muster-court',5.4,0.18,16,0,0.98,2.6,concrete);
    for(const x of [-6.7,6.7]) {
      const shellShape=new Shape();shellShape.absarc(0,1.65,3.65,0,Math.PI,false);shellShape.lineTo(-3.65,0);shellShape.lineTo(-3.32,0);shellShape.lineTo(-3.32,1.65);shellShape.absarc(0,1.65,3.32,Math.PI,0,true);shellShape.lineTo(3.32,0);shellShape.lineTo(3.65,0);shellShape.closePath();
      const shell=mesh('barracks-vaulted-shell',new ExtrudeGeometry(shellShape,{depth:15.4,bevelEnabled:false,curveSegments:32}),steel,x,1,-7.2);shell.scale.set(X,1,Z);
      // Ribbed vaults follow the architecture rather than a flat gabled cap.
      for(const z of [-6,-3,0,3,6]) {
        const rib=mesh('barracks-vault-rib',new TorusGeometry(3.69,0.075,6,24,Math.PI),edge,x,2.65,z);rib.scale.x=X;
      }
      const endShape=new Shape();endShape.moveTo(-3.3,0);endShape.lineTo(3.3,0);endShape.lineTo(3.3,1.65);endShape.absarc(0,1.65,3.3,0,Math.PI,false);endShape.closePath();
      const face=mesh('barracks-arched-end-wall',new ExtrudeGeometry(endShape,{depth:0.18,bevelEnabled:false,curveSegments:32}),sand,x,1,8.2);face.scale.x=X;
      b('barracks-entry',1.6,2.4,0.22,x,2.25,8.45,dark);
      b('barracks-entry-canopy',2.4,0.16,1.4,x,3.65,8.7,steel);
      b('barracks-door-light',1.1,0.08,0.12,x,3.41,8.61,light);
      for(const dx of [-2.3,2.3])b('barracks-front-window',1.15,0.65,0.15,x+dx,3.2,8.47,glass);
      for(const z of [-4,0,4]) {
        const side=x<0?1:-1;b('barracks-court-window',0.16,0.65,1.4,x+side*3.68,2.3,z,glass);
        b('barracks-window-brow',0.3,0.12,1.65,x+side*3.7,2.72,z,edge);
      }
      b('barracks-faction-stripe',2.2,0.24,0.12,x,4.35,8.47,accent);
    }
    // Rear command / medical block links the two quarters into a U-shaped compound.
    b('barracks-command-link',21,4.7,4.3,0,3.2,-9.1,sand);
    b('barracks-command-roof',21.6,0.38,4.9,0,5.72,-9.1,steel);
    b('barracks-command-door',2.4,2.6,0.2,0,2.4,-6.8,dark);
    b('barracks-command-glazing',7,0.9,0.2,0,4.6,-6.8,glass);
    sign('GARRISON / 04',5.6,0,5.72,-6.6);
    for(const x of [-7,7]) { b('barracks-roof-aircon',3.3,0.9,2.2,x,6.35,-9.1,edge);vent(x,6.4,-7.92,2.7); }
    c('barracks-radio-mast',0.06,0.1,4.1,9,7.75,-9,edge);
    beam('radio-crossbar',[7.9,9,-9],[10.1,9,-9],0.04,edge);
    for(const z of [-4,0,4,8]) b('muster-court-centerline',0.15,0.025,1.8,0,1.09,z,ochre);
    for(const x of [-10.4,10.4]) {
      b('barracks-supply-locker',1.3,1.4,3,x,1.55,9.1,steel);
      c('barracks-gate-bollard',0.2,0.28,1.3,x,1.35,10.8,ochre);
    }
    hazard(0,1.07,10.4,5);
  }
  for(const part of parts){ const o=part.object;part.y=o.position.y;part.sx=o.scale.x;part.sy=o.scale.y;part.sz=o.scale.z;part.rx=o.rotation.x;part.ry=o.rotation.y;part.rz=o.rotation.z; }
  root.userData.detailParts=parts;root.userData.hullSize={fullW:width,fullD:depth,height};
  return root;
}
