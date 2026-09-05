import { BufferGeometry, Float32BufferAttribute, SphereGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const cache = new Map<string, BufferGeometry>();
export function sharedUnitGeometry(key: string, build: () => BufferGeometry): BufferGeometry {
  let geometry = cache.get(key);
  if (!geometry) { geometry = build(); geometry.userData.ironDominionSharedUnitGeometry = true; cache.set(key, geometry); }
  return geometry;
}

export function roundedUnitBox(w: number, h: number, d: number, radius = Math.min(w, h, d) * 0.14): BufferGeometry {
  return sharedUnitGeometry(`round:${w}:${h}:${d}:${radius}`, () => new RoundedBoxGeometry(w, h, d, 1, radius));
}

/** Clipped corners and inward-sloping cheeks, rather than rotated rectangular slabs. */
export function armoredUnitHull(w: number, h: number, d: number, inset = 0.2): BufferGeometry {
  return sharedUnitGeometry(`armor:${w}:${h}:${d}:${inset}`, () => {
    const corner = Math.min(w, d) * 0.2;
    const plan = [[-w/2+corner,-d/2],[w/2-corner,-d/2],[w/2,-d/2+corner],[w/2,d/2-corner],[w/2-corner,d/2],[-w/2+corner,d/2],[-w/2,d/2-corner],[-w/2,-d/2+corner]];
    const vertices: number[][] = [];
    for (const top of [false,true]) for (const [x,z] of plan) vertices.push([x*(top?1-inset:1),top?h/2:-h/2,z*(top?1-inset*0.7:1)]);
    const positions:number[]=[],uv:number[]=[];
    const triangle=(a:number,b:number,c:number)=>{ for(const i of [a,b,c]){positions.push(...vertices[i]);uv.push(vertices[i][0]/w+0.5,vertices[i][2]/d+0.5);} };
    for(let i=1;i<7;i++){triangle(0,i,i+1);triangle(8,8+i+1,8+i);}
    for(let i=0;i<8;i++){const n=(i+1)%8;triangle(i,n+8,n);triangle(i,i+8,n+8);}
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));geometry.computeVertexNormals();return geometry;
  });
}

/** Lofted elliptical fuselage sections, listed tail-to-nose as z, half-width,
 * half-height, and vertical center. Shared by all copies of an aircraft. */
export function unitFuselage(key: string, sections: readonly (readonly [number,number,number,number])[]): BufferGeometry {
  return sharedUnitGeometry(`fuselage:${key}`,()=>{
    const positions:number[]=[],uv:number[]=[],indices:number[]=[];const sides=10;
    for(let j=0;j<sections.length;j++){const [z,w,h,y]=sections[j];for(let i=0;i<=sides;i++){const a=i/sides*Math.PI*2;positions.push(Math.cos(a)*w,y+Math.sin(a)*h,z);uv.push(i/sides,j/(sections.length-1));}}
    for(let j=0;j<sections.length-1;j++)for(let i=0;i<sides;i++){const a=j*(sides+1)+i,b=a+sides+1;indices.push(a,a+1,b,b,a+1,b+1);}
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
  });
}

export function unitEllipsoid(w: number, h: number, d: number): BufferGeometry {
  return sharedUnitGeometry(`ellipsoid:${w}:${h}:${d}`,()=>new SphereGeometry(1,12,8).scale(w,h,d));
}
