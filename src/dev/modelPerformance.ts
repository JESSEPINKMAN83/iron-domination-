import type { RenderContext } from '../render/renderer';
import type { GameSim } from '../sim/world';

/** Visible local-only measurements; never sends telemetry. */
export function showModelPerformance(ctx: RenderContext, sim: GameSim): void {
  const panel = document.createElement('pre');
  panel.id = 'model-performance-report';
  panel.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:99999;margin:0;padding:12px;background:#07141eee;color:#fff;font:12px/1.5 monospace;pointer-events:none';
  const baseline = new URLSearchParams(location.search).get('model-baseline') === '1';
  const label = baseline ? 'BASELINE MODELS' : 'CODE RED MODELS';
  panel.textContent = `${label} · warming up 20 s`;
  document.body.append(panel);
  let previous = performance.now();
  let activeSeconds = 0;
  const samples: number[] = [], calls: number[] = [], triangles: number[] = [];
  const qualities = new Set<string>();
  function tick(now: number): void {
    const dt = now - previous;
    previous = now;
    // Ignore suspended tabs, not actual in-focus slow frames.
    if (document.visibilityState !== 'visible' || dt >= 1000) {
      requestAnimationFrame(tick);
      return;
    }
    activeSeconds += dt / 1000;
    if (activeSeconds > 20 && activeSeconds < 40) {
      samples.push(dt);
      calls.push(ctx.renderer.info.render.calls);
      triangles.push(ctx.renderer.info.render.triangles);
      qualities.add(`${ctx.visualQualityLabel} @ ${ctx.renderScale.toFixed(2)}x`);
    }
    if (activeSeconds < 40) {
      panel.textContent = activeSeconds < 20
        ? `${label} · warming up ${Math.floor(activeSeconds)}/20 s`
        : `${label} · sampling ${Math.floor(activeSeconds - 20)}/20 s · ${ctx.visualQualityLabel}`;
      requestAnimationFrame(tick);
      return;
    }
    const avg = (values: number[]): number => values.reduce((sum, n) => sum + n, 0) / Math.max(1, values.length);
    samples.sort((a, b) => a - b);
    const entities = Array.from(sim.world.entities);
    const report = {
      models: baseline ? 'baseline' : 'code-red',
      averageMs: +avg(samples).toFixed(2),
      p95Ms: +(samples[Math.floor(samples.length * .95)] ?? 0).toFixed(2),
      frames: samples.length,
      averageDrawCalls: Math.round(avg(calls)),
      averageTriangles: Math.round(avg(triangles)),
      geometries: ctx.renderer.info.memory.geometries,
      textures: ctx.renderer.info.memory.textures,
      quality: [...qualities],
      viewport: `${ctx.renderer.domElement.width} × ${ctx.renderer.domElement.height}`,
      buildings: entities.filter(e => e.building && !e.destroyed).length,
      units: entities.filter(e => !e.building && e.selectable && !e.destroyed).length,
    };
    panel.dataset.phase = 'complete';
    panel.textContent = JSON.stringify(report, null, 2);
  }
  requestAnimationFrame(tick);
}
