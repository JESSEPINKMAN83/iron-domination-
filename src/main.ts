import { Color, Fog, MeshStandardMaterial } from 'three';
import { betaPlayerName, hasBetaAccess, showLandingScreen } from './landing';
import { setFeedbackMatchMetadataProvider, showFeedbackWidget } from './feedback';
import type { FeedbackMatchMetadata } from './backoffice';
import { sendTelemetryEvent, trackMatchTelemetry, type MatchTelemetry } from './telemetry';
import { configureHowToPlayLifecycle, hideHowToPlayWidget, openHowToPlay, showHowToPlayWidget } from './howToPlay';
import { showMissionBriefing } from './missionBriefing';
import './setup.css';
import './mobile.css';
import { EnemyCommander } from './ai/commander';
import { AudioDirector } from './audio/audioDirector';
import {
  DEFAULT_ORE_AMOUNT,
  DEFAULT_MAP_ID,
  DEFAULT_MAP_SIZE,
  MAP_IDS,
  MAP_PRESETS,
  MAP_SIZE_IDS,
  MAP_SIZE_PRESETS,
  ORE_AMOUNT_MAX,
  ORE_AMOUNT_MIN,
  ORE_AMOUNT_STEP,
  mapConfig,
  oreFieldCount,
  sanitizeMapId,
  sanitizeMapSize,
  sanitizeOreAmount,
  type MapId,
  type MapSize,
} from './content/maps';
import type { StructureKind } from './content/phase3';
import { AI_DIFFICULTY, type Difficulty, type Personality } from './content/phase6';
import { COMBAT_MODE_DESCRIPTIONS, COMBAT_MODES, type CombatMode } from './content/rules';
import { startPosition } from './content/startPositions';
import { Input } from './engine/input';
import { GameLoop, NetworkTickDriver, SIM_HZ } from './engine/loop';
import { FirstContactGate, findFirstVisibleHostileEntity } from './firstContact';
import { advanceTick } from './match/advanceTick';
import { aiControlledTeams, ensureOpposingSides, formatArmyMatchup, isVictoryFromHostileBuildingCounts, shouldAutostartFromUrl } from './match/startup';
import { FirstPersonController } from './modes/firstPersonController';
import { RtsCameraRig } from './modes/rtsCamera';
import { RtsController } from './modes/rtsController';
import { MobileGameControls } from './mobile/gameControls';
import { isMobileTouchDevice, MobileLandscapeGate } from './mobile/platform';
import { LockstepRuntime } from './net/commands';
import { multiplayerInviteUrl, roomFromInvite } from './net/invite';
import { MultiplayerClient, normalizeRoomCode, normalizedBaseUrl, shouldLaunchLocalSkirmish, waitForMultiplayerServer, type MultiplayerEvent, type MultiplayerRoom, type MultiplayerSession, type TacticalPingKind } from './net/multiplayer';
import { AssetPipeline } from './render/assets';
import { BuildingView } from './render/buildingView';
import { CombatView } from './render/combatView';
import { EconomyFxView } from './render/economyFxView';
import { FogView } from './render/fogView';
import { InstancedMeshRegistry } from './render/instancing';
import { OrderMarkerView } from './render/orderMarkerView';
import { applyMultiplayerFactionColors } from './render/palette';
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
import { purchaseUnitUpgrade } from './sim/upgrades';
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
  type CombatEvent,
} from './sim/world';
import { BaseUnderAttackGate, findFriendlyBuildingUnderAttack } from './ui/baseUnderAttack';
import { Hud } from './ui/hud';
import { MissionComms } from './ui/missionComms';
import { SelectionBar } from './ui/selectionBar';
import { Sidebar } from './ui/sidebar';
import { renderTacticalMap, type TacticalMapDeployment } from './ui/tacticalMap';

const nextFrame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve));
const SKIRMISH_STORAGE_KEY = 'iron-dominion.skirmish.v1';
const AUTOSTART_STORAGE_KEY = 'iron-dominion.autostart.v1';
const SAVE_STORAGE_KEY = 'iron-dominion.save.v1';
const LOAD_SAVE_STORAGE_KEY = 'iron-dominion.load-save.v1';
const MULTIPLAYER_SERVER_STORAGE_KEY = 'iron-dominion.multiplayer.server.v1';
const MULTIPLAYER_PLAYER_STORAGE_KEY = 'iron-dominion.multiplayer.players.v1';
const MULTIPLAYER_REMATCH_STORAGE_KEY = 'iron-dominion.multiplayer.rematch.v1';
const MATCH_HISTORY_STORAGE_KEY = 'iron-dominion.match-history.v1';

interface SkirmishSettings {
  mapId: MapId;
  mapSize: MapSize;
  seed: number;
  oreAmount: number;
  ai: Difficulty;
  aiStyle: Personality;
  debug: boolean;
  combatMode: CombatMode;
  armyCount: ArmyCount;
  armySides: ArmySides;
  spawnSlots: ArmySpawnSlots;
}

type ArmyCount = 2 | 3 | 4;
type ArmySides = [number, number, number, number];
type ArmySpawnSlots = [number, number, number, number];

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
const MAP_SIZE_DESCRIPTIONS: Record<MapSize, string> = Object.fromEntries(
  MAP_SIZE_IDS.map((id) => [id, MAP_SIZE_PRESETS[id].description]),
) as Record<MapSize, string>;
const ORE_AMOUNT_LABELS: Record<number, string> = {
  50: 'SPARSE',
  75: 'LOW',
  100: 'STANDARD',
  125: 'HIGH',
  150: 'RICH',
  175: 'ABUNDANT',
  200: 'MAXIMUM',
};
const LOBBY_COLORS = {
  jade: '#67d59b',
  crimson: '#ed6a5c',
  azure: '#67b8ef',
  amber: '#e8b854',
} as const;

function escapeLobbyText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

function mapChoiceLabel(id: MapId): string {
  return MAP_PRESETS[id].shortLabel;
}

function renderLobbyMapPreview(
  root: HTMLDivElement,
  map: (typeof MAP_PRESETS)[MapId],
  seed: number,
  mapSize: MapSize,
  oreAmount: number,
  deployments: TacticalMapDeployment[] = [],
): void {
  renderTacticalMap(root, { mapId: map.id, mapSize, seed, oreAmount, deployments });
}

function oreAmountLabel(value: unknown): string {
  const amount = sanitizeOreAmount(value) ?? DEFAULT_ORE_AMOUNT;
  return ORE_AMOUNT_LABELS[amount] ?? `${amount}%`;
}

function setupMapDeployments(armyCount: ArmyCount, armySides: ArmySides): TacticalMapDeployment[] {
  const colors = Object.values(LOBBY_COLORS);
  return Array.from({ length: armyCount }, (_, offset) => {
    const army = offset + 1;
    return {
      army,
      side: armySides[offset] ?? army,
      color: colors[offset] ?? '#d7dde0',
      label: army === 1 ? 'YOU' : `AI ARMY ${army}`,
      detail: army === 1 ? 'COMMAND' : 'AI START',
      isLocal: army === 1,
    };
  });
}

function createMatchHistoryPanel(): HTMLDivElement {
  const root = document.createElement('div');
  root.style.cssText = 'display:grid;gap:7px;padding:11px;border:1px solid #303936;background:rgba(9,13,13,.7);';
  const title = document.createElement('div');
  title.textContent = 'RECENT MATCHES';
  title.style.cssText = 'color:#d2b15f;font-size:10px;letter-spacing:.12em;';
  const history = readMatchHistory();
  if (history.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'Your completed matches will appear here.';
    empty.style.cssText = 'color:#7f8a85;font-size:10px;';
    root.append(title, empty);
    return root;
  }
  const rows = document.createElement('div');
  rows.style.cssText = 'display:grid;gap:4px;';
  for (const match of history) {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;padding:6px 7px;background:#101514;color:#aebbc4;font-size:10px;';
    const result = document.createElement('div');
    result.textContent = match.outcome.toUpperCase();
    result.style.color = match.outcome === 'victory' ? '#7df27d' : '#ff8a72';
    const details = document.createElement('div');
    details.textContent = `${MAP_PRESETS[match.mapId].shortLabel} · ${match.multiplayer ? 'ONLINE' : 'SKIRMISH'}`;
    details.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const duration = document.createElement('div');
    duration.textContent = formatDuration(match.duration);
    row.append(result, details, duration);
    rows.appendChild(row);
  }
  root.append(title, rows);
  return root;
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

interface StoredMultiplayerRematch {
  server: string;
  roomCode: string;
  playerId: string;
}

interface MatchHistoryEntry {
  playedAt: number;
  outcome: 'victory' | 'defeat';
  mapId: MapId;
  seed: number;
  duration: number;
  multiplayer: boolean;
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

function defaultSpawnSlots(): ArmySpawnSlots {
  return [1, 2, 3, 4];
}

function sanitizeSpawnSlots(value: unknown): ArmySpawnSlots | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const used = new Set<number>();
  return [0, 1, 2, 3].map((index) => {
    const requested = Math.max(1, Math.min(4, Math.floor(Number(value[index]) || index + 1)));
    const slot = used.has(requested) ? [1, 2, 3, 4].find((candidate) => !used.has(candidate)) ?? index + 1 : requested;
    used.add(slot);
    return slot;
  }) as ArmySpawnSlots;
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
      mapSize: sanitizeMapSize(parsed.mapSize),
      seed: Number.isFinite(parsed.seed) ? Math.floor(Number(parsed.seed)) : undefined,
      oreAmount: sanitizeOreAmount(parsed.oreAmount),
      ai: DIFFICULTIES.includes(parsed.ai as Difficulty) ? parsed.ai : undefined,
      aiStyle: PERSONALITIES.includes(parsed.aiStyle as Personality) ? parsed.aiStyle : undefined,
      debug: parsed.debug === true,
      combatMode: COMBAT_MODES.includes(parsed.combatMode as CombatMode) ? parsed.combatMode : undefined,
      armyCount: sanitizeArmyCount(parsed.armyCount),
      armySides: sanitizeArmySides(parsed.armySides),
      spawnSlots: sanitizeSpawnSlots(parsed.spawnSlots),
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
  const mapSize = sanitizeMapSize(params.get('size'));
  const oreAmount = sanitizeOreAmount(params.get('ore'));
  const ai = params.get('ai');
  const aiStyle = params.get('ai-style');
  const combat = params.get('combat');
  const armyCount = sanitizeArmyCount(params.get('armies'));
  const sides = params.get('sides');
  const spawns = params.get('spawns');
  return {
    mapId,
    mapSize,
    seed: Number.isFinite(seed) && seed > 0 ? Math.floor(seed) : undefined,
    oreAmount,
    ai: DIFFICULTIES.includes(ai as Difficulty) ? (ai as Difficulty) : undefined,
    aiStyle: PERSONALITIES.includes(aiStyle as Personality) ? (aiStyle as Personality) : undefined,
    debug: params.get('debug') === 'armies' ? true : undefined,
    combatMode: COMBAT_MODES.includes(combat as CombatMode) ? (combat as CombatMode) : undefined,
    armyCount,
    armySides: sides ? sanitizeArmySides(sides.split(',')) : undefined,
    spawnSlots: spawns ? sanitizeSpawnSlots(spawns.split(',')) : undefined,
  };
}

function initialSettings(params: URLSearchParams): SkirmishSettings {
  const stored = loadStoredSettings();
  const fromUrl = settingsFromUrl(params);
  const armyCount = fromUrl.armyCount ?? stored.armyCount ?? 2;
  const armySides = fromUrl.armySides ?? stored.armySides ?? defaultArmySides();
  return {
    mapId: fromUrl.mapId ?? stored.mapId ?? DEFAULT_MAP_ID,
    mapSize: fromUrl.mapSize ?? stored.mapSize ?? DEFAULT_MAP_SIZE,
    seed: fromUrl.seed ?? stored.seed ?? randomSeed(),
    oreAmount: fromUrl.oreAmount ?? stored.oreAmount ?? DEFAULT_ORE_AMOUNT,
    ai: fromUrl.ai ?? stored.ai ?? 'normal',
    aiStyle: fromUrl.aiStyle ?? stored.aiStyle ?? 'balanced',
    debug: fromUrl.debug ?? stored.debug ?? false,
    combatMode: fromUrl.combatMode ?? stored.combatMode ?? 'assisted',
    armyCount,
    armySides: ensureOpposingSides(armyCount, armySides),
    spawnSlots: fromUrl.spawnSlots ?? stored.spawnSlots ?? defaultSpawnSlots(),
  };
}

function reloadWithSettings(settings: SkirmishSettings, autostart: boolean): void {
  saveSkirmishSettings(settings);
  if (autostart) window.sessionStorage.setItem(AUTOSTART_STORAGE_KEY, '1');
  else window.sessionStorage.removeItem(AUTOSTART_STORAGE_KEY);
  window.location.reload();
}

function restartMultiplayerMatch(client: MultiplayerClient, session: MultiplayerSession): void {
  const state: StoredMultiplayerRematch = { server: client.baseUrl, roomCode: session.room.code, playerId: session.player.id };
  window.sessionStorage.setItem(MULTIPLAYER_REMATCH_STORAGE_KEY, JSON.stringify(state));
  window.location.reload();
}

function consumeMultiplayerRematch(): StoredMultiplayerRematch | undefined {
  const raw = window.sessionStorage.getItem(MULTIPLAYER_REMATCH_STORAGE_KEY);
  window.sessionStorage.removeItem(MULTIPLAYER_REMATCH_STORAGE_KEY);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredMultiplayerRematch>;
    if (typeof parsed.server !== 'string' || typeof parsed.roomCode !== 'string' || typeof parsed.playerId !== 'string') return undefined;
    return { server: normalizedBaseUrl(parsed.server), roomCode: normalizeRoomCode(parsed.roomCode), playerId: parsed.playerId };
  } catch {
    return undefined;
  }
}

