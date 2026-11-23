/** Controlled review fixture: real model/damage renderers; prescribed damage, no AI. */
import { AmbientLight, Color, DirectionalLight, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { UnitView } from '../render/unitView';
import { BuildingView } from '../render/buildingView';
import { CombatView } from '../render/combatView';
import { prewarmMissileExplosion } from '../render/missileExplosion';
import { installSinglePassFlatEffects, type RenderContext } from '../render/renderer';
import { MAP01 } from '../content/map01';
import { generateHeightfield } from '../sim/heightfield';
import { createGameSim, spawnTankAt, spawnWaspAt, type CombatEvent } from '../sim/world';
import { createEconomy, placeStructure, spawnInfantryAt } from '../sim/economy';
import { applyStructureDamage } from '../sim/structureDamage';
import type { Entity } from '../sim/components';
import { directionalImpactResponse } from '../sim/impactModel';

installSinglePassFlatEffects();
const hf = generateHeightfield(MAP01); hf.heights.fill(0); hf.walkable.fill(1); hf.waterLevel = -10; hf.oreFields = [];
const sim = createGameSim(hf), economy = createEconomy(2, 1000000);
const scene = new Scene(); scene.background = new Color(0x28343c);
scene.add(new AmbientLight(0xffffff, 1.8)); const sun = new DirectionalLight(0xfff4db, 3); sun.position.set(-20, 60, 40); scene.add(sun);
const camera = new PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 1000); camera.position.set(55, 38, 65);
const renderer = new WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
document.body.style.cssText = 'margin:0;background:#152128;color:#e5eee7;font:13px system-ui;overflow:hidden'; document.body.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 3, 0); controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 15; controls.maxDistance = 500; controls.update();
const ground = new Mesh(new PlaneGeometry(400, 400), new MeshStandardMaterial({ color: 0x5f6651, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; scene.add(ground);
const context = { setupLitMaterial: <T>(material: T): T => material } as unknown as RenderContext;
function building(x: number, z: number): Entity {
  economy.readyStructure = 'factory';
  const entity = placeStructure(sim, hf, economy, { kind: 'factory', x, z, valid: true, reason: '' })!;
  entity.building!.buildProgress = 1; return entity;
}
const tank = spawnTankAt(sim, -18, 10, 'Armor target', 2);
const infantry = spawnInfantryAt(sim, -6, 12, 2, 'infantry');
const aircraft = spawnWaspAt(sim, hf, -21, -23, 'Aircraft target', 2); aircraft.transform.y = aircraft.previousTransform.y = 12;
const factory = building(19, -20);
const targets: Record<string, Entity> = { armor: tank, infantry, aircraft, building: factory };
const unitView = new UnitView([tank, infantry, aircraft], hf, context); unitView.setCombatChromeVisible(false); unitView.setSelectionOverlayVisible(false);
const buildingView = new BuildingView(sim, hf, context); buildingView.setCombatChromeVisible(false);
const combat = new CombatView(hf, () => true, (id) => sim.byId.get(id)); combat.setCinematicMode(true);
scene.add(unitView.group, buildingView.group, combat.group); await prewarmMissileExplosion(renderer, camera, scene);
const panel = document.createElement('section'); panel.style.cssText = 'position:fixed;top:14px;left:14px;max-width:min(440px,calc(100vw - 64px));padding:16px;background:#0d171fe8;border:1px solid #5c8075;border-radius:10px;line-height:1.6';
panel.innerHTML = '<strong style="font-size:19px">TARGET IMPACT REVIEW</strong><div>Real units and buildings · controlled damage samples</div><div>Drag to orbit · scroll to zoom</div><div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:10px"><label>Target <select id="target"><option value="armor">Armor</option><option value="infantry">Infantry</option><option value="aircraft">Aircraft</option><option value="building">Factory</option></select></label><label>Hit from <select id="side"><option value="right">Right</option><option value="left">Left</option><option value="top">Above</option></select></label><button id="focus">Focus target</button><button id="light">Hit 15%</button><button id="heavy">Hit 45%</button><button id="destroy">Destroy</button><button id="repair">Repair survivor</button><button id="stress">Stress scene</button><button id="reset">Reset range</button><label>Quality <select id="quality"><option value="0">High</option><option value="1">Medium</option><option value="2">Performance</option></select></label><label>Speed <select id="speed"><option>1</option><option>2</option><option>3</option></select></label></div><div id="metrics" style="font:12px monospace;white-space:pre;margin-top:10px"></div><a style="color:#9fe1c4" href="/?start=weapons-lab&armies=2&seed=231128&doctrines=expeditionary-force,missile-command&combat=manual&preview=target-impact">Play with actual weapons →</a>';
document.body.append(panel);
for (const el of Array.from(panel.querySelectorAll('button,select'))) (el as HTMLElement).style.cssText = 'padding:6px;color:#e5eee7;background:#253b42;border:1px solid #64877b;border-radius:5px';
const params = new URLSearchParams(location.search); let time = 0, speed = 1, quality: 0 | 1 | 2 = 0;
let stressed = false;
const pending: Array<{ at: number; target: Entity; damage: number; fromX: number; fromY: number; fromZ: number; top: boolean }> = [];
const selected = () => targets[(panel.querySelector('#target') as HTMLSelectElement).value];
function focus(): void { const side=(panel.querySelector("#side") as HTMLSelectElement).value; const sign=side==="left"?-1:1; const t = selected(); const y = t.transform.y ?? 0; controls.target.set(t.transform.x, y + (t.building ? 3 : 1), t.transform.z); camera.position.set(t.transform.x + sign * (t.building ? 35 : 15), y + (t.building ? 22 : 10), t.transform.z + (t.building ? 36 : 20)); controls.update(); }
function hit(fraction: number): void {
  const t = selected(); if (t.destroyed) return;
  const side = (panel.querySelector('#side') as HTMLSelectElement).value;
  const top = side === 'top'; const fromX = t.transform.x + (side === 'right' ? 45 : -45), fromZ = t.transform.z + 5, fromY = top ? 60 : (t.transform.y ?? 0) + 1.4;
  combat.push([{ kind: 'tankMissile', weaponKind: 'tankMissile', fromX, fromZ, fromY, toX: t.transform.x, toZ: t.transform.z, toY: (t.transform.y ?? 0) + (t.building ? 3.5 : 1), targetId: t.id, sourceTeamId: 1, duration: 0.65, trajectory: top ? 'drop' : 'flat', damage: 0, killed: false }]);
  pending.push({ at: time + 0.65, target: t, damage: t.health!.max * fraction, fromX, fromZ, fromY, top });
}
function applyHit(hit: typeof pending[number]): void {
  const t = hit.target; if (t.destroyed || !t.health) return;
  const damage = Math.min(t.health.current, hit.damage); t.health.current -= damage;
  if (t.building) applyStructureDamage(t, { hitX: t.transform.x, hitZ: t.transform.z, hitY: hit.top ? 8 : 1.6, fromX: hit.fromX, fromZ: hit.fromZ, amount: damage, splashRadius: 4, trajectory: hit.top ? 'drop' : 'flat' });
  const killed = t.health.current <= 0; if (killed) t.destroyed = { remaining: 20 };
  const event: CombatEvent = { kind: 'tankMissile-impact', weaponKind: 'tankMissile', targetId: t.id, targetType: t.building ? 'building' : t.flight ? 'aircraft' : t.selectable?.type, fromX: hit.fromX, fromY: hit.fromY, fromZ: hit.fromZ, toX: t.transform.x, toY: (t.transform.y ?? 0) + 1.5, toZ: t.transform.z, damage, killed, trajectory: hit.top ? 'drop' : 'flat', sourceTeamId: 1 };
  if (!t.building) {
    const response = directionalImpactResponse({ targetX: t.transform.x, targetY: t.transform.y, targetZ: t.transform.z, targetRot: t.transform.rot, targetRadius: t.collider?.radius ?? 2, armor: t.armor?.kind ?? 'heavy', force: Math.min(1, damage / t.health.max), fromX: hit.fromX, fromY: hit.fromY, fromZ: hit.fromZ, hitX: t.transform.x, hitZ: t.transform.z, splashRadius: 4, trajectory: hit.top ? 'drop' : 'flat' });
    unitView.pushCombatEvents([{ ...event, kind: 'impact-reaction', impactKind: 'tankMissile', force: Math.min(1, damage / t.health.max), impactZone: response.zone, topFactor: response.topFactor, impulseX: response.directionX, impulseZ: response.directionZ, angularImpulse: response.angularImpulse }]);
  }
  combat.push([event]);
}
function stress(): void {
  if (stressed) return; stressed = true;
  for (let i = 0; i < 36; i++) { const e = spawnTankAt(sim, -80 + (i % 9) * 9, 40 + Math.floor(i / 9) * 10, 'Stress armor', 2); e.health!.current = e.health!.max * (params.get("critical")==="1" ? 0.24 : 0.4); }
  for (let i = 0; i < 8; i++) { const e = building(60 + (i % 4) * 36, -55 + Math.floor(i / 4) * 40); e.health!.current = e.health!.max * 0.4; applyStructureDamage(e, { hitX: e.transform.x, hitZ: e.transform.z, fromX: e.transform.x - 40, fromZ: e.transform.z, amount: e.health!.max * 0.6, splashRadius: 10 }); }
  unitView.syncEntities(sim.world.entities); camera.position.set(160, 125, 195); controls.target.set(25, 0, 0); controls.update();
}
panel.querySelector('#focus')!.addEventListener('click', focus);
panel.querySelector('#target')!.addEventListener('change', focus);
panel.querySelector('#light')!.addEventListener('click', () => hit(0.15)); panel.querySelector('#heavy')!.addEventListener('click', () => hit(0.45)); panel.querySelector('#destroy')!.addEventListener('click', () => hit(1.1));
panel.querySelector('#repair')!.addEventListener('click', () => { const t = selected(); if (t.destroyed) return; t.health!.current = t.health!.max; if (t.structureDamage) { t.structureDamage.cells.fill(0); t.structureDamage.version++; } });
panel.querySelector('#reset')!.addEventListener('click', () => location.reload()); panel.querySelector('#stress')!.addEventListener('click', stress);
panel.querySelector('#speed')!.addEventListener('change', (e) => { speed = Number((e.target as HTMLSelectElement).value); });
panel.querySelector('#quality')!.addEventListener('change', (e) => { quality = Number((e.target as HTMLSelectElement).value) as 0 | 1 | 2; unitView.setVisualQuality(quality); combat.setVisualQuality(quality); });
if (params.get('stress') === '1') stress();
const snapshot = Number(params.get('snapshot')) || Infinity;
let previous = performance.now(), accumulator = 0; const frames: number[] = [];
function frame(now: number): void {
  const elapsed = (now - previous) / 1000; previous = now; frames.push(elapsed * 1000); if (frames.length > 180) frames.shift(); accumulator += Math.min(0.1, elapsed) * speed;
  while (accumulator >= 1 / 60 && time < snapshot - 1e-8) {
    accumulator -= 1 / 60; time += 1 / 60; sim.tick = Math.floor(time * 30);
    for (let i = pending.length - 1; i >= 0; i--) if (pending[i].at <= time) { applyHit(pending[i]); pending.splice(i, 1); }
    for (const e of sim.world.entities) if (e.destroyed) e.destroyed.remaining = Math.max(0, e.destroyed.remaining - 1 / 60);
    combat.update(1 / 60); unitView.update(1, 1 / 60, camera); buildingView.update(economy, camera);
  }
  combat.completeFrame(); renderer.render(scene, camera);
  const sorted = [...frames].sort((a, b) => a - b), t = selected();
  panel.querySelector('#metrics')!.textContent = `Target ${t.destroyed ? 'DESTROYED' : Math.round(t.health!.current / t.health!.max * 100) + '% HP'}\nDraw calls ${renderer.info.render.calls} · triangles ${renderer.info.render.triangles}\nGeometries ${renderer.info.memory.geometries} · textures ${renderer.info.memory.textures}\nFrame p50 ${sorted[Math.floor(sorted.length * 0.5)].toFixed(1)}ms · p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)}ms\nFixture ${time.toFixed(1)}s · quality ${quality}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame); addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
