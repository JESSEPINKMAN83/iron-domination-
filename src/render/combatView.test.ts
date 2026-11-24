import { WEAPONS, type WeaponKind } from '../content/phase4';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircleGeometry, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry, Sprite } from 'three';
import { MAP01 } from '../content/map01';
import { generateHeightfield, type Heightfield } from '../sim/heightfield';
import type { CombatEvent } from '../sim/world';
import { CombatView, isWaterSurfaceHit, selectCombatVisualEvents, shouldPaintGroundScorch } from './combatView';

beforeEach(() => {
  const context = new Proxy({}, { get: (_, key) => key === 'createRadialGradient' ? () => ({ addColorStop: () => undefined }) : () => undefined });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
});
afterEach(() => vi.unstubAllGlobals());

function event(index: number, sourceTeamId: number, overrides: Partial<CombatEvent> = {}): CombatEvent {
  return {
    kind: 'rifle',
    fromX: index,
    fromZ: 0,
    toX: index + 1,
    toZ: 1,
    sourceTeamId,
    damage: 4,
    killed: false,
    ...overrides,
  };
}

describe('combat visual load shedding', () => {
  it('keeps ordinary battles intact', () => {
    const events = Array.from({ length: 12 }, (_, index) => event(index, (index % 3) + 1));
    expect(selectCombatVisualEvents(events, 1, 0)).toEqual(events);
  });

  it('bounds a three-army event storm while reserving local and critical feedback', () => {
    const events = [
      ...Array.from({ length: 30 }, (_, index) => event(index, 2, { killed: true })),
      ...Array.from({ length: 120 }, (_, index) => event(100 + index, 1)),
      ...Array.from({ length: 150 }, (_, index) => event(300 + index, index % 2 === 0 ? 2 : 3)),
    ];

    const selected = selectCombatVisualEvents(events, 1, 0);
    expect(selected).toHaveLength(48);
    expect(selected.filter((candidate) => candidate.killed)).toHaveLength(12);
    expect(selected.filter((candidate) => !candidate.killed && candidate.sourceTeamId === 1)).toHaveLength(24);
    expect(selected.some((candidate) => candidate.sourceTeamId === 2 || candidate.sourceTeamId === 3)).toBe(true);
    expect(selected.map((candidate) => candidate.fromX)).toEqual(
      [...selected].sort((a, b) => a.fromX - b.fromX).map((candidate) => candidate.fromX),
    );
  });

  it('tightens the allocation ceiling as adaptive quality drops', () => {
    const events = Array.from({ length: 200 }, (_, index) => event(index, (index % 3) + 1));
    expect(selectCombatVisualEvents(events, 1, 0)).toHaveLength(48);
    expect(selectCombatVisualEvents(events, 1, 1)).toHaveLength(34);
    expect(selectCombatVisualEvents(events, 1, 2)).toHaveLength(22);
    expect(selectCombatVisualEvents(events, 1, 0, 7)).toHaveLength(7);
    expect(selectCombatVisualEvents(events, 1, 0, 0)).toEqual([]);
  });

  it('ignores non-visual bookkeeping before applying the budget', () => {
    const bookkeeping = Array.from({ length: 100 }, (_, index) => event(index, 1, { kind: 'impact-reaction' }));
    bookkeeping.push(event(150, 2, { kind: 'strategic-missile-warning', targetTeamId: 1 }));
    const visible = Array.from({ length: 8 }, (_, index) => event(200 + index, 1));
    expect(selectCombatVisualEvents([...bookkeeping, ...visible], 1, 0)).toEqual(visible);
  });

  it('shows and updates strategic missile health for every player viewing the missile', () => {
    const view = new CombatView(generateHeightfield(MAP01), () => true, () => undefined, 2);
    view.push([event(0, 1, {
      kind: 'siegeMissile',
      weaponKind: 'strategicMissile',
      targetTeamId: 2,
      strategicId: 42,
      targetHealth: 100,
      targetMaxHealth: 100,
      trajectory: 'arc',
      duration: 8,
      damage: 0,
    })]);
    const sprites: Sprite[] = [];
    view.group.traverse((object) => {
      if (object instanceof Sprite) sprites.push(object);
    });
    const fill = sprites.find((sprite) => sprite.renderOrder === 91);
    expect(fill?.scale.x).toBeCloseTo(8.1);

    view.push([event(1, 2, {
      kind: 'impact-reaction',
      strategicId: 42,
      targetHealth: 40,
      targetMaxHealth: 100,
      damage: 20,
    })]);
    expect(fill?.scale.x).toBeCloseTo(3.24);

    const attackerView = new CombatView(generateHeightfield(MAP01), () => true, () => undefined, 1);
    attackerView.push([event(0, 1, {
      kind: 'siegeMissile',
      weaponKind: 'strategicMissile',
      targetTeamId: 2,
      strategicId: 43,
      targetHealth: 100,
      targetMaxHealth: 100,
      trajectory: 'arc',
      duration: 8,
      damage: 0,
    })]);
    const attackerSprites: Sprite[] = [];
    attackerView.group.traverse((object) => {
      if (object instanceof Sprite) attackerSprites.push(object);
    });
    expect(attackerSprites.some((sprite) => sprite.renderOrder === 91)).toBe(true);
  });

  it('turns an intercepted strategic projectile into a persistent destroyed wreck', () => {
    const view = new CombatView(generateHeightfield(MAP01), () => true, () => undefined, 2);
    view.push([event(0, 1, {
      kind: 'siegeMissile',
      weaponKind: 'strategicMissile',
      strategicId: 77,
      targetTeamId: 2,
      targetHealth: 100,
      targetMaxHealth: 100,
      fromY: 42,
      toY: 18,
      trajectory: 'arc',
      duration: 8,
      damage: 0,
    })]);

    view.push([event(1, 2, {
      kind: 'strategic-missile-intercepted',
      weaponKind: 'strategicMissile',
      strategicId: 77,
      targetTeamId: 1,
      targetHealth: 0,
      targetMaxHealth: 100,
      fromY: 32,
      toY: 32,
      killed: true,
      damage: 0,
    })]);

    expect(view.group.getObjectByName('destroyed-strategic-wreck')).toBeDefined();
    const remainingHealthBars: Sprite[] = [];
    view.group.traverse((object) => {
      if (object instanceof Sprite && object.renderOrder === 91) remainingHealthBars.push(object);
    });
    expect(remainingHealthBars).toHaveLength(0);
  });
});

