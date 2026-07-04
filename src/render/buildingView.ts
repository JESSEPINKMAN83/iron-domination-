import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
  type Camera,
  type Material,
} from 'three';
import { STRUCTURES, type StructureKind } from '../content/phase3';
import type { Entity } from '../sim/components';
import type { EconomyState } from '../sim/economy';
import { buildings, type PlacementState } from '../sim/economy';
import { sampleHeight, type Heightfield } from '../sim/heightfield';
import type { GameSim } from '../sim/world';
import type { RenderContext } from './renderer';

export class BuildingView {
  readonly group = new Group();
  private readonly objects = new Map<Entity, Mesh>();
  private readonly selectedGlows = new Map<Entity, SelectionGlow>();
  private readonly healthBars = new Map<Entity, { root: Group; fill: Mesh; fillMaterial: MeshBasicMaterial }>();
  private readonly ghost: Mesh;
  private readonly materials: Record<string, Material>;
  private readonly healthBackMaterial = new MeshBasicMaterial({ color: 0x050806, transparent: true, opacity: 0.84, depthWrite: false, side: DoubleSide });

  private readonly playerAccent: Material;
  private readonly enemyAccent: Material;
  private readonly wreckMaterial: Material;

  constructor(private readonly sim: GameSim, private readonly hf: Heightfield, ctx: RenderContext) {
    this.playerAccent = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0xf0c85a, emissive: 0x2b1d00, roughness: 0.7 }));
    this.enemyAccent = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0xd65b46, emissive: 0x2a0600, roughness: 0.72 }));
    this.wreckMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x1d1a16, roughness: 1, metalness: 0.05 }));
    this.materials = {
      'command-yard': ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x5d6670, roughness: 0.8, metalness: 0.1 })),
      'power-plant': ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x586d7b, roughness: 0.78, metalness: 0.12 })),
      refinery: ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x6c6554, roughness: 0.82, metalness: 0.08 })),
      barracks: ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x59685a, roughness: 0.85, metalness: 0.06 })),
      factory: ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x667077, roughness: 0.76, metalness: 0.14 })),
      helipad: ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x4d5f64, roughness: 0.8, metalness: 0.16 })),
      wall: ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x4f5552, roughness: 0.88, metalness: 0.08 })),
      'guard-tower': ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x59646a, roughness: 0.78, metalness: 0.14 })),
      'aa-tower': ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x4b5f6d, roughness: 0.74, metalness: 0.18 })),
    };
    this.ghost = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0x7df27d, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ghost.visible = false;
    this.ghost.renderOrder = 40;
    this.group.add(this.ghost);
  }

  update(economy: EconomyState, camera: Camera): void {
    // sweep meshes whose entities were removed from the world (destroyed timers expired)
    for (const [entity, mesh] of this.objects) {
      if (this.sim.world.has(entity)) continue;
      this.group.remove(mesh);
      const glow = this.selectedGlows.get(entity);
      if (glow) this.group.remove(glow.root);
      const healthBar = this.healthBars.get(entity);
      if (healthBar) this.group.remove(healthBar.root);
      this.objects.delete(entity);
      this.selectedGlows.delete(entity);
      this.healthBars.delete(entity);
    }
    for (const entity of buildings(this.sim)) {
      let mesh = this.objects.get(entity);
      if (!mesh && entity.building) {
        const geometry = new BoxGeometry(entity.building.footprint.w * this.hf.cellSize * 2, 3.2, entity.building.footprint.h * this.hf.cellSize * 2);
        mesh = new Mesh(geometry, this.materials[entity.building.kind] ?? this.materials['command-yard']);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const accent = new Mesh(
          new BoxGeometry(entity.building.footprint.w * this.hf.cellSize, 0.5, entity.building.footprint.h * this.hf.cellSize * 0.3),
          entity.team?.id === 2 ? this.enemyAccent : this.playerAccent,
        );
        accent.position.y = 1.85;
        accent.castShadow = true;
        mesh.add(accent);
        this.objects.set(entity, mesh);
        this.group.add(mesh);

        const glow = createSelectionGlow(entity, this.hf.cellSize);
        this.selectedGlows.set(entity, glow);
        this.group.add(glow.root);

        if (entity.health) {
          const healthBar = createBuildingHealthBar(this.healthBackMaterial);
          this.healthBars.set(entity, healthBar);
          this.group.add(healthBar.root);
        }
      }
      if (!mesh || !entity.building) continue;
      const y = sampleHeight(this.hf, entity.transform.x, entity.transform.z);
      const progress = Math.max(0.08, entity.building.buildProgress);
      mesh.position.set(entity.transform.x, y + 1.6 * progress, entity.transform.z);
      mesh.scale.y = entity.destroyed ? 0.45 : progress;
      if (entity.destroyed && mesh.material !== this.wreckMaterial) mesh.material = this.wreckMaterial;

      this.updateSelectionGlow(entity, y);
      this.updateHealthBar(entity, y, camera);
    }
    this.updateGhost(economy.placement);
  }

  pickAt(x: number, z: number): Entity | undefined {
    let best: Entity | undefined;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (const entity of buildings(this.sim)) {
      if (!entity.building) continue;
      const halfW = entity.building.footprint.w * this.hf.cellSize;
      const halfH = entity.building.footprint.h * this.hf.cellSize;
      const localX = Math.abs(x - entity.transform.x);
      const localZ = Math.abs(z - entity.transform.z);
      const inFootprint = localX <= halfW && localZ <= halfH;
      const d2 = (entity.transform.x - x) ** 2 + (entity.transform.z - z) ** 2;
      if (inFootprint && d2 < bestD2) {
        best = entity;
        bestD2 = d2;
      }
    }
    return best;
  }

  private updateGhost(placement?: PlacementState): void {
    if (!placement) {
      this.ghost.visible = false;
      return;
    }
    const def = STRUCTURES[placement.kind as StructureKind];
    this.ghost.visible = true;
    this.ghost.scale.set(def.footprint.w * this.hf.cellSize * 2, 1.2, def.footprint.h * this.hf.cellSize * 2);
    this.ghost.position.set(placement.x, sampleHeight(this.hf, placement.x, placement.z) + 0.65, placement.z);
    const material = this.ghost.material as MeshBasicMaterial;
    material.color.setHex(placement.valid ? 0x7df27d : 0xff4040);
  }

  private updateHealthBar(entity: Entity, groundY: number, camera: Camera): void {
    const healthBar = this.healthBars.get(entity);
    if (!healthBar || !entity.health || !entity.building) return;
    const pct = Math.max(0, Math.min(1, entity.health.current / entity.health.max));
    const selected = entity.selectable?.selected ?? false;
    healthBar.root.visible = !entity.destroyed && (selected || pct < 0.995);
    if (!healthBar.root.visible) return;
    const height = 4.5 + Math.max(entity.building.footprint.w, entity.building.footprint.h) * 0.42;
    healthBar.root.position.set(entity.transform.x, groundY + height, entity.transform.z);
    healthBar.root.lookAt(camera.position);
    healthBar.fill.scale.x = Math.max(0.02, pct);
    healthBar.fill.position.x = -2.2 * (1 - pct);
    healthBar.fillMaterial.color.setHex(pct < 0.3 ? 0xff5142 : pct < 0.62 ? 0xffc04a : 0x79f06f);
  }

  private updateSelectionGlow(entity: Entity, groundY: number): void {
    const glow = this.selectedGlows.get(entity);
    if (!glow) return;
    const selected = (entity.selectable?.selected ?? false) && !entity.destroyed;
    glow.root.visible = selected;
    if (!selected) return;
    const pulse = 0.5 + 0.5 * Math.sin(this.sim.tick * 0.16 + entity.id * 0.7);
    const lift = 0.08;
    glow.root.position.set(entity.transform.x, groundY + lift, entity.transform.z);
    glow.fillMaterial.opacity = 0.18 + pulse * 0.12;
    glow.ringMaterial.opacity = 0.48 + pulse * 0.22;
    const scale = 1 + pulse * 0.035;
    glow.fill.scale.set(scale, scale, 1);
    glow.ring.scale.set(1 + pulse * 0.025, 1 + pulse * 0.025, 1);
  }
}