function readMatchHistory(): MatchHistoryEntry[] {
  try {
    const rows = JSON.parse(window.localStorage.getItem(MATCH_HISTORY_STORAGE_KEY) ?? '[]');
    return Array.isArray(rows) ? rows.filter(isMatchHistoryEntry).slice(0, 6) : [];
  } catch {
    return [];
  }
}

function recordMatchHistory(entry: MatchHistoryEntry): void {
  const history = [entry, ...readMatchHistory()].slice(0, 6);
  window.localStorage.setItem(MATCH_HISTORY_STORAGE_KEY, JSON.stringify(history));
}

function isMatchHistoryEntry(value: unknown): value is MatchHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<MatchHistoryEntry>;
  return (entry.outcome === 'victory' || entry.outcome === 'defeat') && !!sanitizeMapId(entry.mapId) && Number.isFinite(entry.playedAt) && Number.isFinite(entry.duration);
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
    const root = document.createElement('div');
    root.id = 'iron-setup';
    root.className = 'war-setup';
    const shell = document.createElement('div');
    shell.className = 'war-setup__shell';

    const header = document.createElement('header');
    header.className = 'war-setup__header';
    const headerCopy = document.createElement('div');
    headerCopy.innerHTML =
      '<div class="war-setup__eyebrow"><span>COMMAND CENTRE</span><span class="war-setup__signal">SYSTEM ONLINE</span></div>' +
      '<h1 class="war-setup__title">BATTLE SETUP</h1>' +
      '<p class="war-setup__intro">Host a battle, prepare a skirmish against the AI, or join another commander\'s room.</p>';
    const betaBadge = document.createElement('div');
    betaBadge.className = 'war-setup__badge';
    betaBadge.innerHTML = '<strong>PUBLIC BETA</strong><span>BUILD 0.1</span>';
    header.append(headerCopy, betaBadge);

    const params = new URLSearchParams(location.search);
    let mode: 'host' | 'join' = params.has('room') ? 'join' : 'host';
    const tabs = document.createElement('div');
    tabs.className = 'war-tabs';
    tabs.setAttribute('role', 'tablist');
    const hostTab = createSetupTab('HOST', 'Start a skirmish or open an online room');
    const joinTab = createSetupTab('JOIN', 'Enter an existing room');
    tabs.append(hostTab, joinTab);

    const mobileSteps = document.createElement('nav');
    mobileSteps.className = 'war-mobile-steps';
    mobileSteps.setAttribute('aria-label', 'Battle setup sections');

    const layout = document.createElement('div');
    layout.className = 'war-setup__body';
    const config = document.createElement('main');
    config.className = 'war-config';
    const context = document.createElement('aside');
    context.className = 'war-context';
    const configModeNote = document.createElement('div');
    configModeNote.className = 'war-config__mode-note';
    config.appendChild(configModeNote);

    let refresh = (): void => {};
    let syncMultiplayerSettings = (): void => {};
    let applyingRoomSettings = false;
    let multiplayerSpawnSlots = defaults.spawnSlots;
    const mapChoice = createSegmentedControl('Map', MAP_IDS, defaults.mapId, MAP_DESCRIPTIONS, mapChoiceLabel, () => refresh());
    const mapSizeChoice = createSegmentedControl(
      'Map size', MAP_SIZE_IDS, defaults.mapSize, MAP_SIZE_DESCRIPTIONS,
      (size) => MAP_SIZE_PRESETS[size].label, () => refresh(),
    );
    const difficulty = createSegmentedControl('Difficulty', DIFFICULTIES, defaults.ai, DIFFICULTY_DESCRIPTIONS, undefined, () => refresh());
    const commander = createSegmentedControl('Enemy commander', PERSONALITIES, defaults.aiStyle, PERSONALITY_DESCRIPTIONS, undefined, () => refresh());
    const combatMode = createSegmentedControl('Combat mode', COMBAT_MODES, defaults.combatMode, COMBAT_MODE_DESCRIPTIONS, undefined, () => refresh());
    const armies = createArmySetupControl(defaults.armyCount, defaults.armySides, () => refresh());

    const mapPreview = document.createElement('div');
    mapPreview.className = 'war-map-preview';
    const battlefieldControls = document.createElement('div');
    battlefieldControls.className = 'war-battlefield__controls';
    const mapSettings = document.createElement('div');
    mapSettings.className = 'war-settings-grid';
    mapSettings.append(mapChoice.root, mapSizeChoice.root);

    const seedRow = document.createElement('div');
    seedRow.className = 'war-seed-row';
    const seedWrap = document.createElement('label');
    seedWrap.className = 'war-input';
    const seedLabel = document.createElement('span');
    seedLabel.className = 'war-input__label';
    seedLabel.textContent = 'MAP SEED';
    const seedInput = document.createElement('input');
    seedInput.type = 'number';
    seedInput.min = '1';
    seedInput.step = '1';
    seedInput.value = String(defaults.seed);
    seedInput.oninput = () => refresh();
    seedWrap.append(seedLabel, seedInput);
    const randomize = document.createElement('button');
    randomize.type = 'button';
    randomize.className = 'war-button war-button--quiet';
    randomize.textContent = 'RANDOMIZE';
    randomize.onclick = () => {
      seedInput.value = String(randomSeed());
      refresh();
      randomize.blur();
    };
    seedRow.append(seedWrap, randomize);
    const oreControl = document.createElement('label');
    oreControl.className = 'war-ore-control';
    const oreHeader = document.createElement('span');
    oreHeader.className = 'war-ore-control__header';
    const oreLabel = document.createElement('span');
    oreLabel.textContent = 'ORE AMOUNT';
    const oreOutput = document.createElement('strong');
    oreHeader.append(oreLabel, oreOutput);
    const oreAmountInput = document.createElement('input');
    oreAmountInput.type = 'range';
    oreAmountInput.min = String(ORE_AMOUNT_MIN);
    oreAmountInput.max = String(ORE_AMOUNT_MAX);
    oreAmountInput.step = String(ORE_AMOUNT_STEP);
    oreAmountInput.value = String(sanitizeOreAmount(defaults.oreAmount) ?? DEFAULT_ORE_AMOUNT);
    oreAmountInput.setAttribute('aria-label', 'Ore amount');
    oreAmountInput.oninput = () => refresh();
    const oreScale = document.createElement('span');
    oreScale.className = 'war-ore-control__scale';
    oreScale.innerHTML = '<span>SPARSE</span><span>STANDARD</span><span>MAXIMUM</span>';
    oreControl.append(oreHeader, oreAmountInput, oreScale);
    const seedCaption = document.createElement('p');
    seedCaption.className = 'war-field-note';
    seedCaption.textContent = 'The seed controls terrain layout. Ore amount changes how many resource fields are generated.';
    battlefieldControls.append(mapSettings, seedRow, oreControl, seedCaption);
    const battlefield = document.createElement('div');
    battlefield.className = 'war-battlefield';
    battlefield.append(mapPreview, battlefieldControls);
    const battlefieldSection = createSetupSection('01', 'BATTLEFIELD', 'Select the terrain and scale of the operation.', battlefield);
    battlefieldSection.classList.add('war-section--battlefield');
    config.append(battlefieldSection);

    const rules = document.createElement('div');
    rules.className = 'war-rules-grid';
    rules.append(difficulty.root, commander.root, combatMode.root);
    const rulesSection = createSetupSection('02', 'BATTLE RULES', 'Set enemy pressure and how directly you control combat.', rules);
    rulesSection.classList.add('war-section--rules');
    config.append(rulesSection);

    const forcesSection = createSetupSection(
      '03',
      'FORCES & ALLIANCES',
      'Choose how many armies enter the battle and place allied armies on the same side.',
      armies.root,
    );
    forcesSection.classList.add('war-section--forces');
    config.append(forcesSection);

    let multiplayerClient: MultiplayerClient | undefined;
    let multiplayerSession: MultiplayerSession | undefined;
    let multiplayerStarted = false;
    const currentSettings = (): SkirmishSettings => ({
      mapId: mapChoice.value(),
      mapSize: mapSizeChoice.value(),
      seed: Math.max(1, Math.floor(Number(seedInput.value) || randomSeed())),
      oreAmount: sanitizeOreAmount(oreAmountInput.value) ?? DEFAULT_ORE_AMOUNT,
      ai: difficulty.value(),
      aiStyle: commander.value(),
      debug: defaults.debug,
      combatMode: combatMode.value(),
      armyCount: armies.armyCount(),
      armySides: armies.armySides(),
      spawnSlots: multiplayerSpawnSlots,
    });
    const applyRoomSettings = (room: MultiplayerRoom, playerIndex: number): void => {
      applyingRoomSettings = true;
      difficulty.setValue(room.ai);
      commander.setValue(room.aiStyle);
      combatMode.setValue(room.combatMode ?? 'assisted');
      mapChoice.setValue(sanitizeMapId(room.mapId) ?? DEFAULT_MAP_ID);
      mapSizeChoice.setValue(sanitizeMapSize(room.mapSize) ?? DEFAULT_MAP_SIZE);
      seedInput.value = String(room.seed);
      oreAmountInput.value = String(sanitizeOreAmount(room.oreAmount) ?? DEFAULT_ORE_AMOUNT);
      armies.setState(sanitizeArmyCount(room.armyCount) ?? 2, sanitizeArmySides(room.armySides) ?? defaultArmySides());
      multiplayerSpawnSlots = sanitizeSpawnSlots(room.spawnSlots) ?? defaultSpawnSlots();
      armies.setPlayerIndex(playerIndex);
      const guestLocked = playerIndex !== 1;
      difficulty.setDisabled(guestLocked);
      commander.setDisabled(guestLocked);
      combatMode.setDisabled(guestLocked);
      mapChoice.setDisabled(guestLocked);
      mapSizeChoice.setDisabled(guestLocked);
      armies.setDisabled(guestLocked);
      seedInput.disabled = guestLocked;
      randomize.disabled = guestLocked;
      oreAmountInput.disabled = guestLocked;
      config.classList.toggle('is-locked', guestLocked);
      seedCaption.textContent = guestLocked
        ? 'Match settings are controlled by the host and synchronized for both players.'
        : 'Your map, seed and rules are synchronized to the guest before the match starts.';
      refresh();
      applyingRoomSettings = false;
    };
    const beginWithSettings = (settings: SkirmishSettings, matchMode: 'skirmish' | 'multiplayer'): void => {
      if (multiplayerStarted) return;
      multiplayerStarted = true;
      saveSkirmishSettings(settings);
      if (matchMode === 'multiplayer' && multiplayerClient && multiplayerSession) {
        pendingMultiplayer = { client: multiplayerClient, session: multiplayerSession };
      } else {
        pendingMultiplayer = undefined;
        multiplayerClient?.disconnect();
      }
      document.querySelectorAll('.war-lobby').forEach((lobby) => lobby.remove());
      root.remove();
      resolve(settings);
    };

    const controls = document.createElement('div');
    controls.className = 'war-controls';
    for (const [key, text] of [['SELECT', 'Click or drag'], ['ORDERS', 'Right-click'], ['BUILD', 'Sidebar'], ['GROUND MODE', 'Select + V'], ['FLY', 'W/S · A/D · Q/E']]) {
      const item = document.createElement('div');
      const keyEl = document.createElement('span');
      const valueEl = document.createElement('strong');
      keyEl.textContent = key;
      valueEl.textContent = text;
      item.append(keyEl, valueEl);
      controls.appendChild(item);
    }
    const summaryGrid = document.createElement('div');
    summaryGrid.className = 'war-summary-grid';
    const summaryValues = new Map<string, HTMLElement>();
    for (const label of ['BATTLEFIELD', 'ENEMY', 'FORCES', 'COMBAT']) {
      const item = document.createElement('div');
      const key = document.createElement('span');
      const value = document.createElement('strong');
      key.textContent = label;
      item.append(key, value);
      summaryValues.set(label, value);
      summaryGrid.appendChild(item);
    }
    const history = document.createElement('div');
    history.className = 'war-history';
    history.appendChild(createMatchHistoryPanel());
    const controlsHeading = document.createElement('div');
    controlsHeading.className = 'war-aside__subheading';
    controlsHeading.textContent = 'FIELD CONTROLS';
    const brief = document.createElement('div');
    brief.className = 'war-brief';
    brief.append(summaryGrid, history, controlsHeading, controls);
    const briefSection = createSetupSection('04', 'OPERATION BRIEF', 'Review the active battlefield settings and field controls.', brief);
    briefSection.classList.add('war-section--brief');
    config.append(briefSection);

    for (const [label, section] of [
      ['MAP', battlefieldSection],
      ['RULES', rulesSection],
      ['FORCES', forcesSection],
      ['REVIEW', briefSection],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.onclick = () => {
        for (const candidate of Array.from(mobileSteps.children)) candidate.classList.toggle('is-active', candidate === button);
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        button.blur();
      };
      if (label === 'MAP') button.classList.add('is-active');
      mobileSteps.appendChild(button);
    }

    let multiplayer: ReturnType<typeof createMultiplayerSetupPanel>;
    multiplayer = createMultiplayerSetupPanel(
      currentSettings,
      (settings) => beginWithSettings(settings, 'skirmish'),
      (settings) => beginWithSettings(settings, 'multiplayer'),
      (client, session) => {
        multiplayerClient = client;
        multiplayerSession = session;
        if (session) mode = session.player.index === 1 ? 'host' : 'join';
        renderMode();
      },
      () => multiplayerSession,
      applyRoomSettings,
      () => {
        difficulty.setDisabled(false);
        commander.setDisabled(false);
        combatMode.setDisabled(false);
        mapChoice.setDisabled(false);
        mapSizeChoice.setDisabled(false);
        armies.setDisabled(false);
        armies.setPlayerIndex(1);
        seedInput.disabled = false;
        randomize.disabled = false;
        oreAmountInput.disabled = false;
        config.classList.remove('is-locked');
        seedCaption.textContent = 'The seed controls terrain layout. Ore amount changes how many resource fields are generated.';
      },
    );
    syncMultiplayerSettings = () => multiplayer.syncHostSettings();
    context.appendChild(multiplayer.root);

    refresh = (): void => {
      const seed = Math.max(1, Math.floor(Number(seedInput.value) || defaults.seed));
      const map = MAP_PRESETS[mapChoice.value()];
      const oreAmount = sanitizeOreAmount(oreAmountInput.value) ?? DEFAULT_ORE_AMOUNT;
      const fields = oreFieldCount(map.id, mapSizeChoice.value(), oreAmount);
      oreOutput.textContent = `${oreAmountLabel(oreAmount)} · ${fields} FIELDS · ${oreAmount}%`;
      oreAmountInput.setAttribute('aria-valuetext', `${oreAmountLabel(oreAmount)}, ${fields} ore fields, ${oreAmount} percent`);
      renderLobbyMapPreview(
        mapPreview,
        map,
        seed,
        mapSizeChoice.value(),
        oreAmount,
        setupMapDeployments(armies.armyCount(), armies.armySides()),
      );
      summaryValues.get('BATTLEFIELD')!.textContent = `${map.shortLabel} · ${MAP_SIZE_PRESETS[mapSizeChoice.value()].label} · ${fields} ORE`;
      summaryValues.get('ENEMY')!.textContent = `${difficulty.value().toUpperCase()} · ${commander.value().toUpperCase()}`;
      summaryValues.get('FORCES')!.textContent = `${armies.armyCount()} ARMIES`;
      summaryValues.get('COMBAT')!.textContent = combatMode.value().toUpperCase();
      multiplayer.setMobileSummary(`${map.shortLabel} · ${MAP_SIZE_PRESETS[mapSizeChoice.value()].label} · ${armies.armyCount()} armies`);
      if (!applyingRoomSettings) syncMultiplayerSettings();
    };
    function renderMode(): void {
      const sessionRole = multiplayerSession ? multiplayerSession.player.index === 1 ? 'host' : 'join' : undefined;
      if (sessionRole) mode = sessionRole;
      const hosting = mode === 'host';
      const joinEntry = mode === 'join' && !multiplayerSession;
      hostTab.classList.toggle('is-active', hosting);
      joinTab.classList.toggle('is-active', !hosting);
      hostTab.setAttribute('aria-selected', String(hosting));
      joinTab.setAttribute('aria-selected', String(!hosting));
      hostTab.disabled = false;
      joinTab.disabled = false;
      config.hidden = joinEntry;
      layout.classList.toggle('is-join-entry', joinEntry);
      multiplayer.setMode(mode);
      configModeNote.textContent = multiplayerSession
        ? hosting
          ? 'HOST SETTINGS · CHANGES SYNC TO EVERY JOINED COMMANDER'
          : 'HOST CONFIGURATION · VIEW ONLY'
        : 'HOST SETTINGS · LOCAL SKIRMISH READY';
    }
    function setMode(next: 'host' | 'join'): void {
      mode = next;
      multiplayer.setMode(next);
      renderMode();
    }
    hostTab.onclick = () => {
      setMode('host');
      hostTab.blur();
    };
    joinTab.onclick = () => {
      setMode('join');
      joinTab.blur();
    };

    layout.append(config, context);
    shell.append(header, tabs, mobileSteps, layout);
    root.appendChild(shell);
    document.body.appendChild(root);
    refresh();
    renderMode();
  });
}

