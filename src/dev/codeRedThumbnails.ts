import {
  ACESFilmicToneMapping, AmbientLight, Box3, CanvasTexture,
  DirectionalLight, Mesh, Object3D, OrthographicCamera, Scene,
  SRGBColorSpace, Vector3, WebGLRenderer, type Material,
} from 'three';
import { UnitView } from '../render/unitView';
import { BuildingView } from '../render/buildingView';
import type { RenderContext } from '../render/renderer';
import { applyArmyNations, nationForTeam, NATIONS } from '../content/nations';
import { STRUCTURES, UNITS, type UnitKind } from '../content/phase3';
import { unitLabel, structureLabel } from '../content/sideLabels';
import { CODE_RED_ICON_KINDS, codeRedIconPath, type CodeRedIconKind } from '../ui/codeRedIcons';
import { generateHeightfield } from '../sim/heightfield';
import {
  createGameSim, spawnHammerheadAt, spawnScoutTankAt, spawnSiegeTankAt,
  spawnTankAt, spawnVultureAt, spawnWaspAt,
} from '../sim/world';
import { spawnInfantryAt } from '../sim/economy';
import type { Entity } from '../sim/components';
import { nationFlagMaterial } from '../render/codeRedFlags';

type Portrait = { asset: string; label: string; side: string; category: string; image: string };

