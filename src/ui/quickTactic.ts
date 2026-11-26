import { Raycaster, Vector2, Vector3, type PerspectiveCamera } from 'three';
import { sampleHeight, type Heightfield } from '../sim/heightfield';
import { MAX_TACTIC_WAYPOINTS } from '../sim/tactics';
import type { TacticExecutePayload } from './tacticPlanner';

type Point = { x: number; z: number };
/** Keep the strongest bends and both endpoints within the command budget. */
export function quickRoutePoints(points: Point[]): Point[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));
  const cornerBetween = (start: number, end: number) => {
    const from = points[start];
    const dx = points[end].x - from.x;
    const dz = points[end].z - from.z;
    const lengthSquared = dx * dx + dz * dz;
    let index = start;
    let error = 0;
    for (let i = start + 1; i < end; i++) {
      const x = points[i].x - from.x;
      const z = points[i].z - from.z;
      const fraction = lengthSquared ? Math.max(0, Math.min(1, (x * dx + z * dz) / lengthSquared)) : 0;
      const distance = (x - fraction * dx) ** 2 + (z - fraction * dz) ** 2;
      if (distance > error) {
        index = i;
        error = distance;
      }
    }
    return { start, end, index, error };
  };

  const last = points.length - 1;
  const kept = [0, last];
  const segments = [cornerBetween(0, last)];
  while (kept.length < MAX_TACTIC_WAYPOINTS) {
    segments.sort((a, b) => a.error - b.error);
    const segment = segments.pop();
    if (!segment || segment.error <= 4) break; // Within two metres of the drawn line.
    const { start, end, index } = segment;
    kept.push(index);
    segments.push(cornerBetween(start, index), cornerBetween(index, end));
  }
  return kept.sort((a, b) => a - b).map((index) => ({ ...points[index] }));
}

export class QuickTactic {
  private root?: HTMLDivElement;
  private cancel?: () => void;
  constructor(private camera: PerspectiveCamera, private hf: Heightfield,
    private onActive: (active: boolean) => void,
    private execute: (payload: TacticExecutePayload) => void,
  ) {}

