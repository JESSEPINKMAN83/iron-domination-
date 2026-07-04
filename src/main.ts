import { Fog, MeshStandardMaterial } from 'three';
import { EnemyCommander } from './ai/commander';
import { MAP01 } from './content/map01';
import type { StructureKind } from './content/phase3';
import { AI_DIFFICULTY, type Difficulty, type Personality } from './content/phase6';
import { Input } from './engine/input';
import { GameLoop, SIM_HZ } from './engine/loop';
import { FirstPersonController } from './modes/firstPersonController';
import { RtsCameraRig } from './modes/rtsCamera';
import { RtsController } from './modes/rtsController';
import { AssetPipeline } from './render/assets';
import { BuildingView } from './render/buildingView';
import { CombatView } from './render/combatView';
import { FogView } from './render/fogView';
import { InstancedMeshRegistry } from './render/instancing';
import { OrderMarkerView } from './render/orderMarkerView';
import { RenderContext } from './render/renderer';
import { buildScatter } from './render/scatter';
import { TerrainView } from './render/terrainMesh';
import { UnitView } from './render/unitView';
import { WaterView } from './render/water';
import {
  buildings,
  cancelStructureBuild,
  cancelUnitQueue,
  createEconomy,
  createInitialBase,
  enterReadyStructurePlacement,
  placeStructure,
  queueUnit,
  setPrimaryProducer,
  setProducerRally,
  startStructureBuild,
  stepEconomy,
  updatePlacement,
} from './sim/economy';
import { stepCombat } from './sim/combat';
import { generateHeightfield } from './sim/heightfield';
import { VisibilityGrid } from './sim/visibility';
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

  const params = new URLSearchParams(location.search);
  const debugArmies = params.get('debug') === 'armies';
  const testStart = params.get('start') !== 'normal';
  const aiDifficulty: Difficulty = (['easy', 'normal', 'hard'] as const).find((d) => d === params.get('ai')) ?? 'normal';
  const aiPersonality: Personality = (['turtle', 'rusher', 'balanced'] as const).find((p) => p === params.get('ai-style')) ?? 'balanced';

  const sim = createGameSim(hf);
  const economy = createEconomy(1, testStart ? 15000 : 4600);
  const playerBase = createInitialBase(sim, hf, economy);
  if (testStart) seedTestStartBase(sim, hf, economy, playerBase);
  const enemyEconomy = createEconomy(2, AI_DIFFICULTY[aiDifficulty].startCredits);
  createInitialBase(sim, hf, enemyEconomy, hf.size * 0.18, hf.size * 0.08);

  const playerVision = new VisibilityGrid(hf, 1);
  const aiVision = new VisibilityGrid(hf, 2);
  const isVisibleToPlayer = (x: number, z: number): boolean => playerVision.isVisibleWorld(x, z);
  const commander = new EnemyCommander(sim, hf, enemyEconomy, aiVision, aiPersonality, aiDifficulty, [
    { x: playerBase.transform.x, z: playerBase.transform.z },
  ]);

  const tanks = spawnDebugTanks(sim, hf, debugArmies ? 120 : 8);
  const enemyTanks = spawnEnemyTanks(sim, hf, debugArmies ? 40 : 5);
  playerVision.update(sim);
  aiVision.update(sim);

  const unitView = new UnitView([...tanks, ...enemyTanks], hf, ctx, isVisibleToPlayer);
  unitView.attach(ctx.scene);
  const buildingView = new BuildingView(sim, hf, ctx);
  ctx.scene.add(buildingView.group);
  const combatView = new CombatView(hf, isVisibleToPlayer);
  ctx.scene.add(combatView.group);
  const orderMarkers = new OrderMarkerView(hf);
  ctx.scene.add(orderMarkers.group);
  const fogView = new FogView(playerVision, terrain.chunkGeometries);
  ctx.scene.add(fogView.group);

  const rig = new RtsCameraRig(ctx.camera, input, hf);
  rig.jumpTo(playerBase.transform.x, playerBase.transform.z);
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
      showFacingOrder: (x, z, yaw, kind) => orderMarkers.pushFacing(x, z, yaw, kind),
      showFacingPreview: (fromX, fromZ, toX, toZ, kind) => orderMarkers.showFacingPreview(fromX, fromZ, toX, toZ, kind),
      clearFacingPreview: () => orderMarkers.clearFacingPreview(),
      tryRally: (x, z) => {
        const selected = selectedEntities(sim);
        if (selected.length !== 1) return false;
        const rally = setProducerRally(sim, economy, selected[0], x, z);
        if (!rally) return false;
        orderMarkers.push(rally.x, rally.z, 'rally');
        return true;
      },
    },
  );
  const hud = new Hud(document.body);
  const sidebar = new Sidebar(sim, hf, economy, playerVision, {
    buildStructure: (kind) => {
      if (economy.readyStructure === kind) {
        enterReadyStructurePlacement(sim, hf, economy);
        return;
      }
      startStructureBuild(sim, economy, kind);
    },
    cancelStructure: () => {
      cancelStructureBuild(sim, economy);
    },
    queueUnit: (kind, producer) => {
      queueUnit(sim, economy, kind, producer);
    },
    cancelUnit: (kind, producer) => {
      cancelUnitQueue(sim, economy, kind, producer);
    },
    setPrimaryProducer: (producer) => {
      setPrimaryProducer(economy, producer);
    },
    focusMap: (x, z) => {
      rig.jumpTo(x, z);
    },
    radarYaw: () => rig.yawRadians,
  });
  const firstPerson = new FirstPersonController(ctx.renderer.domElement, ctx.camera, input, hf, sim, {
    onEnter: () => {
      controller.setEnabled(false);
      unitView.setHiddenEntity(undefined);
      unitView.setSelectionOverlayVisible(false);
      sidebar.setVisible(false);
      hud.setFirstPerson(true);
    },
    onExit: (entity) => {
      controller.setEnabled(true);
      unitView.setHiddenEntity(undefined);
      unitView.setSelectionOverlayVisible(true);
      sidebar.setVisible(true);
      hud.setFirstPerson(false);
      if (entity) rig.jumpTo(entity.transform.x, entity.transform.z);
    },
  });
  input.onKeyDown('KeyV', () => {
    if (firstPerson.active) firstPerson.exit();
    else firstPerson.enter(selectedEntities(sim));
  });
  input.onKeyDown('Escape', () => {
    if (firstPerson.active) firstPerson.exit();
  });
  input.onKeyDown('F3', () => water.setDebugOverlay(terrain.toggleWalkOverlay()));
  input.onKeyDown('F4', () => (fogView.group.visible = !fogView.group.visible));
  input.onKeyDown('F1', () => hud.toggleHelp());

  let outcome: 'victory' | 'defeat' | undefined;
  const checkOutcome = (): void => {
    if (outcome || sim.tick < 60) return;
    const alive = (team: number) => buildings(sim, team).filter((entity) => !entity.destroyed).length;
    if (alive(2) === 0) outcome = 'victory';
    else if (alive(1) === 0) outcome = 'defeat';
    if (outcome) showOutcomeBanner(outcome, commander.stats);
  };

  let fps = 60;
  let simTicks = 0;
  let simHz = SIM_HZ;
  let lastSimSample = performance.now();

  const loop = new GameLoop({
    simTick: () => {
      firstPerson.simTick();
      commander.step(1 / SIM_HZ);
      const spawned = [...stepEconomy(sim, hf, economy, 1 / SIM_HZ), ...stepEconomy(sim, hf, enemyEconomy, 1 / SIM_HZ)];
      for (const entity of spawned) {
        if (entity.selectable?.type === 'tank' && entity.team?.id === 1) tanks.push(entity);
        unitView.addEntity(entity);
      }
      stepSim(sim, hf, 1 / SIM_HZ);
      for (const entity of sim.world.entities) {
        if (entity.selectable?.type === 'tank' && !entity.destroyed) scatter.crushNear(entity.transform.x, entity.transform.z, 3.6);
      }
      stepCombat(sim, 1 / SIM_HZ);
      playerVision.update(sim);
      aiVision.update(sim);
      fogView.refresh();
      combatView.push(sim.events.splice(0));
      checkOutcome();
      simTicks++;
    },
    render: (alpha, dt, time) => {
      if (firstPerson.active) firstPerson.update(dt);
      else {
        rig.setGrabSuppressed(controller.isRightOrderGestureActive());
        rig.update(dt);
      }
      unitView.update(alpha, dt, ctx.camera);
      buildingView.update(economy, ctx.camera);
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
        mode: firstPerson.inFirstPerson ? `CHASE ${firstPerson.possessedName ?? ''}` : firstPerson.active ? 'entering chase' : 'RTS',
      });
    },
  });

  overlay.remove();
  loop.start();
}

