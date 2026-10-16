import { afterEach, describe, expect, it, vi } from 'vitest';
import { Line, Mesh, Sprite, Vector3 } from 'three';
import { MAP01 } from '../content/map01';
import { generateHeightfield } from '../sim/heightfield';
import type { CombatEvent } from '../sim/world';
import { CombatView, selectCombatVisualEvents } from './combatView';
import { createMissileTrail, missileTrailProfile, updateMissileTrail } from './missileTrail';

function canvasStub() {
  const text = vi.fn();
  const gradient = { addColorStop: () => undefined };
  const context = new Proxy({ fillText: text, createRadialGradient: () => gradient, createLinearGradient: () => gradient }, {
    get: (target, key) => key in target ? target[key as keyof typeof target] : () => undefined,
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
  return text;
}
const event = (overrides: Partial<CombatEvent> = {}): CombatEvent => ({ kind: 'aaMissile', weaponKind: 'aaMissile', trajectory: 'homing', fromX: 0, fromZ: 0, fromY: 20, toX: 80, toZ: 0, toY: 20, duration: 3, damage: 0, killed: false, sourceTeamId: 1, ...overrides });
afterEach(() => vi.unstubAllGlobals());

describe('combat readability', () => {
  it('gives missile roles distinct trail colors and a bounded heavier silhouette', () => {
    expect(missileTrailProfile('aaMissile').color).not.toBe(missileTrailProfile('agMissile').color);
    expect(missileTrailProfile('siegeMissile').width).toBeGreaterThan(missileTrailProfile('scoutMissile').width);
    expect(missileTrailProfile('strategicMissile').samples).toBeLessThanOrEqual(48);
  });

  it('draws only the sampled trail, with a tapered tail and no line back to launch', () => {
    const trail = createMissileTrail('aaMissile');
    const positions = trail.geometry.getAttribute('position');
    const storage = positions.array;
    updateMissileTrail(trail, [new Vector3(20, 15, 0), new Vector3(24, 15, 0), new Vector3(28, 15, 0)]);
    expect(trail.geometry.drawRange.count).toBe(24);
    const colors = trail.geometry.getAttribute('color');
    expect(colors.getX(0)).toBe(0);
    expect(colors.getX(23)).toBe(1);
    for (let i = 0; i < 24; i++) {
      expect(positions.getX(i)).toBeGreaterThanOrEqual(20);
      expect(Number.isFinite(positions.getY(i))).toBe(true);
    }
    updateMissileTrail(trail, [new Vector3(0, 0, 0), new Vector3(0, 10, 0)]);
    expect(trail.geometry.getAttribute('position').array).toBe(storage);
    expect(trail.geometry.drawRange.count).toBe(12);
    expect(Array.from(storage).every(Number.isFinite)).toBe(true);
  });

  it('reserves heavy-impact feedback during an ordinary gunfire storm', () => {
    const ordinary = Array.from({ length: 250 }, () => event({ kind: 'rifle', weaponKind: 'rifle' }));
    const heavy = Array.from({ length: 20 }, () => event({ kind: 'kineticShell-impact', weaponKind: 'heavyCannon' }));
    const selected = selectCombatVisualEvents([...ordinary, ...heavy], 1, 0);
    expect(selected).toHaveLength(48);
    expect(selected.filter((candidate) => candidate.weaponKind === 'heavyCannon').length).toBeGreaterThanOrEqual(8);
  });

  it('keeps labels readable after animation and replaces repeated hits on one target', () => {
    const text = canvasStub();
    const view = new CombatView(generateHeightfield(MAP01));
    const hit = event({ kind: 'rifle', weaponKind: 'rifle', damage: 30, targetId: 7, targetType: 'aircraft', targetMaxHealth: 100, targetHealth: 70 });
    view.push([hit]);
    const labels = () => view.group.children.filter((child) => child instanceof Sprite && child.renderOrder === 95);
    expect(labels()).toHaveLength(1);
    const height = labels()[0].position.y;
    view.update(0.1);
    expect(labels()[0].scale.x).toBeGreaterThan(10);
    expect(labels()[0].scale.y).toBeGreaterThan(3);
    expect(height).toBeGreaterThan(20);
    view.completeFrame();
    view.push([{ ...hit, killed: true, targetHealth: 0 }]);
    expect(labels()).toHaveLength(1);
    expect(text.mock.calls.some(([label]) => label === 'HEAVY HIT -30%')).toBe(true);
    expect(text.mock.calls.some(([label]) => label === 'DESTROYED')).toBe(true);
  });

  it('uses the heavy blast silhouette for a heavy cannon instead of a rifle flash', () => {
    canvasStub();
    const view = new CombatView(generateHeightfield(MAP01));
    view.push([event({ kind: 'kineticShell-impact', weaponKind: 'heavyCannon', toY: 20 })]);
    const shockwaves: Mesh[] = [];
    view.group.traverse((object) => { if (object instanceof Mesh && !Array.isArray(object.material) && object.material.userData.role === 'shock') shockwaves.push(object); });
    expect(shockwaves).toHaveLength(1);
    expect(shockwaves[0].parent!.scale.x).toBeCloseTo(1.5);
  });

  it('bounds all active renderable effects over repeated salvos and immediately sheds on quality reduction', () => {
    canvasStub();
    const view = new CombatView(generateHeightfield(MAP01));
    let disposed = 0;
    for (let frame = 0; frame < 14; frame++) {
      view.completeFrame();
      view.push(Array.from({ length: 50 }, (_, i) => event({ fromX: i * 0.1, weaponKind: i % 2 ? 'siegeMissile' : 'aaMissile' })));
      view.group.traverse((object) => { if (object instanceof Mesh) object.geometry.addEventListener('dispose', () => disposed++); });
      view.update(0.03);
      expect(view.effectStats().drawables).toBeLessThanOrEqual(view.effectStats().budget);
    }
    view.setVisualQuality(2);
    expect(view.effectStats().drawables).toBeLessThanOrEqual(220);
    expect(view.effectStats().projectiles).toBeGreaterThan(0);
    let actual = 0;
    view.group.traverse((object) => { if (object instanceof Mesh || object instanceof Line || object instanceof Sprite) actual++; });
    expect(actual).toBe(view.effectStats().drawables);
    expect(disposed).toBeGreaterThan(0);
  });
});