/** No renderer exists in the ordinary gallery; it reads the shipped WebPs. */
export async function showCodeRedThumbnails(): Promise<void> {
  const renderModels = new URLSearchParams(location.search).get('render') === '1';
  applyArmyNations(['iron-legion', 'missile-command']);
  document.body.innerHTML = `<style>
    html,body{height:auto!important;overflow:auto!important}body{margin:0;background:#0b1218;color:#e6ece9;font:14px system-ui}
    main{max-width:1440px;margin:auto;padding:32px}small{font-size:10px;letter-spacing:2px;color:#8ca69e}
    h1{font-size:36px;letter-spacing:-1px;margin:12px 0}p{color:#a7b6b9;line-height:1.6}nav{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0}
    button,a{font:inherit;border:1px solid #36474f;border-radius:7px;background:#17252c;color:#d5e9e2;padding:10px 15px;text-decoration:none;cursor:pointer}
    button[aria-pressed=true]{background:#b0e4d0;color:#10211c;border-color:#b0e4d0}
    section{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}article{border:1px solid #2a3942;border-radius:10px;overflow:hidden;background:#141e26}article[hidden]{display:none}
    img{display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:contain}h2{font-size:14px;margin:13px 14px 4px}article p{font-size:11px;margin:0 14px 14px;color:#849b9f}
    #status{font-size:12px}footer{margin-top:32px;border-top:1px solid #293b43;padding-top:16px}
  </style><main><small>CODE RED / EQUIPMENT PORTRAITS</small><h1>Recognize your force at a glance.</h1>
  <p>Captured from the actual game models. Both armies, every building and unit, with nation-specific command headquarters.</p>
  <nav><button data-filter="all" aria-pressed="true">All</button><button data-filter="Israel" aria-pressed="false">Israel</button><button data-filter="Iran" aria-pressed="false">Iran</button><button data-filter="Infantry" aria-pressed="false">Infantry</button><button data-filter="Armor" aria-pressed="false">Armor</button><button data-filter="Aircraft" aria-pressed="false">Aircraft</button><button data-filter="Structures" aria-pressed="false">Structures</button><a href="?start=test&building-showcase=defense&armies=2&doctrines=iron-legion,missile-command&time=day&weather=clear">Test in game</a></nav>
  <p id="status">${renderModels ? 'Rendering portraits…' : 'Static WebP portraits. No live 3D rendering in UI cards.'}</p><section id="portraits"></section><footer><p>One visual language: readable silhouettes, matching equipment, consistent framing and faction markings.</p></footer></main>`;

  const portraits: Portrait[] = [];
  let render: undefined | ((model: Object3D, infantry: boolean) => string);
  let renderer: WebGLRenderer | undefined;
  let scene: Scene | undefined;
  let views: { unit: UnitView; building: BuildingView; sim: ReturnType<typeof createGameSim> } | undefined;
  let hf: ReturnType<typeof generateHeightfield> | undefined;
  if (renderModels) {
    hf = generateHeightfield({ cells: 16, cellSize: 2, seed: 7, waterLevel: -10, oreFieldCount: 0 });
    const sim = createGameSim(hf);
    // Authoring uses the real factories. Only the CSM hook is omitted in this offline stage.
    const ctx = { setupLitMaterial: <T extends Material>(material: T): T => material } as RenderContext;
    views = { sim, unit: new UnitView([], hf, ctx), building: new BuildingView(sim, hf, ctx) };
    renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(512, 384); renderer.setPixelRatio(1);
    renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
    scene = new Scene();
    const background = document.createElement('canvas'); background.width = 512; background.height = 384;
    const c = background.getContext('2d')!;
    const gradient = c.createRadialGradient(290, 210, 20, 260, 180, 350);
    gradient.addColorStop(0, '#3d4b50'); gradient.addColorStop(.6, '#192830'); gradient.addColorStop(1, '#0b121c');
    c.fillStyle = gradient; c.fillRect(0, 0, 512, 384);
    c.strokeStyle = '#b8cece0c'; c.lineWidth = 1;
    for (let y = 240; y < 384; y += 24) { c.beginPath(); c.moveTo(0, y); c.lineTo(512, y); c.stroke(); }
    const texture = new CanvasTexture(background); texture.colorSpace = SRGBColorSpace; scene.background = texture;
    scene.add(new AmbientLight(0xbcc8d1, 1.6));
    const key = new DirectionalLight(0xffe0b6, 3); key.position.set(12, 18, 16); scene.add(key);
    const rim = new DirectionalLight(0x86c8ee, 2.4); rim.position.set(-12, 9, -8); scene.add(rim);
    const fill = new DirectionalLight(0xc3d9d5, .8); fill.position.set(-8, 4, 12); scene.add(fill);
    const camera = new OrthographicCamera(-8, 8, 6, -6, .01, 1000);
    render = (model, infantry) => {
      scene!.add(model); model.updateMatrixWorld(true);
      const bounds = new Box3();
      model.traverse(object => {
        if (!(object instanceof Mesh)) return;
        for (let parent: Object3D | null = object; parent; parent = parent.parent) if (!parent.visible) return;
        object.geometry.computeBoundingBox();
        if (object.geometry.boundingBox) bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
      });
      if (infantry) bounds.min.y += (bounds.max.y - bounds.min.y) * .31;
      const center = bounds.getCenter(new Vector3()); const size = bounds.getSize(new Vector3());
      const distance = Math.max(size.length(), 1) * 3;
      camera.position.copy(center).add(new Vector3(1.6, infantry ? .65 : 1.25, 1.9).normalize().multiplyScalar(distance));
      camera.lookAt(center); camera.left = -1; camera.right = 1; camera.top = 1; camera.bottom = -1; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      const projected = new Box3();
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) projected.expandByPoint(new Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
      const halfHeight = Math.max((projected.max.y - projected.min.y) / 2, (projected.max.x - projected.min.x) / (2 * 4 / 3)) * 1.13;
      const cx = (projected.min.x + projected.max.x) / 2; const cy = (projected.min.y + projected.max.y) / 2;
      camera.left = cx - halfHeight * 4 / 3; camera.right = cx + halfHeight * 4 / 3;
      camera.top = cy + halfHeight; camera.bottom = cy - halfHeight; camera.updateProjectionMatrix();
      renderer!.render(scene!, camera); const image = renderer!.domElement.toDataURL('image/webp', .9);
      scene!.remove(model); return image;
    };
  }
  const addPortrait = (portrait: Portrait) => {
    portraits.push(portrait);
    const card = document.createElement('article'); card.dataset.side = portrait.side; card.dataset.category = portrait.category;
    const image = document.createElement('img'); image.src = portrait.image; image.alt = portrait.label;
    image.width = 512; image.height = 384; image.dataset.asset = portrait.asset;
    const title = document.createElement('h2'); title.textContent = portrait.label;
    const caption = document.createElement('p'); caption.textContent = `${portrait.side} · ${portrait.category}`;
    card.append(image, title, caption); document.querySelector('#portraits')!.append(card);
  };
  for (const team of [1, 2]) {
    const nation = nationForTeam(team)!;
    for (const kind of CODE_RED_ICON_KINDS) {
      const infantry = ['infantry', 'sniper', 'grenadier', 'rocket-infantry'].includes(kind);
      const isUnit = kind in UNITS || kind === 'harvester';
      const category = infantry ? 'Infantry' : ['wasp', 'vulture', 'hammerhead'].includes(kind) ? 'Aircraft' : isUnit ? 'Armor' : 'Structures';
      const label = kind === 'command-yard' ? `${nation.name} Command HQ` : kind === 'harvester' ? 'Ore Collector' : isUnit ? unitLabel(kind as UnitKind, team) : structureLabel(kind as keyof typeof STRUCTURES, team);
      const path = codeRedIconPath(kind, team); const asset = path.split('/').pop()!.replace('.webp', '');
      let image = path;
      if (render && views && hf) {
        const entity = isUnit ? portraitUnit(views.sim, hf, kind, team) : portraitBuilding(kind, team);
        const model = isUnit ? views.unit.createThumbnailModel(entity) : views.building.createThumbnailModel(entity);
        image = render(model, infantry);
      }
      addPortrait({ asset, image, label, side: nation.name, category });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  // The remaining six HQs use the exact same body with each nation's cached flag.
  for (const nation of Object.values(NATIONS).filter(n => n.id !== 'israel' && n.id !== 'iran')) {
    const asset = `${nation.id}-hq`;
    let image = `/assets/ui/code-red/${asset}.webp`;
    if (render && views) {
      const entity = portraitBuilding('command-yard', nation.doctrine === 'iron-legion' ? 1 : 2);
      const model = views.building.createThumbnailModel(entity);
      const flag = model.getObjectByName('national-flag');
      if (flag instanceof Mesh) flag.material = nationFlagMaterial(nation.id);
      image = render(model, false);
    }
    addPortrait({ asset, image, label: `${nation.name} Command HQ`, side: nation.name, category: 'Structures' });
  }
  document.querySelector('#status')!.textContent = `${portraits.length} portraits ready · static WebP assets`;
  document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(button => {
    button.onclick = () => {
      document.querySelectorAll('[data-filter]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
      const filter = button.dataset.filter;
      document.querySelectorAll<HTMLElement>('article').forEach(card => { card.hidden = filter !== 'all' && filter !== card.dataset.side && filter !== card.dataset.category; });
    };
  });
  if (renderer && scene) {
    if (scene.background instanceof CanvasTexture) scene.background.dispose();
    renderer.dispose(); renderer.forceContextLoss();
  }
}

function portraitBuilding(kind: CodeRedIconKind, team: number): Entity {
  const def = STRUCTURES[kind as keyof typeof STRUCTURES];
  return {
    id: 10000 + CODE_RED_ICON_KINDS.indexOf(kind) + team * 100,
    transform: { x: 0, z: 0, rot: 0 }, team: { id: team },
    building: { kind, footprint: def?.footprint ?? { w: 8, h: 8 }, label: def?.label ?? 'Command HQ' },
    health: { current: 100, max: 100 },
  } as Entity;
}

function portraitUnit(sim: ReturnType<typeof createGameSim>, hf: ReturnType<typeof generateHeightfield>, kind: CodeRedIconKind, team: number): Entity {
  if (kind === 'infantry' || kind === 'sniper' || kind === 'grenadier' || kind === 'rocket-infantry') return spawnInfantryAt(sim, 0, 0, team, kind);
  if (kind === 'scout-tank') return spawnScoutTankAt(sim, 0, 0, 'Jackal', team);
  if (kind === 'tank') return spawnTankAt(sim, 0, 0, 'M-17', team);
  if (kind === 'siege-tank') return spawnSiegeTankAt(sim, 0, 0, 'Mauler', team);
  if (kind === 'wasp') return spawnWaspAt(sim, hf, 0, 0, 'Wasp', team);
  if (kind === 'vulture') return spawnVultureAt(sim, hf, 0, 0, 'Vulture', team);
  if (kind === 'hammerhead') return spawnHammerheadAt(sim, hf, 0, 0, 'Hammerhead', team);
  return sim.world.add({ id: sim.nextEntityId++, name: 'Ore Harvester', transform: { x: 0, z: 0, rot: 0 }, previousTransform: { x: 0, z: 0, rot: 0 }, team: { id: team }, health: { current: 160, max: 160 }, selectable: { type: 'harvester', selected: false, radius: 2.6 }, harvester: { state: 'seeking', timer: 0 } });
}
