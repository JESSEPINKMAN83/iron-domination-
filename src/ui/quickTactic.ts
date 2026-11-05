import { Raycaster, Vector2, Vector3, type PerspectiveCamera } from 'three';
import { sampleHeight, type Heightfield } from '../sim/heightfield';
import { MAX_TACTIC_WAYPOINTS } from '../sim/tactics';
import type { TacticExecutePayload } from './tacticPlanner';

type Point = { x: number; z: number };
/** Bound command size while preserving the full drawn route and its endpoint. */
export function quickRoutePoints(points: Point[]): Point[] {
  if (points.length <= MAX_TACTIC_WAYPOINTS) return points.map(p => ({ ...p }));
  return Array.from({ length: MAX_TACTIC_WAYPOINTS }, (_, i) => ({ ...points[Math.round(i * (points.length - 1) / (MAX_TACTIC_WAYPOINTS - 1))] }));
}

export class QuickTactic {
  private root?: HTMLDivElement;
  private cancel?: () => void;
  constructor(private camera: PerspectiveCamera, private hf: Heightfield,
    private onActive: (active: boolean) => void, private execute: (payload: TacticExecutePayload) => void) {}

  open(entityIds: number[]): void {
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
    label.textContent = 'Drag to draw · Fast · 50% variation · Attack while moving';
    bar.append(label);
    const button = (text: string, action: () => void) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
      b.style.cssText = 'padding:7px 10px;border:1px solid #78b99e;border-radius:4px;background:#203e33;color:#d9f4e7;cursor:pointer;';
      b.onclick = action; bar.append(b); return b;
    };
    let points: Point[] = [], pointer: number | undefined, lastX = 0, lastY = 0;
    let frame = 0;
    const close = () => {
      cancelAnimationFrame(frame); window.removeEventListener('keydown', key, true);
      root.remove(); if (this.root === root) this.root = undefined;
      this.cancel = undefined;
      this.onActive(false);
    };
    this.cancel = close;
    const confirm = button('Confirm route', () => {
      if (!points.length) return;
      const waypoints = quickRoutePoints(points);
      close();
      this.execute({ entityIds, waypoints, endAction: { kind: 'attack-through' }, selectionCount: entityIds.length,
        plannerDurationMs: performance.now() - started, highSpeed: true, variation: 0.5 });
    });
    confirm.disabled = true;
    button('Clear', () => { points = []; confirm.disabled = true; });
    button('Cancel', close);
    const key = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.code === 'Escape') close();
      else if (event.code === 'Enter' && points.length) confirm.click();
    };
    window.addEventListener('keydown', key, true);
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
    const add = (e: PointerEvent, force = false) => {
      if (!force && Math.hypot(e.clientX - lastX, e.clientY - lastY) < 8) return;
      const point = pointAt(e.clientX, e.clientY);
      if (!point) return;
      points.push(point); if (points.length > 2048) points = quickRoutePoints(points);
      lastX = e.clientX; lastY = e.clientY; confirm.disabled = false;
    };
    canvas.onpointerdown = e => { if (e.button !== 0) return; pointer = e.pointerId; canvas.setPointerCapture(pointer); add(e, true); };
    canvas.onpointermove = e => { if (pointer === e.pointerId) add(e); };
    canvas.onpointerup = e => { if (pointer === e.pointerId) { add(e, true); pointer = undefined; } };
    canvas.onpointercancel = () => { pointer = undefined; };
    root.append(bar); document.body.append(root); this.onActive(true);
    const draw = () => {
      if (!root.isConnected) return;
      if (canvas.width !== innerWidth || canvas.height !== innerHeight) { canvas.width = innerWidth; canvas.height = innerHeight; }
      const ctx = canvas.getContext('2d')!; ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#a5f4d0'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.beginPath();
      points.forEach((p, i) => { projected.set(p.x, sampleHeight(this.hf, p.x, p.z) + 0.5, p.z).project(this.camera);
        const x = (projected.x + 1) * canvas.width / 2, y = (1 - projected.y) * canvas.height / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }); ctx.stroke(); frame = requestAnimationFrame(draw);
    }; draw();
  }
}