function createSetupTab(title: string, subtitle: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'war-tab';
  button.setAttribute('role', 'tab');
  const heading = document.createElement('span');
  const copy = document.createElement('small');
  heading.textContent = title;
  copy.textContent = subtitle;
  button.append(heading, copy);
  return button;
}

function createSetupSection(index: string, title: string, description: string, content: HTMLElement): HTMLElement {
  const section = document.createElement('section');
  section.className = 'war-section';
  const heading = document.createElement('div');
  heading.className = 'war-section__heading';
  const number = document.createElement('span');
  number.className = 'war-section__index';
  number.textContent = index;
  const copy = document.createElement('div');
  const titleEl = document.createElement('h2');
  const descriptionEl = document.createElement('p');
  titleEl.textContent = title;
  descriptionEl.textContent = description;
  copy.append(titleEl, descriptionEl);
  heading.append(number, copy);
  const body = document.createElement('div');
  body.className = 'war-section__body';
  body.appendChild(content);
  section.append(heading, body);
  return section;
}

function createSegmentedControl<T extends string>(
  label: string,
  values: T[],
  initial: T,
  descriptions: Record<T, string>,
  format: (value: T) => string = (value) => value.toUpperCase(),
  onChange: (value: T) => void = () => {},
): { root: HTMLDivElement; value: () => T; setValue: (value: T) => void; setDisabled: (disabled: boolean) => void } {
  let current = initial;
  let disabled = false;
  const root = document.createElement('div');
  root.className = 'war-field';
  const title = document.createElement('div');
  title.textContent = label.toUpperCase();
  title.className = 'war-field__label';
  const buttons = document.createElement('div');
  buttons.className = 'war-choice-group';
  buttons.style.setProperty('--option-count', String(values.length));
  const description = document.createElement('div');
  description.className = 'war-field__description';
  const render = (): void => {
    for (const button of Array.from(buttons.children) as HTMLButtonElement[]) {
      const active = button.dataset.value === current;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
      button.disabled = disabled;
    }
    description.textContent = descriptions[current];
  };
  for (const value of values) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'war-choice';
    button.dataset.value = value;
    button.textContent = format(value);
    button.onclick = () => {
      current = value;
      render();
      onChange(current);
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
      onChange(current);
    },
    setDisabled: (value) => {
      disabled = value;
      render();
    },
  };
}