interface SelectionGlow {
  root: Group;
  fill: Mesh;
  ring: Mesh;
  fillMaterial: MeshBasicMaterial;
  ringMaterial: MeshBasicMaterial;
}

function createSelectionGlow(entity: Entity, cellSize: number): SelectionGlow {
  const root = new Group();
  root.visible = false;
  root.rotation.x = -Math.PI / 2;
  root.renderOrder = 34;
  const accent = entity.team?.id === 2 ? 0xff6048 : 0xf0d56a;
  const radius = Math.hypot(entity.building!.footprint.w * cellSize, entity.building!.footprint.h * cellSize);
  const fillMaterial = new MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  });
  const ringMaterial = new MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  });
  const fill = new Mesh(new CircleGeometry(radius * 0.92, 64), fillMaterial);
  const ring = new Mesh(new RingGeometry(radius * 0.94, radius + 0.7, 72), ringMaterial);
  fill.renderOrder = 34;
  ring.renderOrder = 35;
  root.add(fill, ring);
  return { root, fill, ring, fillMaterial, ringMaterial };
}

function createBuildingHealthBar(backMaterial: Material): { root: Group; fill: Mesh; fillMaterial: MeshBasicMaterial } {
  const root = new Group();
  root.visible = false;
  const back = new Mesh(new PlaneGeometry(5.0, 0.56), backMaterial);
  back.renderOrder = 42;
  root.add(back);
  const fillMaterial = new MeshBasicMaterial({ color: 0x79f06f, transparent: true, opacity: 0.92, depthWrite: false, side: DoubleSide });
  const fill = new Mesh(new PlaneGeometry(4.4, 0.25), fillMaterial);
  fill.position.z = 0.02;
  fill.renderOrder = 43;
  root.add(fill);
  return { root, fill, fillMaterial };
}
