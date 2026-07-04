import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
  type Camera,
  type Material,
} from 'three';
import { STRUCTURES, type StructureKind } from '../content/phase3';
import type { Entity, StructureDamage } from '../sim/components';
import type { EconomyState } from '../sim/economy';
import { buildings, type PlacementState } from '../sim/economy';
import { sampleHeight, type Heightfield } from '../sim/heightfield';
import { hash2i } from '../sim/noise';
import type { GameSim } from '../sim/world';
import type { RenderContext } from './renderer';

const DEFAULT_BUILDING_HEIGHT = 5.4;
const DESTROYED_TOTAL = 20;
const COLLAPSE_SECONDS = 1.2;
const BLOCK_GAP = 0.02;

const sharedBlockGeometry = new BoxGeometry(1, 1, 1);
const sharedPlaneGeometry = new PlaneGeometry(1, 1);

export class BuildingView {
  readonly group = new Group();
  private readonly objects = new Map<Entity, BuildingObject>();
  private readonly selectedGlows = new Map<Entity, SelectionGlow>();
  private readonly producerGlows = new Map<Entity, SelectionGlow>();
  private readonly producerHighlightIds = new Set<number>();
  private readonly healthBars = new Map<Entity, { root: Group; fill: Mesh; fillMaterial: MeshBasicMaterial }>();
  private readonly ghosts: Mesh[] = [];
  private readonly ghostMaterial = new MeshBasicMaterial({ color: 0x7df27d, transparent: true, opacity: 0.35, depthWrite: false });
  private readonly materials: Record<string, Material>;
  private readonly scorchMaterial: Material;
  private readonly crackMaterial: Material;
  private readonly rubbleMaterial: Material;
  private readonly interiorMaterial: Material;
  private readonly emberMaterial: Material;
  private readonly smokeMaterial: MeshBasicMaterial;
  private readonly fireMaterial: MeshBasicMaterial;
  private readonly healthBackMaterial = new MeshBasicMaterial({ color: 0x050806, transparent: true, opacity: 0.84, depthWrite: false, side: DoubleSide });

  private readonly playerAccent: Material;
  private readonly enemyAccent: Material;