function createArmySetupControl(initialCount: ArmyCount, initialSides: ArmySides, onChange: () => void = () => {}): {
  root: HTMLDivElement;
  armyCount: () => ArmyCount;
  armySides: () => ArmySides;
  setState: (count: ArmyCount, sides: ArmySides) => void;
  setPlayerIndex: (playerIndex: number) => void;
  setDisabled: (disabled: boolean) => void;
} {
  let count: ArmyCount = initialCount;
  let playerIndex = 1;
  let disabled = false;
  const sides: ArmySides = ensureOpposingSides(initialCount, initialSides);
  const root = document.createElement('div');
  root.className = 'war-armies';
  const title = document.createElement('div');
  title.className = 'war-armies__header';
  title.innerHTML = '<span>ARMY COUNT</span><small>SAME SIDE = ALLIES</small>';
  const countButtons = document.createElement('div');
  countButtons.className = 'war-choice-group';
  countButtons.style.setProperty('--option-count', '3');
  const sideRows = document.createElement('div');
  sideRows.className = 'war-armies__rows';
  const matchup = document.createElement('div');
  matchup.className = 'war-armies__matchup';
  matchup.setAttribute('aria-live', 'polite');

  const normalizeSides = (): void => {
    const normalized = ensureOpposingSides(count, sides);
    for (let index = 0; index < sides.length; index++) sides[index] = normalized[index];
  };

  const render = (): void => {
    for (const button of Array.from(countButtons.children) as HTMLButtonElement[]) {
      const active = Number(button.dataset.count) === count;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
      button.disabled = disabled;
    }
    for (const row of Array.from(sideRows.children) as HTMLElement[]) {
      const army = Number(row.dataset.army);
      row.style.display = army <= count ? 'grid' : 'none';
      const label = row.querySelector('.war-army-row__label');
      if (label) label.textContent = army === playerIndex ? `ARMY ${army} YOU` : `ARMY ${army} PLAYER / AI`;
      for (const button of Array.from(row.querySelectorAll('button')) as HTMLButtonElement[]) {
        const side = Number(button.dataset.side);
        const active = side === sides[army - 1];
        const proposedSides = sides.slice(0, count);
        proposedSides[army - 1] = side;
        const removesLastOpponent = new Set(proposedSides).size < 2;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
        button.disabled = disabled || removesLastOpponent;
        button.title = removesLastOpponent ? 'At least two opposing sides are required.' : '';
      }
    }
    matchup.textContent = formatArmyMatchup(count, sides);
  };

  for (const value of [2, 3, 4] as ArmyCount[]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'war-choice';
    button.dataset.count = String(value);
    button.textContent = `${value} ARMIES`;
    button.onclick = () => {
      count = value;
      if (value === 4 && sides.join(',') === '1,2,3,4') {
        sides[0] = 1;
        sides[1] = 1;
        sides[2] = 2;
        sides[3] = 2;
      }
      normalizeSides();
      render();
      onChange();
      button.blur();
    };
    countButtons.appendChild(button);
  }

  for (let army = 1; army <= 4; army++) {
    const row = document.createElement('div');
    row.dataset.army = String(army);
    row.className = 'war-army-row';
    const label = document.createElement('div');
    label.className = 'war-army-row__label';
    row.appendChild(label);
    for (let side = 1; side <= 4; side++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'war-choice war-choice--side';
      button.dataset.side = String(side);
      button.textContent = `SIDE ${side}`;
      button.onclick = () => {
        sides[army - 1] = side;
        normalizeSides();
        render();
        onChange();
        button.blur();
      };
      row.appendChild(button);
    }
    sideRows.appendChild(row);
  }

  root.append(title, countButtons, sideRows, matchup);
  render();
  return {
    root,
    armyCount: () => count,
    armySides: () => ensureOpposingSides(count, sides),
    setState: (nextCount, nextSides) => {
      count = nextCount;
      for (let index = 0; index < sides.length; index++) sides[index] = nextSides[index];
      normalizeSides();
      render();
      onChange();
    },
    setPlayerIndex: (nextPlayerIndex) => {
      playerIndex = Math.max(1, Math.min(4, Math.floor(nextPlayerIndex) || 1));
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
  startSkirmish: (settings: SkirmishSettings) => void,
  startMultiplayerMatch: (settings: SkirmishSettings) => void,
  rememberSession: (client: MultiplayerClient | undefined, session: MultiplayerSession | undefined) => void,
  currentSession: () => MultiplayerSession | undefined,
  applyRoomSettings: (room: MultiplayerRoom, playerIndex: number) => void,
  releaseRoomSettings: () => void,
): {
  root: HTMLDivElement;
  setMode: (mode: 'host' | 'join') => void;
  setMobileSummary: (summary: string) => void;
  syncHostSettings: () => void;
} {
  const root = document.createElement('div');
  root.className = 'war-operation';

  const hostEntry = document.createElement('div');
  hostEntry.className = 'war-operation__entry';
  hostEntry.innerHTML =
    '<div class="war-aside__kicker">HOST COMMAND</div>' +
    '<h2>START YOUR BATTLE</h2>' +
    '<p>Launch an instant skirmish against AI, or open an online room when another commander is joining.</p>';

  const hostCard = document.createElement('section');
  hostCard.className = 'war-mode-card war-mode-card--primary';
  const hostCopy = document.createElement('div');
  hostCopy.innerHTML = '<span class="war-multiplayer__step">BATTLE MODE</span><h3>SKIRMISH READY</h3><p>Starts locally with no network delay. Open a room only if you want another player to join.</p>';

  const joinEntry = document.createElement('div');
  joinEntry.className = 'war-operation__entry war-operation__entry--join';
  joinEntry.innerHTML =
    '<div class="war-aside__kicker">JOIN COMMAND</div>' +
    '<h2>JOIN A BATTLE</h2>' +
    '<p>Enter the room code from the host. Their battlefield configuration will appear here automatically.</p>';

  const serverLabel = setupTextInput('Server', storedMultiplayerServer());
  const codeLabel = setupTextInput('Room', normalizeRoomCode(new URLSearchParams(location.search).get('room') ?? ''));
  codeLabel.input.placeholder = 'ABCD';
  codeLabel.input.maxLength = 8;

  const host = document.createElement('button');
  host.type = 'button';
  host.textContent = 'OPEN ONLINE ROOM';
  host.className = 'war-button war-button--secondary';
  const skirmish = document.createElement('button');
  skirmish.type = 'button';
  skirmish.textContent = 'START SKIRMISH';
  skirmish.className = 'war-button war-button--primary';
  const hostActions = document.createElement('div');
  hostActions.className = 'war-mode-card__actions';
  const mobileDeploySummary = document.createElement('div');
  mobileDeploySummary.className = 'war-mobile-deploy-summary';
  mobileDeploySummary.innerHTML = '<span>READY TO DEPLOY</span><strong></strong>';
  hostActions.append(mobileDeploySummary, skirmish, host);
  hostCard.append(hostCopy, hostActions);
  hostEntry.append(hostCard);

  const joinCard = document.createElement('section');
  joinCard.className = 'war-mode-card war-mode-card--primary';
  const join = document.createElement('button');
  join.type = 'button';
  join.textContent = 'JOIN ROOM';
  join.className = 'war-button war-button--primary';
  const joinActions = document.createElement('div');
  joinActions.className = 'war-multiplayer__join';
  joinActions.append(codeLabel.root, join);
  joinCard.appendChild(joinActions);
  joinEntry.appendChild(joinCard);

  const status = document.createElement('div');
  status.className = 'war-multiplayer__status';
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Local skirmish ready · no multiplayer connection is active.';

  const setStatus = (message: string, bad = false): void => {
    status.textContent = message;
    status.classList.toggle('is-error', bad);
    status.hidden = false;
  };
  let activeMode: 'host' | 'join' = new URLSearchParams(location.search).has('room') ? 'join' : 'host';
  let activeClient: MultiplayerClient | undefined;
  let activeSession: MultiplayerSession | undefined;
  let openingHostRoom = false;
  let settingsSyncTimer: number | undefined;
  let lobbyView: ReturnType<typeof createRoomLobbyView> | undefined;

  const render = (): void => {
    const connected = Boolean(activeSession);
    hostEntry.hidden = connected || activeMode !== 'host';
    joinEntry.hidden = connected || activeMode !== 'join';
    if (lobbyView) lobbyView.root.hidden = !connected;
    if (connected) status.hidden = true;
  };

  const leaveActiveSession = (): void => {
    const wasHost = activeSession?.player.index === 1;
    const client = activeClient;
    activeClient = undefined;
    activeSession = undefined;
    client?.disconnect();
    lobbyView?.root.remove();
    lobbyView = undefined;
    if (wasHost) codeLabel.input.value = '';
    rememberSession(undefined, undefined);
    releaseRoomSettings();
    const url = new URL(location.href);
    if (url.searchParams.has('room')) {
      url.searchParams.delete('room');
      history.replaceState(history.state, '', url);
    }
    render();
    setStatus(wasHost
      ? 'Returned to Battle Setup · open a new room when your battlefield is ready.'
      : 'You left the room · choose a battle mode or join another room.');
  };

  const connectSession = (client: MultiplayerClient, session: MultiplayerSession): void => {
    activeClient = client;
    activeSession = session;
    activeMode = session.player.index === 1 ? 'host' : 'join';
    rememberPlayerId(client.baseUrl, session.room.code, session.player.id);
    if (session.player.index === 1) rememberPlayerId(client.baseUrl, 'HOST', session.player.id);
    rememberSession(client, session);
    applyRoomSettings(session.room, session.player.index);
    lobbyView?.root.remove();
    lobbyView = createRoomLobbyView(client, session, settings, startSkirmish, leaveActiveSession);
    document.body.appendChild(lobbyView.root);
    lobbyView.update(session.room, session.player.index);
    codeLabel.input.value = session.room.code;
    renderRoomStatus(session.room, session.player.index, setStatus);
    render();
    client.connect(
      session.room.code,
      session.player.id,
      (event) => {
        if (event.type === 'room-state' || event.type === 'match-start') {
          session.room = event.room;
          const latest = event.room.players.find((player) => player.id === session.player.id);
          if (latest) session.player = latest;
          activeSession = session;
          applyRoomSettings(event.room, session.player.index);
          lobbyView?.update(event.room, session.player.index);
        }
        handleMultiplayerEvent(event, session.player.index, setStatus, startMultiplayerMatch);
      },
      () => {
        if (activeClient === client && activeSession === session) {
          setStatus('Connection interrupted. Check the multiplayer server is still running.', true);
        }
      },
    );
  };

  const openHostRoom = async (): Promise<void> => {
    if (openingHostRoom || activeSession || activeMode !== 'host') return;
    openingHostRoom = true;
    skirmish.disabled = true;
    host.disabled = true;
    host.textContent = 'OPENING ROOM...';
    setStatus('Waking the battle server · first connection can take up to a minute...', false);
    let client: MultiplayerClient | undefined;
    try {
      const server = normalizedBaseUrl(serverLabel.input.value);
      window.localStorage.setItem(MULTIPLAYER_SERVER_STORAGE_KEY, server);
      await waitForMultiplayerServer(server);
      if (activeMode !== 'host' || activeSession) return;
      setStatus('Battle server online · opening your room...', false);
      client = new MultiplayerClient(server);
      const session = await client.host({ ...settings(), name: betaPlayerName() ?? 'Host', playerId: rememberedPlayerId(server, 'HOST') });
      if (activeMode !== 'host' || activeSession) {
        client.disconnect();
        return;
      }
      connectSession(client, session);
    } catch (err) {
      if (activeMode === 'host') setStatus(`Could not open room: ${friendlyMultiplayerError(err)}`, true);
    } finally {
      openingHostRoom = false;
      if (!activeSession && activeMode === 'host') {
        skirmish.disabled = false;
        host.disabled = false;
        host.textContent = 'OPEN ONLINE ROOM';
      }
      host.blur();
    }
  };
  host.onclick = () => void openHostRoom();
  skirmish.onclick = () => {
    skirmish.disabled = true;
    startSkirmish(settings());
  };

  const joinRoom = async (): Promise<void> => {
    try {
      join.disabled = true;
      const code = normalizeRoomCode(codeLabel.input.value);
      if (!code) throw new Error('enter-room-code');
      const server = normalizedBaseUrl(serverLabel.input.value);
      window.localStorage.setItem(MULTIPLAYER_SERVER_STORAGE_KEY, server);
      setStatus('Waking the battle server · first connection can take up to a minute...', false);
      await waitForMultiplayerServer(server);
      if (activeMode !== 'join' || activeSession) return;
      setStatus('Battle server online · joining room...', false);
      const existing = currentSession();
      const client = new MultiplayerClient(server);
      const session = await client.join(code, betaPlayerName() ?? 'Guest', existing?.player.id ?? rememberedPlayerId(server, code));
      connectSession(client, session);
    } catch (err) {
      setStatus(`Could not join room: ${friendlyMultiplayerError(err)}`, true);
    } finally {
      join.disabled = false;
      join.blur();
    }
  };
  join.onclick = () => void joinRoom();
  codeLabel.input.onkeydown = (event) => {
    if (event.key === 'Enter') void joinRoom();
  };

  const advanced = document.createElement('details');
  advanced.className = 'war-multiplayer__advanced';
  const advancedSummary = document.createElement('summary');
  advancedSummary.textContent = 'ADVANCED CONNECTION';
  advanced.append(advancedSummary, serverLabel.root);
  root.append(hostEntry, joinEntry, status, advanced);
  if (normalizeRoomCode(new URLSearchParams(location.search).get('room') ?? '') && !currentSession()) {
    setStatus('Joining invitation...');
    void joinRoom();
  }
  render();
  return {
    root,
    setMobileSummary: (summary) => {
      const value = mobileDeploySummary.querySelector('strong');
      if (value) value.textContent = summary;
    },
    setMode: (nextMode) => {
      if (activeSession) {
        const currentMode = activeSession.player.index === 1 ? 'host' : 'join';
        if (currentMode === nextMode) return;
        leaveActiveSession();
      }
      activeMode = nextMode;
      render();
      if (nextMode === 'host') setStatus('Local skirmish ready · no multiplayer connection is active.', false);
      else setStatus('Enter the room code shared by the host.', false);
    },
    syncHostSettings: () => {
      if (!activeClient || !activeSession || activeSession.player.index !== 1 || activeSession.room.status !== 'waiting') return;
      if (settingsSyncTimer !== undefined) window.clearTimeout(settingsSyncTimer);
      settingsSyncTimer = window.setTimeout(() => {
        if (!activeClient || !activeSession || activeSession.player.index !== 1 || activeSession.room.status !== 'waiting') return;
        activeClient.updateSettings(activeSession.room.code, activeSession.player.id, settings());
      }, 90);
    },
  };
}

function createRoomLobbyView(
  client: MultiplayerClient,
  session: MultiplayerSession,
  settings: () => SkirmishSettings,
  startSkirmish: (settings: SkirmishSettings) => void,
  returnToSetup: () => void,
): { root: HTMLDivElement; update: (room: MultiplayerRoom, playerIndex: number) => void } {
  const root = document.createElement('div');
  root.className = 'war-lobby';
  const panel = document.createElement('div');
  panel.className = 'war-lobby__panel';

  const heading = document.createElement('div');
  heading.className = 'war-lobby__header';
  const title = document.createElement('div');
  title.className = 'war-lobby__title';
  const headerTools = document.createElement('div');
  headerTools.className = 'war-lobby__header-tools';
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = '← BATTLE SETUP';
  back.className = 'war-button war-button--quiet war-lobby__back';
  back.setAttribute('aria-label', 'Leave this room and return to Battle Setup');
  back.onclick = returnToSetup;
  const shareCopy = document.createElement('div');
  shareCopy.className = 'war-lobby__room-code';
  shareCopy.innerHTML = '<span>ROOM</span><strong></strong>';
  const canNativeShare = Reflect.has(navigator, 'share') && typeof navigator.share === 'function';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = canNativeShare ? 'SHARE LINK' : 'COPY LINK';
  copy.className = 'war-button war-button--secondary war-lobby__copy';
  headerTools.append(back, shareCopy);
  heading.append(title, headerTools);

  let latestRoom = session.room;
  let selectedArmy = session.player.index;

  const briefing = document.createElement('section');
  briefing.className = 'war-lobby__briefing';
  briefing.innerHTML =
    '<div><span>IRON DOMINION · ONLINE BATTLE</span><strong>BUILD. HARVEST. COMMAND. FIGHT.</strong></div>' +
    '<p>Establish power and production, harvest ore, command your army from above, or enter any unit with <b>V</b>. Destroy every hostile Command Yard to win.</p>';

  const battlefield = document.createElement('section');
  battlefield.className = 'war-lobby__battlefield';
  const battlefieldHeader = document.createElement('div');
  battlefieldHeader.className = 'war-lobby__battlefield-header';
  battlefieldHeader.innerHTML = '<div><span>DEPLOYMENT MAP</span><strong></strong></div><p></p>';
  const battlefieldSettings = document.createElement('div');
  battlefieldSettings.className = 'war-lobby__battlefield-settings';
  const createRoomSetting = (label: string): { root: HTMLDivElement; choices: HTMLDivElement } => {
    const field = document.createElement('div');
    field.className = 'war-lobby__room-setting';
    const title = document.createElement('span');
    title.textContent = label;
    const choices = document.createElement('div');
    choices.className = 'war-lobby__setting-choices';
    field.append(title, choices);
    return { root: field, choices };
  };
  const mapSetting = createRoomSetting('MAP TYPE');
  const sizeSetting = createRoomSetting('MAP SIZE');
  const aiSetting = createRoomSetting('AI STRENGTH');
  const seedSetting = createRoomSetting('MAP SEED');
  seedSetting.root.classList.add('war-lobby__room-setting--seed');
  seedSetting.choices.classList.add('war-lobby__seed-controls');
  const oreSetting = createRoomSetting('ORE AMOUNT');
  oreSetting.root.classList.add('war-lobby__room-setting--ore');
  oreSetting.choices.classList.add('war-lobby__ore-controls');
  const combatSetting = createRoomSetting('COMBAT MODE');
  combatSetting.root.classList.add('war-lobby__room-setting--combat');
  const mapButtons = new Map<MapId, HTMLButtonElement>();
  const sizeButtons = new Map<MapSize, HTMLButtonElement>();
  const aiButtons = new Map<Difficulty, HTMLButtonElement>();
  const combatButtons = new Map<CombatMode, HTMLButtonElement>();
  for (const mapId of MAP_IDS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = MAP_PRESETS[mapId].shortLabel;
    button.onclick = () => client.updateSettings(latestRoom.code, session.player.id, { ...settings(), mapId });
    mapButtons.set(mapId, button);
    mapSetting.choices.appendChild(button);
  }
  for (const mapSize of MAP_SIZE_IDS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = MAP_SIZE_PRESETS[mapSize].label;
    button.onclick = () => client.updateSettings(latestRoom.code, session.player.id, { ...settings(), mapSize });
    sizeButtons.set(mapSize, button);
    sizeSetting.choices.appendChild(button);
  }
  for (const difficulty of DIFFICULTIES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = difficulty === 'normal' ? 'MEDIUM' : difficulty.toUpperCase();
    button.onclick = () => client.updateSettings(latestRoom.code, session.player.id, { ...settings(), ai: difficulty });
    aiButtons.set(difficulty, button);
    aiSetting.choices.appendChild(button);
  }
  aiSetting.root.title = 'Applies to every army slot controlled by AI.';
  const seedInput = document.createElement('input');
  seedInput.type = 'number';
  seedInput.min = '1';
  seedInput.step = '1';
  seedInput.inputMode = 'numeric';
  seedInput.className = 'war-lobby__seed-input';
  seedInput.setAttribute('aria-label', 'Map seed');
  const commitSeed = (): void => {
    if (session.player.index !== 1 || latestRoom.status !== 'waiting') return;
    const seed = Math.max(1, Math.floor(Number(seedInput.value) || latestRoom.seed));
    seedInput.value = String(seed);
    client.updateSettings(latestRoom.code, session.player.id, { ...settings(), seed });
  };
  seedInput.onchange = commitSeed;
  seedInput.onkeydown = (event) => {
    if (event.key === 'Enter') {
      commitSeed();
      seedInput.blur();
    }
  };
  const randomizeSeed = document.createElement('button');
  randomizeSeed.type = 'button';
  randomizeSeed.textContent = 'RANDOMIZE';
  randomizeSeed.setAttribute('aria-label', 'Generate a new random map seed');
  randomizeSeed.onclick = () => {
    if (session.player.index !== 1 || latestRoom.status !== 'waiting') return;
    const seed = randomSeed();
    seedInput.value = String(seed);
    client.updateSettings(latestRoom.code, session.player.id, { ...settings(), seed });
    randomizeSeed.blur();
  };
  seedSetting.choices.append(seedInput, randomizeSeed);
  const roomOreInput = document.createElement('input');
  roomOreInput.type = 'range';
  roomOreInput.min = String(ORE_AMOUNT_MIN);
  roomOreInput.max = String(ORE_AMOUNT_MAX);
  roomOreInput.step = String(ORE_AMOUNT_STEP);
  roomOreInput.setAttribute('aria-label', 'Ore amount');
  const roomOreOutput = document.createElement('output');
  const updateRoomOreReadout = (): void => {
    const amount = sanitizeOreAmount(roomOreInput.value) ?? DEFAULT_ORE_AMOUNT;
    const mapId = sanitizeMapId(latestRoom.mapId) ?? DEFAULT_MAP_ID;
    const mapSize = sanitizeMapSize(latestRoom.mapSize) ?? DEFAULT_MAP_SIZE;
    const fields = oreFieldCount(mapId, mapSize, amount);
    roomOreOutput.textContent = `${oreAmountLabel(amount)} · ${fields} FIELDS`;
    roomOreInput.setAttribute('aria-valuetext', `${oreAmountLabel(amount)}, ${fields} ore fields, ${amount} percent`);
  };
  roomOreInput.oninput = updateRoomOreReadout;
  roomOreInput.onchange = () => {
    if (session.player.index !== 1 || latestRoom.status !== 'waiting') return;
    const oreAmount = sanitizeOreAmount(roomOreInput.value) ?? DEFAULT_ORE_AMOUNT;
    client.updateSettings(latestRoom.code, session.player.id, { ...settings(), oreAmount });
  };
  oreSetting.choices.append(roomOreInput, roomOreOutput);
  for (const combatMode of COMBAT_MODES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = combatMode.toUpperCase();
    button.title = COMBAT_MODE_DESCRIPTIONS[combatMode];
    button.onclick = () => client.updateSettings(latestRoom.code, session.player.id, { ...settings(), combatMode });
    combatButtons.set(combatMode, button);
    combatSetting.choices.appendChild(button);
  }
  battlefieldSettings.append(mapSetting.root, sizeSetting.root, aiSetting.root, seedSetting.root, oreSetting.root, combatSetting.root);
  const map = document.createElement('div');
  map.className = 'war-lobby__map';
  battlefield.append(battlefieldHeader, battlefieldSettings, map);

  const invite = document.createElement('section');
  invite.className = 'war-lobby__invite';
  const inviteHeading = document.createElement('div');
  inviteHeading.className = 'war-lobby__invite-heading';
  inviteHeading.innerHTML = '<strong>INVITE PLAYERS</strong><span>Send this link. They will sign up if needed, then join this room automatically.</span>';
  const inviteControls = document.createElement('div');
  inviteControls.className = 'war-lobby__invite-controls';
  const inviteLink = document.createElement('input');
  inviteLink.className = 'war-lobby__invite-link';
  inviteLink.type = 'text';
  inviteLink.readOnly = true;
  inviteLink.setAttribute('aria-label', 'Multiplayer invitation link');
  inviteLink.onclick = () => inviteLink.select();
  inviteControls.append(inviteLink, copy);
  invite.append(inviteHeading, inviteControls);

  const armyBar = document.createElement('div');
  armyBar.className = 'war-lobby__army-bar';
  const armyLabel = document.createElement('div');
  armyLabel.className = 'war-lobby__army-label';
  armyLabel.innerHTML = '<strong>ARMIES IN BATTLE</strong><span>Empty slots deploy as AI</span>';
  const armyChoices = document.createElement('div');
  armyChoices.className = 'war-lobby__army-choices';
  const armyButtons = new Map<ArmyCount, HTMLButtonElement>();
  for (const count of [2, 3, 4] as ArmyCount[]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'war-lobby__army-choice';
    button.textContent = String(count);
    button.setAttribute('aria-label', `${count} armies in battle`);
    button.onclick = () => {
      if (session.player.index !== 1 || latestRoom.status !== 'waiting') return;
      const armySides = [...latestRoom.armySides] as ArmySides;
      if (count === 4 && armySides.join(',') === '1,2,3,4') {
        armySides[0] = 1;
        armySides[1] = 1;
        armySides[2] = 2;
        armySides[3] = 2;
      }
      client.updateSettings(latestRoom.code, session.player.id, {
        ...settings(),
        armyCount: count,
        armySides: ensureOpposingSides(count, armySides),
      });
      button.blur();
    };
    armyButtons.set(count, button);
    armyChoices.appendChild(button);
  }
  armyBar.append(armyLabel, armyChoices);

  const status = document.createElement('div');
  status.className = 'war-lobby__status';
  status.setAttribute('aria-live', 'polite');

  const players = document.createElement('div');
  players.className = 'war-lobby__players';
  const tableHead = document.createElement('div');
  tableHead.className = 'war-lobby__table-head';
  tableHead.innerHTML = '<span>PLAYER</span><span>TEAM</span><span>COLOUR</span>';
  const defaultColors = ['jade', 'crimson', 'azure', 'amber'] as const;
  const playerRows = Array.from({ length: 4 }, (_, offset) => {
    const index = offset + 1;
    const row = document.createElement('div');
    row.className = 'war-lobby__player';
    const slot = document.createElement('div');
    slot.className = 'war-lobby__slot';
    slot.textContent = `P${index}`;
    const identity = document.createElement('div');
    identity.className = 'war-lobby__identity';
    const nameInput = document.createElement('input');
    nameInput.className = 'war-lobby__name-input';
    nameInput.maxLength = 28;
    nameInput.setAttribute('aria-label', `Player ${index} commander name`);
    const nameText = document.createElement('div');
    nameText.className = 'war-lobby__player-name';
    const connection = document.createElement('div');
    connection.className = 'war-lobby__connection';
    identity.append(nameInput, nameText, connection);
    const team = document.createElement('select');
    team.className = 'war-lobby__team';
    team.setAttribute('aria-label', `Player ${index} team`);
    for (let side = 1; side <= 4; side++) {
      const option = document.createElement('option');
      option.value = String(side);
      option.textContent = `SIDE ${side}`;
      team.appendChild(option);
    }
    const colorPicker = document.createElement('div');
    colorPicker.className = 'war-lobby__color-picker';
    const colorButtons = new Map<keyof typeof LOBBY_COLORS, HTMLButtonElement>();
    for (const [color, value] of Object.entries(LOBBY_COLORS) as [keyof typeof LOBBY_COLORS, string][]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'war-lobby__color';
      button.title = color;
      button.setAttribute('aria-label', `Player ${index} colour ${color}`);
      button.style.background = value;
      button.onclick = () => client.updatePlayerProfile(latestRoom.code, session.player.id, { color });
      colorButtons.set(color, button);
      colorPicker.appendChild(button);
    }
    const colorDisplay = document.createElement('div');
    colorDisplay.className = 'war-lobby__color-display';
    let nameSaveTimer: number | undefined;
    const saveName = (): void => {
      if (nameSaveTimer !== undefined) window.clearTimeout(nameSaveTimer);
      nameSaveTimer = undefined;
      client.updatePlayerProfile(latestRoom.code, session.player.id, { name: nameInput.value });
    };
    nameInput.oninput = () => {
      if (nameSaveTimer !== undefined) window.clearTimeout(nameSaveTimer);
      nameSaveTimer = window.setTimeout(saveName, 250);
    };
    nameInput.onchange = saveName;
    team.onchange = () => {
      const player = latestRoom.players.find((candidate) => candidate.index === index);
      const nextSide = Number(team.value);
      if (player?.id === session.player.id) {
        client.updatePlayerProfile(latestRoom.code, session.player.id, { side: nextSide });
      } else if (session.player.index === 1) {
        const armySides = [...latestRoom.armySides] as ArmySides;
        armySides[index - 1] = nextSide;
        client.updateSettings(latestRoom.code, session.player.id, { ...settings(), armySides });
      }
    };
    row.onclick = (event) => {
      if (session.player.index !== 1 || latestRoom.status !== 'waiting') return;
      if ((event.target as HTMLElement).closest('input,button,select')) return;
      selectedArmy = index;
      update(latestRoom, session.player.index);
    };
    row.append(slot, identity, team, colorPicker, colorDisplay);
    return { row, slot, nameInput, nameText, connection, team, colorPicker, colorButtons, colorDisplay, defaultColor: defaultColors[offset] };
  });
  players.append(tableHead, ...playerRows.map((view) => view.row));

  const actions = document.createElement('div');
  actions.className = 'war-lobby__actions';
  copy.onclick = async () => {
    const inviteUrl = multiplayerInviteUrl(location.href, latestRoom.code);
    try {
      if (canNativeShare) {
        await navigator.share({
          title: 'Join my Iron Dominion battle',
          text: `Join room ${latestRoom.code}. The battlefield is already configured.`,
          url: inviteUrl,
        });
        status.textContent = `Invitation ready · room ${latestRoom.code}`;
      } else {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(inviteUrl);
        } else {
          const fallback = document.createElement('textarea');
          fallback.value = inviteUrl;
          fallback.style.cssText = 'position:fixed;left:-9999px;top:0;';
          document.body.appendChild(fallback);
          fallback.select();
          const copied = document.execCommand('copy');
          fallback.remove();
          if (!copied) throw new Error('clipboard-unavailable');
        }
        status.textContent = `Invite link copied · room ${latestRoom.code}`;
      }
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        status.textContent = 'Could not share the invitation. Copy the room code instead.';
      }
    }
    copy.blur();
  };
  const ready = document.createElement('button');
  ready.type = 'button';
  ready.className = 'war-button war-button--primary war-lobby__cta';
  ready.onclick = () => client.setReady(latestRoom.code, session.player.id, !session.player.ready);
  const launch = document.createElement('button');
  launch.type = 'button';
  launch.className = 'war-button war-button--primary war-lobby__cta';
  launch.onclick = () => {
    if (session.player.index !== 1) return;
    if (shouldLaunchLocalSkirmish(latestRoom, session.player.id)) {
      launch.disabled = true;
      launch.textContent = 'STARTING SKIRMISH...';
      status.textContent = 'No guest connected · closing the room and starting locally.';
      startSkirmish(settingsFromRoom(latestRoom));
      return;
    }
    client.startMatch(latestRoom.code, session.player.id);
    launch.disabled = true;
    launch.textContent = 'STARTING MATCH...';
  };
  actions.append(ready, launch);

  const roster = document.createElement('div');
  roster.className = 'war-lobby__roster';
  const rosterTitle = document.createElement('div');
  rosterTitle.className = 'war-lobby__section-title';
  rosterTitle.textContent = 'PLAYERS';
  roster.append(rosterTitle, players);
  const command = document.createElement('section');
  command.className = 'war-lobby__command';
  command.append(invite, armyBar, roster, actions, status);
  const roomGrid = document.createElement('div');
  roomGrid.className = 'war-lobby__grid';
  roomGrid.append(battlefield, command);
  panel.append(heading, briefing, roomGrid);
  root.appendChild(panel);

  let lastDeploymentSignature = '';
  const renderDeploymentMap = (room: MultiplayerRoom, isHost: boolean): void => {
    const mapId = sanitizeMapId(room.mapId) ?? DEFAULT_MAP_ID;
    const mapSize = sanitizeMapSize(room.mapSize) ?? DEFAULT_MAP_SIZE;
    const signature = JSON.stringify({
      mapId,
      mapSize,
      seed: room.seed,
      oreAmount: room.oreAmount,
      armyCount: room.armyCount,
      armySides: room.armySides,
      spawnSlots: room.spawnSlots,
      selectedArmy,
      players: room.players.map((player) => [player.index, player.name, player.color, player.connected]),
    });
    if (signature === lastDeploymentSignature) return;
    lastDeploymentSignature = signature;
    const oreAmount = sanitizeOreAmount(room.oreAmount) ?? DEFAULT_ORE_AMOUNT;
    renderLobbyMapPreview(map, MAP_PRESETS[mapId], room.seed, mapSize, oreAmount);
    const overlay = document.createElement('div');
    overlay.className = 'war-lobby__deployments';
    const slots = sanitizeSpawnSlots(room.spawnSlots) ?? defaultSpawnSlots();
    for (let spawnSlot = 1; spawnSlot <= 4; spawnSlot++) {
      const armyOffset = slots.findIndex((slot) => slot === spawnSlot);
      const armyIndex = armyOffset + 1;
      const active = armyIndex > 0 && armyIndex <= room.armyCount;
      const player = active ? room.players.find((candidate) => candidate.index === armyIndex) : undefined;
      const color = active ? player?.color ?? (['jade', 'crimson', 'azure', 'amber'] as const)[armyIndex - 1] : undefined;
      const point = startPosition(100, spawnSlot);
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'war-lobby__deployment';
      marker.classList.toggle('is-active', active);
      marker.classList.toggle('is-selected', active && selectedArmy === armyIndex);
      marker.style.left = `${50 + point.x}%`;
      marker.style.top = `${50 + point.z}%`;
      marker.style.setProperty('--army-color', color ? LOBBY_COLORS[color] : '#63706b');
      marker.disabled = !isHost || room.status !== 'waiting';
      marker.setAttribute('aria-label', active ? `Army ${armyIndex} deployment position` : `Empty deployment position ${spawnSlot}`);
      marker.innerHTML = active
        ? `<span class="war-lobby__deployment-pin">${armyIndex}</span><strong>${escapeLobbyText(player?.name ?? `AI ARMY ${armyIndex}`)}</strong><small>SIDE ${room.armySides[armyIndex - 1] ?? armyIndex}</small>`
        : '<span class="war-lobby__deployment-pin">+</span><strong>OPEN POSITION</strong>';
      marker.onclick = () => {
        if (!isHost || room.status !== 'waiting') return;
        if (active && selectedArmy === armyIndex) {
          marker.blur();
          return;
        }
        const movingArmy = Math.max(1, Math.min(room.armyCount, selectedArmy));
        const next = [...slots] as ArmySpawnSlots;
        const targetArmyOffset = slots.findIndex((slot) => slot === spawnSlot);
        const previousSlot = next[movingArmy - 1];
        next[movingArmy - 1] = spawnSlot;
        if (targetArmyOffset >= 0) next[targetArmyOffset] = previousSlot;
        client.updateSettings(room.code, session.player.id, { ...settings(), spawnSlots: next });
        marker.blur();
      };
      overlay.appendChild(marker);
    }
    map.appendChild(overlay);
    const mapTitle = battlefieldHeader.querySelector('strong');
    const mapHelp = battlefieldHeader.querySelector('p');
    if (mapTitle) mapTitle.textContent = `${MAP_PRESETS[mapId].label} · ${MAP_SIZE_PRESETS[mapSize].label} · ${oreFieldCount(mapId, mapSize, oreAmount)} ORE FIELDS`;
    if (mapHelp) mapHelp.textContent = isHost
      ? `Army ${selectedArmy} selected · click another deployment point to swap positions.`
      : 'The host controls deployment positions. Your assigned army is highlighted.';
  };

  const update = (room: MultiplayerRoom, playerIndex: number): void => {
    latestRoom = room;
    session.room = room;
    selectedArmy = Math.max(1, Math.min(room.armyCount, selectedArmy));
    title.textContent = playerIndex === 1 ? 'COMMAND WAR ROOM' : 'BATTLE BRIEFING';
    const roomCode = shareCopy.querySelector('strong');
    if (roomCode) roomCode.textContent = room.code;
    const isHost = playerIndex === 1;
    invite.hidden = !isHost || room.status !== 'waiting';
    inviteLink.value = multiplayerInviteUrl(location.href, room.code);
    for (const [count, button] of armyButtons) {
      const selected = room.armyCount === count;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = !isHost || room.status !== 'waiting';
    }
    const roomMapId = sanitizeMapId(room.mapId) ?? DEFAULT_MAP_ID;
    const roomMapSize = sanitizeMapSize(room.mapSize) ?? DEFAULT_MAP_SIZE;
    for (const [mapId, button] of mapButtons) {
      button.classList.toggle('is-active', mapId === roomMapId);
      button.disabled = !isHost || room.status !== 'waiting';
    }
    for (const [mapSize, button] of sizeButtons) {
      button.classList.toggle('is-active', mapSize === roomMapSize);
      button.disabled = !isHost || room.status !== 'waiting';
    }
    for (const [difficulty, button] of aiButtons) {
      button.classList.toggle('is-active', difficulty === room.ai);
      button.disabled = !isHost || room.status !== 'waiting';
    }
    if (document.activeElement !== seedInput) seedInput.value = String(room.seed);
    seedInput.disabled = !isHost || room.status !== 'waiting';
    randomizeSeed.disabled = !isHost || room.status !== 'waiting';
    if (document.activeElement !== roomOreInput) roomOreInput.value = String(sanitizeOreAmount(room.oreAmount) ?? DEFAULT_ORE_AMOUNT);
    roomOreInput.disabled = !isHost || room.status !== 'waiting';
    updateRoomOreReadout();
    for (const [combatMode, button] of combatButtons) {
      const selected = combatMode === room.combatMode;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = !isHost || room.status !== 'waiting';
    }
    for (let offset = 0; offset < playerRows.length; offset++) {
      const index = offset + 1;
      const view = playerRows[offset];
      const player = room.players.find((candidate) => candidate.index === index);
      const isLocal = player?.id === session.player.id;
      const color = player?.color ?? view.defaultColor;
      view.row.hidden = index > room.armyCount;
      view.row.classList.toggle('is-local', isLocal);
      view.row.classList.toggle('is-open', !player?.connected);
      view.row.classList.toggle('is-selected', isHost && selectedArmy === index);
      view.row.style.setProperty('--army-color', LOBBY_COLORS[color]);
      view.slot.style.color = LOBBY_COLORS[color];
      view.nameInput.hidden = !isLocal;
      view.nameText.hidden = isLocal;
      if (isLocal && document.activeElement !== view.nameInput) view.nameInput.value = player?.name ?? session.player.name;
      view.nameInput.disabled = room.status !== 'waiting';
      view.nameText.textContent = player?.name ?? (index === 1 ? 'HOST SLOT' : 'OPEN / AI');
      view.connection.textContent = player?.connected
        ? player.ready ? 'READY' : `${player.pingMs ?? '...'}ms · NOT READY`
        : player ? 'DISCONNECTED · AI ON START' : 'AI FILLS IF EMPTY';
      view.connection.style.color = player?.ready ? '#7df27d' : player?.connected ? '#f0d56a' : '#6f7b78';
      view.team.value = String(room.armySides[index - 1] ?? index);
      view.team.disabled = room.status !== 'waiting' || (!isLocal && !isHost);
      view.colorPicker.hidden = !isLocal;
      view.colorDisplay.hidden = isLocal;
      view.colorDisplay.style.background = LOBBY_COLORS[color];
      view.colorDisplay.title = color;
      for (const [buttonColor, button] of view.colorButtons) {
        const selected = buttonColor === color;
        button.classList.toggle('is-active', selected);
        button.disabled = !isLocal || room.status !== 'waiting';
      }
    }
    const localPlayer = room.players.find((player) => player.id === session.player.id) ?? session.player;
    session.player = localPlayer;
    const connectedPlayers = room.players.filter((player) => player.connected);
    const connected = connectedPlayers.length;
    const openSlots = Math.max(0, room.armyCount - connected);
    const allConnectedReady = connected > 0 && connectedPlayers.every((player) => player.ready);
    const engines = new Set(room.players.map((player) => player.engine).filter(Boolean));
    renderDeploymentMap(room, isHost);
    if (room.status === 'starting') status.textContent = 'Launching · synchronizing commanders and AI forces...';
    else if (engines.size > 1) status.textContent = 'Different browsers detected · matching browsers are recommended.';
    else if (!allConnectedReady) {
      const notReady = connectedPlayers.filter((player) => !player.ready).length;
      status.textContent = `${notReady} ${notReady === 1 ? 'commander' : 'commanders'} must confirm READY before deployment.`;
    }
    else if (openSlots > 0) status.textContent = playerIndex === 1
      ? shouldLaunchLocalSkirmish(room, session.player.id)
        ? 'No guest connected · Start launches a local skirmish with AI.'
        : `${openSlots} open ${openSlots === 1 ? 'slot' : 'slots'} will deploy as AI.`
      : `${openSlots} open ${openSlots === 1 ? 'slot' : 'slots'} will deploy as AI · waiting for host.`;
    else status.textContent = playerIndex === 1 ? 'All commanders ready.' : 'Ready · waiting for host.';
    ready.hidden = false;
    launch.hidden = !isHost;
    ready.disabled = room.status !== 'waiting';
    ready.classList.toggle('is-confirmed', Boolean(localPlayer.ready));
    ready.textContent = localPlayer.ready ? 'READY CONFIRMED · CLICK TO CANCEL' : 'CONFIRM READY';
    const canLaunch = isHost && allConnectedReady && room.status === 'waiting';
    launch.disabled = !canLaunch;
    launch.textContent = room.status === 'starting'
      ? 'STARTING GAME...'
      : !allConnectedReady
        ? 'WAITING FOR READY'
        : shouldLaunchLocalSkirmish(room, session.player.id)
          ? 'START SKIRMISH'
          : 'START MULTIPLAYER GAME';
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
  const connectedPlayers = room.players.filter((player) => player.connected);
  const connected = connectedPlayers.length;
  const openSlots = Math.max(0, room.armyCount - connected);
  const team = `army ${playerIndex} / side ${room.armySides[playerIndex - 1] ?? playerIndex}`;
  const map = MAP_PRESETS[sanitizeMapId(room.mapId) ?? DEFAULT_MAP_ID].shortLabel;
  const mapSize = MAP_SIZE_PRESETS[sanitizeMapSize(room.mapSize) ?? DEFAULT_MAP_SIZE].label;
  const countdown =
    room.status === 'starting' && room.startsAt ? `starting in ${Math.max(1, Math.ceil((room.startsAt - Date.now()) / 1000))}s` : undefined;
  const waiting = countdown ?? (room.status === 'waiting'
    ? playerIndex === 1
      ? connectedPlayers.every((player) => player.ready)
        ? openSlots > 0 ? `ready to launch · ${openSlots} AI ${openSlots === 1 ? 'slot' : 'slots'}` : 'host can launch'
        : 'waiting for joined commanders to ready'
      : 'waiting for host'
    : room.status);
  const combat = room.combatMode === 'manual' ? 'manual combat' : 'assisted combat';
  const ore = `${sanitizeOreAmount(room.oreAmount) ?? DEFAULT_ORE_AMOUNT}% ore`;
  const pings = room.players.map((player) => player.pingMs).filter((ping): ping is number => Number.isFinite(ping));
  const ping = pings.length ? `${Math.max(...pings)}ms` : 'measuring ping';
  const engines = new Set(room.players.map((player) => player.engine).filter(Boolean));
  const engineWarning = engines.size > 1 ? ' · different browsers — desync likely, best played on the same browser' : '';
  setStatus(
    `Room ${room.code} · ${map} ${mapSize} · ${ore} · you are ${team} · ${connected}/${room.armyCount} connected · ${combat} · ${waiting} · ping ${ping} · delay ${room.inputDelay ?? 8}t${engineWarning}`,
    engines.size > 1,
  );
}

function settingsFromRoom(room: MultiplayerRoom): SkirmishSettings {
  return {
    mapId: sanitizeMapId(room.mapId) ?? DEFAULT_MAP_ID,
    mapSize: sanitizeMapSize(room.mapSize) ?? DEFAULT_MAP_SIZE,
    seed: room.seed,
    oreAmount: sanitizeOreAmount(room.oreAmount) ?? DEFAULT_ORE_AMOUNT,
    ai: room.ai,
    aiStyle: room.aiStyle,
    debug: false,
    combatMode: room.combatMode ?? 'assisted',
    armyCount: sanitizeArmyCount(room.armyCount) ?? 2,
    armySides: sanitizeArmySides(room.armySides) ?? defaultArmySides(),
    spawnSlots: sanitizeSpawnSlots(room.spawnSlots) ?? defaultSpawnSlots(),
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
  if (message === 'server-unreachable' || message === 'connection-closed' || message === 'request-timeout') {
    return 'the battle server did not wake in time. Please retry in a moment.';
  }
  if (message === 'room-not-found') return 'room not found or expired. Ask the host for a fresh code.';
  if (message === 'room-full') return 'room is full. Start a new room for another match.';
  if (message === 'match-in-progress') return 'this match has already started. Ask the host for a new room.';
  if (message === 'enter-room-code') return 'enter a room code first.';
  if (message === 'unknown-player') return 'player session expired. Join the room again.';
  if (message === 'origin-not-allowed') return 'relay rejected this site origin. Add this site URL to ALLOWED_ORIGINS.';
  return message;
}

function setupTextInput(label: string, value: string): { root: HTMLLabelElement; input: HTMLInputElement } {
  const root = document.createElement('label');
  root.className = 'war-input';
  const title = document.createElement('span');
  title.className = 'war-input__label';
  title.textContent = label;
  const input = document.createElement('input');
  input.value = value;
  root.append(title, input);
  return { root, input };
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
  hideHowToPlayWidget();
  const multiplayer = pendingMultiplayer;
  pendingMultiplayer = undefined;
  const multiplayerMode = multiplayer !== undefined;
  if (multiplayer) settings = settingsFromRoom(multiplayer.session.room);
  applyMultiplayerFactionColors(
    multiplayer
      ? Object.fromEntries(multiplayer.session.room.players.map((player) => [player.index, player.color]))
      : {},
  );
  const localTeam = multiplayer?.session.player.index ?? 1;
  const humanTeams = multiplayer ? multiplayer.session.room.players.map((player) => player.index) : [localTeam];
  const aiTeams = new Set(aiControlledTeams(settings.armyCount, humanTeams));
  const app = document.getElementById('app');
  if (!app) throw new Error('#app missing');
  const overlay = showLoadingOverlay();
  await nextFrame();
  await nextFrame();

  const t0 = performance.now();
  const selectedMap = MAP_PRESETS[settings.mapId] ?? MAP_PRESETS[DEFAULT_MAP_ID];
  const hf = generateHeightfield({ ...mapConfig(settings.mapId, settings.mapSize, settings.oreAmount), seed: settings.seed });
  console.info(`[map] ${selectedMap.label} · ${MAP_SIZE_PRESETS[settings.mapSize].label} · seed ${settings.seed} · ${hf.oreFields.length} ore fields · ${hf.cells}×${hf.cells} cells generated in ${(performance.now() - t0).toFixed(0)} ms`);

  const params = new URLSearchParams(location.search);
  const mobileTouch = isMobileTouchDevice();
  const requestedQuality = params.get('quality');
  const initialQualityTier = requestedQuality === 'performance' || requestedQuality === 'low'
    ? 2 as const
    : requestedQuality === 'balanced'
      ? 1 as const
      : mobileTouch
        ? 0 as const
        : undefined;
  const ctx = new RenderContext(app, { multiplayer: multiplayerMode, initialQualityTier, mobileSafeMode: mobileTouch });
  applyMapAtmosphere(ctx, selectedMap);
  const input = new Input(mobileTouch);
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

  const startMode = params.get('start');
  const lineupStart = startMode === 'lineup';
  const testStart = startMode === 'test' || startMode === 'sandbox';
  const debugArmies = startMode === 'armies' || startMode === 'debug-armies';
  const hitJuicePreview = !multiplayerMode && !isPublicHost(location.hostname) && params.get('hit-juice-preview') === '1';
  let nextHitJuicePreviewTick = 0;
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
    const credits = isLocal && (testStart || lineupStart) ? 15000 : aiTeams.has(team) ? AI_DIFFICULTY[aiDifficulty].startCredits : 4600;
    const economy = createEconomy(team, credits);
    const start = startPosition(hf.size, settings.spawnSlots[team - 1] ?? team);
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
  for (const army of armies) {
    if (!aiTeams.has(army.team)) continue;
    const hints = armies
      .filter((candidate) => areTeamsHostile(sim, army.team, candidate.team))
      .map((candidate) => ({ x: candidate.base.transform.x, z: candidate.base.transform.z }));
    army.commander = new EnemyCommander(sim, hf, army.economy, army.vision, aiPersonality, aiDifficulty, hints);
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

  const unitView = new UnitView([...lineupUnits, ...startingUnits], hf, ctx, isVisibleToPlayer, localTeam);
  unitView.attach(ctx.scene);
  const buildingView = new BuildingView(sim, hf, ctx, isVisibleToPlayer);
  ctx.scene.add(buildingView.group);
  const combatView = new CombatView(hf, isVisibleToPlayer, (id) => sim.byId.get(id));
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
  let sidebar!: Sidebar;
  let tacticalPingKind: TacticalPingKind | undefined;
  let networkPaused = false;
  let lastNetworkStatus = '';
  const setNetworkStatus = (message: string, bad = false): void => {
    if (multiplayerMode) {
      const shouldPause =
        bad && (/interrupted/i.test(message) || /disconnected/i.test(message) || /closed/i.test(message) || /send failed/i.test(message));
      const shouldResume = !bad && (/connected/i.test(message) || /online/i.test(message));
      if (shouldPause) networkPaused = true;
      if (shouldResume) networkPaused = false;
      const statusKey = `${bad ? 'warning' : 'online'}:${networkPaused ? 'paused' : 'running'}:${message}`;
      if (statusKey === lastNetworkStatus) return;
      lastNetworkStatus = statusKey;
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
        onTacticalPing: (ping) => {
          sidebar.addTacticalPing(ping);
          hud.showTacticalPing(ping.name || `Commander ${ping.playerIndex}`, ping.kind);
        },
        onRematchStart: () => {
          if (multiplayer) restartMultiplayerMatch(multiplayer.client, multiplayer.session);
        },
      })
    : undefined;
  if (multiplayerMode) setNetworkStatus(`Room ${multiplayer.session.room.code} · army ${localTeam} · online`);

  const rig = new RtsCameraRig(ctx.camera, input, hf);
  if (lineupStart) rig.jumpTo(localBase.transform.x + 26, localBase.transform.z + 12);
  else rig.jumpToOpeningView(localBase.transform.x, localBase.transform.z, localTeam);
  const tacticalPing = {
    isActive: () => tacticalPingKind !== undefined,
    confirm: (x: number, z: number) => {
      if (tacticalPingKind && lockstep) lockstep.sendTacticalPing(tacticalPingKind, x, z);
      tacticalPingKind = undefined;
      sidebar.setTacticalPing();
    },
    cancel: () => {
      tacticalPingKind = undefined;
      sidebar.setTacticalPing();
    },
  };
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
          attack: (ids, targetId) => lockstep.issue({ type: 'attack', ids, targetId }),
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
    tacticalPing,
  );
  sidebar = new Sidebar(sim, hf, economy, playerVision, {
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
    beginTacticalPing: lockstep
      ? (kind) => {
          tacticalPingKind = kind;
        }
      : undefined,
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
    credits: () => economy.credits,
    purchaseUpgrade: (ids, upgradeId) => {
      audio.playUi('build');
      if (lockstep) {
        lockstep.issue({ type: 'upgrade-units', ids, upgradeId });
        return { ok: true, reason: 'Upgrade order queued', upgraded: ids.length, cost: 0 };
      }
      const result = purchaseUnitUpgrade(sim, economy, ids, upgradeId, localTeam);
      if (!result.ok) audio.playUi('error');
      return result;
    },
  }, localTeam);
  let uiPaused = false;
  const setUiPaused = (paused: boolean): void => {
    uiPaused = paused;
    input.resetTransientInputs();
  };
  configureHowToPlayLifecycle({
    onOpen: () => setUiPaused(true),
    onClose: () => setUiPaused(false),
  });
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
  let mobileControls: MobileGameControls | undefined;
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
        sidebar.setFirstPerson(true);
        selectionBar.setVisible(false);
        hud.setFirstPerson(true);
      },
      prepareExitPose: (entity) => rig.focusOn(entity.transform.x, entity.transform.z, ctx.camera.position),
      onExit: () => {
        controller.setEnabled(true);
        unitView.setHiddenEntity(undefined);
        unitView.setSelectionOverlayVisible(true);
        sidebar.setFirstPerson(false);
        selectionBar.setVisible(true);
        hud.setFirstPerson(false);
      },
      onHitFeedback: (force) => hud.flashReticle(force),
    },
    localTeam,
    lockstep
      ? {
          control: (command) => lockstep.issue({ type: 'possess-input', ...command }),
          fire: (command) => lockstep.issue({ type: 'possess-fire', ...command }),
          follow: (command) => lockstep.issue({ type: 'possess-follow', ...command }),
          release: (id) => lockstep.issue({ type: 'possess-release', id }),
        }
      : undefined,
    isVisibleToPlayer,
  );
  if (mobileTouch) {
    mobileControls = new MobileGameControls(input, sidebar, {
      enterFirstPerson: () => firstPerson.enter(selectedEntities(sim, localTeam)),
      exitFirstPerson: () => firstPerson.exit(),
      cyclePossessed: () => firstPerson.cyclePossessed(1),
      firePrimary: () => firstPerson.firePrimary(),
      fireSecondary: () => firstPerson.fireSecondary(),
      useSpecial: () => firstPerson.useSpecialAbility(),
    });
  }
  input.onKeyDown('KeyV', () => {
    if (firstPerson.active) firstPerson.exit();
    else firstPerson.enter(selectedEntities(sim, localTeam));
  });
  input.onKeyDown('Tab', () => {
    firstPerson.cyclePossessed(1);
  });
  input.onKeyDown('KeyF', () => {
    firstPerson.useSpecialAbility();
  });
  input.onKeyDown('Escape', () => {
    if (firstPerson.active) firstPerson.exit();
  });
  input.onKeyDown('F3', () => water.setDebugOverlay(terrain.toggleWalkOverlay()));
  input.onKeyDown('F4', () => (fogView.group.visible = !fogView.group.visible));
  input.onKeyDown('F1', () => {
    openHowToPlay();
  });
  input.onKeyDown('F2', () => hud.toggleInfo());
  input.onKeyDown('KeyM', () => {
    audio.unlock();
    const muted = audio.toggleMuted();
    console.info(`[audio] ${muted ? 'muted' : 'unmuted'}`);
  });

  let outcome: 'victory' | 'defeat' | undefined;
  let matchTelemetry: MatchTelemetry | undefined;
  const checkOutcome = (): void => {
    if (outcome || sim.tick < 60) return;
    const alive = (team: number) => buildings(sim, team).filter((entity) => !entity.destroyed).length;
    const hostileTeams = teams.filter((team) => areTeamsHostile(sim, localTeam, team));
    if (isVictoryFromHostileBuildingCounts(hostileTeams.map(alive))) outcome = 'victory';
    else if (alive(localTeam) === 0) outcome = 'defeat';
    if (outcome) {
      matchTelemetry?.end();
      const snapshot = matchSnapshot();
      recordMatchHistory({
        playedAt: Date.now(),
        outcome,
        mapId: settings.mapId,
        seed: settings.seed,
        duration: snapshot.elapsedSeconds,
        multiplayer: multiplayerMode,
      });
      showOutcomeBanner(
        outcome,
        combinedCommanderStats(commanders),
        settings,
        snapshot,
        multiplayer && lockstep ? () => lockstep.requestRematch() : undefined,
      );
    }
  };
  lockstep?.connect();
  window.addEventListener('beforeunload', () => lockstep?.disconnect(), { once: true });

  let fps = 60;
  let simTicks = 0;
  let simHz = SIM_HZ;
  let lastSimSample = performance.now();
  let lastUiRefreshTick = -999;
  let renderFrame = 0;
  let deferredEffectDt = 0;
  const fallbackMatchId = `${multiplayerMode ? `mp-${multiplayer!.session.room.code}` : 'sp'}-${crypto.randomUUID()}`;
  const matchTelemetryMetadata = (): FeedbackMatchMetadata => {
    const room = multiplayer?.session.room;
    const player = room?.players.find((candidate) => candidate.id === multiplayer?.session.player.id) ?? multiplayer?.session.player;
    return {
      matchId: room?.matchId ?? fallbackMatchId,
      status: outcome ?? 'ongoing',
      multiplayer: multiplayerMode,
      roomCode: room?.code,
      mapId: settings.mapId,
      mapSize: settings.mapSize,
      seed: settings.seed,
      playerName: player?.name,
      playerTeam: localTeam,
      playerSide: settings.armySides[localTeam - 1] ?? localTeam,
      elapsedSeconds: Math.max(0, Math.round((sim.tick / SIM_HZ) * 10) / 10),
      fps: Math.max(0, Math.round(fps * 10) / 10),
      pingMs: player?.pingMs,
      quality: ctx.visualQualityLabel,
      renderScale: Math.round(ctx.renderScale * 100) / 100,
      engine: player?.engine,
      buildVersion: import.meta.env.VITE_APP_VERSION ?? '0.1.0',
    };
  };
  setFeedbackMatchMetadataProvider(matchTelemetryMetadata);
  matchTelemetry = trackMatchTelemetry(matchTelemetryMetadata);
  const firstContactGate = new FirstContactGate();
  const baseUnderAttackGate = new BaseUnderAttackGate();
  const missionComms = new MissionComms();

  const showEnemyFirstContact = (): void => {
    showMissionBriefing({
      variant: 'hostile',
      audioUrl: '/assets/audio/enemy-first-contact.mp3',
      backingAudioUrl: '/assets/audio/enemy-first-contact-war-drums.mp3',
      backingVolume: 0.5,
      portraitUrl: '/assets/briefing/general-varek-drahn.webp',
      speakerName: 'GENERAL VAREK DRAHN',
      title: 'First contact',
      alertLabel: 'HOSTILE FORCE IDENTIFIED',
      message: 'You have entered territory under my control. Prepare your forces.',
      channelLabel: 'HOSTILE COMMS',
      channelSource: 'SIGNAL INTERCEPT',
      ariaLabel: 'Enemy general transmission',
    });
  };

  const checkFirstContact = (): void => {
    if (lineupStart) return;
    const contact = firstContactGate.tryTrigger(() => findFirstVisibleHostileEntity(
      sim.world.entities,
      localTeam,
      (friendlyTeam, otherTeam) => areTeamsHostile(sim, friendlyTeam, otherTeam),
      (x, z) => playerVision.isVisibleWorld(x, z),
    ));
    if (contact) showEnemyFirstContact();
  };

  const checkBaseUnderAttack = (events: CombatEvent[]): void => {
    if (lineupStart) return;
    const alert = baseUnderAttackGate.tryTrigger(sim.tick, () => findFriendlyBuildingUnderAttack(events, sim.byId, localTeam));
    if (!alert) return;
    sidebar.signalUnderAttack(alert.x, alert.z, alert.label);
    hud.showBaseUnderAttack(alert.label, alert.critical);
    missionComms.announceBaseUnderAttack(alert.label, alert.critical);
    audio.playUi('error');
  };

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
      if (sim.tick % 3 === 0) {
        for (const entity of sim.world.entities) {
          if (entity.selectable?.type === 'tank' && !entity.destroyed) scatter.crushNear(entity.transform.x, entity.transform.z, 3.6);
        }
      }
      if (sim.tick - lastFogTextureTick >= 4) {
        lastFogTextureTick = sim.tick;
        fogView.refresh();
      }
      const events = tickResult.events;
      if (hitJuicePreview && firstPerson.inFirstPerson) {
        const possessed = firstPerson.possessedEntity;
        if (possessed && !possessed.destroyed && sim.tick >= nextHitJuicePreviewTick) {
          nextHitJuicePreviewTick = sim.tick + 18; // ~0.6s at 30 Hz
          const force = 0.35 + (sim.tick % 5) * 0.12;
          const yaw = possessed.playerControlled?.aimYaw ?? possessed.transform.rot;
          const fromX = possessed.transform.x - Math.sin(yaw) * 18;
          const fromZ = possessed.transform.z - Math.cos(yaw) * 18;
          events.push({
            kind: 'impact-reaction',
            impactKind: 'tankMissile',
            force,
            fromX,
            fromZ,
            toX: possessed.transform.x,
            toY: possessed.transform.y,
            toZ: possessed.transform.z,
            targetId: possessed.id,
            targetLabel: possessed.name ?? 'unit',
            targetType: possessed.selectable?.type ?? 'tank',
            targetHealth: possessed.health?.current,
            targetMaxHealth: possessed.health?.max,
            damage: Math.max(8, Math.round((possessed.health?.max ?? 100) * force * 0.08)),
            killed: false,
          });
          if (possessed.health) {
            possessed.health.current = Math.max(12, possessed.health.current - Math.max(6, Math.round(possessed.health.max * 0.045)));
          }
        }
      }
      unitView.pushCombatEvents(events);
      firstPerson.handleCombatEvents(events);
      audio.handleCombatEvents(events, firstPerson.possessedEntity?.id);
      economyFx.push(events);
      combatView.push(events);
      checkBaseUnderAttack(events);
      checkFirstContact();
      checkOutcome();
      simTicks++;
    },
    render: (alpha, dt, time) => {
      renderFrame++;
      ctx.setFastMotionMode((multiplayerMode || mobileTouch) && firstPerson.flying);
      unitView.setVisualQuality(ctx.visualQuality);
      if (firstPerson.active) firstPerson.update(dt, alpha);
      else {
        rig.setGrabSuppressed(controller.isRightOrderGestureActive());
        rig.setEmptyRightDragLook(controller.isEmptyRightLookActive());
        rig.update(dt);
      }
      unitView.update(alpha, dt, ctx.camera);
      if (sim.tick - lastUiRefreshTick >= 3) {
        lastUiRefreshTick = sim.tick;
        buildingView.setProducerHighlights(sidebar.producerHighlightIds());
        selectionBar.update();
        sidebar.update();
      }
      mobileControls?.update({
        firstPerson: firstPerson.active,
        flying: firstPerson.flying,
        selectedCount: controller.selectedCount(),
        possessedName: firstPerson.possessedName,
      });
      if (renderFrame % ctx.visualUpdateDivisor === 0) buildingView.update(economy, ctx.camera);
      // Keep camera and unit motion at the browser's full frame rate in
      // multiplayer flight. Battlefield particles and order decorations can
      // update at the adaptive cadence without making aircraft controls feel
      // sticky on older CPUs/GPUs.
      deferredEffectDt += dt;
      const effectDivisor = multiplayerMode && firstPerson.flying ? ctx.visualUpdateDivisor : 1;
      if (renderFrame % effectDivisor === 0) {
        combatView.update(deferredEffectDt);
        economyFx.update(deferredEffectDt);
        orderMarkers.update(deferredEffectDt);
        snowfall?.update(deferredEffectDt, time);
        deferredEffectDt = 0;
      }
      if (sim.tick !== lastResourceVisualTick) {
        lastResourceVisualTick = sim.tick;
        terrain.updateResources(sim.resourceNodes);
      }
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
        renderScale: ctx.renderScale,
        visualQuality: ctx.visualQualityLabel,
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
  if (!lineupStart) {
    const hostileArmyCount = teams.filter((team) => team !== localTeam && areTeamsHostile(sim, localTeam, team)).length;
    showMissionBriefing({ enemyCount: hostileArmyCount });
    if (!isPublicHost(location.hostname) && params.get('first-contact-preview') === '1' && firstContactGate.triggerNow()) {
      window.setTimeout(showEnemyFirstContact, 250);
    }
  }
  if (hitJuicePreview) {
    window.setTimeout(() => {
      const tanks = selectedEntities(sim, localTeam);
      const pool = tanks.length > 0
        ? tanks
        : Array.from(sim.world.entities).filter(
          (entity) => entity.team?.id === localTeam && entity.possessable && entity.mover && !entity.destroyed,
        );
      if (pool.length === 0) return;
      setSelected(sim, pool.slice(0, 1), false, localTeam);
      firstPerson.enter(pool.slice(0, 1));
    }, 400);
  }
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
  wrap.className = 'game-chrome-controls';
  wrap.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:30;display:flex;gap:6px;align-items:center;';
  const help = gameChromeButton('HOW TO PLAY', 'Open the field manual');
  help.classList.add('game-chrome-controls__help');
  help.setAttribute('aria-label', 'How to play');
  help.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    help.blur();
    openHowToPlay();
  };
  const menu = gameChromeButton('MENU', 'Open match menu');
  menu.classList.add('game-chrome-controls__menu');
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
      onHelp: () => openHowToPlay(),
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
  overlay.className = 'game-menu-overlay';
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
  panel.className = 'game-menu-panel';
  panel.style.cssText =
    'width:300px;display:grid;gap:8px;padding:14px;background:rgba(8,12,14,.94);border:1px solid #596260;border-radius:3px;' +
    'box-shadow:0 18px 60px rgba(0,0,0,.55);font:11px ui-monospace,Menlo,monospace;color:#d7e0e7;letter-spacing:.08em;';
  const title = document.createElement('div');
  title.textContent = 'MATCH MENU';
  title.style.cssText = 'color:#d2b15f;font-size:13px;margin-bottom:2px;';
  const status = document.createElement('div');
  status.textContent = `${MAP_PRESETS[settings.mapId].shortLabel} · ${MAP_SIZE_PRESETS[settings.mapSize].label} · seed ${settings.seed} · ${settings.ai}/${settings.aiStyle}`;
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

