/** Visible, local-only timing report; no telemetry or hidden diagnostic access. */
export function showModelPerformance():void {
  const panel=document.createElement('aside');panel.style.cssText='position:fixed;bottom:8px;left:8px;z-index:99999;padding:12px;background:#07141eee;color:#fff;font:13px monospace;pointer-events:none';
  const baseline=new URLSearchParams(location.search).get('model-baseline')==='1';
  const label=baseline?'BASELINE MODELS':'CODE RED MODELS';panel.textContent=label+' · warming up 20 s';document.body.append(panel);
  const start=performance.now();let previous=start;const samples:number[]=[];
  function tick(now:number){const elapsed=now-start,dt=now-previous;previous=now;
    if(document.visibilityState==='visible'&&elapsed>20000&&elapsed<40000&&dt<1000)samples.push(dt);
    if(elapsed<40000){if(elapsed>20000)panel.textContent=label+' · sampling '+Math.floor((elapsed-20000)/1000)+'/20 s';requestAnimationFrame(tick);return;}
    samples.sort((a,b)=>a-b);const avg=samples.reduce((a,b)=>a+b,0)/Math.max(1,samples.length);panel.textContent=`${label} · avg ${avg.toFixed(2)} ms · p95 ${(samples[Math.floor(samples.length*.95)]??0).toFixed(2)} ms · ${samples.length} frames`;
  }requestAnimationFrame(tick);
}