function stubHeightfield(groundY: number, waterLevel: number): Heightfield {
  const cells = 4;
  const samples = 5;
  const cellSize = 2;
  return {
    kind: 'highlands',
    cells,
    cellSize,
    samples,
    size: cells * cellSize,
    waterLevel,
    maxHeight: Math.max(groundY, waterLevel),
    heights: new Float32Array(samples * samples).fill(groundY),
    walkable: new Uint8Array(cells * cells).fill(1),
    splat: new Uint8Array(samples * samples * 4),
    oreFields: [],
  };
}

function collectMeshes(view: CombatView): Mesh[] {
  const meshes: Mesh[] = [];
  view.group.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  return meshes;
}

describe('water surface hits', () => {
  it('treats lake cells as water unless the impact is a high airburst', () => {
    const lake = stubHeightfield(0.4, 2);
    expect(isWaterSurfaceHit(lake, 0, 0)).toBe(true);
    expect(isWaterSurfaceHit(lake, 0, 0, 0.4)).toBe(true);
    expect(isWaterSurfaceHit(lake, 0, 0, 4.2)).toBe(false);
    expect(isWaterSurfaceHit(stubHeightfield(4.5, 2), 0, 0)).toBe(false);
  });

  it('never paints ground scorches onto a lake bed', () => {
    const lake = stubHeightfield(0.4, 2);
    const land = stubHeightfield(4.5, 2);
    const shell = event(0, 1, { kind: 'kineticShell-impact', toX: 0, toZ: 0, toY: 0.4 });
    expect(shouldPaintGroundScorch(lake, shell)).toBe(false);
    expect(shouldPaintGroundScorch(lake, { ...shell, toY: 3.8 })).toBe(false);
    expect(shouldPaintGroundScorch(land, { ...shell, toY: 4.5 })).toBe(true);
    expect(shouldPaintGroundScorch(land, event(0, 1, { kind: 'rifle', toX: 0, toZ: 0 }))).toBe(false);
  });

  it('spawns a surface ripple instead of a dark crater when shooting water', () => {
    const lake = stubHeightfield(0.35, 2);
    const view = new CombatView(lake, () => true, () => undefined, 1);
    view.push([event(0, 1, { kind: 'rifle', toX: 0, toZ: 0, damage: 0 })]);
    const meshes = collectMeshes(view);
    expect(meshes.some((mesh) => mesh.geometry instanceof RingGeometry && mesh.position.y === 0 && mesh.parent?.position.y === lake.waterLevel + 0.07)).toBe(true);
    expect(meshes.some((mesh) => mesh.geometry instanceof PlaneGeometry)).toBe(false);
    expect(meshes.some((mesh) => mesh.geometry instanceof CircleGeometry)).toBe(false);
    expect(meshes.some((mesh) => mesh.geometry.type === 'SphereGeometry')).toBe(false);
  });

  it('still uses a small impact flash on dry land', () => {
    const land = stubHeightfield(4.5, 2);
    const view = new CombatView(land, () => true, () => undefined, 1);
    view.push([event(0, 1, { kind: 'rifle', toX: 0, toZ: 0, damage: 0 })]);
    const meshes = collectMeshes(view);
    expect(meshes.some((mesh) => mesh.geometry.type === 'SphereGeometry')).toBe(true);
    expect(meshes.some((mesh) => mesh.geometry instanceof RingGeometry && mesh.parent?.position.y === land.waterLevel + 0.07)).toBe(false);
  });

  it('keeps bomb fire on water but drops the dark ground disc', () => {
    const lake = stubHeightfield(0.35, 2);
    const view = new CombatView(lake, () => true, () => undefined, 1);
    view.push([event(0, 1, { kind: 'bomb-impact', toX: 0, toZ: 0, toY: 0.4, damage: 0 })]);
    const meshes = collectMeshes(view);
    expect(meshes.some((mesh) => mesh.geometry instanceof CircleGeometry)).toBe(false);
    expect(meshes.some((mesh) => mesh.geometry instanceof PlaneGeometry)).toBe(false);
    expect(meshes.some((mesh) => mesh.geometry instanceof RingGeometry)).toBe(true);
    expect(view.group.getObjectByName('missile-explosion')).toBeInstanceOf(Sprite);
  });
});

