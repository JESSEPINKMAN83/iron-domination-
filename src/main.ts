import { Color, Fog, MeshStandardMaterial } from 'three';
import { EnemyCommander } from './ai/commander';
import { AudioDirector } from './audio/audioDirector';
import { DEFAULT_MAP_ID, MAP_IDS, MAP_PRESETS, mapConfig, sanitizeMapId, type MapId } from './content/maps';
import type { StructureKind } from './content/phase3';
import { AI_DIFFICULTY, type Difficulty, type Personality } from './content/phase6';
import { COMBAT_MODE_DESCRIPTIONS, COMBAT_MODES, type CombatMode } from './content/rules';
import { startPosition } from './content/startPositions';
import { Input } from './engine/input';
import { GameLoop, NetworkTickDriver, SIM_HZ } from './engine/loop';
import { advanceTick } from './match/advanceTick';
import { shouldAutostartFromUrl } from './match/startup';
import { FirstPersonController } from './modes/firstPersonController';
import { RtsCameraRig } from './modes/rtsCamera';
import { RtsController } from './modes/rtsController';
import { LockstepRuntime } from './net/commands';
import { MultiplayerClient, normalizeRoomCode, normalizedBaseUrl, type MultiplayerEvent, type MultiplayerRoom, type MultiplayerSession } from './net/multiplayer';
import { AssetPipeline } from './render/assets';
import { BuildingView } from './render/buildingView';
import { CombatView } from './render/combatView';
import { EconomyFxView } from './render/economyFxView';
import { FogView } from './render/fogView';
import { InstancedMeshRegistry } from './render/instancing';
import { OrderMarkerView } from './render/orderMarkerView';
import { RenderContext } from './render/renderer';
import { buildScatter } from './render/scatter';
import { TerrainView } from './render/terrainMesh';
import { UnitView } from './render/unitView';
import { WaterView } from './render/water';
import { SnowfallView } from './render/weather';
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
import { generateHeightfield } from './sim/heightfield';
import { restoreEconomyState, restoreSerializedSim, serializeMatchState, type SerializedMatchState } from './sim/serialize';
import { VisibilityGrid } from './sim/visibility';
import {
  createGameSim,
  areTeamsHostile,
  selectedEntities,
  setSelected,
  spawnHammerheadAt,
  spawnScoutTankAt,
  spawnSiegeTankAt,
  spawnTankAt,
  spawnVultureAt,
  spawnWaspAt,
} from './sim/world';
import { Hud } from './ui/hud';
import { SelectionBar } from './ui/selectionBar';
import { Sidebar } from './ui/sidebar';

const nextFrame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve));
const SKIRMISH_STORAGE_KEY = 'iron-dominion.skirmish.v1';
const AUTOSTART_STORAGE_KEY = 'iron-dominion.autostart.v1';
const SAVE_STORAGE_KEY = 'iron-dominion.save.v1';
const LOAD_SAVE_STORAGE_KEY = 'iron-dominion.load-save.v1';
const MULTIPLAYER_SERVER_STORAGE_KEY = 'iron-dominion.multiplayer.server.v1';
const MULTIPLAYER_PLAYER_STORAGE_KEY = 'iron-dominion.multiplayer.players.v1';

interface SkirmishSettings {
  mapId: MapId;
  seed: number;
  ai: Difficulty;
  aiStyle: Personality;
  debug: boolean;
  combatMode: CombatMode;
  armyCount: ArmyCount;
  armySides: ArmySides;
}

type ArmyCount = 2 | 3 | 4;
type ArmySides = [number, number, number, number];