  constructor(
    private readonly sim: GameSim,
    private readonly hf: Heightfield,
    ctx: RenderContext,
    private readonly isVisible: (x: number, z: number) => boolean = () => true,
  ) {
    this.playerAccent = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0xf0c85a, emissive: 0x2b1d00, roughness: 0.7 }));
    this.enemyAccent = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0xd65b46, emissive: 0x2a0600, roughness: 0.72 }));
    this.scorchMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x313638, roughness: 0.96, metalness: 0.04 }));
    this.crackMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x24282a, roughness: 1, metalness: 0.02 }));
    this.rubbleMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x1c1a17, roughness: 1, metalness: 0.04 }));
    this.interiorMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x050403, roughness: 1, metalness: 0 }));
    this.emberMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x22100a, emissive: 0xff5a1f, emissiveIntensity: 0.75, roughness: 0.9 }));
    this.smokeMaterial = new MeshBasicMaterial({ color: 0x282827, transparent: true, opacity: 0.28, depthWrite: false, side: DoubleSide });
    this.fireMaterial = new MeshBasicMaterial({
      color: 0xff7b24,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    });
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
    this.ensureGhostCount(1);
  }

  update(economy: EconomyState, camera: Camera): void {
    for (const [entity, object] of this.objects) {
      if (this.sim.world.has(entity)) continue;
      this.group.remove(object.root);
      const glow = this.selectedGlows.get(entity);
      if (glow) this.group.remove(glow.root);
      const producerGlow = this.producerGlows.get(entity);
      if (producerGlow) this.group.remove(producerGlow.root);
      const healthBar = this.healthBars.get(entity);
      if (healthBar) this.group.remove(healthBar.root);
      this.objects.delete(entity);
      this.selectedGlows.delete(entity);
      this.producerGlows.delete(entity);
      this.healthBars.delete(entity);
    }

    for (const entity of buildings(this.sim)) {
      let object = this.objects.get(entity);
      if (!object && entity.building) {
        object = this.createBuildingObject(entity);
        this.objects.set(entity, object);
        this.group.add(object.root);

        const glow = createSelectionGlow(entity, this.hf.cellSize);
        this.selectedGlows.set(entity, glow);
        this.group.add(glow.root);

        const producerGlow = createSelectionGlow(entity, this.hf.cellSize, {
          color: 0x64f0c8,
          radiusScale: 1.12,
          outerAdd: 1.1,
          renderOrder: 32,
        });
        this.producerGlows.set(entity, producerGlow);
        this.group.add(producerGlow.root);

        if (entity.health) {
          const healthBar = createBuildingHealthBar(this.healthBackMaterial);
          this.healthBars.set(entity, healthBar);
          this.group.add(healthBar.root);
        }
      }
      if (!object || !entity.building) continue;
      const groundY = sampleHeight(this.hf, entity.transform.x, entity.transform.z);
      const progress = Math.max(0.08, entity.building.buildProgress);
      object.root.position.set(entity.transform.x, groundY, entity.transform.z);
      object.root.scale.y = entity.destroyed ? 1 : progress;

      const currentlyVisible = entity.team?.id === 1 || this.isVisible(entity.transform.x, entity.transform.z);
      if (currentlyVisible) object.everSeen = true;
      const fogged = !currentlyVisible;
      // enemy buildings never scouted stay hidden; once seen they persist as a frozen ghost
      object.root.visible = object.everSeen;
      if (!object.root.visible) continue;

      if (!fogged) this.applyDamageDressing(entity, object);
      object.root.rotation.x = entity.destroyed ? 0 : object.leanX;
      object.root.rotation.z = entity.destroyed ? object.leanZ * 0.35 : object.leanZ;
      this.updateDamageEffects(entity, object, camera);
      // fogged enemy buildings freeze — no live health/dock intel through the shroud
      this.updateRefineryDock(entity, object, fogged);
      this.updateSelectionGlow(entity, groundY);
      this.updateProducerGlow(entity, groundY);
      this.updateHealthBar(entity, groundY, camera, fogged);
    }
    this.updateGhost(economy.placement);
  }

  setProducerHighlights(ids: Iterable<number>): void {
    this.producerHighlightIds.clear();
    for (const id of ids) this.producerHighlightIds.add(id);
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

  private createBuildingObject(entity: Entity): BuildingObject {
    const root = new Group();
    const damage = structureDamageFor(entity);
    const baseMaterial = this.materials[entity.building?.kind ?? 'command-yard'] ?? this.materials['command-yard'];
    const buildingHeight = heightForStructure(entity.building?.kind);
    const fullW = (entity.building?.footprint.w ?? 4) * this.hf.cellSize * 2;
    const fullD = (entity.building?.footprint.h ?? 4) * this.hf.cellSize * 2;
    const blockW = fullW / damage.cols - BLOCK_GAP;
    const blockD = fullD / damage.rows - BLOCK_GAP;
    const blockH = buildingHeight / damage.tiers - BLOCK_GAP;
    const blocks: DamageBlock[] = [];

    for (let tier = 0; tier < damage.tiers; tier++) {
      for (let row = 0; row < damage.rows; row++) {
        for (let col = 0; col < damage.cols; col++) {
          const index = tier * damage.cols * damage.rows + row * damage.cols + col;
          const mesh = new Mesh(sharedBlockGeometry, baseMaterial);
          const position = new Vector3(-fullW / 2 + (col + 0.5) * (fullW / damage.cols), (tier + 0.5) * (buildingHeight / damage.tiers), -fullD / 2 + (row + 0.5) * (fullD / damage.rows));
          const scale = new Vector3(blockW, blockH, blockD);
          mesh.position.copy(position);
          mesh.scale.copy(scale);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          root.add(mesh);
          blocks.push({ mesh, index, col, row, tier, basePosition: position, baseScale: scale, baseMaterial });
        }
      }
    }

    const accent = new Mesh(
      new BoxGeometry(fullW * 0.5, 0.22, Math.max(0.5, fullD * 0.12)),
      entity.team?.id === 2 ? this.enemyAccent : this.playerAccent,
    );
    accent.position.set(0, buildingHeight + 0.16, fullD * 0.18);
    accent.castShadow = true;
    const label = createBuildingLabel(entity.building?.label ?? entity.name ?? 'Building', fullW * 0.5, Math.max(0.5, fullD * 0.12), buildingHeight);
    label.position.copy(accent.position);
    label.position.y += 0.13;
    label.position.z += 0.01;
    root.add(accent, label);
    const refineryDock = entity.building?.kind === 'refinery' ? createRefineryDock(fullW, fullD, buildingHeight) : undefined;
    if (refineryDock) root.add(refineryDock.root);

    return {
      root,
      blocks,
      accents: [accent, label],
      refineryDock,
      effects: [],
      appliedVersion: -1,
      appliedLevel: -1,
      leanX: 0,
      leanZ: 0,
      collapsed: false,
      everSeen: false,
    };
  }

  private applyDamageDressing(entity: Entity, object: BuildingObject): void {
    const damage = structureDamageFor(entity);
    const level = damageLevel(entity);
    const destroyedRemaining = entity.destroyed?.remaining;
    const needsCollapseFrame = destroyedRemaining !== undefined && destroyedRemaining > DESTROYED_TOTAL - COLLAPSE_SECONDS - 0.1;
    if (object.appliedVersion === damage.version && object.appliedLevel === level && !needsCollapseFrame) return;

    object.appliedVersion = damage.version;
    object.appliedLevel = level;
    object.leanX = 0;
    object.leanZ = 0;
    object.collapsed = Boolean(entity.destroyed);
    this.clearEffects(object);

    const worst = worstCells(damage, 4);
    const lean = damageVector(damage);
    if (level >= 8) {
      object.leanX = lean.z * 0.035;
      object.leanZ = -lean.x * 0.035;
    }

    for (const block of object.blocks) {
      const value = damage.cells[block.index] ?? 0;
      resetBlock(block);
      if (entity.destroyed) {
        dressCollapsedBlock(entity, block, this.rubbleMaterial, destroyedRemaining ?? 0);
        continue;
      }
      if (level >= 9 && block.tier === damage.tiers - 1 && value > 70) dressRemovedBlock(block, this.interiorMaterial);
      else if (value >= 190) dressRemovedBlock(block, this.interiorMaterial);
      else if (value >= 155 || (level >= 8 && isCornerCell(damage, block) && value >= 105)) dressRubbleBlock(entity, block, this.rubbleMaterial);
      else if (value >= 85) dressShrunkBlock(entity, block, this.crackMaterial);
      else if (value >= 24 || (level >= 2 && value > 0)) dressCrackedBlock(entity, block, this.crackMaterial);
      else if (value > 0) dressScorchedBlock(entity, block, this.scorchMaterial);
      else if (level >= 1) block.mesh.material = block.baseMaterial;
      if (level >= 7 && block.tier > 0 && supportCellBroken(damage, block)) {
        block.mesh.position.y -= block.baseScale.y * 0.15;
        block.mesh.rotation.x += deterministicSigned(block.index, entity.id, 0x57) * 0.08;
        block.mesh.rotation.z += deterministicSigned(block.index, entity.id, 0x58) * 0.08;
      }
    }

    for (const accent of object.accents) accent.visible = level < 4 && !entity.destroyed;

    const hasLocalizedDamage = worst.some((cell) => cell.value > 0);
    const smokeCount = !hasLocalizedDamage ? 0 : level >= 9 ? 4 : level >= 7 ? 3 : level >= 5 ? 2 : 1;
    const fireCount = level >= 9 ? 3 : level >= 7 ? 2 : 0;
    for (let i = 0; i < Math.min(smokeCount, worst.length); i++) this.addEffect(entity, object, worst[i], 'smoke', level);
    for (let i = 0; i < Math.min(fireCount, worst.length); i++) this.addEffect(entity, object, worst[i], 'fire', level);
  }

  private addEffect(entity: Entity, object: BuildingObject, cell: DamageCell, kind: 'smoke' | 'fire', level: number): void {
    const mesh = new Mesh(sharedPlaneGeometry, kind === 'smoke' ? this.smokeMaterial.clone() : this.fireMaterial.clone());
    const size = kind === 'smoke' ? 1.55 + level * 0.18 : 1.35 + level * 0.08;
    mesh.scale.set(size, size, size);
    mesh.position.set(cell.position.x, cell.position.y + (kind === 'smoke' ? 1.4 : 0.75), cell.position.z);
    mesh.renderOrder = kind === 'smoke' ? 26 : 27;
    object.root.add(mesh);
    object.effects.push({ mesh, kind, basePosition: mesh.position.clone(), phase: hash2i(cell.index, entity.id, kind === 'smoke' ? 0x5a10 : 0xf117) * Math.PI * 2 });
  }

  private clearEffects(object: BuildingObject): void {
    for (const effect of object.effects) {
      object.root.remove(effect.mesh);
      if (Array.isArray(effect.mesh.material)) effect.mesh.material.forEach((material) => material.dispose());
      else effect.mesh.material.dispose();
    }
    object.effects.length = 0;
  }

  private updateDamageEffects(entity: Entity, object: BuildingObject, camera: Camera): void {
    for (const effect of object.effects) {
      const wave = Math.sin(this.sim.tick * 0.12 + effect.phase);
      effect.mesh.position.copy(effect.basePosition);
      if (effect.kind === 'smoke') {
        effect.mesh.position.y += 0.45 + wave * 0.16;
        const material = effect.mesh.material as MeshBasicMaterial;
        material.opacity = entity.destroyed ? 0.38 : 0.18 + 0.08 * (wave + 1);
        effect.mesh.scale.x = Math.max(effect.mesh.scale.x, 1) * (1 + wave * 0.01);
      } else {
        effect.mesh.position.y += wave * 0.08;
        const material = effect.mesh.material as MeshBasicMaterial;
        material.opacity = 0.48 + 0.2 * (wave + 1);
      }
      effect.mesh.lookAt(camera.position);
    }
  }

  private updateRefineryDock(entity: Entity, object: BuildingObject, fogged: boolean): void {
    const dock = object.refineryDock;
    if (!dock) return;
    // freeze dock activity while fogged so enemy harvest state doesn't leak through fog
    dock.root.visible = !entity.destroyed && !fogged;
    if (!dock.root.visible) return;
    let returning = false;
    let depositing = false;
    for (const unit of this.sim.world.entities) {
      if (unit.team?.id !== entity.team?.id || unit.destroyed || !unit.harvester) continue;
      if (unit.harvester.refineryId !== entity.id) continue;
      returning ||= unit.harvester.state === 'to-refinery';
      depositing ||= unit.harvester.state === 'depositing';
    }
    const active = returning || depositing;
    const pulse = 0.5 + 0.5 * Math.sin(this.sim.tick * (depositing ? 0.45 : 0.22) + entity.id);
    dock.statusMaterial.opacity = active ? 0.34 + pulse * 0.38 : 0.12;
    dock.statusMaterial.color.setHex(depositing ? 0x7df27d : returning ? 0xffc25a : 0x46534d);
    dock.hose.visible = active;
    dock.hose.scale.y = active ? 0.55 + pulse * 0.25 : 0.2;
    dock.pump.rotation.z = active ? Math.sin(this.sim.tick * 0.22 + entity.id) * 0.22 : 0;
  }

  private updateGhost(placement?: PlacementState): void {
    if (!placement) {
      for (const ghost of this.ghosts) ghost.visible = false;
      return;
    }
    const def = STRUCTURES[placement.kind as StructureKind];
    const points = placement.wallLine?.length ? placement.wallLine : [{ x: placement.x, z: placement.z }];
    this.ensureGhostCount(points.length);
    this.ghostMaterial.color.setHex(placement.valid ? 0x7df27d : 0xff4040);
    for (let i = 0; i < this.ghosts.length; i++) {
      const ghost = this.ghosts[i];
      const point = points[i];
      ghost.visible = !!point;
      if (!point) continue;
      ghost.scale.set(def.footprint.w * this.hf.cellSize * 2, 1.2, def.footprint.h * this.hf.cellSize * 2);
      ghost.position.set(point.x, sampleHeight(this.hf, point.x, point.z) + 0.65, point.z);
    }
  }

  private ensureGhostCount(count: number): void {
    while (this.ghosts.length < count) {
      const ghost = new Mesh(new BoxGeometry(1, 1, 1), this.ghostMaterial);
      ghost.visible = false;
      ghost.renderOrder = 40;
      this.ghosts.push(ghost);
      this.group.add(ghost);
    }
  }

  private updateHealthBar(entity: Entity, groundY: number, camera: Camera, fogged: boolean): void {
    const healthBar = this.healthBars.get(entity);
    if (!healthBar || !entity.health || !entity.building) return;
    // a fogged enemy building must not reveal that it's taking damage
    if (fogged) {
      healthBar.root.visible = false;
      return;
    }
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

  private updateProducerGlow(entity: Entity, groundY: number): void {
    const glow = this.producerGlows.get(entity);
    if (!glow) return;
    const highlighted = this.producerHighlightIds.has(entity.id) && !entity.destroyed && entity.building?.complete;
    glow.root.visible = !!highlighted;
    if (!highlighted) return;
    const pulse = 0.5 + 0.5 * Math.sin(this.sim.tick * 0.22 + entity.id * 0.41);
    glow.root.position.set(entity.transform.x, groundY + 0.13, entity.transform.z);
    glow.fillMaterial.opacity = 0.14 + pulse * 0.1;
    glow.ringMaterial.opacity = 0.58 + pulse * 0.28;
    const scale = 1.02 + pulse * 0.055;
    glow.fill.scale.set(scale, scale, 1);
    glow.ring.scale.set(1.02 + pulse * 0.035, 1.02 + pulse * 0.035, 1);
  }
}

interface DamageBlock {
  mesh: Mesh;
  index: number;
  col: number;
  row: number;
  tier: number;
  basePosition: Vector3;
  baseScale: Vector3;
  baseMaterial: Material;
}

interface BuildingObject {
  root: Group;
  blocks: DamageBlock[];
  accents: Mesh[];
  refineryDock?: RefineryDock;
  effects: DamageEffect[];
  appliedVersion: number;
  appliedLevel: number;
  leanX: number;
  leanZ: number;
  collapsed: boolean;
  /** enemy buildings render only after being scouted once, then stay as a frozen ghost */
  everSeen: boolean;
}

interface RefineryDock {
  root: Group;
  pump: Group;
  hose: Mesh;
  statusMaterial: MeshBasicMaterial;
}

interface DamageEffect {
  mesh: Mesh;
  kind: 'smoke' | 'fire';
  basePosition: Vector3;
  phase: number;
}

interface DamageCell {
  index: number;
  value: number;
  position: Vector3;
}

interface SelectionGlow {
  root: Group;
  fill: Mesh;
  ring: Mesh;
  fillMaterial: MeshBasicMaterial;
  ringMaterial: MeshBasicMaterial;
}

function structureDamageFor(entity: Entity): StructureDamage {
  if (!entity.structureDamage) {
    return { cols: 3, rows: 3, tiers: 2, cells: new Uint8Array(18), version: 0 };
  }
  return entity.structureDamage;
}

function damageLevel(entity: Entity): number {
  if (entity.destroyed) return 10;
  if (!entity.health) return 0;
  return Math.max(0, Math.min(10, Math.ceil(10 * (1 - entity.health.current / entity.health.max))));
}

function resetBlock(block: DamageBlock): void {
  block.mesh.visible = true;
  block.mesh.material = block.baseMaterial;
  block.mesh.position.copy(block.basePosition);
  block.mesh.scale.copy(block.baseScale);
  block.mesh.rotation.set(0, 0, 0);
}

function dressScorchedBlock(entity: Entity, block: DamageBlock, material: Material): void {
  block.mesh.material = material;
  block.mesh.scale.set(block.baseScale.x * 0.97, block.baseScale.y * 0.99, block.baseScale.z * 0.97);
  block.mesh.position.y -= block.baseScale.y * 0.015;
  block.mesh.rotation.x = deterministicSigned(block.index, entity.id, 0xb1) * 0.018;
  block.mesh.rotation.z = deterministicSigned(block.index, entity.id, 0xb2) * 0.018;
}

function dressCrackedBlock(entity: Entity, block: DamageBlock, material: Material): void {
  block.mesh.material = material;
  block.mesh.scale.set(block.baseScale.x * 0.96, block.baseScale.y * 0.98, block.baseScale.z * 0.96);
  block.mesh.rotation.x = deterministicSigned(block.index, entity.id, 0xc1) * 0.025;
  block.mesh.rotation.z = deterministicSigned(block.index, entity.id, 0xc2) * 0.025;
}

function dressShrunkBlock(entity: Entity, block: DamageBlock, material: Material): void {
  block.mesh.material = material;
  const shrink = 0.92 + hash2i(block.index, entity.id, 0x120) * 0.03;
  block.mesh.scale.set(block.baseScale.x * shrink, block.baseScale.y * 0.94, block.baseScale.z * shrink);
  block.mesh.rotation.x = deterministicSigned(block.index, entity.id, 0x121) * 0.06;
  block.mesh.rotation.z = deterministicSigned(block.index, entity.id, 0x122) * 0.06;
}

function dressRubbleBlock(entity: Entity, block: DamageBlock, material: Material): void {
  block.mesh.material = material;
  block.mesh.scale.set(block.baseScale.x * 0.92, block.baseScale.y * 0.34, block.baseScale.z * 0.88);
  block.mesh.position.y = Math.max(block.baseScale.y * 0.18, block.basePosition.y - block.baseScale.y * 0.36);
  block.mesh.rotation.x = deterministicSigned(block.index, entity.id, 0x211) * 0.28;
  block.mesh.rotation.y = hash2i(block.index, entity.id, 0x212) * Math.PI;
  block.mesh.rotation.z = deterministicSigned(block.index, entity.id, 0x213) * 0.28;
}

function dressRemovedBlock(block: DamageBlock, interior: Material): void {
  block.mesh.material = interior;
  block.mesh.visible = true;
  block.mesh.scale.set(block.baseScale.x * 0.58, block.baseScale.y * 0.52, block.baseScale.z * 0.58);
  block.mesh.position.y = block.basePosition.y - block.baseScale.y * 0.12;
}

function dressCollapsedBlock(entity: Entity, block: DamageBlock, material: Material, remaining: number): void {
  block.mesh.material = material;
  const since = Math.max(0, DESTROYED_TOTAL - remaining);
  const delay = block.tier === 0 ? 0.18 : 0;
  const t = Math.max(0, Math.min(1, (since - delay - hash2i(block.index, entity.id, 0xdead) * 0.18) / COLLAPSE_SECONDS));
  const fall = t * t;
  const driftX = deterministicSigned(block.index, entity.id, 0xd1) * block.baseScale.x * 0.52 * fall;
  const driftZ = deterministicSigned(block.index, entity.id, 0xd2) * block.baseScale.z * 0.52 * fall;
  block.mesh.position.set(block.basePosition.x + driftX, Math.max(0.18, block.basePosition.y - fall * (block.basePosition.y + 0.35)), block.basePosition.z + driftZ);
  block.mesh.scale.set(block.baseScale.x * (1 - fall * 0.42), block.baseScale.y * (1 - fall * 0.65), block.baseScale.z * (1 - fall * 0.42));
  block.mesh.rotation.x = deterministicSigned(block.index, entity.id, 0xd3) * fall * 1.2;
  block.mesh.rotation.y = deterministicSigned(block.index, entity.id, 0xd4) * fall * 1.5;
  block.mesh.rotation.z = deterministicSigned(block.index, entity.id, 0xd5) * fall * 1.2;
}

function supportCellBroken(damage: StructureDamage, block: DamageBlock): boolean {
  if (block.tier === 0) return false;
  return damage.cells[(block.tier - 1) * damage.cols * damage.rows + block.row * damage.cols + block.col] >= 200;
}

function isCornerCell(damage: StructureDamage, block: DamageBlock): boolean {
  return (block.col === 0 || block.col === damage.cols - 1) && (block.row === 0 || block.row === damage.rows - 1);
}

function worstCells(damage: StructureDamage, count: number): DamageCell[] {
  const fullW = damage.cols;
  const fullD = damage.rows;
  return Array.from(damage.cells)
    .map((value, index) => {
      const plane = damage.cols * damage.rows;
      const tier = Math.floor(index / plane);
      const rem = index - tier * plane;
      const row = Math.floor(rem / damage.cols);
      const col = rem % damage.cols;
      return {
        index,
        value,
        position: new Vector3((col + 0.5 - fullW / 2) * 2.2, 1 + tier * 1.6, (row + 0.5 - fullD / 2) * 2.2),
      };
    })
    .filter((cell) => cell.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, count);
}

function damageVector(damage: StructureDamage): { x: number; z: number } {
  let sx = 0;
  let sz = 0;
  let total = 0;
  for (let tier = 0; tier < damage.tiers; tier++) {
    for (let row = 0; row < damage.rows; row++) {
      for (let col = 0; col < damage.cols; col++) {
        const value = damage.cells[tier * damage.cols * damage.rows + row * damage.cols + col];
        sx += (col / Math.max(1, damage.cols - 1) - 0.5) * value;
        sz += (row / Math.max(1, damage.rows - 1) - 0.5) * value;
        total += value;
      }
    }
  }
  if (total <= 0) return { x: 0, z: 0 };
  return { x: sx / total, z: sz / total };
}

function deterministicSigned(index: number, id: number, seed: number): number {
  return hash2i(index, id, seed) * 2 - 1;
}

function heightForStructure(kind?: string): number {
  if (kind === 'wall') return 2.2;
  if (kind === 'guard-tower' || kind === 'aa-tower') return 7.2;
  if (kind === 'helipad') return 4.4;
  if (kind === 'refinery' || kind === 'factory') return 6.2;
  if (kind === 'command-yard') return 6.6;
  return DEFAULT_BUILDING_HEIGHT;
}

function createBuildingLabel(text: string, width: number, depth: number, buildingHeight: number): Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('building label canvas unavailable');
  const label = text.toUpperCase();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(240,200,90,0.12)';
  ctx.fillRect(10, 12, canvas.width - 20, canvas.height - 24);
  ctx.strokeStyle = 'rgba(24,20,12,0.35)';
  ctx.lineWidth = 5;
  ctx.strokeRect(12, 14, canvas.width - 24, canvas.height - 28);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#171309';
  let fontSize = 50;
  do {
    ctx.font = `900 ${fontSize}px ui-monospace, Menlo, monospace`;
    if (ctx.measureText(label).width <= canvas.width - 72) break;
    fontSize -= 3;
  } while (fontSize > 22);
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 2);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new Mesh(new PlaneGeometry(width * 0.92, depth * 0.86), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 38;
  mesh.userData.buildingHeight = buildingHeight;
  return mesh;
}