describe('missile presentation', () => {
  it.each(['aaMissile', 'tankMissile', 'strategicMissile'] as const)('consolidates %s bodies without changing flight endpoints', (weaponKind) => {
    const view = new CombatView(generateHeightfield(MAP01));
    view.push([event(0, 1, { kind: weaponKind === 'strategicMissile' ? 'siegeMissile' : weaponKind, weaponKind, fromY: 10, toY: 20, toX: 100, toZ: 40, duration: 2, trajectory: 'arc' })]);
    const bodies: Mesh[] = [];
    view.group.traverse((o) => { if (o instanceof Mesh && o.name === 'missile-body') bodies.push(o); });
    expect(bodies).toHaveLength(1);
    expect(bodies[0].geometry.groups).toHaveLength(0);
    expect(bodies[0].geometry.getAttribute('color')).toBeDefined();
    expect(view.effectStats().drawables).toBeLessThanOrEqual(6);
    view.update(1);
    const parent = bodies[0].parent!;
    expect(parent.position.x).toBeCloseTo(50);
    parent.traverse((o) => { expect(Number.isFinite(o.position.y)).toBe(true); });
    view.update(1);
    expect(view.effectStats().projectiles).toBe(0);
  });
  it('animates rocket exhaust then extinguishes it during strategic coast', () => {
    const view = new CombatView(generateHeightfield(MAP01));
    view.push([event(0, 1, { kind: 'siegeMissile', weaponKind: 'strategicMissile', duration: 10, trajectory: 'arc' })]);
    const exhaust: Mesh[] = [];
    view.group.traverse((o) => { if (o instanceof Mesh && o.name === 'missile-exhaust') exhaust.push(o); });
    expect(exhaust).toHaveLength(2);
    view.update(0.2); const scale = exhaust[0].scale.y;
    view.update(0.02); expect(exhaust[0].scale.y).not.toBe(scale);
    view.update(5); expect(exhaust.every((o) => !o.visible)).toBe(true);
  });
  it('uses an elevated airburst for anti-air hits', () => {
    const view = new CombatView(generateHeightfield(MAP01));
    view.push([event(0, 1, { kind: 'aaMissile-impact', weaponKind: 'aaMissile', targetType: 'aircraft', toY: 60 })]);
    expect(view.group.getObjectByName('missile-airburst')?.position.y).toBe(60);
    view.update(1);
    expect(view.group.getObjectByName('missile-airburst')).toBeUndefined();
  });
});


