import type { MatchSnapshot, BattleTimelinePoint } from '../match/battleDebrief';

const COLORS = ['#6da9ff', '#ff9875', '#c29bff', '#f4d674', '#69d9b1', '#f093d0', '#9bd65a', '#68d6e5'];
const METRICS = [
  { key: 'unitsSurviving', label: 'Army strength', detail: 'Living units, including collectors. Buildings excluded.' },
  { key: 'credits', label: 'Credits available', detail: 'Credits held at each moment, after purchases and income.' },
  { key: 'income', label: 'Money earned', detail: 'Cumulative income recorded during the match.' },
  { key: 'unitKills', label: 'Units destroyed', detail: 'Cumulative enemy unit kills. Buildings excluded.' },
  { key: 'unitLosses', label: 'Units lost', detail: 'Cumulative unit losses for each army. Buildings excluded.' },
  { key: 'damageDealt', label: 'Damage dealt', detail: 'Cumulative damage to units and structures.' },
] as const;
const fmt = (n: number) => new Intl.NumberFormat('en-US', { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
const clock = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
export function createBattleTimeline(snapshot: MatchSnapshot): HTMLElement {
  const root = document.createElement('section'); root.className = 'battle-timeline';
  const title = document.createElement('div'); title.className = 'battle-timeline__heading';
  title.innerHTML = '<div><small>THE BATTLE, MOMENT BY MOMENT</small><h2>How the match unfolded</h2></div><span>ALL ARMIES · MATCH TIME</span>';
  if (snapshot.timelineDemo) title.querySelector('small')!.textContent = 'DESIGN PREVIEW · ILLUSTRATIVE DATA';
  const controls = document.createElement('div'); controls.className = 'battle-timeline__controls';
  const detail = document.createElement('p'); detail.className = 'battle-timeline__detail';
  const plot = document.createElement('div'); plot.className = 'battle-timeline__plot';
  const legend = document.createElement('div'); legend.className = 'battle-timeline__legend';
  const readout = document.createElement('div'); readout.className = 'battle-timeline__readout'; readout.setAttribute('aria-live', 'polite');
  root.append(title, controls, detail, legend, plot, readout);
  const points = snapshot.timeline ?? [];
  if (points.length < 2) { detail.textContent = 'Timeline unavailable for this match. New matches record history automatically; final totals are below.'; return root; }
  const scrubber = document.createElement('input');
  scrubber.type = 'range'; scrubber.min = '0'; scrubber.max = String(points.length - 1); scrubber.value = scrubber.max;
  scrubber.setAttribute('aria-label', 'Inspect match time'); scrubber.className = 'battle-timeline__scrubber';
  root.insertBefore(scrubber, readout);
  let metric: typeof METRICS[number] = METRICS[0];
  const hidden = new Set<number>();
  const buttons: HTMLButtonElement[] = [];
  const legends: HTMLButtonElement[] = [];
  const ns = 'http://www.w3.org/2000/svg';
  const end = Math.max(1, points[points.length - 1].seconds);
  const showPoint = (point: BattleTimelinePoint) => {
    readout.replaceChildren();
    const time = document.createElement('strong'); time.textContent = clock(point.seconds); readout.append(time);
    snapshot.armies.forEach((army, i) => {
      if (hidden.has(army.team)) return;
      const value = point.armies.find((a) => a.team === army.team)?.[metric.key];
      const span = document.createElement('span'); span.style.color = COLORS[i % COLORS.length];
      span.textContent = `${army.label} · ${value === undefined ? '—' : fmt(value)}`; readout.append(span);
    });
  };
  const render = () => {
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(METRICS[i] === metric)));
    legends.forEach((b, i) => b.setAttribute('aria-pressed', String(!hidden.has(snapshot.armies[i].team))));
    detail.textContent = metric.detail + ' Hover or drag across the chart to inspect a moment. Click an army to hide its line.';
    const values = points.flatMap((p) => p.armies.filter((a) => !hidden.has(a.team)).map((a) => a[metric.key]));
    const rawMax = Math.max(1, ...values); const magnitude = 10 ** Math.floor(Math.log10(rawMax));
    const max = Math.ceil(rawMax / magnitude / 0.5) * magnitude * 0.5;
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 1000 340'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${metric.label} over time for every army`);
    const add = (tag: string, attrs: Record<string, string>, text?: string) => {
      const el = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k,v)); if(text) el.textContent=text; svg.append(el); return el;
    };
    for(let i=0;i<=4;i++) {
      const y=20+i*67;
      add('line',{x1:'68',x2:'978',y1:String(y),y2:String(y),stroke:'#263735','stroke-dasharray':'3 5'});
      add('text',{x:'54',y:String(y+4),'text-anchor':'end',fill:'#98aca7','font-size':'12'},fmt(max*(1-i/4)));
    }
    for(let i=0;i<=5;i++) add('text',{x:String(68+i*182),y:'320','text-anchor':'middle',fill:'#98aca7','font-size':'12'},clock(end*i/5));
    snapshot.armies.forEach((army,i)=>{
      if(hidden.has(army.team)) return;
      let path=''; points.forEach((point)=>{
        const a=point.armies.find((a)=>a.team===army.team); if(!a) return;
        path+=`${path?' L':'M'}${(68+point.seconds/end*910).toFixed(2)},${(288-a[metric.key]/max*268).toFixed(2)}`;
      });
      const line=add('path',{d:path,fill:'none',stroke:COLORS[i%COLORS.length],'stroke-width':army.isLocal?'3.5':'2.5','stroke-linejoin':'round','stroke-linecap':'round'});
      const name=document.createElementNS(ns,'title');name.textContent=army.label;line.append(name);
    });
    const cursor=add('line',{x1:'978',x2:'978',y1:'20',y2:'288',stroke:'#e7eee8','stroke-opacity':'.5','stroke-dasharray':'4 4'});
    plot.replaceChildren(svg);
    scrubber.oninput = () => {
      const point = points[Number(scrubber.value)]; const x = String(68 + point.seconds / end * 910);
      cursor.setAttribute('x1', x); cursor.setAttribute('x2', x); showPoint(point);
    };
    const inspect=(event: PointerEvent)=>{
      const rect=svg.getBoundingClientRect(); const seconds=Math.max(0,Math.min(1,((event.clientX-rect.left)/rect.width*1000-68)/910))*end;
      const point=points.reduce((best,p)=>Math.abs(p.seconds-seconds)<Math.abs(best.seconds-seconds)?p:best,points[0]);
      const x=String(68+point.seconds/end*910); cursor.setAttribute('x1',x);cursor.setAttribute('x2',x);scrubber.value=String(points.indexOf(point));showPoint(point);
    };
    svg.onpointermove=inspect;svg.onpointerdown=inspect;scrubber.value=scrubber.max;showPoint(points[points.length-1]);
  };
  METRICS.forEach((m)=>{const b=document.createElement('button');b.type='button';b.textContent=m.label;b.onclick=()=>{metric=m;render();};controls.append(b);buttons.push(b);});
  snapshot.armies.forEach((army,i)=>{const b=document.createElement('button');b.type='button';b.style.setProperty('--line-color',COLORS[i%COLORS.length]);b.textContent=`● ${army.label} · Army ${army.team}`;b.onclick=()=>{if(hidden.has(army.team)) hidden.delete(army.team);else if(hidden.size<snapshot.armies.length-1) hidden.add(army.team);render();};legend.append(b);legends.push(b);});
  render();return root;
}
