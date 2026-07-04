import { Fog, MeshStandardMaterial } from 'three';
import { EnemyCommander } from './ai/commander';
import { MAP01 } from './content/map01';
import type { StructureKind } from './content/phase3';
import { AI_DIFFICULTY, type Difficulty, type Personality } from './content/phase6';
import { startPosition } from './content/startPositions';
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
  spawnInfantryAt,
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
const SKIRMISH_STORAGE_KEY = 'iron-dominion.skirmish.v1';
const AUTOSTART_STORAGE_KEY = 'iron-dominion.autostart.v1';

interface SkirmishSettings {
  seed: number;
  ai: Difficulty;
  aiStyle: Personality;
  debug: boolean;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
const PERSONALITIES: Personality[] = ['turtle', 'rusher', 'balanced'];

function randomSeed(): number {
  return Math.floor(100000 + Math.random() * 900000000);
}

function loadStoredSettings(): Partial<SkirmishSettings> {
  try {
    const raw = window.localStorage.getItem(SKIRMISH_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<SkirmishSettings>;
    return {
      seed: Number.isFinite(parsed.seed) ? Math.floor(Number(parsed.seed)) : undefined,
      ai: DIFFICULTIES.includes(parsed.ai as Difficulty) ? parsed.ai : undefined,
      aiStyle: PERSONALITIES.includes(parsed.aiStyle as Personality) ? parsed.aiStyle : undefined,
      debug: parsed.debug === true,
    };
  } catch {
    return {};
  }
}

function saveSkirmishSettings(settings: SkirmishSettings): void {
  window.localStorage.setItem(SKIRMISH_STORAGE_KEY, JSON.stringify(settings));
}

function settingsFromUrl(params: URLSearchParams): Partial<SkirmishSettings> {
  const seed = Number(params.get('seed'));
  const ai = params.get('ai');
  const aiStyle = params.get('ai-style');
  return {
    seed: Number.isFinite(seed) && seed > 0 ? Math.floor(seed) : undefined,
    ai: DIFFICULTIES.includes(ai as Difficulty) ? (ai as Difficulty) : undefined,
    aiStyle: PERSONALITIES.includes(aiStyle as Personality) ? (aiStyle as Personality) : undefined,
    debug: params.get('debug') === 'armies' ? true : undefined,
  };
}

function initialSettings(params: URLSearchParams): SkirmishSettings {
  const stored = loadStoredSettings();
  const fromUrl = settingsFromUrl(params);
  return {
    seed: fromUrl.seed ?? stored.seed ?? randomSeed(),
    ai: fromUrl.ai ?? stored.ai ?? 'normal',
    aiStyle: fromUrl.aiStyle ?? stored.aiStyle ?? 'balanced',
    debug: fromUrl.debug ?? stored.debug ?? false,
  };
}

function reloadWithSettings(settings: SkirmishSettings, autostart: boolean): void {
  saveSkirmishSettings(settings);
  if (autostart) window.sessionStorage.setItem(AUTOSTART_STORAGE_KEY, '1');
  else window.sessionStorage.removeItem(AUTOSTART_STORAGE_KEY);
  window.location.reload();
}

function showLoadingOverlay(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'gap:10px;background:#0a0d10;color:#cfd8e3;font:14px ui-monospace,Menlo,monospace;z-index:100;letter-spacing:.2em;';
  el.innerHTML = '<div style="font-size:22px">IRON DOMINION</div><div>generating terrain…</div>';
  document.body.appendChild(el);
  return el;
}

function showSetupScreen(defaults: SkirmishSettings): Promise<SkirmishSettings> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0a0d10;color:#cfd8e3;' +
      'font:13px ui-monospace,Menlo,monospace;z-index:120;letter-spacing:.08em;';
    const panel = document.createElement('div');
    panel.style.cssText =
      'width:min(720px,calc(100vw - 36px));display:grid;gap:18px;padding:28px 32px;background:linear-gradient(180deg,#151b1d,#070909);' +
      'border:2px solid #596260;border-radius:4px;box-shadow:inset 0 0 0 1px rgba(210,177,95,.22),0 22px 80px rgba(0,0,0,.62);';

    const title = document.createElement('div');
    title.innerHTML =
      '<div style="font-size:34px;color:#f0d56a;letter-spacing:.22em">IRON DOMINION</div>' +
      '<div style="margin-top:7px;color:#aebbc4;letter-spacing:.14em">skirmish command setup</div>' +
      '<div style="margin-top:5px;color:#6f7b78;font-size:11px;letter-spacing:.12em">Phase 6 pre-Netlify build</div>';

    const form = document.createElement('div');
    form.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:14px;';
    const difficulty = createSegmentedControl('Difficulty', DIFFICULTIES, defaults.ai);
    const commander = createSegmentedControl('Enemy commander', PERSONALITIES, defaults.aiStyle);
    form.append(difficulty.root, commander.root);

    const seedRow = document.createElement('div');
    seedRow.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;';
    const seedWrap = document.createElement('label');
    seedWrap.style.cssText = 'display:grid;gap:7px;color:#d2b15f;text-transform:uppercase;';
    const seedInput = document.createElement('input');
    seedInput.type = 'number';
    seedInput.min = '1';
    seedInput.step = '1';
    seedInput.value = String(defaults.seed);
    seedInput.style.cssText =
      'height:38px;background:#090d0d;color:#f0f3e8;border:1px solid #46504d;padding:0 10px;font:16px ui-monospace,Menlo,monospace;letter-spacing:.08em;';
    seedWrap.append('Map seed', seedInput);
    const randomize = document.createElement('button');
    randomize.type = 'button';
    randomize.textContent = '🎲 RANDOMIZE';
    randomize.style.cssText = smallSetupButtonCss();
    randomize.onclick = () => {
      seedInput.value = String(randomSeed());
      randomize.blur();
    };
    seedRow.append(seedWrap, randomize);

    const caption = document.createElement('div');
    caption.style.cssText = 'color:#8d9a96;font-size:11px;line-height:1.45;letter-spacing:.06em;';
    caption.textContent = 'Same seed, same terrain. Share a seed to replay a map.';

    const controls = document.createElement('div');
    controls.style.cssText =
      'display:grid;grid-template-columns:repeat(5,1fr);gap:6px;padding:12px;border:1px solid #303936;background:#0f1414;color:#aebbc4;font-size:10px;line-height:1.35;';
    for (const text of ['Select: click/drag', 'Orders: right-click', 'Build: sidebar', 'V-mode: select + V', 'Fly: W/S A/D Space/Ctrl']) {
      const item = document.createElement('div');
      item.textContent = text;
      controls.appendChild(item);
    }

    const start = document.createElement('button');
    start.type = 'button';
    start.textContent = 'START';
    start.style.cssText =
      'height:54px;border:1px solid #d2b15f;background:linear-gradient(180deg,#d2b15f,#856c32);color:#121513;' +
      'font:700 18px ui-monospace,Menlo,monospace;letter-spacing:.28em;cursor:pointer;box-shadow:0 8px 26px rgba(0,0,0,.45);';

    const begin = (): void => {
      const seed = Math.max(1, Math.floor(Number(seedInput.value) || randomSeed()));
      const settings: SkirmishSettings = { seed, ai: difficulty.value(), aiStyle: commander.value(), debug: defaults.debug };
      saveSkirmishSettings(settings);
      window.removeEventListener('keydown', onKeyDown);
      el.remove();
      resolve(settings);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Enter') begin();
    };
    start.onclick = begin;
    window.addEventListener('keydown', onKeyDown);

    panel.append(title, form, seedRow, caption, controls, start);
    el.appendChild(panel);
    document.body.appendChild(el);
  });
}