describe('missile resource ownership', () => {
  it('shares immutable geometry but isolates materials and releases the last wreck reference', () => {
    const view = new CombatView(generateHeightfield(MAP01));
    view.push([1, 2, 3].map((id) => event(id, 1, { kind: 'siegeMissile', weaponKind: 'strategicMissile', strategicId: id, fromY: 100, duration: 10 })));
    const bodies: Mesh[] = [];
    view.group.traverse((o) => { if (o instanceof Mesh && o.name === 'missile-body') bodies.push(o); });
    expect(bodies).toHaveLength(3);
    expect(bodies[0].geometry).toBe(bodies[1].geometry);
    expect(bodies[0].material).not.toBe(bodies[1].material);
    const dispose = vi.spyOn(bodies[0].geometry, 'dispose');
    view.push([event(0, 2, { kind: 'strategic-missile-intercepted', strategicId: 1 })]);
    expect(dispose).not.toHaveBeenCalled();
    // Quality trimming and projectile expiry must not free an airborne wreck's geometry.
    view.setVisualQuality(2);
    view.update(10);
    expect(view.effectStats().projectiles).toBe(0);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(view.group.getObjectByName('destroyed-strategic-wreck')).toBeUndefined();
    view.push([event(4, 1, { kind: 'siegeMissile', weaponKind: 'strategicMissile', duration: 10 })]);
    const replacement = view.group.getObjectByName('missile-body') as Mesh;
    expect(replacement.geometry).not.toBe(bodies[0].geometry);
    view.update(10);
  });
  it.each([0, 1, 2] as const)('keeps repeated missile volleys bounded at quality %s', (quality) => {
    const view = new CombatView(generateHeightfield(MAP01));
    view.setVisualQuality(quality);
    for (let frame = 0; frame < 60; frame++) {
      view.push(Array.from({ length: 12 }, (_, i) => event(i, 1, { kind: 'aaMissile', weaponKind: 'aaMissile', duration: 1, trajectory: 'flat' })));
      view.update(1 / 30); view.completeFrame();
      expect(view.effectStats().drawables).toBeLessThanOrEqual(view.effectStats().budget);
      expect(view.effectStats().projectiles).toBeLessThanOrEqual([72, 48, 28][quality]);
    }
    view.update(40);
    expect(view.effectStats().projectiles).toBe(0);
  });
});


