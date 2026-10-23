/** Drag only the handle: card controls and battlefield input remain independent. */
export function draggableCard(card:HTMLElement, handle:HTMLElement):()=>void {
  handle.classList.add('campaign-drag-handle');
  handle.tabIndex=0;
  handle.title='Drag to move · Arrow keys to reposition';
  handle.setAttribute('aria-label','Move card. Drag or use arrow keys.');
  let drag:{id:number;x:number;y:number;left:number;top:number}|undefined;
  let moved=false;
  const position=(left:number,top:number)=>{
    const rect=card.getBoundingClientRect();
    card.style.left=`${Math.max(8,Math.min(left,window.innerWidth-rect.width-8))}px`;
    card.style.top=`${Math.max(8,Math.min(top,window.innerHeight-Math.min(rect.height,window.innerHeight-16)-8))}px`;
    card.style.right='auto';card.style.bottom='auto';moved=true;
  };
  handle.addEventListener('pointerdown',event=>{
    if(event.button!==0||(event.target as Element).closest('button,a,input'))return;
    event.preventDefault();event.stopPropagation();
    const rect=card.getBoundingClientRect();
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
    handle.setPointerCapture(event.pointerId);handle.classList.add('is-dragging');
  });
  handle.addEventListener('pointermove',event=>{
    if(!drag||drag.id!==event.pointerId)return;
    event.stopPropagation();position(drag.left+event.clientX-drag.x,drag.top+event.clientY-drag.y);
  });
  const end=()=>{drag=undefined;handle.classList.remove('is-dragging');};
  handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);handle.addEventListener('lostpointercapture',end);
  handle.addEventListener('keydown',event=>{
    if(event.target!==handle||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();const rect=card.getBoundingClientRect();const step=event.shiftKey?40:12;
    position(rect.left+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0),rect.top+(event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0));
  });
  const resize=()=>{if(moved){const rect=card.getBoundingClientRect();position(rect.left,rect.top);}};
  window.addEventListener('resize',resize);
  return ()=>window.removeEventListener('resize',resize);
}
