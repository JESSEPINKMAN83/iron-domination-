import { WEAPONS, type WeaponKind } from '../content/phase4';
import { prewarmMissileExplosion } from '../render/missileExplosion';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
/** Standalone local effects range. Uses production CombatView, without changing combat rules. */
import { Color, GridHelper, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer } from 'three';
import { CombatView } from '../render/combatView';
import { MAP01 } from '../content/map01';
import { generateHeightfield, sampleHeight } from '../sim/heightfield';
import type { CombatEvent } from '../sim/world';

const hf = generateHeightfield(MAP01);
const scene = new Scene();
scene.background = new Color(0x24313b);
const camera = new PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 1500);
camera.position.set(160, 130, 210);
camera.lookAt(0, 22, 0);
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
document.body.style.cssText = 'margin:0;background:#172026;color:#e6f4ef;font:14px system-ui;overflow:hidden';
document.body.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 22, 0); controls.minDistance = 30; controls.maxDistance = 600; controls.maxPolarAngle = Math.PI * 0.48; controls.update();
const ground = new PlaneGeometry(420, 320, 70, 54);
ground.rotateX(-Math.PI / 2);
const positions = ground.getAttribute('position');
for (let i = 0; i < positions.count; i++) positions.setY(i, sampleHeight(hf, positions.getX(i), positions.getZ(i)));
scene.add(new Mesh(ground, new MeshBasicMaterial({ color: 0x4c5943 })));
const grid = new GridHelper(380, 19, 0x8caa89, 0x687962); grid.position.y = 1; scene.add(grid);
const view = new CombatView(hf);
view.setCinematicMode(true); // Keep damage labels out of this effects inspection tool.
scene.add(view.group);
await prewarmMissileExplosion(renderer, camera, scene);
const panel = document.createElement('section');
panel.style.cssText = 'position:fixed;left:18px;top:18px;max-width:min(540px, calc(100vw - 72px));padding:18px;background:#0c151de8;border:1px solid #52706d;border-radius:12px;line-height:1.6';
panel.innerHTML = '<strong style="font-size:20px">MISSILE RANGE</strong><div>Infantry rockets · tank missiles · aircraft · Iranian missile / Shahed</div><div>Drag to orbit · scroll to zoom · no balance changes</div><div style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0"><label>Set <select id="set"><option value="standard">Standard</option><option value="upgrades">Upgrades / MLRS</option><option value="ballistic">Bombs / shells / FPV</option></select></label><button id="wave">Launch wave</button><button id="impact">Explosions</button><button id="close">Close view</button><button id="stress" aria-pressed="false">Stress: off</button><label>Quality <select id="quality"><option value="0">High</option><option value="1">Medium</option><option value="2">Performance</option></select></label><label>Speed <select id="speed"><option>1</option><option>2</option><option>3</option></select></label></div><div id="metrics" style="font:12px monospace;white-space:pre"></div><a href="/?start=missile-test&armies=2&seed=231125" style="color:#9fdac6">Play missile scenario →</a>';
document.body.append(panel);
for (const button of Array.from(panel.querySelectorAll('button,select'))) (button as HTMLElement).style.cssText = 'padding:6px;background:#253c43;color:#e6f4ef;border:1px solid #628381;border-radius:5px';
const params = new URLSearchParams(location.search);
const snapshotTime = Number(params.get('snapshot')) || Infinity;
let stress = params.get('stress') === '1', speed = 1, time = 0, nextWave = 0;
const quality = Math.max(0, Math.min(2, Number(params.get('quality')) || 0)) as 0 | 1 | 2;
view.setVisualQuality(quality);
(panel.querySelector('#quality') as HTMLSelectElement).value = String(quality);
(panel.querySelector('#stress') as HTMLButtonElement).textContent = `Stress: ${stress ? 'on' : 'off'}`;
panel.querySelector('#stress')!.setAttribute('aria-pressed', String(stress));
const pending: Array<{ at: number; event: CombatEvent }> = [];
const groups: Record<string, readonly WeaponKind[]> = {
  standard: ['strategicMissile', 'emberDrone', 'rocketLauncher', 'rocketPod', 'aaMissile', 'precisionMissile', 'tankMissile'],
  upgrades: ['scoutMissile', 'siegeMissile', 'agMissile', 'swarmRocket', 'annihilatorMissile', 'mlrsRocket', 'tankBomb'],
  ballistic: ['heavyBomb', 'bomb', 'grenade', 'rifleGrenade', 'clusterGrenade', 'cannon', 'heavyCannon', 'siegeShell', 'fpvStrike'],
};
let kinds = groups.standard;
const launchKind = (kind: WeaponKind): string => kind === 'strategicMissile' || kind === 'emberDrone' ? 'siegeMissile' : WEAPONS[kind].projectile?.kind ?? (kind === 'heavyBomb' ? 'bomb' : kind);
panel.querySelector('#set')!.addEventListener('change', (event) => { kinds = groups[(event.target as HTMLSelectElement).value]; });
function launchWave(): void {
  for (let j = 0; j < (stress ? 5 : 1); j++) for (let i = 0; i < kinds.length; i++) {
    const weaponKind = kinds[i];
    const z = (i - (kinds.length - 1) * 0.5) * 24 + j * 2;
    const fromX = -125 + j * 2, toX = 100 - j * 3;
    const duration = weaponKind === 'strategicMissile' ? 6 : weaponKind === 'emberDrone' ? 7 : 2.5 + i * 0.12;
    const event: CombatEvent = {
      kind: launchKind(weaponKind),
      weaponKind, fromX, fromZ: z, fromY: sampleHeight(hf, fromX, z) + (weaponKind === 'bomb' || weaponKind === 'heavyBomb' ? 45 : 4),
      toX, toZ: z, toY: weaponKind === 'aaMissile' ? 38 : sampleHeight(hf, toX, z) + 0.5,
      trajectory: weaponKind === 'bomb' || weaponKind === 'heavyBomb' ? 'drop' : weaponKind === 'strategicMissile' || weaponKind === 'emberDrone' || WEAPONS[weaponKind].projectile?.trajectory === 'arc' ? 'arc' : 'flat',
      strategicLift: 48, duration, sourceTeamId: 1, targetTeamId: 2,
      targetType: weaponKind === 'aaMissile' ? 'aircraft' : 'vehicle', damage: 0, killed: false,
    };
    if (weaponKind === 'fpvStrike') { view.push([{ ...event, kind: 'bomb-impact', damage: 40 }]); continue; }
    view.push([event]);
    pending.push({ at: time + duration, event: { ...event, kind: `${event.kind}-impact` as CombatEvent['kind'], damage: 40 } });
  }
}
function impactWave(): void {
  for (let i = 0; i < kinds.length; i++) {
    const x = 55, z = (i - (kinds.length - 1) * 0.5) * 24;
    view.push([{ kind: kinds[i] === 'fpvStrike' ? 'bomb-impact' : `${launchKind(kinds[i])}-impact`, weaponKind: kinds[i], fromX: -100, fromZ: z, toX: x, toZ: z, toY: kinds[i] === 'aaMissile' ? 38 : sampleHeight(hf, x, z) + 0.5, targetType: kinds[i] === 'aaMissile' ? 'aircraft' : 'vehicle', sourceTeamId: 1, damage: 40, killed: false }]);
  }
}
panel.querySelector('#impact')!.addEventListener('click', impactWave);
let close = false;
panel.querySelector('#close')!.addEventListener('click', (event) => {
  close = !close;
  camera.position.set(close ? 110 : 160, close ? 45 : 130, close ? 90 : 210);
  controls.target.set(close ? 55 : 0, close ? 8 : 22, 0); controls.update();
  (event.target as HTMLButtonElement).textContent = close ? 'Wide view' : 'Close view';
});
panel.querySelector('#wave')!.addEventListener('click', launchWave);
panel.querySelector('#stress')!.addEventListener('click', (e) => { stress = !stress; const b = e.currentTarget as HTMLButtonElement; b.textContent = `Stress: ${stress ? 'on' : 'off'}`; b.setAttribute('aria-pressed', String(stress)); });
panel.querySelector('#quality')!.addEventListener('change', (e) => view.setVisualQuality(Number((e.target as HTMLSelectElement).value) as 0 | 1 | 2));
panel.querySelector('#speed')!.addEventListener('change', (e) => { speed = Number((e.target as HTMLSelectElement).value); });
const frames: number[] = [];
let previous = performance.now(), accumulator = 0;
function frame(now: number): void {
  const rawDt = (now - previous) / 1000;
  const dt = Math.min(0.1, rawDt); previous = now;
  frames.push(rawDt * 1000); if (frames.length > 180) frames.shift();
  accumulator += dt * speed;
  while (accumulator >= 1 / 60 && time + 1e-8 < snapshotTime) {
    const step = 1 / 60; accumulator -= step; time += step;
    if (time >= nextWave) { if (params.get('mode') === 'impacts') impactWave(); else launchWave(); nextWave = time + (stress ? 1.8 : 8); }
    for (let i = pending.length - 1; i >= 0; i--) if (pending[i].at <= time) { view.push([pending[i].event]); pending.splice(i, 1); }
    view.update(step);
  }
  view.completeFrame();
  renderer.render(scene, camera);
  const sorted = [...frames].sort((a, b) => a - b);
  const stats = view.effectStats();
  panel.querySelector('#metrics')!.textContent = `Draw calls ${renderer.info.render.calls} · triangles ${renderer.info.render.triangles}\nFX ${stats.drawables}/${stats.budget} · flying ${stats.projectiles} · smoke ${stats.smoke}\nGeometries ${renderer.info.memory.geometries} · textures ${renderer.info.memory.textures}\nFrame p50 ${sorted[Math.floor(sorted.length * 0.5)].toFixed(1)}ms · p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)}ms\nFixture time ${time.toFixed(1)}s${time + 1e-8 >= snapshotTime ? ' · frozen sample' : ''}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