interface ArmyRuntime {
  team: number;
  side: number;
  economy: ReturnType<typeof createEconomy>;
  base: ReturnType<typeof createInitialBase>;
  vision: VisibilityGrid;
  commander?: EnemyCommander;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
const PERSONALITIES: Personality[] = ['turtle', 'rusher', 'balanced'];
const DIFFICULTY_DESCRIPTIONS: Record<Difficulty, string> = {
  easy: 'Slower reactions, weaker economy, delayed first attack, and less accurate combat. Good for learning and V-mode fights.',
  normal: 'Baseline public match pacing. Honest income, fair reactions, pressure after the opening.',
  hard: 'Faster reactions, stronger economy, earlier attacks. Built for stress-testing defenses.',
};
const PERSONALITY_DESCRIPTIONS: Record<Personality, string> = {
  turtle: 'Builds up, defends longer, then sends heavier pressure.',
  rusher: 'Cuts economy corners and attacks early with smaller squads.',
  balanced: 'Mixes economy, tech, and attacks for the default skirmish rhythm.',
};
const MAP_DESCRIPTIONS: Record<MapId, string> = Object.fromEntries(
  MAP_IDS.map((id) => [id, MAP_PRESETS[id].description]),
) as Record<MapId, string>;

function mapChoiceLabel(id: MapId): string {
  return MAP_PRESETS[id].shortLabel;
}

interface MatchSnapshot {
  elapsedSeconds: number;
  playerCredits: number;
  playerBuildings: number;
  enemyBuildings: number;
  playerUnits: number;
  enemyUnits: number;
  playerCollectors: number;
  enemyCollectors: number;
}

interface StoredMatchSave {
  savedAt: number;
  settings: SkirmishSettings;
  state: SerializedMatchState;
}

let pendingMultiplayer: { client: MultiplayerClient; session: MultiplayerSession } | undefined;

function randomSeed(): number {
  return Math.floor(100000 + Math.random() * 900000000);
}

function defaultArmySides(): ArmySides {
  return [1, 2, 3, 4];
}

function sanitizeArmyCount(value: unknown): ArmyCount | undefined {
  const count = Math.floor(Number(value));
  if (count === 2 || count === 3 || count === 4) return count;
  return undefined;
}

function sanitizeArmySides(value: unknown): ArmySides | undefined {
  const raw = Array.isArray(value) ? value : [];
  if (raw.length === 0) return undefined;
  return [0, 1, 2, 3].map((index) => {
    const side = Math.floor(Number(raw[index]));
    return Number.isFinite(side) ? Math.max(1, Math.min(4, side)) : index + 1;
  }) as ArmySides;
}

function activeTeams(settings: Pick<SkirmishSettings, 'armyCount'>): number[] {
  return Array.from({ length: settings.armyCount }, (_, index) => index + 1);
}

function loadStoredSettings(): Partial<SkirmishSettings> {
  try {
    const raw = window.localStorage.getItem(SKIRMISH_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<SkirmishSettings>;
    return {
      mapId: sanitizeMapId(parsed.mapId),
      seed: Number.isFinite(parsed.seed) ? Math.floor(Number(parsed.seed)) : undefined,
      ai: DIFFICULTIES.includes(parsed.ai as Difficulty) ? parsed.ai : undefined,
      aiStyle: PERSONALITIES.includes(parsed.aiStyle as Personality) ? parsed.aiStyle : undefined,
      debug: parsed.debug === true,
      combatMode: COMBAT_MODES.includes(parsed.combatMode as CombatMode) ? parsed.combatMode : undefined,
      armyCount: sanitizeArmyCount(parsed.armyCount),
      armySides: sanitizeArmySides(parsed.armySides),
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
  const mapId = sanitizeMapId(params.get('map'));
  const ai = params.get('ai');
  const aiStyle = params.get('ai-style');
  const combat = params.get('combat');
  const armyCount = sanitizeArmyCount(params.get('armies'));
  const sides = params.get('sides');
  return {
    mapId,
    seed: Number.isFinite(seed) && seed > 0 ? Math.floor(seed) : undefined,
    ai: DIFFICULTIES.includes(ai as Difficulty) ? (ai as Difficulty) : undefined,
    aiStyle: PERSONALITIES.includes(aiStyle as Personality) ? (aiStyle as Personality) : undefined,
    debug: params.get('debug') === 'armies' ? true : undefined,
    combatMode: COMBAT_MODES.includes(combat as CombatMode) ? (combat as CombatMode) : undefined,
    armyCount,
    armySides: sides ? sanitizeArmySides(sides.split(',')) : undefined,
  };
}

function initialSettings(params: URLSearchParams): SkirmishSettings {
  const stored = loadStoredSettings();
  const fromUrl = settingsFromUrl(params);
  return {
    mapId: fromUrl.mapId ?? stored.mapId ?? DEFAULT_MAP_ID,
    seed: fromUrl.seed ?? stored.seed ?? randomSeed(),
    ai: fromUrl.ai ?? stored.ai ?? 'normal',
    aiStyle: fromUrl.aiStyle ?? stored.aiStyle ?? 'balanced',
    debug: fromUrl.debug ?? stored.debug ?? false,
    combatMode: fromUrl.combatMode ?? stored.combatMode ?? 'assisted',
    armyCount: fromUrl.armyCount ?? stored.armyCount ?? 2,
    armySides: fromUrl.armySides ?? stored.armySides ?? defaultArmySides(),
  };
}

function reloadWithSettings(settings: SkirmishSettings, autostart: boolean): void {
  saveSkirmishSettings(settings);
  if (autostart) window.sessionStorage.setItem(AUTOSTART_STORAGE_KEY, '1');
  else window.sessionStorage.removeItem(AUTOSTART_STORAGE_KEY);
  window.location.reload();
}

function readStoredMatchSave(): StoredMatchSave | undefined {
  try {
    const raw = window.localStorage.getItem(SAVE_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as StoredMatchSave;
    if (!parsed?.state || !parsed.settings) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function requestLoadStoredMatch(): boolean {
  const save = readStoredMatchSave();
  if (!save) return false;
  saveSkirmishSettings(save.settings);
  window.sessionStorage.setItem(AUTOSTART_STORAGE_KEY, '1');
  window.sessionStorage.setItem(LOAD_SAVE_STORAGE_KEY, '1');
  window.location.reload();
  return true;
}

function consumeLoadStoredMatch(): StoredMatchSave | undefined {
  if (window.sessionStorage.getItem(LOAD_SAVE_STORAGE_KEY) !== '1') return undefined;
  window.sessionStorage.removeItem(LOAD_SAVE_STORAGE_KEY);
  return readStoredMatchSave();
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
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:14px;box-sizing:border-box;background:#0a0d10;color:#cfd8e3;' +
      'font:13px ui-monospace,Menlo,monospace;z-index:120;letter-spacing:.08em;';
    const panel = document.createElement('div');
    panel.style.cssText =
      'width:min(1120px,calc(100vw - 28px));max-height:calc(100vh - 28px);display:grid;grid-template-rows:auto minmax(0,1fr);gap:16px;' +
      'box-sizing:border-box;padding:22px 24px;background:linear-gradient(180deg,#151b1d,#070909);border:2px solid #596260;border-radius:4px;overflow:auto;overflow-x:hidden;' +
      'box-shadow:inset 0 0 0 1px rgba(210,177,95,.22),0 22px 80px rgba(0,0,0,.62);';

    const title = document.createElement('div');
    title.innerHTML =
      '<div style="font-size:30px;color:#f0d56a;letter-spacing:.22em;line-height:1">IRON DOMINION</div>' +
      '<div style="margin-top:7px;color:#aebbc4;letter-spacing:.14em">public playtest skirmish</div>' +
      '<div style="margin-top:4px;color:#6f7b78;font-size:11px;letter-spacing:.12em">Build a base, harvest oil, and break the enemy command yard</div>';

    const layout = document.createElement('div');
    layout.style.cssText =
      'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:16px;align-items:start;min-width:0;min-height:0;';
    const leftColumn = document.createElement('div');
    leftColumn.style.cssText = 'display:grid;gap:12px;align-content:start;min-width:0;';
    const rightColumn = document.createElement('div');
    rightColumn.style.cssText =
      'display:grid;gap:12px;min-width:0;min-height:0;';

    const form = document.createElement('div');
    form.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;';
    const difficulty = createSegmentedControl('Difficulty', DIFFICULTIES, defaults.ai, DIFFICULTY_DESCRIPTIONS);
    const commander = createSegmentedControl('Enemy commander', PERSONALITIES, defaults.aiStyle, PERSONALITY_DESCRIPTIONS);
    const combatMode = createSegmentedControl('Combat mode', COMBAT_MODES, defaults.combatMode, COMBAT_MODE_DESCRIPTIONS);
    combatMode.root.style.gridColumn = '1 / -1';
    const armies = createArmySetupControl(defaults.armyCount, defaults.armySides);
    armies.root.style.gridColumn = '1 / -1';
    form.append(difficulty.root, commander.root, combatMode.root, armies.root);

    const mapChoice = createSegmentedControl('Map', MAP_IDS, defaults.mapId, MAP_DESCRIPTIONS, mapChoiceLabel);
    mapChoice.root.style.padding = '11px';
    mapChoice.root.style.border = '1px solid #303936';
    mapChoice.root.style.background = 'rgba(9,13,13,.7)';

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
      'width:100%;min-width:0;box-sizing:border-box;height:38px;background:#090d0d;color:#f0f3e8;border:1px solid #46504d;padding:0 10px;font:16px ui-monospace,Menlo,monospace;letter-spacing:.08em;';
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
    caption.textContent = 'Same seed, same terrain. Share the seed or match link to replay the same battlefield.';

    let multiplayerClient: MultiplayerClient | undefined;
    let multiplayerSession: MultiplayerSession | undefined;
    let multiplayerStarted = false;
    let startButton: HTMLButtonElement | undefined;
    const currentSettings = (): SkirmishSettings => {
      const seed = Math.max(1, Math.floor(Number(seedInput.value) || randomSeed()));
      return {
        mapId: mapChoice.value(),
        seed,
        ai: difficulty.value(),
        aiStyle: commander.value(),
        debug: defaults.debug,
        combatMode: combatMode.value(),
        armyCount: armies.armyCount(),
        armySides: armies.armySides(),
      };
    };
    const setMultiplayerLaunchOnly = (): void => {
      if (!startButton) return;
      startButton.disabled = true;
      startButton.textContent = 'WAITING FOR BOTH PLAYERS';
      startButton.style.opacity = '.48';
      startButton.style.cursor = 'not-allowed';
    };
    const applyRoomSettings = (room: MultiplayerRoom, playerIndex: number): void => {
      difficulty.setValue(room.ai);
      commander.setValue(room.aiStyle);
      combatMode.setValue(room.combatMode ?? 'assisted');
      mapChoice.setValue(sanitizeMapId(room.mapId) ?? DEFAULT_MAP_ID);
      seedInput.value = String(room.seed);
      armies.setState(2, sanitizeArmySides(room.armySides) ?? defaultArmySides());
      const guestLocked = playerIndex !== 1;
      difficulty.setDisabled(guestLocked);
      commander.setDisabled(guestLocked);
      combatMode.setDisabled(guestLocked);
      mapChoice.setDisabled(guestLocked);
      armies.setDisabled(guestLocked);
      seedInput.disabled = guestLocked;
      randomize.disabled = guestLocked;
      randomize.style.opacity = guestLocked ? '.45' : '1';
      caption.textContent = guestLocked
        ? 'Match settings are controlled by the host and synchronized for both players.'
        : 'Your map, seed, and rules are synchronized to the guest before the match starts.';
    };
    const beginWithSettings = (settings: SkirmishSettings, fromMultiplayerRoom = false): void => {
      if (multiplayerStarted) return;
      if (multiplayerSession && !fromMultiplayerRoom) return;
      multiplayerStarted = true;
      saveSkirmishSettings(settings);
      if (multiplayerClient && multiplayerSession) pendingMultiplayer = { client: multiplayerClient, session: multiplayerSession };
      else multiplayerClient?.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      el.remove();
      resolve(settings);
    };
    const multiplayer = createMultiplayerSetupPanel(
      () => currentSettings(),
      (settings) => beginWithSettings(settings, true),
      (client, session) => {
        multiplayerClient = client;
        multiplayerSession = session;
        setMultiplayerLaunchOnly();
      },
      () => multiplayerSession,
      applyRoomSettings,
    );

    const controls = document.createElement('div');
    controls.style.cssText =
      'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:12px;border:1px solid #303936;background:#0f1414;color:#aebbc4;font-size:10px;line-height:1.35;';
    for (const text of ['Select: click/drag', 'Orders: right-click', 'Build: sidebar', 'V-mode: select + V', 'Fly: W/S A/D Q/E']) {
      const item = document.createElement('div');
      item.textContent = text;
      controls.appendChild(item);
    }

    const start = document.createElement('button');
    startButton = start;
    start.type = 'button';
    start.textContent = 'START SKIRMISH';
    start.style.cssText =
      'height:60px;border:1px solid #d2b15f;background:linear-gradient(180deg,#d2b15f,#856c32);color:#121513;' +
      'font:700 18px ui-monospace,Menlo,monospace;letter-spacing:.22em;cursor:pointer;box-shadow:0 8px 26px rgba(0,0,0,.45);position:sticky;bottom:0;';

    const begin = (): void => {
      beginWithSettings(currentSettings());
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Enter') begin();
    };
    start.onclick = begin;
    if (multiplayerSession) setMultiplayerLaunchOnly();
    window.addEventListener('keydown', onKeyDown);

    leftColumn.append(form);
    rightColumn.append(mapChoice.root, seedRow, caption, multiplayer, controls, start);
    layout.append(leftColumn, rightColumn);
    panel.append(title, layout);
    el.appendChild(panel);
    document.body.appendChild(el);
  });
}

function createSegmentedControl<T extends string>(
  label: string,
  values: T[],
  initial: T,
  descriptions: Record<T, string>,
  format: (value: T) => string = (value) => value.toUpperCase(),
): { root: HTMLDivElement; value: () => T; setValue: (value: T) => void; setDisabled: (disabled: boolean) => void } {
  let current = initial;
  let disabled = false;
  const root = document.createElement('div');
  root.style.cssText = 'display:grid;gap:7px;min-width:0;';
  const title = document.createElement('div');
  title.textContent = label.toUpperCase();
  title.style.cssText = 'color:#d2b15f;';
  const buttons = document.createElement('div');
  buttons.style.cssText = `display:grid;grid-template-columns:repeat(${values.length},minmax(0,1fr));gap:5px;min-width:0;`;
  const description = document.createElement('div');
  description.style.cssText = 'min-height:42px;color:#8d9a96;font-size:10px;line-height:1.45;letter-spacing:.04em;overflow-wrap:anywhere;';
  const render = (): void => {
    for (const button of Array.from(buttons.children) as HTMLButtonElement[]) {
      const active = button.dataset.value === current;
      button.style.cssText = setupChoiceButtonCss(active);
      button.disabled = disabled;
      button.style.opacity = disabled ? '.5' : '1';
      button.style.cursor = disabled ? 'not-allowed' : 'pointer';
    }
    description.textContent = descriptions[current];
  };
  for (const value of values) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.value = value;
    button.textContent = format(value);
    button.onclick = () => {
      current = value;
      render();
      button.blur();
    };
    buttons.appendChild(button);
  }
  root.append(title, buttons, description);
  render();
  return {
    root,
    value: () => current,
    setValue: (value) => {
      if (!values.includes(value)) return;
      current = value;
      render();
    },
    setDisabled: (value) => {
      disabled = value;
      render();
    },
  };
}

function createArmySetupControl(initialCount: ArmyCount, initialSides: ArmySides): {
  root: HTMLDivElement;
  armyCount: () => ArmyCount;
  armySides: () => ArmySides;
  setState: (count: ArmyCount, sides: ArmySides) => void;
  setDisabled: (disabled: boolean) => void;
} {
  let count: ArmyCount = initialCount;
  let disabled = false;
  const sides: ArmySides = [...initialSides] as ArmySides;
  const root = document.createElement('div');
  root.style.cssText = 'display:grid;gap:9px;padding:11px;border:1px solid #303936;background:rgba(9,13,13,.7);';
  const title = document.createElement('div');
  title.style.cssText = 'display:flex;justify-content:space-between;gap:12px;align-items:baseline;color:#d2b15f;';
  title.innerHTML = '<span>ARMIES</span><span style="color:#6f7b78;font-size:10px;">same side = allies</span>';
  const countButtons = document.createElement('div');
  countButtons.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:5px;';
  const sideRows = document.createElement('div');
  sideRows.style.cssText = 'display:grid;gap:6px;';

  const render = (): void => {
    for (const button of Array.from(countButtons.children) as HTMLButtonElement[]) {
      button.style.cssText = setupChoiceButtonCss(Number(button.dataset.count) === count);
      button.disabled = disabled;
      button.style.opacity = disabled ? '.5' : '1';
      button.style.cursor = disabled ? 'not-allowed' : 'pointer';
    }
    for (const row of Array.from(sideRows.children) as HTMLElement[]) {
      const army = Number(row.dataset.army);
      row.style.display = army <= count ? 'grid' : 'none';
      for (const button of Array.from(row.querySelectorAll('button')) as HTMLButtonElement[]) {
        button.style.cssText = setupChoiceButtonCss(Number(button.dataset.side) === sides[army - 1]);
        button.disabled = disabled;
        button.style.opacity = disabled ? '.5' : '1';
        button.style.cursor = disabled ? 'not-allowed' : 'pointer';
      }
    }
  };

  for (const value of [2, 3, 4] as ArmyCount[]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.count = String(value);
    button.textContent = `${value} ARMIES`;
    button.onclick = () => {
      count = value;
      render();
      button.blur();
    };
    countButtons.appendChild(button);
  }

  for (let army = 1; army <= 4; army++) {
    const row = document.createElement('div');
    row.dataset.army = String(army);
    row.style.cssText = 'grid-template-columns:92px repeat(4,1fr);gap:5px;align-items:center;';
    const label = document.createElement('div');
    label.textContent = army === 1 ? 'ARMY 1 YOU' : `ARMY ${army} AI`;
    label.style.cssText = 'color:#aebbc4;font-size:10px;';
    row.appendChild(label);
    for (let side = 1; side <= 4; side++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.side = String(side);
      button.textContent = `SIDE ${side}`;
      button.onclick = () => {
        sides[army - 1] = side;
        render();
        button.blur();
      };
      row.appendChild(button);
    }
    sideRows.appendChild(row);
  }

  root.append(title, countButtons, sideRows);
  render();
  return {
    root,
    armyCount: () => count,
    armySides: () => [...sides] as ArmySides,
    setState: (nextCount, nextSides) => {
      count = nextCount;
      for (let index = 0; index < sides.length; index++) sides[index] = nextSides[index];
      render();
    },
    setDisabled: (value) => {
      disabled = value;
      render();
    },
  };
}

function createMultiplayerSetupPanel(
  settings: () => SkirmishSettings,
  startMatch: (settings: SkirmishSettings) => void,
  rememberSession: (client: MultiplayerClient, session: MultiplayerSession) => void,
  currentSession: () => MultiplayerSession | undefined,
  applyRoomSettings: (room: MultiplayerRoom, playerIndex: number) => void,
): HTMLDivElement {
  const root = document.createElement('div');
  root.style.cssText = 'display:grid;gap:10px;padding:12px;border:1px solid #303936;background:#0f1414;min-width:0;overflow:hidden;';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;gap:12px;align-items:baseline;';
  header.innerHTML =
    '<div style="color:#d2b15f;">MULTIPLAYER</div>' +
    '<div style="color:#6f7b78;font-size:10px;">friends-link online 1v1</div>';

  const row = document.createElement('div');
  row.style.cssText =
    'display:grid;grid-template-columns:minmax(0,1fr) minmax(92px,.28fr);gap:7px;align-items:end;min-width:0;';
  const actionRow = document.createElement('div');
  actionRow.style.cssText = 'grid-column:1 / -1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;min-width:0;';

  const serverLabel = setupTextInput('Server', storedMultiplayerServer());
  const codeLabel = setupTextInput('Room', normalizeRoomCode(new URLSearchParams(location.search).get('room') ?? ''));
  codeLabel.input.placeholder = 'ABCD';
  codeLabel.input.maxLength = 8;

  const host = document.createElement('button');
  host.type = 'button';
  host.textContent = 'HOST ROOM';
  host.style.cssText = smallSetupButtonCss();

  const join = document.createElement('button');
  join.type = 'button';
  join.textContent = 'JOIN ROOM';
  join.style.cssText = smallSetupButtonCss();

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'COPY LINK';
  copy.disabled = true;
  copy.style.cssText = smallSetupButtonCss();
  copy.style.opacity = '.45';

  const status = document.createElement('div');
  status.style.cssText = 'min-height:18px;color:#8d9a96;font-size:10px;line-height:1.4;letter-spacing:.05em;overflow-wrap:anywhere;';
  status.textContent = defaultMultiplayerServer() === 'http://127.0.0.1:8787'
    ? 'Run `npm run dev:multiplayer`, then host here and share the room code.'
    : 'Use the public relay URL below, then host here and share the room code.';

  const setBusy = (busy: boolean): void => {
    host.disabled = busy;
    join.disabled = busy;
    host.style.opacity = busy ? '.55' : '1';
    join.style.opacity = busy ? '.55' : '1';
    copy.style.opacity = copy.disabled ? '.45' : '1';
  };
  const setStatus = (message: string, bad = false): void => {
    status.textContent = message;
    status.style.color = bad ? '#ff8a72' : '#8d9a96';
  };
  let lobbyView: ReturnType<typeof createRoomLobbyView> | undefined;
  const connectSession = (client: MultiplayerClient, session: MultiplayerSession): void => {
    rememberPlayerId(client.baseUrl, session.room.code, session.player.id);
    if (session.player.index === 1) rememberPlayerId(client.baseUrl, 'HOST', session.player.id);
    rememberSession(client, session);
    applyRoomSettings(session.room, session.player.index);
    lobbyView?.root.remove();
    lobbyView = createRoomLobbyView(client, session, settings);
    root.appendChild(lobbyView.root);
    lobbyView.update(session.room, session.player.index);
    codeLabel.input.value = session.room.code;
    copy.disabled = false;
    copy.style.opacity = '1';
    renderRoomStatus(session.room, session.player.index, setStatus);
    client.connect(
      session.room.code,
      session.player.id,
      (event) => {
        if (event.type === 'room-state' || event.type === 'match-start') {
          session.room = event.room;
          const latest = event.room.players.find((player) => player.id === session.player.id);
          if (latest) session.player = latest;
          applyRoomSettings(event.room, session.player.index);
          lobbyView?.update(event.room, session.player.index);
        }
        handleMultiplayerEvent(event, session.player.index, setStatus, startMatch);
      },
      () => setStatus('Connection interrupted. Check the multiplayer server is still running.', true),
    );
  };

  host.onclick = async () => {
    try {
      setBusy(true);
      const server = normalizedBaseUrl(serverLabel.input.value);
      window.localStorage.setItem(MULTIPLAYER_SERVER_STORAGE_KEY, server);
      const client = new MultiplayerClient(server);
      const session = await client.host({ ...settings(), name: 'Host', playerId: rememberedPlayerId(server, 'HOST') });
      connectSession(client, session);
    } catch (err) {
      setStatus(`Could not host room: ${friendlyMultiplayerError(err)}`, true);
    } finally {
      setBusy(false);
      host.blur();
    }
  };

  join.onclick = async () => {
    try {
      setBusy(true);
      const code = normalizeRoomCode(codeLabel.input.value);
      if (!code) throw new Error('enter-room-code');
      const server = normalizedBaseUrl(serverLabel.input.value);
      window.localStorage.setItem(MULTIPLAYER_SERVER_STORAGE_KEY, server);
      const existing = currentSession();
      const client = new MultiplayerClient(server);
      const session = await client.join(code, 'Guest', existing?.player.id ?? rememberedPlayerId(server, code));
      connectSession(client, session);
    } catch (err) {
      setStatus(`Could not join room: ${friendlyMultiplayerError(err)}`, true);
    } finally {
      setBusy(false);
      join.blur();
    }
  };

  copy.onclick = async () => {
    const code = normalizeRoomCode(codeLabel.input.value);
    if (!code) return;
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    await navigator.clipboard?.writeText(url.toString());
    setStatus(`Copied room link ${code}. Guest opens it and clicks JOIN ROOM; the host starts the match.`);
    copy.blur();
  };

  actionRow.append(host, join, copy);
  row.append(serverLabel.root, codeLabel.root, actionRow);
  root.append(header, row, status);
  return root;
}

function createRoomLobbyView(
  client: MultiplayerClient,
  session: MultiplayerSession,
  settings: () => SkirmishSettings,
): { root: HTMLDivElement; update: (room: MultiplayerRoom, playerIndex: number) => void } {
  const root = document.createElement('div');
  root.style.cssText =
    'position:fixed;inset:0;z-index:145;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;' +
    'background:rgba(5,8,9,.94);backdrop-filter:blur(10px);';
  const panel = document.createElement('div');
  panel.style.cssText =
    'width:min(760px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:24px;box-sizing:border-box;' +
    'display:grid;gap:18px;background:linear-gradient(180deg,#151b1d,#080b0b);border:2px solid #596260;' +
    'box-shadow:inset 0 0 0 1px rgba(210,177,95,.2),0 28px 90px rgba(0,0,0,.7);';

  const heading = document.createElement('div');
  heading.style.cssText = 'display:flex;justify-content:space-between;gap:16px;align-items:flex-start;';
  const title = document.createElement('div');
  title.style.cssText = 'color:#f0d56a;font-size:24px;letter-spacing:.16em;';
  const role = document.createElement('div');
  role.style.cssText = 'padding:6px 9px;border:1px solid #596260;color:#aebbc4;font-size:10px;letter-spacing:.12em;';
  heading.append(title, role);

  const summary = document.createElement('div');
  summary.style.cssText =
    'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;border:1px solid #303936;background:#303936;';
  const players = document.createElement('div');
  players.style.cssText = 'display:grid;gap:8px;';
  const status = document.createElement('div');
  status.style.cssText = 'min-height:18px;text-align:center;color:#aebbc4;font-size:11px;letter-spacing:.08em;';

  const actions = document.createElement('div');
  actions.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.7fr);gap:10px;';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'COPY ROOM LINK';
  copy.style.cssText = smallSetupButtonCss();
  copy.onclick = async () => {
    const url = new URL(location.href);
    url.searchParams.set('room', session.room.code);
    await navigator.clipboard?.writeText(url.toString());
    status.textContent = `Room link copied · ${session.room.code}`;
    copy.blur();
  };
  const launch = document.createElement('button');
  launch.type = 'button';
  launch.style.cssText =
    'height:54px;border:1px solid #d2b15f;background:linear-gradient(180deg,#d2b15f,#856c32);color:#121513;' +
    'font:700 15px ui-monospace,Menlo,monospace;letter-spacing:.15em;cursor:pointer;';
  launch.onclick = () => {
    if (session.player.index !== 1) return;
    client.updateSettings(session.room.code, session.player.id, settings());
    client.startMatch(session.room.code, session.player.id);
    launch.disabled = true;
    launch.textContent = 'STARTING MATCH...';
    launch.style.opacity = '.55';
  };
  actions.append(copy, launch);
  panel.append(heading, summary, players, status, actions);
  root.appendChild(panel);

  const update = (room: MultiplayerRoom, playerIndex: number): void => {
    session.room = room;
    title.textContent = `ROOM ${room.code}`;
    role.textContent = playerIndex === 1 ? 'HOST COMMANDER' : 'JOINED COMMANDER';
    const map = MAP_PRESETS[sanitizeMapId(room.mapId) ?? DEFAULT_MAP_ID];
    const values = [
      ['MAP', map.label],
      ['SEED', String(room.seed)],
      ['COMBAT', room.combatMode === 'manual' ? 'MANUAL' : 'ASSISTED'],
    ];
    summary.replaceChildren(...values.map(([label, value]) => {
      const item = document.createElement('div');
      item.style.cssText = 'padding:13px;background:#0f1414;display:grid;gap:5px;min-width:0;';
      const key = document.createElement('div');
      key.textContent = label;
      key.style.cssText = 'color:#6f7b78;font-size:9px;letter-spacing:.12em;';
      const text = document.createElement('div');
      text.textContent = value;
      text.style.cssText = 'color:#f0d56a;font-size:12px;overflow-wrap:anywhere;';
      item.append(key, text);
      return item;
    }));
    const playerSlots = [1, 2].map((index) => {
      const player = room.players.find((candidate) => candidate.index === index);
      const row = document.createElement('div');
      row.style.cssText =
        'display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:12px;align-items:center;padding:13px 14px;' +
        'border:1px solid #303936;background:#0f1414;';
      const number = document.createElement('div');
      number.textContent = `P${index}`;
      number.style.cssText = `color:${index === 1 ? '#7df27d' : '#ff8a72'};font-size:12px;`;
      const name = document.createElement('div');
      name.textContent = player?.name ?? (index === 1 ? 'Host slot' : 'Waiting for player...');
      name.style.cssText = 'color:#dce8df;';
      const connection = document.createElement('div');
      connection.textContent = player?.connected ? `${player.pingMs ?? '...'} ms · CONNECTED` : 'OPEN SLOT';
      connection.style.cssText = `color:${player?.connected ? '#7df27d' : '#6f7b78'};font-size:10px;`;
      row.append(number, name, connection);
      return row;
    });
    players.replaceChildren(...playerSlots);
    const connected = room.players.filter((player) => player.connected).length;
    const engines = new Set(room.players.map((player) => player.engine).filter(Boolean));
    if (room.status === 'starting') status.textContent = 'Host launched the match · synchronizing both players...';
    else if (engines.size > 1) status.textContent = 'Different browsers detected · matching browser engines are recommended.';
    else if (connected < 2) status.textContent = playerIndex === 1 ? 'Waiting for another commander to join...' : 'Connected · waiting for the host.';
    else status.textContent = playerIndex === 1 ? 'Opponent connected · you can start the match.' : 'Both players connected · waiting for the host to start.';
    const canLaunch = playerIndex === 1 && connected === 2 && room.status === 'waiting';
    launch.disabled = !canLaunch;
    launch.textContent = playerIndex === 1
      ? room.status === 'starting' ? 'STARTING MATCH...' : connected === 2 ? 'START MATCH' : 'WAITING FOR PLAYER'
      : 'WAITING FOR HOST';
    launch.style.opacity = canLaunch ? '1' : '.45';
    launch.style.cursor = canLaunch ? 'pointer' : 'not-allowed';
  };

  return { root, update };
}

function handleMultiplayerEvent(
  event: MultiplayerEvent,
  playerIndex: number,
  setStatus: (message: string, bad?: boolean) => void,
  startMatch: (settings: SkirmishSettings) => void,
): void {
  if (event.type === 'room-state') {
    renderRoomStatus(event.room, playerIndex, setStatus);
    if (event.room.status === 'in-game') startMatch(settingsFromRoom(event.room));
  } else if (event.type === 'match-start') {
    renderRoomStatus(event.room, playerIndex, setStatus);
    startMatch(settingsFromRoom(event.room));
  } else if (event.type === 'room-closed') {
    setStatus(`Room closed: ${event.reason}`, true);
  }
}

function renderRoomStatus(room: MultiplayerRoom, playerIndex: number, setStatus: (message: string, bad?: boolean) => void): void {
  const connected = room.players.filter((player) => player.connected).length;
  const team = `army ${playerIndex} / side ${room.armySides[playerIndex - 1] ?? playerIndex}`;
  const map = MAP_PRESETS[sanitizeMapId(room.mapId) ?? DEFAULT_MAP_ID].shortLabel;
  const countdown =
    room.status === 'starting' && room.startsAt ? `starting in ${Math.max(1, Math.ceil((room.startsAt - Date.now()) / 1000))}s` : undefined;
  const waiting = countdown ?? (connected < 2 ? 'waiting for commander' : room.status === 'waiting' ? playerIndex === 1 ? 'host can launch' : 'waiting for host' : room.status);
  const combat = room.combatMode === 'manual' ? 'manual combat' : 'assisted combat';
  const pings = room.players.map((player) => player.pingMs).filter((ping): ping is number => Number.isFinite(ping));
  const ping = pings.length ? `${Math.max(...pings)}ms` : 'measuring ping';
  const engines = new Set(room.players.map((player) => player.engine).filter(Boolean));
  const engineWarning = engines.size > 1 ? ' · different browsers — desync likely, best played on the same browser' : '';
  setStatus(
    `Room ${room.code} · ${map} · you are ${team} · ${connected}/2 connected · ${combat} · ${waiting} · ping ${ping} · delay ${room.inputDelay ?? 8}t${engineWarning}`,
    engines.size > 1,
  );
}

function settingsFromRoom(room: MultiplayerRoom): SkirmishSettings {
  return {
    mapId: sanitizeMapId(room.mapId) ?? DEFAULT_MAP_ID,
    seed: room.seed,
    ai: room.ai,
    aiStyle: room.aiStyle,
    debug: false,
    combatMode: room.combatMode ?? 'assisted',
    armyCount: sanitizeArmyCount(room.armyCount) ?? 2,
    armySides: sanitizeArmySides(room.armySides) ?? defaultArmySides(),
  };
}

function storedMultiplayerServer(): string {
  const fallback = defaultMultiplayerServer();
  const stored = window.localStorage.getItem(MULTIPLAYER_SERVER_STORAGE_KEY);
  if (!stored) return fallback;
  if (isPublicHost(window.location.hostname) && isLoopbackServer(stored)) {
    window.localStorage.removeItem(MULTIPLAYER_SERVER_STORAGE_KEY);
    return fallback;
  }
  return stored;
}

function defaultMultiplayerServer(): string {
  return normalizedBaseUrl(import.meta.env.VITE_MULTIPLAYER_SERVER_URL ?? 'http://127.0.0.1:8787');
}

function isPublicHost(hostname: string): boolean {
  return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]';
}

function isLoopbackServer(server: string): boolean {
  try {
    const hostname = new URL(normalizedBaseUrl(server)).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function playerStorageKey(server: string, roomCode: string): string {
  return `${normalizedBaseUrl(server)}:${normalizeRoomCode(roomCode)}`;
}

function rememberedPlayerId(server: string, roomCode: string): string | undefined {
  const storage = normalizeRoomCode(roomCode) === 'HOST' ? window.localStorage : window.sessionStorage;
  const stored = storage.getItem(MULTIPLAYER_PLAYER_STORAGE_KEY);
  if (!stored) return undefined;
  try {
    const map = JSON.parse(stored) as Record<string, string>;
    return map[playerStorageKey(server, roomCode)];
  } catch {
    return undefined;
  }
}

function rememberPlayerId(server: string, roomCode: string, playerId: string): void {
  const storage = normalizeRoomCode(roomCode) === 'HOST' ? window.localStorage : window.sessionStorage;
  const stored = storage.getItem(MULTIPLAYER_PLAYER_STORAGE_KEY);
  let map: Record<string, string> = {};
  if (stored) {
    try {
      map = JSON.parse(stored) as Record<string, string>;
    } catch {
      map = {};
    }
  }
  map[playerStorageKey(server, roomCode)] = playerId;
  if (Object.keys(map).length > 24) map = Object.fromEntries(Object.entries(map).slice(-24));
  storage.setItem(MULTIPLAYER_PLAYER_STORAGE_KEY, JSON.stringify(map));
}

function friendlyMultiplayerError(err: unknown): string {
  const message = String((err as Error).message ?? err);
  if (message === 'Failed to fetch') return 'server unreachable. Check the relay URL and that the Node server is awake.';
  if (message === 'room-not-found') return 'room not found or expired. Ask the host for a fresh code.';
  if (message === 'room-full') return 'room is full. Start a new room for another match.';
  if (message === 'enter-room-code') return 'enter a room code first.';
  if (message === 'unknown-player') return 'player session expired. Join the room again.';
  if (message === 'origin-not-allowed') return 'relay rejected this site origin. Add the Netlify URL to ALLOWED_ORIGINS.';
  return message;
}

function setupTextInput(label: string, value: string): { root: HTMLLabelElement; input: HTMLInputElement } {
  const root = document.createElement('label');
  root.style.cssText = 'display:grid;gap:5px;color:#d2b15f;text-transform:uppercase;font-size:10px;min-width:0;';
  const input = document.createElement('input');
  input.value = value;
  input.style.cssText =
    'width:100%;min-width:0;box-sizing:border-box;height:38px;background:#090d0d;color:#f0f3e8;border:1px solid #46504d;padding:0 9px;font:12px ui-monospace,Menlo,monospace;letter-spacing:.04em;';
  root.append(label, input);
  return { root, input };
}

function setupChoiceButtonCss(active: boolean): string {
  return (
    'min-width:0;height:38px;border-radius:2px;border:1px solid #4b5552;font:11px ui-monospace,Menlo,monospace;letter-spacing:.05em;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
    `background:${active ? 'linear-gradient(180deg,#d2b15f,#8b7339)' : 'linear-gradient(180deg,#26302f,#111615)'};` +
    `color:${active ? '#141614' : '#d7e0e7'};`
  );
}

function smallSetupButtonCss(): string {
  return (
    'width:100%;min-width:0;height:40px;border-radius:2px;border:1px solid #4b5552;font:11px ui-monospace,Menlo,monospace;letter-spacing:.04em;padding:0 7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
    'background:linear-gradient(180deg,#26302f,#111615);color:#d7e0e7;cursor:pointer;'
  );
}

function applyMapAtmosphere(ctx: RenderContext, preset: (typeof MAP_PRESETS)[MapId]): void {
  const sky = new Color(preset.atmosphere.sky);
  ctx.scene.background = sky;
  if (ctx.scene.fog instanceof Fog) {
    ctx.scene.fog.color.copy(sky);
    ctx.scene.fog.near = preset.atmosphere.fogNear;
    ctx.scene.fog.far = preset.atmosphere.fogFar;
  }
  ctx.hemisphere.color.setHex(preset.atmosphere.hemisphereSky);
  ctx.hemisphere.groundColor.setHex(preset.atmosphere.hemisphereGround);
  ctx.hemisphere.intensity = preset.atmosphere.hemisphereIntensity;
}

async function boot(settings: SkirmishSettings): Promise<void> {
  const multiplayer = pendingMultiplayer;
  pendingMultiplayer = undefined;
  const multiplayerMode = multiplayer !== undefined;
  if (multiplayer) settings = settingsFromRoom(multiplayer.session.room);
  const localTeam = multiplayer?.session.player.index ?? 1;
  const app = document.getElementById('app');
  if (!app) throw new Error('#app missing');
  const overlay = showLoadingOverlay();
  await nextFrame();
  await nextFrame();

  const t0 = performance.now();
  const selectedMap = MAP_PRESETS[settings.mapId] ?? MAP_PRESETS[DEFAULT_MAP_ID];
  const hf = generateHeightfield({ ...mapConfig(settings.mapId), seed: settings.seed });
  console.info(`[map] ${selectedMap.label} · seed ${settings.seed} · ${hf.cells}×${hf.cells} cells generated in ${(performance.now() - t0).toFixed(0)} ms`);

  const ctx = new RenderContext(app);
  applyMapAtmosphere(ctx, selectedMap);
  const input = new Input();
  input.attach(ctx.renderer.domElement);

  // GLB/KTX2/Draco pipeline — no models yet, but wired for the content phases.
  const assets = new AssetPipeline(ctx.renderer);
  void assets;

  const terrain = new TerrainView(hf, ctx.csm, ctx.maxAnisotropy);
  ctx.scene.add(terrain.group);

  const water = new WaterView(hf, ctx.sunDirection, ctx.scene.fog as Fog, {
    deepColor: selectedMap.atmosphere.waterDeep,
    shallowColor: selectedMap.atmosphere.waterShallow,
  });
  ctx.scene.add(water.mesh);

  const registry = new InstancedMeshRegistry();
  const scatterMaterial = ctx.setupLitMaterial(
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true }),
  );
  const scatter = buildScatter(hf, registry, scatterMaterial, settings.seed ^ 0x5eed);
  ctx.scene.add(scatter.group);
  const snowfall = settings.mapId === 'frostbite-pass' ? new SnowfallView(hf, settings.seed) : undefined;
  if (snowfall) ctx.scene.add(snowfall.points);

  const params = new URLSearchParams(location.search);
  const startMode = params.get('start');
  const lineupStart = startMode === 'lineup';
  const testStart = startMode === 'test' || startMode === 'sandbox';
  const debugArmies = startMode === 'armies' || startMode === 'debug-armies';
  const aiDifficulty: Difficulty = settings.ai;
  const aiPersonality: Personality = settings.aiStyle;
  const savedMatch = multiplayerMode ? undefined : consumeLoadStoredMatch();

  const sim = createGameSim(hf);
  sim.rules.autoCombat = settings.combatMode !== 'manual';
  sim.rules.autoDefense = settings.combatMode !== 'manual';
  const teams = activeTeams(settings);
  sim.rules.allianceSides = Object.fromEntries(teams.map((team) => [team, settings.armySides[team - 1] ?? team]));
  const armies: ArmyRuntime[] = teams.map((team) => {
    const isLocal = team === localTeam;
    const credits = isLocal && (testStart || lineupStart) ? 15000 : multiplayerMode ? 4600 : isLocal ? 4600 : AI_DIFFICULTY[aiDifficulty].startCredits;
    const economy = createEconomy(team, credits);
    const start = startPosition(hf.size, team);
    const base = createInitialBase(sim, hf, economy, start.x, start.z);
    const vision = new VisibilityGrid(hf, team);
    return { team, side: sim.rules.allianceSides[team] ?? team, economy, base, vision };
  });
  const localArmy = armies.find((army) => army.team === localTeam) ?? armies[0];
  const economy = localArmy.economy;
  let localBase = localArmy.base;
  const playerVision = localArmy.vision;
  let loadedFromSave = false;
  if (savedMatch) {
    try {
      restoreSerializedSim(sim, hf, savedMatch.state.sim);
      for (const state of savedMatch.state.economies) {
        const army = armies.find((candidate) => candidate.team === state.team);
        if (army) restoreEconomyState(army.economy, sim, state);
      }
      for (const army of armies) {
        const restoredBase = commandBaseForTeam(sim, army.team);
        if (restoredBase) army.base = restoredBase;
        army.vision.update(sim);
      }
      localBase = localArmy.base;
      loadedFromSave = true;
      console.info(`[save] loaded match from ${new Date(savedMatch.savedAt).toLocaleString()}`);
    } catch (err) {
      console.warn('[save] failed to load saved match', err);
    }
  }
  if (testStart && !multiplayerMode && !loadedFromSave) seedTestStartBase(sim, hf, economy, localBase);
  const isVisibleToPlayer = lineupStart ? () => true : (x: number, z: number): boolean => playerVision.isVisibleWorld(x, z);
  if (!multiplayerMode) {
    for (const army of armies) {
      if (army.team === localTeam) continue;
      const hints = armies
        .filter((candidate) => areTeamsHostile(sim, army.team, candidate.team))
        .map((candidate) => ({ x: candidate.base.transform.x, z: candidate.base.transform.z }));
      army.commander = new EnemyCommander(sim, hf, army.economy, army.vision, aiPersonality, aiDifficulty, hints);
    }
  }
  const commanders = armies.map((army) => army.commander).filter((commander): commander is EnemyCommander => !!commander);
  const matchSnapshot = (): MatchSnapshot => {
    const aliveBuildings = (team: number) => buildings(sim, team).filter((entity) => !entity.destroyed).length;
    const aliveUnits = (team: number) =>
      sim.world.entities.filter((entity) => entity.team?.id === team && !entity.destroyed && !entity.building).length;
    const aliveCollectors = (team: number) =>
      sim.world.entities.filter((entity) => entity.team?.id === team && !entity.destroyed && entity.harvester).length;
    const hostileTeams = teams.filter((team) => areTeamsHostile(sim, localTeam, team));
    const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
    return {
      elapsedSeconds: sim.tick / SIM_HZ,
      playerCredits: economy.credits,
      playerBuildings: aliveBuildings(localTeam),
      enemyBuildings: sum(hostileTeams.map(aliveBuildings)),
      playerUnits: aliveUnits(localTeam),
      enemyUnits: sum(hostileTeams.map(aliveUnits)),
      playerCollectors: aliveCollectors(localTeam),
      enemyCollectors: sum(hostileTeams.map(aliveCollectors)),
    };
  };

  const loadedUnits = loadedFromSave ? Array.from(sim.world.entities).filter((entity) => entity.selectable && !entity.building) : [];
  const lineupUnits = !loadedFromSave && lineupStart ? spawnLineupUnits(sim, hf, economy, localBase.transform.x, localBase.transform.z) : [];
  const startingUnits = lineupStart
    ? []
    : loadedFromSave
      ? loadedUnits
      : armies.flatMap((army) => [
        ...spawnStartingTanks(sim, hf, army.base.transform.x, army.base.transform.z, army.team, army.team === localTeam && debugArmies ? 120 : debugArmies ? 40 : 2),
        ...(debugArmies ? [] : spawnStartingInfantry(sim, hf, army.base.transform.x, army.base.transform.z, army.team)),
      ]);
  for (const army of armies) army.vision.update(sim);

  const unitView = new UnitView([...lineupUnits, ...startingUnits], hf, ctx, isVisibleToPlayer);
  unitView.attach(ctx.scene);
  const buildingView = new BuildingView(sim, hf, ctx, isVisibleToPlayer);
  ctx.scene.add(buildingView.group);
  const combatView = new CombatView(hf, isVisibleToPlayer);
  ctx.scene.add(combatView.group);
  const economyFx = new EconomyFxView(sim, hf, isVisibleToPlayer);
  ctx.scene.add(economyFx.group);
  const audio = new AudioDirector(ctx.camera);
  window.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
  window.addEventListener('keydown', () => audio.unlock(), { passive: true });
  const orderMarkers = new OrderMarkerView(hf);
  ctx.scene.add(orderMarkers.group);
  const fogView = new FogView(playerVision, terrain.chunkGeometries);
  ctx.scene.add(fogView.group);
  let lastFogTextureTick = -2;
  let lastResourceVisualTick = -1;
  const hud = new Hud(document.body);
  let networkPaused = false;
  const setNetworkStatus = (message: string, bad = false): void => {
    if (multiplayerMode) {
      const shouldPause =
        bad && (/interrupted/i.test(message) || /disconnected/i.test(message) || /closed/i.test(message) || /send failed/i.test(message));
      const shouldResume = !bad && (/connected/i.test(message) || /online/i.test(message));
      if (shouldPause) networkPaused = true;
      if (shouldResume) networkPaused = false;
      hud.setMultiplayerStatus(message, bad, networkPaused);
    }
    console[bad ? 'warn' : 'info'](`[mp] ${message}`);
  };
  const lockstep = multiplayer
    ? new LockstepRuntime({
        sim,
        hf,
        economies: Object.fromEntries(armies.map((army) => [army.team, army.economy])),
        client: multiplayer.client,
        session: multiplayer.session,
        onStatus: setNetworkStatus,
        onSnapshotRestored: () => {
          for (const army of armies) {
            const restoredBase = commandBaseForTeam(sim, army.team);
            if (restoredBase) army.base = restoredBase;
            army.vision.update(sim);
          }
          localBase = localArmy.base;
          unitView.syncEntities(sim.world.entities);
          fogView.refresh();
          buildingView.update(economy, ctx.camera);
        },
      })
    : undefined;
  if (multiplayerMode) setNetworkStatus(`Room ${multiplayer.session.room.code} · army ${localTeam} · online`);

  const rig = new RtsCameraRig(ctx.camera, input, hf);
  if (lineupStart) rig.jumpTo(localBase.transform.x + 26, localBase.transform.z + 12);
  else rig.jumpToOpeningView(localBase.transform.x, localBase.transform.z, localTeam);
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
        if (lockstep) {
          const kind = economy.selectedStructure;
          const placement = updatePlacement(sim, hf, kind, x, z, economy.team, economy);
          economy.placement = placement;
          if (!placement.valid) return;
          audio.playConstruction(x, z, kind === 'wall' ? 'wall' : 'structure');
          lockstep.issue({ type: 'place-structure', kind, x, z });
          return;
        }
        const placement = updatePlacement(sim, hf, economy.selectedStructure, x, z, economy.team, economy);
        const placed = placeStructure(sim, hf, economy, placement);
        if (placed) {
          audio.playConstruction(placed.transform.x, placed.transform.z, economy.selectedStructure === 'wall' ? 'wall' : 'structure');
          economy.selectedStructure = undefined;
          economy.placement = undefined;
        } else {
          audio.playUi('error');
          economy.placement = placement;
        }
      },
      cancel: () => {
        economy.selectedStructure = undefined;
        economy.placement = undefined;
        audio.playUi('cancel');
      },
    },
    buildingView,
    {
      showOrder: (x, z, kind) => {
        orderMarkers.push(x, z, kind);
        audio.playUi(kind === 'attack' ? 'build' : 'order');
      },
      showFacingOrder: (x, z, yaw, kind, length, count) => orderMarkers.pushFacing(x, z, yaw, kind, length, count),
      showFacingPreview: (fromX, fromZ, toX, toZ, kind, count) => orderMarkers.showFacingPreview(fromX, fromZ, toX, toZ, kind, count),
      clearFacingPreview: () => orderMarkers.clearFacingPreview(),
      showTargetHover: (target) => orderMarkers.showTargetHover(target),
      clearTargetHover: () => orderMarkers.clearTargetHover(),
      tryRally: (x, z) => {
        const selected = selectedEntities(sim, localTeam);
        if (selected.length !== 1) return false;
        const rally = setProducerRally(sim, economy, selected[0], x, z);
        if (!rally) return false;
        orderMarkers.push(rally.x, rally.z, 'rally');
        audio.playUi('order');
        return true;
      },
    },
    localTeam,
    lockstep
      ? {
          move: (ids, x, z, attackMove, faceYaw, formationSpread) => lockstep.issue({ type: 'move', ids, x, z, attackMove, faceYaw, formationSpread }),
          harvest: (ids, x, z) => {
            const node = sim.resourceNodes.find((candidate) => Math.hypot(candidate.x - x, candidate.z - z) <= candidate.radius + 4 && candidate.remaining > 0);
            return node ? lockstep.issue({ type: 'harvest', ids, x, z }) : false;
          },
          returnHarvesters: (ids, x, z) => {
            const refinery = buildings(sim, localTeam).find(
              (entity) =>
                entity.building?.kind === 'refinery' &&
                entity.building.complete &&
                !entity.destroyed &&
                Math.hypot(entity.transform.x - x, entity.transform.z - z) <= (entity.collider?.radius ?? 8) + 10,
            );
            return refinery ? lockstep.issue({ type: 'return-harvesters', ids, x, z }) : false;
          },
          stop: (ids) => lockstep.issue({ type: 'stop', ids }),
          rally: (producerId, x, z) => {
            orderMarkers.push(x, z, 'rally');
            audio.playUi('order');
            return lockstep.issue({ type: 'rally', producerId, x, z });
          },
        }
      : undefined,
  );
  const sidebar = new Sidebar(sim, hf, economy, playerVision, {
    buildStructure: (kind) => {
      if (economy.readyStructure === kind) {
        const start = initialPlacementPoint(sim, hf, economy, localBase, kind);
        enterReadyStructurePlacement(sim, hf, economy, start.x, start.z);
        audio.playUi('select');
        return;
      }
      audio.playUi('build');
      if (lockstep) lockstep.issue({ type: 'start-structure', kind });
      else startStructureBuild(sim, economy, kind);
    },
    cancelStructure: () => {
      audio.playUi('cancel');
      if (lockstep) lockstep.issue({ type: 'cancel-structure' });
      else cancelStructureBuild(sim, economy);
    },
    queueUnit: (kind, producer) => {
      audio.playUi('build');
      if (lockstep) lockstep.issue({ type: 'queue-unit', kind, producerId: producer?.id });
      else queueUnit(sim, economy, kind, producer);
    },
    cancelUnit: (kind, producer) => {
      audio.playUi('cancel');
      if (lockstep) lockstep.issue({ type: 'cancel-unit', kind, producerId: producer?.id });
      else cancelUnitQueue(sim, economy, kind, producer);
    },
    setPrimaryProducer: (producer) => {
      audio.playUi('select');
      if (lockstep && producer.id !== undefined) lockstep.issue({ type: 'primary-producer', producerId: producer.id });
      else setPrimaryProducer(economy, producer);
    },
    focusMap: (x, z) => {
      rig.jumpTo(x, z);
    },
    radarYaw: () => rig.yawRadians,
    radarViewport: () => rig.getGroundViewportFootprint(),
  });
  const selectionBar = new SelectionBar(sim, {
    selectEntities: (entities) => {
      audio.playUi('select');
      setSelected(
        sim,
        entities.filter((entity) => !entity.destroyed && sim.world.has(entity)),
        false,
        localTeam,
      );
    },
  }, localTeam);
  let uiPaused = false;
  const setUiPaused = (paused: boolean): void => {
    uiPaused = paused;
    input.keys.clear();
    input.buttons = 0;
  };
  createGameMenu(settings, {
    setPaused: setUiPaused,
    snapshot: matchSnapshot,
    save:
      multiplayerMode
        ? undefined
        : () => {
            const stored: StoredMatchSave = {
              savedAt: Date.now(),
              settings,
              state: serializeMatchState(sim, armies.map((army) => army.economy)),
            };
            window.localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(stored));
            return stored;
          },
    load: multiplayerMode ? undefined : requestLoadStoredMatch,
    forfeit: multiplayerMode
      ? () => {
          multiplayer.client.forfeit(multiplayer.session.room.code, multiplayer.session.player.id);
          setNetworkStatus('You forfeited the match', true);
        }
      : undefined,
  });
  const firstPerson = new FirstPersonController(
    ctx.renderer.domElement,
    ctx.camera,
    input,
    hf,
    sim,
    {
      onEnter: () => {
        controller.setEnabled(false);
        unitView.setHiddenEntity(undefined);
        unitView.setSelectionOverlayVisible(false);
        sidebar.setVisible(false);
        selectionBar.setVisible(false);
        hud.setFirstPerson(true);
      },
      onExit: (entity) => {
        controller.setEnabled(true);
        unitView.setHiddenEntity(undefined);
        unitView.setSelectionOverlayVisible(true);
        sidebar.setVisible(true);
        selectionBar.setVisible(true);
        hud.setFirstPerson(false);
        if (entity) rig.jumpTo(entity.transform.x, entity.transform.z);
      },
    },
    localTeam,
    lockstep
      ? {
          control: (command) => lockstep.issueRealtime({ type: 'possess-control', ...command }),
          fire: (command) => lockstep.issueRealtime({ type: 'possess-fire', ...command }),
          release: (id) => lockstep.issueRealtime({ type: 'possess-release', id }),
        }
      : undefined,
  );
  input.onKeyDown('KeyV', () => {
    if (firstPerson.active) firstPerson.exit();
    else firstPerson.enter(selectedEntities(sim, localTeam));
  });
  input.onKeyDown('Tab', () => {
    firstPerson.cyclePossessed(1);
  });
  input.onKeyDown('Escape', () => {
    if (firstPerson.active) firstPerson.exit();
  });
  input.onKeyDown('F3', () => water.setDebugOverlay(terrain.toggleWalkOverlay()));
  input.onKeyDown('F4', () => (fogView.group.visible = !fogView.group.visible));
  input.onKeyDown('F1', () => {
    if (document.getElementById('skirmish-help-dialog')) return;
    setUiPaused(true);
    showHelpDialog({ onClose: () => setUiPaused(false) });
  });
  input.onKeyDown('F2', () => hud.toggleInfo());
  input.onKeyDown('KeyM', () => {
    audio.unlock();
    const muted = audio.toggleMuted();
    console.info(`[audio] ${muted ? 'muted' : 'unmuted'}`);
  });

  let outcome: 'victory' | 'defeat' | undefined;
  const checkOutcome = (): void => {
    if (outcome || sim.tick < 60) return;
    const alive = (team: number) => buildings(sim, team).filter((entity) => !entity.destroyed).length;
    const hostileTeams = teams.filter((team) => areTeamsHostile(sim, localTeam, team));
    if (hostileTeams.every((team) => alive(team) === 0)) outcome = 'victory';
    else if (alive(localTeam) === 0) outcome = 'defeat';
    if (outcome) showOutcomeBanner(outcome, combinedCommanderStats(commanders), settings, matchSnapshot());
  };
  lockstep?.connect();
  window.addEventListener('beforeunload', () => lockstep?.disconnect(), { once: true });

  let fps = 60;
  let simTicks = 0;
  let simHz = SIM_HZ;
  let lastSimSample = performance.now();

  const loop = new GameLoop({
    simTick: () => {
      if (uiPaused || networkPaused) return;
      firstPerson.simTick();
      const tickResult = advanceTick({
        sim,
        hf,
        economies: armies.map((army) => army.economy),
        visions: armies.map((army) => army.vision),
        commanders,
        lockstep,
        autoFire: !lineupStart,
        runCommanders: !lineupStart,
      });
      const spawned = tickResult.spawned;
      for (const entity of spawned) {
        unitView.addEntity(entity);
      }
      for (const entity of sim.world.entities) {
        if (entity.selectable?.type === 'tank' && !entity.destroyed) scatter.crushNear(entity.transform.x, entity.transform.z, 3.6);
      }
      if (sim.tick - lastFogTextureTick >= 2) {
        lastFogTextureTick = sim.tick;
        fogView.refresh();
      }
      const events = tickResult.events;
      audio.handleCombatEvents(events);
      economyFx.push(events);
      combatView.push(events);
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
      economyFx.update(dt);
      orderMarkers.update(dt);
      if (sim.tick !== lastResourceVisualTick) {
        lastResourceVisualTick = sim.tick;
        terrain.updateResources(sim.resourceNodes);
      }
      selectionBar.update();
      water.update(time);
      snowfall?.update(dt, time);
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
        renderScale: ctx.renderScale,
        simHz,
        instances: registry.totalInstances,
        zoom: rig.distance,
        yawDeg: rig.yawDegrees,
        pitchDeg: rig.pitchDegrees,
        units: unitView.count(),
        selected: controller.selectedCount(),
        mode: networkPaused ? 'NETWORK PAUSED' : uiPaused ? 'PAUSED' : firstPerson.inFirstPerson ? `CHASE ${firstPerson.possessedName ?? ''}` : firstPerson.active ? 'entering chase' : 'RTS',
      });
    },
  }, lockstep ? new NetworkTickDriver(() => !uiPaused && !networkPaused && lockstep.canAdvance()) : undefined);

  overlay.remove();
  loop.start();
  if (!lineupStart) showMissionBriefing(settings);
}

