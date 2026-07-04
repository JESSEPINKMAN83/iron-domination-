import { Fog, MeshStandardMaterial } from 'three';
import { MAP01 } from './content/map01';
import { Input } from './engine/input';
import { GameLoop, SIM_HZ } from './engine/loop';
import { FirstPersonController } from './modes/firstPersonController';
import { RtsCameraRig } from './modes/rtsCamera';
import { RtsController } from './modes/rtsController';
import { AssetPipeline } from './render/assets';
import { BuildingView } from './render/buildingView';
import { CombatView } from './render/combatView';
import { InstancedMeshRegistry } from './render/instancing';
import { OrderMarkerView } from './render/orderMarkerView';
import { RenderContext } from './render/renderer';
import { buildScatter } from './render/scatter';
import { TerrainView } from './render/terrainMesh';
import { UnitView } from './render/unitView';
import { WaterView } from './render/water';
import { createEconomy, createInitialBase, placeStructure, queueUnit, stepEconomy, updatePlacement } from './sim/economy';
import { stepCombat } from './sim/combat';
import { generateHeightfield } from './sim/heightfield';
import { createGameSim, selectedEntities, spawnDebugTanks, spawnEnemyTanks, stepSim } from './sim/world';
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
  const scatter = buildScatter(hf, registry, scatterMaterial, MAP01.seed ^ 0x5eed);
  ctx.scene.add(scatter.group);

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
  const orderMarkers = new OrderMarkerView(hf);
  ctx.scene.add(orderMarkers.group);

  const rig = new RtsCameraRig(ctx.camera, input, hf);
  const controller = new RtsController(
    ctx.renderer.domElement,
    ctx.camera,
    hf,
    sim,
    unitView,
    {
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
    },
    buildingView,
    {
      showOrder: (x, z, kind) => orderMarkers.push(x, z, kind),
    },
  );
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
  const firstPerson = new FirstPersonController(ctx.renderer.domElement, ctx.camera, input, hf, {
    onEnter: () => {
      controller.setEnabled(false);
      unitView.setHiddenEntity(firstPerson.possessedEntity);
      sidebar.setVisible(false);
      hud.setFirstPerson(true);
    },
    onExit: (entity) => {
      controller.setEnabled(true);
      unitView.setHiddenEntity(undefined);
      sidebar.setVisible(true);
      hud.setFirstPerson(false);
      if (entity) rig.jumpTo(entity.transform.x, entity.transform.z);
    },
  });
  input.onKeyDown('KeyV', () => {
    if (firstPerson.enter(selectedEntities(sim))) return;
  });
  input.onKeyDown('Escape', () => {
    if (firstPerson.active) firstPerson.exit();
  });
  input.onKeyDown('F3', () => water.setDebugOverlay(terrain.toggleWalkOverlay()));
  input.onKeyDown('F1', () => hud.toggleHelp());

  let fps = 60;
  let simTicks = 0;
  let simHz = SIM_HZ;
  let lastSimSample = performance.now();

  const loop = new GameLoop({
    simTick: () => {
      firstPerson.simTick();
      const spawned = stepEconomy(sim, hf, economy, 1 / SIM_HZ);
      for (const entity of spawned) {
        if (entity.selectable?.type === 'tank') tanks.push(entity);
        unitView.addEntity(entity);
      }
      stepSim(sim, hf, 1 / SIM_HZ);
      for (const entity of sim.world.entities) {
        if (entity.selectable?.type === 'tank' && !entity.destroyed) scatter.crushNear(entity.transform.x, entity.transform.z, 3.6);
      }
      stepCombat(sim, 1 / SIM_HZ);
      combatView.push(sim.events.splice(0));
      simTicks++;
    },
    render: (alpha, dt, time) => {
      if (firstPerson.active) firstPerson.update(dt);
      else rig.update(dt);
      unitView.update(alpha, ctx.camera);
      buildingView.update(economy);
      combatView.update(dt);
      orderMarkers.update(dt);
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
        mode: firstPerson.inFirstPerson ? `FPS ${firstPerson.possessedName ?? ''}` : firstPerson.active ? 'entering FPS' : 'RTS',
      });
    },
  });

  overlay.remove();
  loop.start();
}

void boot();