function createSegmentedControl<T extends string>(label: string, values: T[], initial: T): { root: HTMLDivElement; value: () => T } {
  let current = initial;
  const root = document.createElement('div');
  root.style.cssText = 'display:grid;gap:7px;';
  const title = document.createElement('div');
  title.textContent = label.toUpperCase();
  title.style.cssText = 'color:#d2b15f;';
  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:5px;';
  const render = (): void => {
    for (const button of Array.from(buttons.children) as HTMLButtonElement[]) {
      const active = button.dataset.value === current;
      button.style.cssText = setupChoiceButtonCss(active);
    }
  };
  for (const value of values) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.value = value;
    button.textContent = value.toUpperCase();
    button.onclick = () => {
      current = value;
      render();
      button.blur();
    };
    buttons.appendChild(button);
  }
  root.append(title, buttons);
  render();
  return { root, value: () => current };
}

function setupChoiceButtonCss(active: boolean): string {
  return (
    'height:38px;border-radius:2px;border:1px solid #4b5552;font:11px ui-monospace,Menlo,monospace;letter-spacing:.05em;cursor:pointer;' +
    `background:${active ? 'linear-gradient(180deg,#d2b15f,#8b7339)' : 'linear-gradient(180deg,#26302f,#111615)'};` +
    `color:${active ? '#141614' : '#d7e0e7'};`
  );
}