function copyMatchLink(settings: SkirmishSettings, status: HTMLElement): void {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('map', settings.mapId);
  url.searchParams.set('size', settings.mapSize);
  url.searchParams.set('seed', String(settings.seed));
  url.searchParams.set('ore', String(settings.oreAmount));
  url.searchParams.set('ai', settings.ai);
  url.searchParams.set('ai-style', settings.aiStyle);
  url.searchParams.set('combat', settings.combatMode);
  url.searchParams.set('armies', String(settings.armyCount));
  url.searchParams.set('sides', settings.armySides.slice(0, settings.armyCount).join(','));
  url.searchParams.set('spawns', settings.spawnSlots.slice(0, settings.armyCount).join(','));
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
  onRematch?: () => void,
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
  const again = outcomeButton(onRematch ? 'REMATCH' : 'PLAY AGAIN', () => {
    if (!onRematch) {
      reloadWithSettings({ ...settings, seed: randomSeed() }, true);
      return;
    }
    onRematch();
    again.disabled = true;
    again.textContent = 'WAITING FOR PLAYER';
    again.style.opacity = '.55';
  });
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
  sendTelemetryEvent('session-start');
  showFeedbackWidget();
  showHowToPlayWidget();
  const params = new URLSearchParams(location.search);
  const inviteRoom = roomFromInvite(params);
  const mobileLandscape = new MobileLandscapeGate();
  mobileLandscape.activate();
  const settings = initialSettings(params);
  const rematch = consumeMultiplayerRematch();
  if (rematch) {
    const client = new MultiplayerClient(rematch.server);
    const session = await client.join(rematch.roomCode, undefined, rematch.playerId);
    pendingMultiplayer = { client, session };
    await boot(settingsFromRoom(session.room));
    return;
  }
  const hasAutostartParams = shouldAutostartFromUrl(params);
  const autostart = window.sessionStorage.getItem(AUTOSTART_STORAGE_KEY) === '1';
  window.sessionStorage.removeItem(AUTOSTART_STORAGE_KEY);
  if (hasAutostartParams || autostart) {
    saveSkirmishSettings(settings);
    await boot(settings);
    return;
  }
  const localSetupPreview = !isPublicHost(location.hostname) && params.get('setup-preview') === '1';
  if (!localSetupPreview && !(inviteRoom && hasBetaAccess())) await showLandingScreen({ inviteRoom });
  const chosen = await showSetupScreen(settings);
  document.getElementById('iron-landing')?.remove();
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