describe('textured missile impacts', () => {
  it.each([
    ['atRocket-impact', 'rocketLauncher'], ['atRocket-impact', 'rocketPod'],
    ['tankMissile-impact', 'tankMissile'], ['agMissile-impact', 'precisionMissile'],
    ['siegeMissile-impact', 'strategicMissile'], ['siegeMissile-impact', 'emberDrone'],
  ] as const)('uses the shared animated blast for %s / %s', (kind, weaponKind) => {
    const view = new CombatView(generateHeightfield(MAP01));
    view.push([event(0, 1, { kind, weaponKind, toY: 40 })]);
    const explosion = view.group.getObjectByName('missile-explosion') as Sprite;
    expect(explosion).toBeInstanceOf(Sprite);
    const texture = explosion.material.map;
    expect(texture?.image.width).toBe(768);
    view.update(0.1);
    expect(explosion.material.userData.explosionFrame.value).toBeGreaterThan(0);
    expect(explosion.material.map).toBe(texture);
    view.update(2);
    expect(view.group.getObjectByName('missile-explosion')).toBeUndefined();
  });
  it('keeps Shahed propellers moving without adding rocket exhaust', () => {
    const view = new CombatView(generateHeightfield(MAP01));
    view.push([event(0, 1, { kind: 'siegeMissile', weaponKind: 'emberDrone', duration: 5 })]);
    const propeller = view.group.getObjectByName('drone-propeller')!;
    const before = propeller.rotation.y;
    expect(view.group.getObjectByName('missile-exhaust')).toBeUndefined();
    view.update(0.1);
    expect(propeller.rotation.y).not.toBe(before);
    expect(view.group.getObjectByName('missile-body')).toBeDefined();
  });
});


it('gives the tank main-gun shell a textured impact with a single blast draw', () => {
  const view = new CombatView(generateHeightfield(MAP01));
  view.push([event(0, 1, { kind: 'kineticShell-impact', weaponKind: 'cannon', toY: 40 })]);
  const blast = view.group.getObjectByName('missile-ground-blast')!;
  expect(blast.children).toHaveLength(1);
  expect(blast.children[0]).toBeInstanceOf(Sprite);
  view.update(2);
  expect(view.group.getObjectByName('missile-ground-blast')).toBeUndefined();
});


describe('complete ordnance presentation coverage', () => {
  const projectileWeapons = (Object.keys(WEAPONS) as WeaponKind[]).filter((kind) => WEAPONS[kind].projectile || ['bomb', 'heavyBomb', 'tankBomb'].includes(kind));
  it.each(projectileWeapons)('renders launch and textured impact for %s', (weaponKind) => {
    const view = new CombatView(generateHeightfield(MAP01));
    view.setCinematicMode(true);
    const launchKind = WEAPONS[weaponKind].projectile?.kind ?? (weaponKind === 'heavyBomb' ? 'bomb' : weaponKind);
    view.push([event(0, 1, { kind: launchKind, weaponKind, fromY: 60, toY: 60, duration: 0.2 })]);
    expect(view.effectStats().projectiles).toBe(1);
    view.update(0.21); view.completeFrame();
    view.push([event(0, 1, { kind: `${launchKind}-impact`, weaponKind, toY: 60 })]);
    expect(view.group.getObjectByName('missile-explosion')).toBeInstanceOf(Sprite);
    view.update(5);
    expect(view.group.getObjectByName('missile-explosion')).toBeUndefined();
    expect(view.effectStats().projectiles).toBe(0);
  });
  it('uses the same textured impact for a physical FPV drone hit', () => {
    const view = new CombatView(generateHeightfield(MAP01));
    view.push([event(0, 1, { kind: 'bomb-impact', weaponKind: 'fpvStrike', toY: 60, damage: 20 })]);
    expect(view.group.getObjectByName('missile-explosion')).toBeInstanceOf(Sprite);
    expect(view.effectStats().projectiles).toBe(0);
  });
});

it('keeps loading blueprints off-scene and gives each view independent GPU geometry', () => {
  const first = new CombatView(generateHeightfield(MAP01));
  const second = new CombatView(generateHeightfield(MAP01));
  expect(first.group.children).toHaveLength(0);
  expect(second.group.children).toHaveLength(0);
  const launch = event(0, 1, { kind: 'agMissile', weaponKind: 'precisionMissile', duration: 1 });
  first.push([launch]); second.push([launch]);
  const a = first.group.getObjectByName('missile-body') as Mesh;
  const b = second.group.getObjectByName('missile-body') as Mesh;
  expect(a.geometry).not.toBe(b.geometry);
  expect(a.geometry.getAttribute('position').array).not.toBe(b.geometry.getAttribute('position').array);
  const dispose = vi.spyOn(a.geometry, 'dispose');
  second.update(2);
  expect(dispose).not.toHaveBeenCalled();
  first.update(2);
  expect(dispose).toHaveBeenCalledTimes(1);
});