function smallSetupButtonCss(): string {
  return (
    'height:40px;border-radius:2px;border:1px solid #4b5552;font:11px ui-monospace,Menlo,monospace;letter-spacing:.06em;padding:0 12px;' +
    'background:linear-gradient(180deg,#26302f,#111615);color:#d7e0e7;cursor:pointer;'
  );
}

async function boot(settings: SkirmishSettings): Promise<void> {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app missing');
  const overlay = showLoadingOverlay();
  await nextFrame();
  await nextFrame();

  const t0 = performance.now();
  const hf = generateHeightfield({ ...MAP01, seed: settings.seed });
  console.info(`[map] seed ${settings.seed} · ${hf.cells}×${hf.cells} cells generated in ${(performance.now() - t0).toFixed(0)} ms`);

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
  const scatter = buildScatter(hf, registry, scatterMaterial, settings.seed ^ 0x5eed);
  ctx.scene.add(scatter.group);

  const params = new URLSearchParams(location.search);
  const startMode = params.get('start');
  const testStart = startMode === 'test' || startMode === 'sandbox';
  const debugArmies = startMode === 'armies' || startMode === 'debug-armies';
  const aiDifficulty: Difficulty = settings.ai;
  const aiPersonality: Personality = settings.aiStyle;

  const sim = createGameSim(hf);
  const economy = createEconomy(1, testStart ? 15000 : 4600);
  const playerBase = createInitialBase(sim, hf, economy);
  if (testStart) seedTestStartBase(sim, hf, economy, playerBase);
  const enemyEconomy = createEconomy(2, AI_DIFFICULTY[aiDifficulty].startCredits);
  const enemyStart = startPosition(hf.size, 2);
  const enemyBase = createInitialBase(sim, hf, enemyEconomy, enemyStart.x, enemyStart.z);

  const playerVision = new VisibilityGrid(hf, 1);
  const aiVision = new VisibilityGrid(hf, 2);
  const isVisibleToPlayer = (x: number, z: number): boolean => playerVision.isVisibleWorld(x, z);
  const commander = new EnemyCommander(sim, hf, enemyEconomy, aiVision, aiPersonality, aiDifficulty, [
    { x: playerBase.transform.x, z: playerBase.transform.z },
  ]);

  const tanks = spawnDebugTanks(sim, hf, debugArmies ? 120 : 2);
  const enemyTanks = spawnEnemyTanks(sim, hf, debugArmies ? 40 : 2);
  const startingInfantry = debugArmies
    ? []
    : [
        ...spawnStartingInfantry(sim, hf, playerBase.transform.x, playerBase.transform.z, 1),
        ...spawnStartingInfantry(sim, hf, enemyBase.transform.x, enemyBase.transform.z, 2),
      ];
  playerVision.update(sim);
  aiVision.update(sim);

  const unitView = new UnitView([...tanks, ...enemyTanks, ...startingInfantry], hf, ctx, isVisibleToPlayer);
  unitView.attach(ctx.scene);
  const buildingView = new BuildingView(sim, hf, ctx, isVisibleToPlayer);
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
    input,
    ctx.camera,
    hf,
    sim,
    unitView,
    {
      isPlacing: () => economy.placement !== undefined,
      preview: (x, z) => {
        if (economy.selectedStructure) economy.placement = updatePlacement(sim, hf, economy.selectedStructure, x, z, economy.team, economy);
      },
      confirm: (x, z) => {
        if (!economy.selectedStructure) return;
        const placement = updatePlacement(sim, hf, economy.selectedStructure, x, z, economy.team, economy);
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
      showFacingOrder: (x, z, yaw, kind, length) => orderMarkers.pushFacing(x, z, yaw, kind, length),
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
    radarViewport: () => rig.getGroundViewportFootprint(),
  });
  createGameMenu(settings, hud);
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
  input.onKeyDown('Tab', () => {
    firstPerson.cyclePossessed(1);
  });
  input.onKeyDown('Escape', () => {
    if (firstPerson.active) firstPerson.exit();
  });
  input.onKeyDown('F3', () => water.setDebugOverlay(terrain.toggleWalkOverlay()));
  input.onKeyDown('F4', () => (fogView.group.visible = !fogView.group.visible));
  input.onKeyDown('F1', () => hud.toggleInfo());

  let outcome: 'victory' | 'defeat' | undefined;
  const checkOutcome = (): void => {
    if (outcome || sim.tick < 60) return;
    const alive = (team: number) => buildings(sim, team).filter((entity) => !entity.destroyed).length;
    if (alive(2) === 0) outcome = 'victory';
    else if (alive(1) === 0) outcome = 'defeat';
    if (outcome) showOutcomeBanner(outcome, commander.stats, settings);
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
      if (firstPerson.active) firstPerson.update(dt, alpha);
      else {
        rig.setGrabSuppressed(controller.isRightOrderGestureActive());
        rig.setEmptyRightDragLook(controller.isEmptyRightLookActive());
        rig.update(dt);
      }
      unitView.update(alpha, dt, ctx.camera);
      buildingView.setProducerHighlights(sidebar.producerHighlightIds());
      buildingView.update(economy, ctx.camera);
      combatView.update(dt);
      orderMarkers.update(dt);
      terrain.updateResources(sim.resourceNodes);
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

function createGameMenu(settings: SkirmishSettings, hud: Hud): void {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:30;display:flex;gap:6px;align-items:center;';
  const info = gameChromeButton('i', 'Show info panels');
  info.style.width = '34px';
  info.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    hud.toggleInfo();
    info.textContent = hud.getInfoVisible() ? '×' : 'i';
    info.title = hud.getInfoVisible() ? 'Hide info panels' : 'Show info panels';
    info.blur();
  };
  const menu = gameChromeButton('MENU', 'Open match menu');
  menu.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    menu.blur();
    showRestartDialog(settings);
  };
  wrap.append(info, menu);
  document.body.appendChild(wrap);
}