function showMissionBriefing(settings: SkirmishSettings): void {
  const existing = document.getElementById('mission-briefing-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'mission-briefing-toast';
  el.style.cssText =
    'position:fixed;left:50%;top:18px;transform:translate(-50%,-18px);z-index:34;width:min(560px,calc(100vw - 32px));' +
    'padding:12px 16px;background:rgba(8,12,14,.9);border:1px solid #596260;border-radius:3px;opacity:0;' +
    'box-shadow:0 12px 38px rgba(0,0,0,.42);font:11px/1.45 ui-monospace,Menlo,monospace;color:#d7e0e7;' +
    'letter-spacing:.08em;pointer-events:none;transition:opacity .35s ease,transform .35s ease;';
  el.innerHTML =
    '<div style="display:flex;justify-content:space-between;gap:12px;color:#f0d56a;font-size:13px;">' +
    '<span>MISSION ONLINE</span><span>DESTROY COMMAND YARD</span></div>' +
    `<div style="margin-top:5px;color:#aebbc4;">${settings.ai.toUpperCase()} / ${settings.aiStyle.toUpperCase()} · build power, refinery, production, then scout and strike.</div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%,0)';
  });
  window.setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%,-18px)';
    window.setTimeout(() => el.remove(), 450);
  }, 6500);
}

function createGameMenu(
  settings: SkirmishSettings,
  options: {
    setPaused: (paused: boolean) => void;
    snapshot: () => MatchSnapshot;
    save?: () => StoredMatchSave;
    load?: () => boolean;
    forfeit?: () => void;
  },
): void {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:30;display:flex;gap:6px;align-items:center;';
  const help = gameChromeButton('HELP', 'Open controls and objective');
  help.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    help.blur();
    options.setPaused(true);
    showHelpDialog({ onClose: () => options.setPaused(false) });
  };
  const menu = gameChromeButton('MENU', 'Open match menu');
  menu.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    menu.blur();
    options.setPaused(true);
    showMatchMenu(settings, {
      snapshot: options.snapshot,
      save: options.save,
      load: options.load,
      forfeit: options.forfeit,
      onClose: () => options.setPaused(false),
      onHelp: () => showHelpDialog({ onClose: () => options.setPaused(false) }),
    });
  };
  wrap.append(help, menu);
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

function showMatchMenu(
  settings: SkirmishSettings,
  options: {
    snapshot?: () => MatchSnapshot;
    save?: () => StoredMatchSave;
    load?: () => boolean;
    forfeit?: () => void;
    onClose: () => void;
    onHelp: () => void;
  },
): void {
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
  const close = (): void => {
    window.removeEventListener('keydown', onKeyDown);
    overlay.remove();
    options.onClose();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') close();
  };
  window.addEventListener('keydown', onKeyDown);
  const panel = document.createElement('div');
  panel.style.cssText =
    'width:300px;display:grid;gap:8px;padding:14px;background:rgba(8,12,14,.94);border:1px solid #596260;border-radius:3px;' +
    'box-shadow:0 18px 60px rgba(0,0,0,.55);font:11px ui-monospace,Menlo,monospace;color:#d7e0e7;letter-spacing:.08em;';
  const title = document.createElement('div');
  title.textContent = 'MATCH MENU';
  title.style.cssText = 'color:#d2b15f;font-size:13px;margin-bottom:2px;';
  const status = document.createElement('div');
  status.textContent = `${MAP_PRESETS[settings.mapId].shortLabel} · seed ${settings.seed} · ${settings.ai}/${settings.aiStyle}`;
  status.style.cssText = 'color:#8d9a96;font-size:10px;line-height:1.4;margin-bottom:4px;';
  const snapshot = options.snapshot?.();
  const details = document.createElement('div');
  details.style.cssText =
    'display:grid;grid-template-columns:1fr 1fr;gap:5px 8px;padding:8px;border:1px solid rgba(255,255,255,.1);' +
    'background:rgba(255,255,255,.035);color:#b8c5c1;font-size:10px;line-height:1.35;margin-bottom:4px;';
  if (snapshot) {
    for (const item of [
      ['time', formatDuration(snapshot.elapsedSeconds)],
      ['credits', `$${snapshot.playerCredits}`],
      ['your base', `${snapshot.playerBuildings} bldg · ${snapshot.playerUnits} units`],
      ['enemy base', `${snapshot.enemyBuildings} bldg · ${snapshot.enemyUnits} units`],
      ['collectors', `${snapshot.playerCollectors} yours · ${snapshot.enemyCollectors} enemy`],
      ['AI pressure', DIFFICULTY_DESCRIPTIONS[settings.ai].split('.')[0]],
    ]) {
      const cell = document.createElement('div');
      cell.innerHTML = `<span style="color:#d2b15f">${item[0].toUpperCase()}</span><br>${item[1]}`;
      details.appendChild(cell);
    }
  }
  const resume = dialogButton('Resume', close);
  const help = dialogButton('Help / controls', () => {
    window.removeEventListener('keydown', onKeyDown);
    overlay.remove();
    options.onHelp();
  });
  const copy = dialogButton('Copy match link', () => copyMatchLink(settings, status));
  const saveButton = options.save
    ? dialogButton('Save game', () => {
        const saved = options.save?.();
        status.textContent = saved ? `saved ${new Date(saved.savedAt).toLocaleTimeString()}` : 'save failed';
      })
    : undefined;
  const loadButton = options.load
    ? dialogButton('Load saved game', () => {
        if (!options.load?.()) status.textContent = 'no saved game found';
      })
    : undefined;
  const forfeitButton = options.forfeit
    ? dialogButton('Forfeit match', () => {
        if (!window.confirm('Forfeit this multiplayer match?')) return;
        options.forfeit?.();
        close();
      })
    : undefined;
  const restart = dialogButton('Restart match', () => reloadWithSettings(settings, true));
  const setup = dialogButton('Back to setup', () => reloadWithSettings(settings, false));
  panel.append(title, status);
  if (snapshot) panel.append(details);
  panel.append(resume, help, copy);
  if (saveButton) panel.append(saveButton);
  if (loadButton) panel.append(loadButton);
  if (forfeitButton) panel.append(forfeitButton);
  panel.append(restart, setup);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

function showHelpDialog(options: { onClose: () => void }): void {
  const existing = document.getElementById('skirmish-help-dialog');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'skirmish-help-dialog';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:75;display:grid;place-items:center;background:rgba(0,0,0,.32);pointer-events:auto;';
  overlay.onpointerdown = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const close = (): void => {
    window.removeEventListener('keydown', onKeyDown);
    overlay.remove();
    options.onClose();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') close();
  };
  window.addEventListener('keydown', onKeyDown);

  const panel = document.createElement('div');
  panel.style.cssText =
    'width:min(760px,calc(100vw - 36px));max-height:calc(100vh - 36px);overflow:auto;display:grid;gap:14px;padding:20px 22px;' +
    'background:linear-gradient(180deg,rgba(18,24,25,.97),rgba(7,10,11,.96));border:1px solid #596260;border-radius:4px;' +
    'box-shadow:0 22px 80px rgba(0,0,0,.62);font:11px/1.55 ui-monospace,Menlo,monospace;color:#d7e0e7;letter-spacing:.06em;';
  const title = document.createElement('div');
  title.innerHTML =
    '<div style="font-size:18px;color:#f0d56a;letter-spacing:.18em;">FIELD GUIDE</div>' +
    '<div style="margin-top:5px;color:#8d9a96;">Destroy the enemy command yard while keeping your base alive.</div>';
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;';
  const sections = [
    ['Start', 'Build Power Plant -> Refinery -> Barracks/Factory. Oil collectors bring credits back to refineries.'],
    ['Command', 'Select with click or drag. Right-click ground to move. Right-click and hold to set facing and spread.'],
    ['Build', 'Use the right panel tabs. Structure cards become READY, then place them on terrain. Unit queues keep producing.'],
    ['Fight', 'A then right-click sets attack move. Units near a hit friendly building will respond to the attacker.'],
    ['V-mode', 'Select a unit and press V. Hold Shift for 2x movement. Left-click primary fire, right-click secondary fire. Press V or Escape to exit.'],
    ['Aircraft', 'W/S thrust, Shift boost, A/D yaw, Q/E hard turn, Space/Ctrl altitude, mouse aim. Bombs fire downward from the air.'],
    ['Sniper', 'In V-mode, right-click toggles scope. Wheel zooms. Left-click fires after reload.'],
    ['Camera', 'WASD or edge pan. Hold Space and drag to grab pan. Empty right-drag or Cmd/Ctrl left-drag rotates.'],
  ];
  for (const [heading, body] of sections) {
    const card = document.createElement('div');
    card.style.cssText = 'border:1px solid rgba(255,255,255,.08);background:rgba(8,12,14,.58);padding:10px 11px;border-radius:3px;';
    card.innerHTML = `<div style="color:#d2b15f;margin-bottom:3px;">${heading.toUpperCase()}</div><div style="color:#b8c5c1;">${body}</div>`;
    grid.appendChild(card);
  }
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;justify-content:space-between;gap:10px;align-items:center;';
  const hint = document.createElement('div');
  hint.textContent = 'F1 opens this guide. F2 toggles debug stats. MENU pauses the match.';
  hint.style.cssText = 'color:#8d9a96;font-size:10px;';
  const closeButton = dialogButton('Close', close);
  closeButton.style.minWidth = '120px';
  footer.append(hint, closeButton);
  panel.append(title, grid, footer);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

function copyMatchLink(settings: SkirmishSettings, status: HTMLElement): void {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('map', settings.mapId);
  url.searchParams.set('seed', String(settings.seed));
  url.searchParams.set('ai', settings.ai);
  url.searchParams.set('ai-style', settings.aiStyle);
  url.searchParams.set('combat', settings.combatMode);
  url.searchParams.set('armies', String(settings.armyCount));
  url.searchParams.set('sides', settings.armySides.slice(0, settings.armyCount).join(','));
  const write = navigator.clipboard?.writeText(url.toString());
  if (!write) {
    status.textContent = url.toString();
    return;
  }
  write
    .then(() => {
      status.textContent = 'match link copied';
    })
    .catch(() => {
      status.textContent = url.toString();
  });
}

function commandBaseForTeam(sim: ReturnType<typeof createGameSim>, team: number): ReturnType<typeof createInitialBase> | undefined {
  const teamBuildings = buildings(sim, team).filter((entity) => !entity.destroyed);
  return (
    teamBuildings.find((entity) => entity.building?.kind === 'command-yard') ??
    teamBuildings[0]
  );
}

function combinedCommanderStats(commanders: EnemyCommander[]): { attacksLaunched: number; rebuilds: number } {
  return commanders.reduce(
    (total, commander) => ({
      attacksLaunched: total.attacksLaunched + commander.stats.attacksLaunched,
      rebuilds: total.rebuilds + commander.stats.rebuilds,
    }),
    { attacksLaunched: 0, rebuilds: 0 },
  );
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
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

function showOutcomeBanner(
  outcome: 'victory' | 'defeat',
  aiStats: { attacksLaunched: number; rebuilds: number },
  settings: SkirmishSettings,
  snapshot: MatchSnapshot,
): void {
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
  summary.textContent = `time ${formatDuration(snapshot.elapsedSeconds)} · enemy launched ${aiStats.attacksLaunched} assaults · rebuilt ${aiStats.rebuilds}`;
  summary.style.cssText = 'margin-top:10px;font-size:11px;letter-spacing:.14em;color:#aebbc4';
  const stats = document.createElement('div');
  stats.style.cssText =
    'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:16px;letter-spacing:.08em;font-size:10px;color:#b8c5c1;';
  for (const [label, value] of [
    ['YOUR FORCE', `${snapshot.playerBuildings} bldg / ${snapshot.playerUnits} units`],
    ['ENEMY FORCE', `${snapshot.enemyBuildings} bldg / ${snapshot.enemyUnits} units`],
    ['ECONOMY', `$${snapshot.playerCredits} / ${snapshot.playerCollectors} collectors`],
  ]) {
    const cell = document.createElement('div');
    cell.style.cssText = 'padding:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);';
    cell.innerHTML = `<div style="color:#d2b15f;margin-bottom:3px;">${label}</div><div>${value}</div>`;
    stats.appendChild(cell);
  }
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;justify-content:center;gap:10px;margin-top:18px;pointer-events:auto;';
  const again = outcomeButton('PLAY AGAIN', () => reloadWithSettings({ ...settings, seed: randomSeed() }, true));
  const setup = outcomeButton('SETUP', () => reloadWithSettings(settings, false));
  actions.append(again, setup);
  el.append(title, summary, stats, actions);
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
  hf: ReturnType<typeof generateHeightfield>,
  baseX: number,
  baseZ: number,
  team: number,
) {
  const plan = [
    { kind: 'infantry' as const, side: -15, depth: 39 },
    { kind: 'infantry' as const, side: -9, depth: 45 },
    { kind: 'infantry' as const, side: -3, depth: 41 },
    { kind: 'infantry' as const, side: 3, depth: 47 },
    { kind: 'sniper' as const, side: 10, depth: 43 },
    { kind: 'rocket-infantry' as const, side: 17, depth: 38 },
  ];
  const spawned = [];
  const basis = openingFormationBasis(team);
  for (const item of plan) {
    const target = openingFormationPoint(baseX, baseZ, basis, item.side, item.depth);
    const cell = sim.nav.nearestWalkableCell(target.x, target.z, 26) ?? sim.nav.nearestWalkableCellGlobal(target.x, target.z);
    if (!cell) continue;
    const p = sim.nav.cellCenter(cell.x, cell.y);
    const unit = spawnInfantryAt(sim, p.x, p.z, team, item.kind);
    orientOpeningUnit(unit, basis);
    spawned.push(unit);
  }
  void hf;
  return spawned;
}

function spawnStartingTanks(
  sim: ReturnType<typeof createGameSim>,
  hf: ReturnType<typeof generateHeightfield>,
  baseX: number,
  baseZ: number,
  team: number,
  count: number,
): Array<ReturnType<typeof spawnTankAt>> {
  const spawned: Array<ReturnType<typeof spawnTankAt>> = [];
  const basis = openingFormationBasis(team);
  const columns = Math.max(2, Math.min(10, Math.ceil(Math.sqrt(count))));
  let cursor = 0;
  let guard = 0;
  while (spawned.length < count && guard++ < count * 80) {
    const col = cursor % columns;
    const row = Math.floor(cursor / columns);
    cursor++;
    const side = (col - (columns - 1) / 2) * 7.1;
    const depth = 29 + row * 7.3;
    const target = openingFormationPoint(baseX, baseZ, basis, side, depth);
    const cell = sim.nav.nearestWalkableCell(target.x, target.z, 18) ?? sim.nav.nearestWalkableCellGlobal(target.x, target.z);
    if (!cell) continue;
    const p = sim.nav.cellCenter(cell.x, cell.y);
    const tank = spawnTankAt(sim, p.x, p.z, `Army ${team} M-17 ${spawned.length + 1}`, team);
    orientOpeningUnit(tank, basis);
    spawned.push(tank);
  }
  void hf;
  return spawned;
}

function openingFormationBasis(team: number): { forwardX: number; forwardZ: number; rightX: number; rightZ: number } {
  const sx = team === 2 || team === 3 ? -1 : 1;
  const sz = team === 2 || team === 4 ? -1 : 1;
  const len = Math.hypot(sx, sz);
  const forwardX = sx / len;
  const forwardZ = sz / len;
  return {
    forwardX,
    forwardZ,
    rightX: forwardZ,
    rightZ: -forwardX,
  };
}

function openingFormationPoint(
  baseX: number,
  baseZ: number,
  basis: { forwardX: number; forwardZ: number; rightX: number; rightZ: number },
  side: number,
  depth: number,
): { x: number; z: number } {
  return {
    x: baseX + basis.forwardX * depth + basis.rightX * side,
    z: baseZ + basis.forwardZ * depth + basis.rightZ * side,
  };
}

function orientOpeningUnit(
  entity: ReturnType<typeof spawnTankAt> | ReturnType<typeof spawnInfantryAt>,
  basis: { forwardX: number; forwardZ: number },
): void {
  const yaw = Math.atan2(basis.forwardX, basis.forwardZ);
  entity.transform.rot = yaw;
  entity.previousTransform.rot = yaw;
  if (entity.turret) entity.turret.yaw = yaw;
}

function spawnLineupUnits(
  sim: ReturnType<typeof createGameSim>,
  hf: ReturnType<typeof generateHeightfield>,
  economy: ReturnType<typeof createEconomy>,
  baseX: number,
  baseZ: number,
): Array<ReturnType<typeof spawnTankAt>> {
  const units = [];
  const kinds = [
    'rifle',
    'grenadier',
    'rocket',
    'sniper',
    'jackal',
    'm17',
    'mauler',
    'wasp',
    'vulture',
    'hammerhead',
    'harvester',
  ] as const;
  const startX = baseX - 42;
  const playerZ = baseZ + 34;
  const enemyZ = baseZ + 52;
  for (let i = 0; i < kinds.length; i++) {
    const x = startX + i * 8.4;
    const player = spawnLineupKind(sim, hf, economy, kinds[i], x, playerZ, 1);
    const enemy = spawnLineupKind(sim, hf, economy, kinds[i], x, enemyZ, 2);
    if (player) {
      orientLineupUnit(player, 0);
      units.push(player);
    }
    if (enemy) {
      orientLineupUnit(enemy, Math.PI);
      units.push(enemy);
    }
  }
  return units;
}

function spawnLineupKind(
  sim: ReturnType<typeof createGameSim>,
  hf: ReturnType<typeof generateHeightfield>,
  economy: ReturnType<typeof createEconomy>,
  kind: 'rifle' | 'grenadier' | 'rocket' | 'sniper' | 'jackal' | 'm17' | 'mauler' | 'wasp' | 'vulture' | 'hammerhead' | 'harvester',
  x: number,
  z: number,
  team: number,
) {
  if (kind === 'rifle') return spawnInfantryAt(sim, x, z, team, 'infantry');
  if (kind === 'grenadier') return spawnInfantryAt(sim, x, z, team, 'grenadier');
  if (kind === 'rocket') return spawnInfantryAt(sim, x, z, team, 'rocket-infantry');
  if (kind === 'sniper') return spawnInfantryAt(sim, x, z, team, 'sniper');
  if (kind === 'jackal') return spawnScoutTankAt(sim, x, z, team === 2 ? 'Ash Jackal Lineup' : 'Jackal Lineup', team);
  if (kind === 'm17') return spawnTankAt(sim, x, z, team === 2 ? 'Ash M-17 Lineup' : 'M-17 Lineup', team);
  if (kind === 'mauler') return spawnSiegeTankAt(sim, x, z, team === 2 ? 'Ash Mauler Lineup' : 'Mauler Lineup', team);
  if (kind === 'wasp') return spawnWaspAt(sim, hf, x, z, team === 2 ? 'Ash Wasp Lineup' : 'Wasp Lineup', team);
  if (kind === 'vulture') return spawnVultureAt(sim, hf, x, z, team === 2 ? 'Ash Vulture Lineup' : 'Vulture Lineup', team);
  if (kind === 'hammerhead') return spawnHammerheadAt(sim, hf, x, z, team === 2 ? 'Ash Hammerhead Lineup' : 'Hammerhead Lineup', team);
  const placement = updatePlacement(sim, hf, 'refinery', x, z + (team === 2 ? 18 : -18), economy.team, economy);
  economy.readyStructure = 'refinery';
  const refinery = placeStructure(sim, hf, economy, placement);
  economy.readyStructure = undefined;
  const harvester = stepEconomy(sim, hf, economy, 0).find((entity) => entity.harvester);
  if (!harvester) return undefined;
  harvester.transform.x = x;
  harvester.transform.z = z;
  harvester.previousTransform.x = x;
  harvester.previousTransform.z = z;
  harvester.team = { id: team };
  if (refinery) refinery.team = { id: team };
  return harvester;
}

function orientLineupUnit(entity: ReturnType<typeof spawnTankAt>, rot: number): void {
  entity.transform.rot = rot;
  entity.previousTransform.rot = rot;
  if (entity.turret) entity.turret.yaw = rot;
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

function initialPlacementPoint(
  sim: ReturnType<typeof createGameSim>,
  hf: ReturnType<typeof generateHeightfield>,
  economy: ReturnType<typeof createEconomy>,
  base: ReturnType<typeof createInitialBase>,
  kind: StructureKind,
): { x: number; z: number } {
  const offsets = [
    { x: 24, z: -10 },
    { x: -24, z: -10 },
    { x: 24, z: 18 },
    { x: -24, z: 18 },
    { x: 0, z: -28 },
    { x: 0, z: 30 },
    { x: 38, z: 0 },
    { x: -38, z: 0 },
    { x: 42, z: 24 },
    { x: -42, z: 24 },
    { x: 42, z: -24 },
    { x: -42, z: -24 },
  ];
  for (const offset of offsets) {
    const x = base.transform.x + offset.x;
    const z = base.transform.z + offset.z;
    if (updatePlacement(sim, hf, kind, x, z, economy.team, economy).valid) return { x, z };
  }
  return { x: base.transform.x + 30, z: base.transform.z };
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
  const hasAutostartParams = shouldAutostartFromUrl(params);
  const autostart = window.sessionStorage.getItem(AUTOSTART_STORAGE_KEY) === '1';
  window.sessionStorage.removeItem(AUTOSTART_STORAGE_KEY);
  if (hasAutostartParams || autostart) {
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