  open(entityIds: number[], drag?: { start: { x: number; y: number }; event: PointerEvent }): void {
    if (!entityIds.length) return;
    this.cancel?.();
    const started = performance.now();
    const root = document.createElement('div');
    this.root = root;
    root.style.cssText = 'position:fixed;inset:0;z-index:90;';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block;cursor:crosshair;touch-action:none;';
    root.append(canvas);
    const bar = document.createElement('div');
    bar.style.cssText = 'position:absolute;left:50%;top:16px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:10px;background:#101e24f5;border:1px solid #78b99e;border-radius:6px;color:#d9f4e7;font:12px system-ui;max-width:95vw;';
    const label = document.createElement('span');
    label.textContent = `${entityIds.length} ${entityIds.length === 1 ? 'unit' : 'units'} · Draw route · Release to send · Esc cancels`;
    bar.append(label);
    const button = (text: string, action: () => void) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
      b.style.cssText = 'padding:7px 10px;border:1px solid #78b99e;border-radius:4px;background:#203e33;color:#d9f4e7;cursor:pointer;';
      b.onclick = action; bar.append(b); return b;
    };
    let points: Point[] = [], pointer: number | undefined, lastX = 0, lastY = 0;
    let frame = 0, dirty = true;
    const close = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('pointermove', moveStroke, true);
      window.removeEventListener('pointerup', finishStroke, true);
      window.removeEventListener('pointercancel', cancelStroke, true);
      root.remove(); if (this.root === root) this.root = undefined;
      this.cancel = undefined;
      this.onActive(false);
    };
    this.cancel = close;
    const executeRoute = () => {
      if (!points.length) return;
      const waypoints = quickRoutePoints(points);
      close();
      this.execute({ entityIds, waypoints, endAction: { kind: 'attack-through' }, selectionCount: entityIds.length,
        plannerDurationMs: performance.now() - started, highSpeed: true, variation: 0 });
    };
    button('Cancel', close);
    const key = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.code === 'Escape') close();
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', close);
    for (const name of ['pointerdown', 'pointerup', 'click', 'wheel', 'contextmenu']) root.addEventListener(name, e => { e.stopPropagation(); if (name === 'contextmenu' || name === 'wheel') e.preventDefault(); }, { passive: false });
    const ray = new Raycaster(), ndc = new Vector2(), projected = new Vector3();
    const pointAt = (x: number, y: number): Point | undefined => {
      ndc.set(x / innerWidth * 2 - 1, 1 - y / innerHeight * 2); ray.setFromCamera(ndc, this.camera);
      const { origin, direction } = ray.ray;
      const step = Math.max(10, this.hf.size / 100);
      let previous = 0;
      for (let t = step; t <= this.camera.far; t += step) {
        projected.copy(origin).addScaledVector(direction, t);
        if (Math.abs(projected.x) > this.hf.size / 2 || Math.abs(projected.z) > this.hf.size / 2) { previous = t; continue; }
        if (projected.y <= sampleHeight(this.hf, projected.x, projected.z)) {
          let lo = previous, hi = t;
          for (let i = 0; i < 12; i++) {
            const mid = (lo + hi) / 2; projected.copy(origin).addScaledVector(direction, mid);
            if (projected.y > sampleHeight(this.hf, projected.x, projected.z)) lo = mid; else hi = mid;
          }
          projected.copy(origin).addScaledVector(direction, hi);
          return { x: projected.x, z: projected.z };
        }
        previous = t;
      }
    };
    const add = (e: { clientX: number; clientY: number }, force = false) => {
      if (!force && Math.hypot(e.clientX - lastX, e.clientY - lastY) < 4) return;
      const point = pointAt(e.clientX, e.clientY);
      if (!point) return;
      const previous = points.at(-1);
      if (previous && Math.hypot(point.x - previous.x, point.z - previous.z) < 0.01) return;
      points.push(point);
      dirty = true;
      if (points.length > 2048) points = quickRoutePoints(points);
      lastX = e.clientX; lastY = e.clientY;
    };
    canvas.onpointerdown = e => { if (drag || e.button !== 0) return; points = []; pointer = e.pointerId; canvas.setPointerCapture(pointer); add(e, true); };
    const moveStroke = (event: PointerEvent) => {
      if (pointer !== event.pointerId) return;
      const samples = event.getCoalescedEvents?.();
      if (samples?.length) for (const sample of samples) add(sample);
      else add(event);
    };
    const finishStroke = (e: PointerEvent) => {
      if (pointer !== e.pointerId || e.button !== (drag ? 2 : 0)) return;
      e.preventDefault(); e.stopPropagation();
      add(e, true); pointer = undefined;
      if (points.length) executeRoute();
      else if (drag) close();
    };
    const cancelStroke = (event: PointerEvent) => {
      if (pointer !== event.pointerId) return;
      pointer = undefined;
      points = []; dirty = true;
      if (drag) close();
    };
    // Finish the stroke before a HUD element can consume its release.
    window.addEventListener('pointermove', moveStroke, true);
    window.addEventListener('pointerup', finishStroke, true);
    window.addEventListener('pointercancel', cancelStroke, true);
    canvas.onlostpointercapture = cancelStroke;
    root.append(bar);
    document.body.append(root);
    this.onActive(true);
    if (drag) {
      pointer = drag.event.pointerId;
      add({ clientX: drag.start.x, clientY: drag.start.y }, true);
      add(drag.event, true);
    }
    const draw = () => {
      if (!root.isConnected) return;
      if (canvas.width !== innerWidth || canvas.height !== innerHeight) { canvas.width = innerWidth; canvas.height = innerHeight; dirty = true; }
      if (dirty) {
        dirty = false;
        const ctx = canvas.getContext('2d')!; ctx.clearRect(0, 0, canvas.width, canvas.height);
        const route = quickRoutePoints(points);
        const screen = route.map(p => {
          projected.set(p.x, sampleHeight(this.hf, p.x, p.z) + 0.5, p.z).project(this.camera);
          return { x: (projected.x + 1) * canvas.width / 2, y: (1 - projected.y) * canvas.height / 2 };
        });
        ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
        screen.forEach((p, i) => { if (!i) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.strokeStyle = '#061c16'; ctx.lineWidth = 7; ctx.stroke();
        ctx.strokeStyle = '#a5f4d0'; ctx.lineWidth = 3; ctx.stroke();
        for (const [i, p] of screen.entries()) {
          ctx.beginPath(); ctx.arc(p.x, p.y, i === screen.length - 1 ? 7 : 3, 0, Math.PI * 2);
          ctx.fillStyle = '#10241e'; ctx.fill(); ctx.strokeStyle = '#b9ffe0'; ctx.lineWidth = 2; ctx.stroke();
        }
        const end = screen.at(-1), before = screen.at(-2);
        if (end && before) {
          const angle = Math.atan2(end.y - before.y, end.x - before.x);
          ctx.beginPath(); ctx.moveTo(end.x - Math.cos(angle - 0.55) * 16, end.y - Math.sin(angle - 0.55) * 16);
          ctx.lineTo(end.x, end.y); ctx.lineTo(end.x - Math.cos(angle + 0.55) * 16, end.y - Math.sin(angle + 0.55) * 16);
          ctx.stroke();
        }
        label.textContent = `${entityIds.length} ${entityIds.length === 1 ? 'unit' : 'units'} · ${route.length} waypoints · Release to send · Esc cancels`;
      }
      frame = requestAnimationFrame(draw);
    }; draw();
  }
}
