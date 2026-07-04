import { Fog, MeshStandardMaterial } from 'three';
import { MAP01 } from './content/map01';
import { Input } from './engine/input';
import { GameLoop, SIM_HZ } from './engine/loop';
import { RtsCameraRig } from './modes/rtsCamera';
import { RtsController } from './modes/rtsController';
import { AssetPipeline } from './render/assets';
import { BuildingView } from './render/buildingView';
import { CombatView } from './render/combatView';
import { InstancedMeshRegistry } from './render/instancing';
import { RenderContext } from './render/renderer';
import { buildScatter } from './render/scatter';
import { TerrainView } from './render/terrainMesh';
import { UnitView } from './render/unitView';
import { WaterView } from './render/water';
import { createEconomy, createInitialBase, placeStructure, queueUnit, stepEconomy, updatePlacement } from './sim/economy';
import { stepCombat } from './sim/combat';
import { generateHeightfield } from './sim/heightfield';
import { createGameSim, spawnDebugTanks, spawnEnemyTanks, stepSim } from './sim/world';
import { Hud } from './ui/hud';
import { Sidebar } from './ui/sidebar';

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

  const sim = createGameSim(hf);
  const economy = createEconomy();
  createInitialBase(sim, hf, economy);
  const tanks = spawnDebugTanks(sim, hf, 120);
  const enemyTanks = spawnEnemyTanks(sim, hf, 40);
  const unitView = new UnitView([...tanks, ...enemyTanks], hf, ctx);
  unitView.attach(ctx.scene);
  const buildingView = new BuildingView(sim, hf, ctx);
  ctx.scene.add(buildingView.group);
  const combatView = new CombatView(hf);
  ctx.scene.add(combatView.group);

  const rig = new RtsCameraRig(ctx.camera, input, hf);
  const controller = new RtsController(ctx.renderer.domElement, ctx.camera, hf, sim, unitView, {
    isPlacing: () => economy.placement !== undefined,
    preview: (x, z) => {
      if (economy.selectedStructure) economy.placement = updatePlacement(sim, hf, economy.selectedStructure, x, z);
    },
    confirm: (x, z) => {
      if (!economy.selectedStructure) return;
      const placement = updatePlacement(sim, hf, economy.selectedStructure, x, z);
      const placed = placeStructure(sim, hf, economy, placement);
      if (placed) {
        economy.selectedStructure = undefined;
        economy.placement = undefined;
      } else {
        economy.placement = placement;
      }
    },
    cancel: () => {
      economy.selectedStructure = undefined;
      economy.placement = undefined;
    },
  }, buildingView);
  const hud = new Hud(document.body);
  const sidebar = new Sidebar(sim, hf, economy, {
    buildStructure: (kind) => {
      economy.selectedStructure = kind;
      economy.placement = updatePlacement(sim, hf, kind, 0, 0);
    },
    queueUnit: (kind, producer) => {
      queueUnit(sim, economy, kind, producer);
    },
    focusMap: (x, z) => {
      rig.jumpTo(x, z);
    },
  });
  input.onKeyDown('F3', () => water.setDebugOverlay(terrain.toggleWalkOverlay()));
  input.onKeyDown('F1', () => hud.toggleHelp());

  let fps = 60;
  let simTicks = 0;
  let simHz = SIM_HZ;
  let lastSimSample = performance.now();

  const loop = new GameLoop({
    simTick: () => {
      const spawned = stepEconomy(sim, hf, economy, 1 / SIM_HZ);
      for (const entity of spawned) {
        if (entity.selectable?.type === 'tank') tanks.push(entity);
        unitView.addEntity(entity);
      }
      stepSim(sim, hf, 1 / SIM_HZ);
      stepCombat(sim, 1 / SIM_HZ);
      combatView.push(sim.events.splice(0));
      simTicks++;
    },
    render: (alpha, dt, time) => {
      rig.update(dt);
      unitView.update(alpha);
      buildingView.update(economy);
      combatView.update(dt);
      water.update(time);
      ctx.render(dt);
      sidebar.update();

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
        pitchDeg: rig.pitchDegrees,
        units: unitView.count(),
        selected: controller.selectedCount(),
      });
    },
  });

  overlay.remove();
  loop.start();
}

void boot();
