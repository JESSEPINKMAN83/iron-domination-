import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, RingGeometry, type Material } from 'three';
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
  private readonly selectedRings = new Map<Entity, Mesh>();
  private readonly ghost: Mesh;
  private readonly materials: Record<string, Material>;
  private readonly ringMaterial = new MeshBasicMaterial({ color: 0xd2b15f, transparent: true, opacity: 0.78, depthWrite: false });

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
    };
    this.ghost = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0x7df27d, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ghost.visible = false;
    this.ghost.renderOrder = 40;
    this.group.add(this.ghost);
  }

  update(economy: EconomyState): void {
    // sweep meshes whose entities were removed from the world (destroyed timers expired)
    for (const [entity, mesh] of this.objects) {
      if (this.sim.world.has(entity)) continue;
      this.group.remove(mesh);
      const ring = this.selectedRings.get(entity);
      if (ring) this.group.remove(ring);
      this.objects.delete(entity);
      this.selectedRings.delete(entity);
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

        const radius = Math.hypot(entity.building.footprint.w * this.hf.cellSize, entity.building.footprint.h * this.hf.cellSize);
        const ring = new Mesh(new RingGeometry(radius, radius + 0.65, 48), this.ringMaterial);
        ring.rotation.x = -Math.PI / 2;
        ring.visible = false;
        ring.renderOrder = 32;
        this.selectedRings.set(entity, ring);
        this.group.add(ring);
      }
      if (!mesh || !entity.building) continue;
      const y = sampleHeight(this.hf, entity.transform.x, entity.transform.z);
      const progress = entity.building.complete ? 1 : Math.max(0.08, entity.building.buildProgress);
      mesh.position.set(entity.transform.x, y + 1.6 * progress, entity.transform.z);
      mesh.scale.y = entity.destroyed ? 0.45 : progress;
      if (entity.destroyed && mesh.material !== this.wreckMaterial) mesh.material = this.wreckMaterial;

      const ring = this.selectedRings.get(entity);
      if (ring) {
        ring.position.set(entity.transform.x, y + 0.1, entity.transform.z);
        ring.visible = entity.selectable?.selected ?? false;
      }
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
}