function gameChromeButton(text: string, title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.tabIndex = -1;
  button.textContent = text;
  button.title = title;
  button.style.cssText =
    'height:34px;padding:0 14px;border:1px solid #4b5552;border-radius:2px;' +
    'font:11px ui-monospace,Menlo,monospace;letter-spacing:.12em;background:linear-gradient(180deg,#26302f,#111615);color:#d7e0e7;cursor:pointer;';
  button.onpointerdown = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  return button;
}

function showRestartDialog(settings: SkirmishSettings): void {
  const existing = document.getElementById('skirmish-restart-dialog');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'skirmish-restart-dialog';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:70;display:grid;place-items:center;background:rgba(0,0,0,.25);pointer-events:auto;';
  overlay.onpointerdown = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const panel = document.createElement('div');
  panel.style.cssText =
    'width:270px;display:grid;gap:8px;padding:14px;background:rgba(8,12,14,.94);border:1px solid #596260;border-radius:3px;' +
    'box-shadow:0 18px 60px rgba(0,0,0,.55);font:11px ui-monospace,Menlo,monospace;color:#d7e0e7;letter-spacing:.08em;';
  const title = document.createElement('div');
  title.textContent = 'MATCH MENU';
  title.style.cssText = 'color:#d2b15f;font-size:13px;margin-bottom:2px;';
  const restart = dialogButton('Restart match', () => reloadWithSettings(settings, true));
  const setup = dialogButton('Back to setup', () => reloadWithSettings(settings, false));
  const cancel = dialogButton('Cancel', () => overlay.remove());
  panel.append(title, restart, setup, cancel);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

function dialogButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.tabIndex = -1;
  button.textContent = label.toUpperCase();
  button.style.cssText =
    'height:34px;border-radius:2px;border:1px solid #4b5552;background:linear-gradient(180deg,#26302f,#111615);' +
    'color:#d7e0e7;font:11px ui-monospace,Menlo,monospace;letter-spacing:.08em;cursor:pointer;';
  button.onpointerdown = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    button.blur();
    action();
  };
  return button;
}

