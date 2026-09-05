import { ACESFilmicToneMapping, PCFSoftShadowMap, Mesh, OrthographicCamera, SRGBColorSpace, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Box3, Vector3 } from 'three';
import { BUILDING_PORTRAIT_KINDS, buildingPortraitLabel, createBuildingStudioScene, frameBuildingPortrait, setCommandPortrait } from '../render/buildingPortraits';
import { createBuildingPreview, disposeBuildingPreview } from '../render/buildingView';

if (!import.meta.env.DEV) throw new Error('The building studio is only available in local development.');
document.body.innerHTML = `
<style>
*{box-sizing:border-box}body{margin:0;background:#0c141a;color:#dce6e8;font:14px system-ui}header{padding:24px 30px;border-bottom:1px solid #33414a;display:flex;align-items:center;justify-content:space-between;gap:20px}small{color:#c4a775;letter-spacing:.2em;font-size:10px}h1{font-size:24px;font-weight:500;margin:7px 0 0}a{color:#d5bd8e;text-decoration:none}main{display:grid;grid-template-columns:minmax(0,1fr) 380px;min-height:calc(100vh - 100px)}.hero{position:sticky;top:0;height:calc(100vh - 104px);min-height:430px}#viewport{width:100%;height:100%;display:block;touch-action:none}.caption{position:absolute;left:30px;top:25px;pointer-events:none}.caption h2{font-size:28px;font-weight:500;margin:8px 0}.caption p{color:#8da1ad}.tools{position:absolute;bottom:24px;left:30px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}select,button{font:inherit;background:#1c2c37;color:#dce6e8;border:1px solid #435765;border-radius:5px;padding:8px 12px;cursor:pointer}.catalog{padding:20px;border-left:1px solid #33414a;display:grid;grid-template-columns:1fr 1fr;gap:12px;align-content:start}.card{padding:0;overflow:hidden;text-align:left;background:#17252f}.card[aria-pressed=true]{border-color:#d5bd8e;box-shadow:0 0 0 1px #d5bd8e}.card img{display:block;width:100%;aspect-ratio:1;object-fit:contain}.card span{display:block;padding:10px;font-size:12px}.readout{font-size:11px;color:#a4b6bf}@media(max-width:800px){main{grid-template-columns:1fr}.hero{position:relative;height:65vh}.catalog{grid-template-columns:repeat(3,1fr);border:0}header{padding:20px}}
</style>
<header><div><small>IRON DOMINION / BUILDING COLLECTION</small><h1>Architectural upgrade</h1></div><a href="/?start=test&map=crater-oasis&size=small&seed=42&quality=full&armies=2&sides=1,2&relief=100">Play local match ↗</a></header>
<main><section class="hero"><canvas id="viewport" aria-label="Interactive 3D building preview"></canvas><div class="caption"><small>LIVE MODEL · MATCHING UI PORTRAIT</small><h2 id="name"></h2><p>Drag to orbit · Scroll to zoom</p></div><div class="tools"><label>Faction <select aria-label="Faction"><option value="1">Aegis · Blue</option><option value="2">Vesper · Red</option><option value="3">Coalition · Green</option><option value="4">Coalition · Violet</option></select></label><button id="rotate" aria-pressed="false">Auto rotate</button><button id="reset">Reset view</button><span class="readout" id="readout"></span></div></section><section class="catalog" aria-label="All building models"></section></main>`;
const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
const scene = createBuildingStudioScene(); const camera = new OrthographicCamera();
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.autoRotateSpeed = 0.8;
let kind = 'command-yard', team = 1;
let model = createBuildingPreview(kind, team); scene.add(model);
function fit(): void {
  const { width, height } = canvas.getBoundingClientRect(); renderer.setSize(width, height, false);
  frameBuildingPortrait(camera, model, width / height);
  controls.target.copy(new Box3().setFromObject(model).getCenter(new Vector3())); camera.zoom = 1;
  camera.updateProjectionMatrix(); controls.update();
}
function select(next: string): void {
  scene.remove(model); disposeBuildingPreview(model); kind = next;
  model = createBuildingPreview(kind, team); scene.add(model); fit();
  document.querySelector('#name')!.textContent = buildingPortraitLabel(kind);
  document.querySelectorAll<HTMLButtonElement>('.card').forEach((card) => card.setAttribute('aria-pressed', String(card.dataset.kind === kind)));
  let triangles = 0; model.traverse((child) => { if (child instanceof Mesh) triangles += (child.geometry.index?.count ?? child.geometry.attributes.position.count) / 3; });
  document.querySelector('#readout')!.textContent = `${Math.round(triangles).toLocaleString()} triangles`;
}
const catalog = document.querySelector('.catalog')!;
for (const id of BUILDING_PORTRAIT_KINDS) {
  const button = document.createElement('button'); button.className = 'card'; button.dataset.kind = id;
  const img = document.createElement('img'); img.alt = `${buildingPortraitLabel(id)} model`;
  setCommandPortrait(img, id, team);
  const title = document.createElement('span'); title.textContent = buildingPortraitLabel(id);
  button.append(img, title); button.onclick = () => select(id); catalog.append(button);
}
document.querySelector('select')!.onchange = (event) => {
  team = Number((event.target as HTMLSelectElement).value); select(kind);
  document.querySelectorAll<HTMLButtonElement>('.card').forEach((card) => setCommandPortrait(card.querySelector('img')!, card.dataset.kind!, team));
};
document.querySelector<HTMLButtonElement>('#rotate')!.onclick = (event) => {
  controls.autoRotate = !controls.autoRotate; (event.target as HTMLElement).setAttribute('aria-pressed', String(controls.autoRotate));
};
document.querySelector<HTMLButtonElement>('#reset')!.onclick = fit;
new ResizeObserver(fit).observe(canvas.parentElement!);
select(kind);
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
