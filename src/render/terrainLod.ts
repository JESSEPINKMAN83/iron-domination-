/** Keep every boundary vertex so adjacent chunks with different detail never crack. */
export function terrainLodIndices(cells:number,step:2|4):Uint32Array {
  const indices:number[]=[];
  const vertex=(x:number,z:number)=>z*(cells+1)+x;
  for(let z=0;z<cells;z+=step) for(let x=0;x<cells;x+=step){
    const right=Math.min(cells,x+step),bottom=Math.min(cells,z+step);
    if(x>0&&z>0&&right<cells&&bottom<cells){
      indices.push(vertex(x,z),vertex(x,bottom),vertex(right,z),vertex(right,z),vertex(x,bottom),vertex(right,bottom));continue;
    }
    const edge:number[]=[];
    for(let zz=z;zz<bottom;zz+=x===0?1:step) edge.push(vertex(x,zz));
    for(let xx=x;xx<right;xx+=bottom===cells?1:step) edge.push(vertex(xx,bottom));
    for(let zz=bottom;zz>z;zz-=right===cells?1:step) edge.push(vertex(right,zz));
    for(let xx=right;xx>x;xx-=z===0?1:step) edge.push(vertex(xx,z));
    const center=vertex(Math.floor((x+right)/2),Math.floor((z+bottom)/2));
    for(let i=0;i<edge.length;i++) indices.push(center,edge[i],edge[(i+1)%edge.length]);
  }
  return new Uint32Array(indices);
}

export function terrainDetailStep(distance:number,current:1|2|4=1):1|2|4 {
  if(current===4) return distance<440 ? distance<220?1:2 : 4;
  if(current===2) return distance>600?4:distance<220?1:2;
  return distance>600?4:distance>300?2:1;
}
