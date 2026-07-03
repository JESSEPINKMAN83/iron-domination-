import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Material } from 'three';
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
  private readonly ghost: Mesh;
  private readonly materials: Record<string, Material>;

  constructor(private readonly sim: GameSim, private readonly hf: Heightfield, ctx: RenderContext) {
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
    for (const entity of buildings(this.sim)) {
      let mesh = this.objects.get(entity);
      if (!mesh && entity.building) {
        const geometry = new BoxGeometry(entity.building.footprint.w * this.hf.cellSize * 2, 3.2, entity.building.footprint.h * this.hf.cellSize * 2);
        mesh = new Mesh(geometry, this.materials[entity.building.kind] ?? this.materials['command-yard']);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.objects.set(entity, mesh);
        this.group.add(mesh);
      }
      if (!mesh || !entity.building) continue;
      const y = sampleHeight(this.hf, entity.transform.x, entity.transform.z);
      const progress = entity.building.complete ? 1 : Math.max(0.08, entity.building.buildProgress);
      mesh.position.set(entity.transform.x, y + 1.6 * progress, entity.transform.z);
      mesh.scale.y = progress;
    }
    this.updateGhost(economy.placement);
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