function createRefineryDock(width: number, depth: number, buildingHeight: number): RefineryDock {
  const root = new Group();
  root.position.set(width * 0.28, 0.25, depth * 0.54);

  const dockMaterial = new MeshStandardMaterial({ color: 0x2c3434, roughness: 0.86, metalness: 0.18 });
  const pipeMaterial = new MeshStandardMaterial({ color: 0x4a514c, roughness: 0.72, metalness: 0.22 });
  const platform = new Mesh(new BoxGeometry(Math.max(2.2, width * 0.22), 0.26, 1.15), dockMaterial);
  platform.castShadow = true;
  platform.receiveShadow = true;
  root.add(platform);

  const pump = new Group();
  pump.position.set(0, 0.75, -0.12);
  const mast = new Mesh(new CylinderGeometry(0.13, 0.15, 1.2, 10), pipeMaterial);
  mast.position.y = 0.45;
  pump.add(mast);
  const arm = new Mesh(new BoxGeometry(1.65, 0.16, 0.16), pipeMaterial);
  arm.position.set(0.55, 1.08, 0);
  pump.add(arm);
  const nozzle = new Mesh(new CylinderGeometry(0.16, 0.2, 0.46, 10), pipeMaterial);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(1.34, 0.92, 0.2);
  pump.add(nozzle);
  root.add(pump);

  const hose = new Mesh(new CylinderGeometry(0.08, 0.1, 2.2, 10), pipeMaterial);
  hose.position.set(1.36, 0.46, 1.0);
  hose.rotation.x = Math.PI * 0.5;
  hose.visible = false;
  root.add(hose);

  const statusMaterial = new MeshBasicMaterial({
    color: 0x46534d,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    toneMapped: false,
  });
  const status = new Mesh(new RingGeometry(1.0, 1.32, 32), statusMaterial);
  status.rotation.x = -Math.PI / 2;
  status.position.set(0, 0.04, 0.18);
  status.renderOrder = 35;
  root.add(status);

  const roofPipe = new Mesh(new CylinderGeometry(0.12, 0.12, Math.max(1.8, buildingHeight * 0.42), 10), pipeMaterial);
  roofPipe.position.set(-1.25, buildingHeight * 0.22, -0.52);
  roofPipe.castShadow = true;
  root.add(roofPipe);

  return { root, pump, hose, statusMaterial };
}

function createSelectionGlow(
  entity: Entity,
  cellSize: number,
  options: { color?: number; radiusScale?: number; outerAdd?: number; renderOrder?: number } = {},
): SelectionGlow {
  const root = new Group();
  root.visible = false;
  root.rotation.x = -Math.PI / 2;
  root.renderOrder = options.renderOrder ?? 34;
  const accent = options.color ?? (entity.team?.id === 2 ? 0xff6048 : 0xf0d56a);
  const radius = Math.hypot(entity.building!.footprint.w * cellSize, entity.building!.footprint.h * cellSize) * (options.radiusScale ?? 1);
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
  const ring = new Mesh(new RingGeometry(radius * 0.94, radius + (options.outerAdd ?? 0.7), 72), ringMaterial);
  fill.renderOrder = options.renderOrder ?? 34;
  ring.renderOrder = (options.renderOrder ?? 34) + 1;
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
