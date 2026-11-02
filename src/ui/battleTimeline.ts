import type { MatchSnapshot, BattleTimelinePoint } from '../match/battleDebrief';

const COLORS = ['#6da9ff', '#ff9875', '#c29bff', '#f4d674', '#69d9b1', '#f093d0', '#9bd65a', '#68d6e5'];
const METRICS = [
  { key: 'unitsSurviving', label: 'Estimated win chance', detail: 'Heuristic estimate from living forces, available credits and recent income. Setup-aware: allied armies combine their forces and economy and share one side’s chance. A balanced 1-vs-4 starts near 20% vs 80%; a three-way free-for-all near 33% each. Not a calibrated prediction. The confirmed winning side ends at 100%.' },
  { key: 'credits', label: 'Credits available', detail: 'Credits held at each moment, after purchases and income.' },
  { key: 'income', label: 'Money earned', detail: 'Cumulative income recorded during the match.' },
  { key: 'unitKills', label: 'Units destroyed', detail: 'Cumulative enemy unit kills. Buildings excluded.' },
  { key: 'unitLosses', label: 'Units lost', detail: 'Cumulative unit losses for each army. Buildings excluded.' },
  { key: 'damageDealt', label: 'Damage dealt', detail: 'Cumulative damage to units and structures.' },
] as const;
const fmt = (n: number) => new Intl.NumberFormat('en-US', { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
const clock = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
export function estimatedWinShares(snapshot: MatchSnapshot, point: BattleTimelinePoint): Map<number, number> {
  const previous = [...(snapshot.timeline ?? [])].reverse().find(p => p.seconds < point.seconds);
  const scores = new Map<number, number>();
  for (const army of snapshot.armies) {
    const current = point.armies.find(a => a.team === army.team);
    const old = previous?.armies.find(a => a.team === army.team);
    const incomeRate = current && old ? Math.max(0, current.income - old.income) / Math.max(1, point.seconds - previous!.seconds) : 0;
    const score = current ? current.unitsSurviving * 550 + Math.max(0, current.credits) * 0.25 + incomeRate * 60 + 100 : 0;
    scores.set(army.side, (scores.get(army.side) ?? 0) + score);
  }
  const finalPoint = snapshot.timeline?.at(-1);
  const survivingSides = new Set(snapshot.armies.filter(a => !a.eliminated).map(a => a.side));
  if (point === finalPoint && survivingSides.size === 1) {
    return new Map(snapshot.armies.map(a => [a.team, survivingSides.has(a.side) ? 100 : 0]));
  }
  const total = [...scores.values()].reduce((a, b) => a + b, 0);
  return new Map(snapshot.armies.map(a => [a.team, total > 0 ? (scores.get(a.side) ?? 0) / total * 100 : 100 / Math.max(1, scores.size)]));
}

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
  const valueAt = (point: BattleTimelinePoint, team: number) => metric.key === 'unitsSurviving' ? estimatedWinShares(snapshot, point).get(team) : point.armies.find(a => a.team === team)?.[metric.key];
  const showPoint = (point: BattleTimelinePoint) => {
    readout.replaceChildren();
    const time = document.createElement('strong'); time.textContent = clock(point.seconds); readout.append(time);
    snapshot.armies.forEach((army, i) => {
      if (hidden.has(army.team)) return;
      const value = valueAt(point, army.team);
      const span = document.createElement('span'); span.style.color = COLORS[i % COLORS.length];
      const allies = snapshot.armies.filter(a => a.side === army.side).length;
      const sideLabel = metric.key === 'unitsSurviving' && allies > 1 ? ` (side ${army.side}, ${allies} allies)` : '';
      span.textContent = `${army.label}${sideLabel} · ${value === undefined ? '—' : fmt(value) + (metric.key === 'unitsSurviving' ? '%' : '')}`; readout.append(span);
    });
  };
  const render = () => {
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(METRICS[i] === metric)));
    legends.forEach((b, i) => b.setAttribute('aria-pressed', String(!hidden.has(snapshot.armies[i].team))));
    detail.textContent = metric.detail + ' Hover or drag across the chart to inspect a moment. Click an army to hide its line.';
    const values = points.flatMap((p) => p.armies.filter((a) => !hidden.has(a.team)).map((a) => a[metric.key]));
    const rawMax = Math.max(1, ...values); const magnitude = 10 ** Math.floor(Math.log10(rawMax));
    const max = metric.key === 'unitsSurviving' ? 100 : Math.ceil(rawMax / magnitude / 0.5) * magnitude * 0.5;
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 1000 340'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${metric.label} over time for every army`);
    const add = (tag: string, attrs: Record<string, string>, text?: string) => {
      const el = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k,v)); if(text) el.textContent=text; svg.append(el); return el;
    };
    for(let i=0;i<=4;i++) {
      const y=20+i*67;
      add('line',{x1:'68',x2:'978',y1:String(y),y2:String(y),stroke:'#263735','stroke-dasharray':'3 5'});
      add('text',{x:'54',y:String(y+4),'text-anchor':'end',fill:'#98aca7','font-size':'12'},fmt(max*(1-i/4)) + (metric.key === 'unitsSurviving' ? '%' : ''));
    }
    for(let i=0;i<=5;i++) add('text',{x:String(68+i*182),y:'320','text-anchor':'middle',fill:'#98aca7','font-size':'12'},clock(end*i/5));
    snapshot.armies.forEach((army,i)=>{
      if(hidden.has(army.team)) return;
      let path=''; points.forEach((point)=>{
        const a=point.armies.find((a)=>a.team===army.team); if(!a) return;
        path+=`${path?' L':'M'}${(68+point.seconds/end*910).toFixed(2)},${(288-(valueAt(point, army.team) ?? 0)/max*268).toFixed(2)}`;
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
