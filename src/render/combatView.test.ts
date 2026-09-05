import { describe, expect, it } from 'vitest';
import { CircleGeometry, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry, Sprite } from 'three';
import { MAP01 } from '../content/map01';
import { generateHeightfield, type Heightfield } from '../sim/heightfield';
import type { CombatEvent } from '../sim/world';
import { CombatView, isWaterSurfaceHit, selectCombatVisualEvents, shouldPaintGroundScorch } from './combatView';

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
    expect(meshes.some((mesh) => {
      const material = mesh.material;
      return mesh.geometry.type === 'SphereGeometry' && material instanceof MeshBasicMaterial && material.color.getHex() === 0xff9738;
    })).toBe(true);
  });
});
