import { createUnitPreview, disposeUnitPreview, UNIT_PORTRAIT_MODELS } from './unitView';
import {
  ACESFilmicToneMapping, Box3, Color, DirectionalLight, HemisphereLight,
  OrthographicCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer, type Group,
} from 'three';
import { STRUCTURES, type StructureKind } from '../content/phase3';
import { createBuildingPreview, disposeBuildingPreview } from './buildingView';
import { FACTION, factionId } from './palette';

export const BUILDING_PORTRAIT_KINDS = ['command-yard', ...Object.keys(STRUCTURES)];
export function isBuildingPortrait(kind: string): boolean {
  return kind === 'command-yard' || Object.prototype.hasOwnProperty.call(STRUCTURES, kind);
}

/** Fits the full model in camera space, including antennas, barrels and the dock. */
export function frameBuildingPortrait(camera: OrthographicCamera, model: Group, aspect = 1): void {
  model.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(model);
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3()).length();
  camera.position.copy(center).add(new Vector3(1, 0.85, 1.15).normalize().multiplyScalar(size * 2));
  camera.lookAt(center); camera.updateMatrixWorld(true);
  const projected = new Box3();
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    projected.expandByPoint(new Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
  }
  const halfH = Math.max((projected.max.y - projected.min.y) / 2, (projected.max.x - projected.min.x) / (2 * aspect)) * 1.09;
  camera.left = -halfH * aspect; camera.right = halfH * aspect;
  camera.top = halfH; camera.bottom = -halfH;
  camera.near = 0.1; camera.far = size * 5; camera.updateProjectionMatrix();
}

export function createBuildingStudioScene(options: { shadows?: boolean } = {}): Scene {
  const scene = new Scene(); scene.background = new Color(0x17252f);
  scene.add(new HemisphereLight(0xdcefff, 0x6c6a5f, 2.5));
  const key = new DirectionalLight(0xffefd6, 3.4); key.position.set(-35, 60, 45);
  if (options.shadows !== false) {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -45; key.shadow.camera.right = 45;
    key.shadow.camera.top = 45; key.shadow.camera.bottom = -45; key.shadow.camera.far = 200;
    key.shadow.normalBias = 0.12; key.shadow.bias = -0.0002;
  }
  scene.add(key);
  const rim = new DirectionalLight(0x8ebeff, 2.2); rim.position.set(40, 30, -40); scene.add(rim);
  return scene;
}

const PORTRAIT_SIZE = 128;
const cache = new Map<string, string>();
const pending = new Map<string, { kind: string; team: number; targets: Set<HTMLImageElement> }>();
let scheduled = false;
let renderer: WebGLRenderer | undefined;
let scene: Scene | undefined;
let camera: OrthographicCamera | undefined;

function portraitKey(kind: string, team: number): string | undefined {
  const unit = Object.prototype.hasOwnProperty.call(UNIT_PORTRAIT_MODELS, kind);
  if (!isBuildingPortrait(kind) && !unit) return undefined;
  const palette = FACTION[factionId(team)];
  return `${unit ? 'unit' : 'building'}:${kind}:${Object.values(palette).join(':')}`;
}

/** Queue one portrait per frame, then release the temporary WebGL context. No
 * continuously rendered UI canvases, and no old artwork substituted for a building. */
export function setCommandPortrait(img: HTMLImageElement, kind: string, team = 1): void {
  const key = portraitKey(kind, team);
  if (!key) { img.src = `/assets/ui/command-icons/${kind}.png`; return; }
  img.dataset.buildingPortrait = key;
  const cached = cache.get(key);
  if (cached) { img.src = cached; return; }
  const job = pending.get(key) ?? { kind, team, targets: new Set<HTMLImageElement>() };
  job.targets.add(img); pending.set(key, job);
  if (!scheduled) { scheduled = true; requestAnimationFrame(renderNextPortrait); }
}

/** Render the local army's command icons before the match loop starts so the
 * sidebar never opens a second WebGL context in the middle of play. */
export function prewarmCommandPortraits(team = 1): void {
  for (const kind of [...BUILDING_PORTRAIT_KINDS, ...Object.keys(UNIT_PORTRAIT_MODELS)]) {
    const key = portraitKey(kind, team);
    if (!key || cache.has(key) || pending.has(key)) continue;
    pending.set(key, { kind, team, targets: new Set() });
  }
  while (pending.size > 0) {
    const entry = pending.entries().next().value;
    if (!entry) break;
    pending.delete(entry[0]);
    bakePortrait(entry[0], entry[1]);
  }
  releasePortraitRenderer();
}

function ensurePortraitRenderer(): boolean {
  if (renderer) return true;
  try {
    renderer = new WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    renderer.setSize(PORTRAIT_SIZE, PORTRAIT_SIZE); renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = false;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    scene = createBuildingStudioScene({ shadows: false }); camera = new OrthographicCamera();
    return true;
  } catch (error) {
    console.warn('Command portrait renderer unavailable', error);
    renderer = undefined; scene = undefined; camera = undefined;
    return false;
  }
}

function releasePortraitRenderer(): void {
  renderer?.dispose();
  renderer = undefined; scene = undefined; camera = undefined; scheduled = false;
}

function bakePortrait(key: string, job: { kind: string; team: number; targets: Set<HTMLImageElement> }): void {
  if (!ensurePortraitRenderer() || !renderer || !scene || !camera) {
    for (const img of job.targets) img.remove();
    return;
  }
  let model: Group | undefined;
  try {
    model = isBuildingPortrait(job.kind) ? createBuildingPreview(job.kind, job.team) : createUnitPreview(job.kind, job.team);
    scene.add(model);
    frameBuildingPortrait(camera, model);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/webp', 0.82);
    if (cache.size >= 80) cache.delete(cache.keys().next().value!);
    cache.set(key, url);
    for (const img of job.targets) if (img.dataset.buildingPortrait === key) img.src = url;
  } catch (error) {
    console.warn('Command portrait unavailable', error);
    for (const img of job.targets) img.remove();
  } finally {
    if (model) {
      scene.remove(model);
      if (isBuildingPortrait(job.kind)) disposeBuildingPreview(model);
      else disposeUnitPreview(model);
    }
  }
}

function renderNextPortrait(): void {
  const entry = pending.entries().next().value;
  if (!entry) { releasePortraitRenderer(); return; }
  pending.delete(entry[0]);
  bakePortrait(entry[0], entry[1]);
  requestAnimationFrame(renderNextPortrait);
}

export function buildingPortraitLabel(kind: string): string {
  return STRUCTURES[kind as StructureKind]?.label ?? 'Command Yard';
}