function showOutcomeBanner(outcome: 'victory' | 'defeat', aiStats: { attacksLaunched: number; rebuilds: number }): void {
  const el = document.createElement('div');
  const win = outcome === 'victory';
  el.style.cssText =
    'position:fixed;left:50%;top:34%;transform:translate(-50%,-50%);z-index:60;padding:26px 48px;text-align:center;' +
    'font:15px ui-monospace,Menlo,monospace;letter-spacing:.3em;color:#f0f3e8;pointer-events:none;' +
    `background:rgba(8,12,14,.88);border:2px solid ${win ? '#d2b15f' : '#d65b46'};border-radius:4px;box-shadow:0 18px 60px rgba(0,0,0,.55);`;
  el.innerHTML =
    `<div style="font-size:34px;color:${win ? '#f0d56a' : '#ff6a54'}">${win ? 'VICTORY' : 'DEFEAT'}</div>` +
    `<div style="margin-top:10px;font-size:11px;letter-spacing:.14em;color:#aebbc4">enemy commander launched ${aiStats.attacksLaunched} assaults · rebuilt ${aiStats.rebuilds} structures</div>`;
  document.body.appendChild(el);
}

function seedTestStartBase(sim: ReturnType<typeof createGameSim>, hf: ReturnType<typeof generateHeightfield>, economy: ReturnType<typeof createEconomy>, base: ReturnType<typeof createInitialBase>): void {
  const placements: Array<{ kind: StructureKind; offsets: Array<{ x: number; z: number }> }> = [
    { kind: 'power-plant', offsets: [{ x: -30, z: -10 }, { x: -34, z: 18 }, { x: 22, z: -30 }] },
    { kind: 'refinery', offsets: [{ x: 30, z: -6 }, { x: 38, z: 24 }, { x: -44, z: -28 }] },
    { kind: 'barracks', offsets: [{ x: -28, z: 28 }, { x: -52, z: 16 }, { x: 18, z: 34 }] },
    { kind: 'factory', offsets: [{ x: 34, z: 32 }, { x: 56, z: 4 }, { x: -20, z: 52 }] },
    { kind: 'helipad', offsets: [{ x: -38, z: 58 }, { x: 10, z: 62 }, { x: 64, z: 38 }] },
    { kind: 'guard-tower', offsets: [{ x: 52, z: -32 }, { x: -56, z: -8 }, { x: 58, z: 58 }] },
  ];
  for (const item of placements) {
    economy.readyStructure = item.kind;
    const placement = findValidTestPlacement(sim, hf, economy, base.transform.x, base.transform.z, item.kind, item.offsets);
    if (!placement) {
      console.warn(`[test-start] could not place ${item.kind}`);
      economy.readyStructure = undefined;
      continue;
    }
    const placed = placeStructure(sim, hf, economy, placement);
    if (placed?.building) placed.building.buildProgress = 1;
  }
  economy.readyStructure = undefined;
  economy.selectedStructure = undefined;
  economy.placement = undefined;
}

function findValidTestPlacement(
  sim: ReturnType<typeof createGameSim>,
  hf: ReturnType<typeof generateHeightfield>,
  economy: ReturnType<typeof createEconomy>,
  baseX: number,
  baseZ: number,
  kind: StructureKind,
  offsets: Array<{ x: number; z: number }>,
): ReturnType<typeof updatePlacement> | undefined {
  const probes = [
    ...offsets,
    ...offsets.flatMap((offset) => [
      { x: offset.x + 12, z: offset.z },
      { x: offset.x - 12, z: offset.z },
      { x: offset.x, z: offset.z + 12 },
      { x: offset.x, z: offset.z - 12 },
    ]),
  ];
  for (const offset of probes) {
    const placement = updatePlacement(sim, hf, kind, baseX + offset.x, baseZ + offset.z, economy.team);
    if (placement.valid) return placement;
  }
  return undefined;
}

void boot();
