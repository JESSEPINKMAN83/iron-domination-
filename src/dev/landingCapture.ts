/** Local-only capture desk. Records rendered gameplay pixels, never the HUD. */
export function createLandingCapture(source:HTMLCanvasElement,name:string,seconds=12){
  // Capture WebGL directly: avoids a GPU-to-CPU readback on every frame.
  const canvas=source;
  const panel=document.createElement('aside');panel.dataset.captureDesk='true';
  panel.style.cssText='position:fixed;right:18px;bottom:18px;z-index:500;background:#0b181eee;border:1px solid #9de5c4;border-radius:6px;padding:14px;color:#fff;font:13px system-ui;display:flex;align-items:center;gap:12px';
  const button=document.createElement('button');button.textContent=`Record ${seconds}s gameplay`;
  button.style.cssText='padding:9px 14px;cursor:pointer;background:#9de5c4;border:0;border-radius:4px;color:#10251c;font-weight:700';
  const status=document.createElement('span');status.textContent='1280 × 720 · silent · current models';
  const download=document.createElement('a');download.hidden=true;download.textContent='Download gameplay clip';download.style.color='#9de5c4';
  panel.append(button,status,download);document.body.append(panel);
  let recorder:MediaRecorder|undefined,started=0,clock=0;
  button.onclick=()=>{
    if(recorder?.state==='recording')return;
    if(typeof MediaRecorder==='undefined'||typeof canvas.captureStream!=='function'){status.textContent='Video recording unavailable in this browser';return;}
    const mime=['video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
    if(!mime){status.textContent='Video recording unavailable in this browser';return;}
    const stream=canvas.captureStream(30);const chunks:Blob[]=[];
    recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6_000_000});
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    recorder.onstop=()=>{
      stream.getTracks().forEach(track=>track.stop());
      if(download.href.startsWith('blob:'))URL.revokeObjectURL(download.href);
      download.href=URL.createObjectURL(new Blob(chunks,{type:mime}));download.download=`${name}.webm`;download.hidden=false;
      status.textContent='Capture complete';
      button.disabled=false;button.textContent='Record again';
    };
    recorder.start(1000);started=performance.now();clock=0;button.disabled=true;download.hidden=true;
    status.textContent='Recording…';
    window.setTimeout(()=>{if(recorder?.state==='recording')recorder.stop();},seconds*1000);
  };
  return {
    get recording(){return recorder?.state==='recording';},
    get elapsed(){return clock;},
    frame(){
      if(recorder?.state==='recording'){
        clock=(performance.now()-started)/1000;
        status.textContent=`Recording ${Math.min(seconds,clock).toFixed(1)} / ${seconds}s`;
      }
    },
  };
}
