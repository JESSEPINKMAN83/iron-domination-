import { CanvasTexture, DoubleSide, MeshBasicMaterial, SRGBColorSpace } from 'three';
import type { NationId } from '../content/nations';
const cache = new Map<NationId, MeshBasicMaterial>();
/** One small texture per nation, shared across HQs. Proxy flags use simplified insignia at RTS scale. */
export function nationFlagMaterial(id: NationId): MeshBasicMaterial {
  const cached = cache.get(id); if(cached) return cached;
  const canvas=document.createElement('canvas'); canvas.width=192; canvas.height=128;
  const c=canvas.getContext('2d')!;
  const fill=(color:string,x=0,y=0,w=192,h=128)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
  fill('#f4f2e5');
  if(id==='israel') {
    fill('#1756ad',0,18,192,15); fill('#1756ad',0,95,192,15); c.strokeStyle='#1756ad';c.lineWidth=5;
    for(const sign of [-1,1]) {c.beginPath();for(let i=0;i<3;i++){const a=sign*Math.PI/2+i*Math.PI*2/3;c.lineTo(96+28*Math.cos(a),64+28*Math.sin(a));}c.closePath();c.stroke();}
  } else if(id==='usa') {
    for(let i=0;i<13;i+=2)fill('#ae2535',0,i*128/13,192,128/13);
    fill('#18356c',0,0,85,69);c.fillStyle='white';for(let y=0;y<5;y++)for(let x=0;x<6;x++){c.beginPath();c.arc(9+x*13,8+y*13,2,0,Math.PI*2);c.fill();}
  } else if(id==='uk') {
    fill('#16366c'); c.strokeStyle='white';c.lineWidth=22;for(const rev of [false,true]){c.beginPath();c.moveTo(0,rev?128:0);c.lineTo(192,rev?0:128);c.stroke();}
    c.strokeStyle='#b52235';c.lineWidth=8;for(const rev of [false,true]){c.beginPath();c.moveTo(0,rev?128:0);c.lineTo(192,rev?0:128);c.stroke();}
    fill('white',77,0,38,128);fill('white',0,45,192,38);fill('#b52235',84,0,24,128);fill('#b52235',0,52,192,24);
  } else if(id==='france'){fill('#163c86',0,0,64,128);fill('#c62c3a',128,0,64,128);}
  else if(id==='iran'){fill('#287947',0,0,192,42);fill('#c62c38',0,86,192,42);c.fillStyle='#b72532';c.font='bold 35px serif';c.textAlign='center';c.fillText('☫',96,78);}
  else if(id==='hezbollah'){fill('#e7c934');c.fillStyle='#2d653b';c.font='bold 27px sans-serif';c.textAlign='center';c.fillText('حزب الله',96,74);}
  else if(id==='houthis'){c.fillStyle='#b83232';c.textAlign='center';c.font='bold 24px sans-serif';c.fillText('أنصار الله',96,70);fill('#26794a',20,92,152,7);}
  else {fill('#bd3034',0,0,192,42);fill('#222b29',0,86,192,42);c.fillStyle='#327345';c.textAlign='center';c.font='bold 23px sans-serif';c.fillText('العراق',96,73);}
  const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;
  const material=new MeshBasicMaterial({map:texture,side:DoubleSide});material.userData.codeRedSharedMaterial=true;cache.set(id,material);return material;
}
