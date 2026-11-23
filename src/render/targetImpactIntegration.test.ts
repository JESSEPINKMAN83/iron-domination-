import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstancedMesh, Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three';
import { MAP01 } from '../content/map01';
import { generateHeightfield } from '../sim/heightfield';
import { createGameSim } from '../sim/world';
import { createEconomy, placeStructure } from '../sim/economy';
import { applyStructureDamage } from '../sim/structureDamage';
import { BuildingView } from './buildingView';
import type { RenderContext } from './renderer';

beforeEach(() => {
  const context = new Proxy({}, { get: (_, key) => {
    if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => ({ addColorStop: () => undefined });
    if (key === 'measureText') return () => ({ width: 100 });
    if (key === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (key === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
    return () => undefined;
  } });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture() {
  const hf = generateHeightfield(MAP01); hf.heights.fill(0); hf.waterLevel = -10; hf.walkable.fill(1);
  const sim = createGameSim(hf), economy = createEconomy(2, 10000);
  economy.readyStructure = 'factory';
  const entity = placeStructure(sim, hf, economy, { kind: 'factory', x: 0, z: 0, valid: true, reason: '' })!;
  entity.building!.buildProgress = 1;
  const context = { setupLitMaterial: <T>(m: T): T => m } as unknown as RenderContext;
  let visible = true;
  const view = new BuildingView(sim, hf, context, () => visible);
  const camera = new PerspectiveCamera(50, 1.5, 0.1, 500); camera.position.set(40, 25, 45); camera.lookAt(0, 3, 0); camera.updateMatrixWorld();
  view.update(economy, camera);
  const hit = () => { entity.health!.current *= 0.55; applyStructureDamage(entity, { hitX: 0, hitZ: 0, fromX: 40, fromZ: 0, amount: 200, splashRadius: 6 }); };
  return { view, sim, economy, entity, camera, hit, fog: () => { visible = false; } };
}
describe('live building target damage', () => {
  it('batches damaged cells and makes hit heat depend on game ticks, not render count', () => {
    const f = fixture(); f.sim.tick = 100; f.hit(); f.view.update(f.economy, f.camera);
    const root = f.view.group.getObjectByName('damaged-building-hull')!;
    expect(root.children.length).toBeLessThan(8); expect(root.children.every((child) => child instanceof InstancedMesh)).toBe(true);
    const flash = f.view.group.getObjectByName('building-impact-flash') as Mesh;
    expect(flash).toBeDefined(); const opacity = (flash.material as MeshBasicMaterial).opacity;
    for (let frame = 0; frame < 20; frame++) f.view.update(f.economy, f.camera);
    expect((flash.material as MeshBasicMaterial).opacity).toBe(opacity);
    f.sim.tick = 110; f.view.update(f.economy, f.camera); expect(flash.visible).toBe(false);
  });
  it('animates collapse without cloning new effect materials every frame', () => {
    const f = fixture(); f.hit(); f.entity.health!.current = 0; f.entity.destroyed = { remaining: 20 };
    const clone = vi.spyOn(MeshBasicMaterial.prototype, 'clone');
    f.view.update(f.economy, f.camera); const allocations = clone.mock.calls.length;
    for (let frame = 1; frame < 45; frame++) { f.sim.tick = Math.floor(frame / 2); f.entity.destroyed.remaining = 20 - frame / 60; f.view.update(f.economy, f.camera); }
    expect(clone.mock.calls.length).toBe(allocations);
    expect(f.view.group.getObjectByName('damaged-building-hull')?.children.length).toBeLessThanOrEqual(4);
  });
  it('freezes last-seen damage effects while the building is in fog', () => {
    const f = fixture(); f.hit(); f.view.update(f.economy, f.camera);
    const scar = f.view.group.getObjectByName('building-impact-scar') as Mesh; expect(scar).toBeDefined();
    const position = scar.position.clone(); const visible = scar.visible;
    f.fog(); f.entity.health!.current = 0; f.entity.destroyed = { remaining: 18 }; f.sim.tick = 100;
    f.view.update(f.economy, f.camera);
    expect(scar.visible).toBe(visible); expect(scar.position.equals(position)).toBe(true);
  });
});
