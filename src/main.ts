import { Fog, MeshStandardMaterial } from 'three';
import { MAP01 } from './content/map01';
import { Input } from './engine/input';
import { GameLoop, SIM_HZ } from './engine/loop';
import { RtsCameraRig } from './modes/rtsCamera';
import { AssetPipeline } from './render/assets';
import { InstancedMeshRegistry } from './render/instancing';
import { RenderContext } from './render/renderer';
import { buildScatter } from './render/scatter';
import { TerrainView } from './render/terrainMesh';
import { WaterView } from './render/water';
import { generateHeightfield } from './sim/heightfield';
import { Hud } from './ui/hud';

const nextFrame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve));

function showLoadingOverlay(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'gap:10px;background:#0a0d10;color:#cfd8e3;font:14px ui-monospace,Menlo,monospace;z-index:100;letter-spacing:.2em;';
  el.innerHTML = '<div style="font-size:22px">IRON DOMINION</div><div>generating terrain…</div>';
  document.body.appendChild(el);
  return el;
}

async function boot(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app missing');
  const overlay = showLoadingOverlay();
  await nextFrame();
  await nextFrame();

  const t0 = performance.now();
  const hf = generateHeightfield(MAP01);
  console.info(`[map] ${hf.cells}×${hf.cells} cells generated in ${(performance.now() - t0).toFixed(0)} ms`);

  const ctx = new RenderContext(app);
  const input = new Input();
  input.attach(ctx.renderer.domElement);

  // GLB/KTX2/Draco pipeline — no models yet, but wired for the content phases.
  const assets = new AssetPipeline(ctx.renderer);
  void assets;

  const terrain = new TerrainView(hf, ctx.csm, ctx.maxAnisotropy);
  ctx.scene.add(terrain.group);

  const water = new WaterView(hf, ctx.sunDirection, ctx.scene.fog as Fog);
  ctx.scene.add(water.mesh);

  const registry = new InstancedMeshRegistry();
  const scatterMaterial = ctx.setupLitMaterial(
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true }),
  );
  ctx.scene.add(buildScatter(hf, registry, scatterMaterial, MAP01.seed ^ 0x5eed));

  const rig = new RtsCameraRig(ctx.camera, input, hf);
  const hud = new Hud(document.body);
  input.onKeyDown('F3', () => water.setDebugOverlay(terrain.toggleWalkOverlay()));
  input.onKeyDown('F1', () => hud.toggleHelp());

  let fps = 60;
  let simTicks = 0;
  let simHz = SIM_HZ;
  let lastSimSample = performance.now();

  const loop = new GameLoop({
    simTick: () => {
      simTicks++; // sim systems land in Phase 2 — the fixed 30 Hz cadence is live now
    },
    render: (_alpha, dt, time) => {
      rig.update(dt);
      water.update(time);
      ctx.render(dt);

      fps = fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
      const now = performance.now();
      if (now - lastSimSample >= 1000) {
        simHz = simTicks;
        simTicks = 0;
        lastSimSample = now;
      }
      hud.update(now, {
        fps,
        frameMs: dt * 1000,
        drawCalls: ctx.renderer.info.render.calls,
        triangles: ctx.renderer.info.render.triangles,
        simHz,
        instances: registry.totalInstances,
        zoom: rig.distance,
        yawDeg: rig.yawDegrees,
      });
    },
  });

  overlay.remove();
  loop.start();
}

void boot();