function showOutcomeBanner(outcome: 'victory' | 'defeat', aiStats: { attacksLaunched: number; rebuilds: number }, settings: SkirmishSettings): void {
  const el = document.createElement('div');
  const win = outcome === 'victory';
  el.style.cssText =
    'position:fixed;left:50%;top:34%;transform:translate(-50%,-50%);z-index:60;padding:26px 48px;text-align:center;' +
    'font:15px ui-monospace,Menlo,monospace;letter-spacing:.3em;color:#f0f3e8;pointer-events:none;' +
    `background:rgba(8,12,14,.88);border:2px solid ${win ? '#d2b15f' : '#d65b46'};border-radius:4px;box-shadow:0 18px 60px rgba(0,0,0,.55);`;
  const title = document.createElement('div');
  title.textContent = win ? 'VICTORY' : 'DEFEAT';
  title.style.cssText = `font-size:34px;color:${win ? '#f0d56a' : '#ff6a54'}`;
  const summary = document.createElement('div');
  summary.textContent = `enemy commander launched ${aiStats.attacksLaunched} assaults · rebuilt ${aiStats.rebuilds} structures`;
  summary.style.cssText = 'margin-top:10px;font-size:11px;letter-spacing:.14em;color:#aebbc4';
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;justify-content:center;gap:10px;margin-top:18px;pointer-events:auto;';
  const again = outcomeButton('PLAY AGAIN', () => reloadWithSettings({ ...settings, seed: randomSeed() }, true));
  const setup = outcomeButton('SETUP', () => reloadWithSettings(settings, false));
  actions.append(again, setup);
  el.append(title, summary, actions);
  document.body.appendChild(el);
}

function outcomeButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.tabIndex = -1;
  button.textContent = label;
  button.style.cssText =
    'height:36px;padding:0 14px;border:1px solid #d2b15f;border-radius:2px;background:linear-gradient(180deg,#d2b15f,#856c32);' +
    'color:#121513;font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.12em;cursor:pointer;';
  button.onpointerdown = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    button.blur();
    action();
  };
  return button;
}

function spawnStartingInfantry(
  sim: ReturnType<typeof createGameSim>,
  _hf: ReturnType<typeof generateHeightfield>,
  baseX: number,
  baseZ: number,
  team: number,
) {
  const plan = [
    { kind: 'infantry' as const, x: -10, z: 16 },
    { kind: 'infantry' as const, x: -6, z: 22 },
    { kind: 'infantry' as const, x: 0, z: 18 },
    { kind: 'infantry' as const, x: 6, z: 24 },
    { kind: 'rocket-infantry' as const, x: 12, z: 16 },
  ];
  const spawned = [];
  for (const item of plan) {
    const mirror = team === 2 ? -1 : 1;
    const cell = sim.nav.nearestWalkableCell(baseX + item.x * mirror, baseZ + item.z * mirror, 18);
    if (!cell) continue;
    const p = sim.nav.cellCenter(cell.x, cell.y);
    spawned.push(spawnInfantryAt(sim, p.x, p.z, team, item.kind));
  }
  return spawned;
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

async function start(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const settings = initialSettings(params);
  const hasUrlParams = params.toString().length > 0;
  const autostart = window.sessionStorage.getItem(AUTOSTART_STORAGE_KEY) === '1';
  window.sessionStorage.removeItem(AUTOSTART_STORAGE_KEY);
  if (hasUrlParams || autostart) {
    saveSkirmishSettings(settings);
    await boot(settings);
    return;
  }
  const chosen = await showSetupScreen(settings);
  await boot(chosen);
}

// Surface boot failures on screen instead of hanging silently on the loading overlay.
void start().catch((err) => {
  console.error('[iron-dominion] failed to start', err);
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;z-index:300;display:flex;flex-direction:column;gap:12px;padding:32px;overflow:auto;' +
    'background:#140708;color:#ffb3a0;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;';
  el.innerHTML =
    '<div style="font-size:20px;color:#ff6a54;letter-spacing:.14em">IRON DOMINION — failed to start</div>' +
    '<div style="color:#cfd8e3">Reload to try a new map, or report this:</div>';
  const pre = document.createElement('div');
  pre.textContent = String((err as Error)?.stack ?? err);
  el.appendChild(pre);
  document.body.appendChild(el);
});
