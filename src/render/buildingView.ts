import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
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
import { factionId, FACTION, type FactionId } from './palette';
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
  private readonly scarMaterial: MeshBasicMaterial;
  private readonly emberSpotMaterial: MeshBasicMaterial;
  private readonly smokeMaterial: MeshBasicMaterial;
  private readonly fireMaterial: MeshBasicMaterial;
  private readonly healthBackMaterial = new MeshBasicMaterial({ color: 0x050806, transparent: true, opacity: 0.84, depthWrite: false, side: DoubleSide });

  private readonly accentMaterials: Record<FactionId, Material>;

  constructor(
    private readonly sim: GameSim,
    private readonly hf: Heightfield,
    ctx: RenderContext,
    private readonly isVisible: (x: number, z: number) => boolean = () => true,
  ) {
    this.accentMaterials = {
      1: this.createAccentMaterial(ctx, 1),
      2: this.createAccentMaterial(ctx, 2),
      3: this.createAccentMaterial(ctx, 3),
      4: this.createAccentMaterial(ctx, 4),
    };
    this.scorchMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x313638, roughness: 0.96, metalness: 0.04 }));
    this.crackMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x24282a, roughness: 1, metalness: 0.02 }));
    this.rubbleMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x1c1a17, roughness: 1, metalness: 0.04 }));
    this.interiorMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x050403, roughness: 1, metalness: 0 }));
    this.emberMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x22100a, emissive: 0xff5a1f, emissiveIntensity: 0.75, roughness: 0.9 }));
    this.scarMaterial = new MeshBasicMaterial({ color: 0x070605, transparent: true, opacity: 0.5, depthWrite: false, side: DoubleSide });
    this.emberSpotMaterial = new MeshBasicMaterial({
      color: 0xff5a1f,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    });
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

  private createAccentMaterial(ctx: RenderContext, id: FactionId): Material {
    const team = FACTION[id];
    return ctx.setupLitMaterial(new MeshStandardMaterial({ color: team.accent, emissive: team.accentEmissive, roughness: 0.7 }));
  }

  update(economy: EconomyState, camera: Camera): void {
    for (const [entity, object] of this.objects) {
      if (this.sim.world.has(entity)) continue;
      this.clearEffects(object);
      this.group.remove(object.root);
      this.disposeTree(object.root);
      const glow = this.selectedGlows.get(entity);
      if (glow) {
        this.group.remove(glow.root);
        this.disposeTree(glow.root);
      }
      const producerGlow = this.producerGlows.get(entity);
      if (producerGlow) {
        this.group.remove(producerGlow.root);
        this.disposeTree(producerGlow.root);
      }
      const healthBar = this.healthBars.get(entity);
      if (healthBar) {
        this.group.remove(healthBar.root);
        this.disposeTree(healthBar.root);
      }
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
      this.accentMaterials[factionId(entity.team?.id)],
    );
    accent.position.set(0, buildingHeight + 0.16, fullD * 0.18);
    accent.castShadow = true;
    const label = createBuildingLabel(entity.building?.label ?? entity.name ?? 'Building', fullW * 0.5, Math.max(0.5, fullD * 0.12), buildingHeight);
    label.position.copy(accent.position);
    label.position.y += 0.13;
    label.position.z += 0.01;
    root.add(accent, label);
    const details = createBuildingDetails(entity, fullW, fullD, buildingHeight, this.accentMaterials[factionId(entity.team?.id)]);
    root.add(details);
    const refineryDock = entity.building?.kind === 'refinery' ? createRefineryDock(fullW, fullD, buildingHeight) : undefined;
    if (refineryDock) root.add(refineryDock.root);

    return {
      root,
      blocks,
      accents: [accent, label],
      details,
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

    const worst = worstBlocks(object.blocks, damage, 6);
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
      if (level >= 9 && block.tier === damage.tiers - 1 && value > 62) dressRemovedBlock(block, this.interiorMaterial);
      else if (value >= 182) dressRemovedBlock(block, this.interiorMaterial);
      else if (value >= 128 || (level >= 8 && isCornerCell(damage, block) && value >= 86)) dressRubbleBlock(entity, block, this.rubbleMaterial);
      else if (value >= 58) dressShrunkBlock(entity, block, this.crackMaterial);
      else if (value >= 12 || (level >= 1 && value > 0)) dressCrackedBlock(entity, block, this.crackMaterial);
      else if (value > 0) dressScorchedBlock(entity, block, this.scorchMaterial);
      else if (level >= 1) block.mesh.material = block.baseMaterial;
      if (level >= 7 && block.tier > 0 && supportCellBroken(damage, block)) {
        block.mesh.position.y -= block.baseScale.y * 0.15;
        block.mesh.rotation.x += deterministicSigned(block.index, entity.id, 0x57) * 0.08;
        block.mesh.rotation.z += deterministicSigned(block.index, entity.id, 0x58) * 0.08;
      }
    }

    for (const accent of object.accents) accent.visible = level < 4 && !entity.destroyed;
    updateBuildingDetails(object.details, level, Boolean(entity.destroyed));

    const hasLocalizedDamage = worst.some((cell) => cell.value > 0);
    const scarCount = Math.min(worst.length, level >= 7 ? 6 : level >= 3 ? 5 : 3);
    const smokeCount = !hasLocalizedDamage ? 0 : level >= 9 ? 4 : level >= 7 ? 3 : level >= 4 ? 2 : 1;
    const fireCount = level >= 9 ? 3 : level >= 7 ? 2 : level >= 5 ? 1 : 0;
    const emberCount = level >= 8 ? 3 : level >= 5 ? 2 : level >= 2 ? 1 : 0;
    for (let i = 0; i < scarCount; i++) this.addEffect(entity, object, worst[i], 'scar', level);
    for (let i = 0; i < Math.min(smokeCount, worst.length); i++) this.addEffect(entity, object, worst[i], 'smoke', level);
    for (let i = 0; i < Math.min(fireCount, worst.length); i++) this.addEffect(entity, object, worst[i], 'fire', level);
    for (let i = 0; i < Math.min(emberCount, worst.length); i++) this.addEffect(entity, object, worst[i], 'ember', level);
  }

  private addEffect(entity: Entity, object: BuildingObject, cell: DamageCell, kind: DamageEffectKind, level: number): void {
    const material =
      kind === 'smoke' ? this.smokeMaterial.clone() : kind === 'fire' ? this.fireMaterial.clone() : kind === 'ember' ? this.emberSpotMaterial.clone() : this.scarMaterial.clone();
    const mesh = new Mesh(sharedPlaneGeometry, material);
    const severity = Math.max(0.2, Math.min(1, cell.value / 180));
    const size =
      kind === 'smoke' ? 1.45 + level * 0.18 : kind === 'fire' ? 1.2 + level * 0.08 : kind === 'ember' ? 0.52 + severity * 0.7 : 1.15 + severity * 1.45;
    mesh.scale.set(size, size, size);
    mesh.position.set(cell.position.x, cell.position.y + (kind === 'smoke' ? 1.4 : kind === 'fire' ? 0.75 : 0.08), cell.position.z);
    mesh.rotation.x = kind === 'scar' || kind === 'ember' ? -Math.PI / 2 : 0;
    mesh.rotation.z = kind === 'scar' || kind === 'ember' ? hash2i(cell.index, entity.id, kind === 'scar' ? 0x5ca9 : 0xe9) * Math.PI : 0;
    mesh.renderOrder = kind === 'smoke' ? 26 : kind === 'fire' ? 27 : 28;
    object.root.add(mesh);
    object.effects.push({ mesh, kind, basePosition: mesh.position.clone(), baseScale: size, phase: hash2i(cell.index, entity.id, kind === 'smoke' ? 0x5a10 : 0xf117) * Math.PI * 2 });
  }

  private clearEffects(object: BuildingObject): void {
    for (const effect of object.effects) {
      object.root.remove(effect.mesh);
      if (Array.isArray(effect.mesh.material)) effect.mesh.material.forEach((material) => material.dispose());
      else effect.mesh.material.dispose();
    }
    object.effects.length = 0;
  }

  // Block geometry/materials and the palette materials are shared across all
  // buildings and must survive removal; everything else (accent box, label mesh +
  // canvas texture, glow/dock/health geometries and their materials) is per-building.
  private isSharedMaterial(m: Material): boolean {
    return (
      Object.values(this.accentMaterials).includes(m) ||
      m === this.healthBackMaterial ||
      m === this.ghostMaterial ||
      m === this.scorchMaterial ||
      m === this.crackMaterial ||
      m === this.rubbleMaterial ||
      m === this.interiorMaterial ||
      m === this.emberMaterial ||
      m === this.scarMaterial ||
      m === this.emberSpotMaterial ||
      m === this.smokeMaterial ||
      m === this.fireMaterial ||
      Object.values(this.materials).includes(m)
    );
  }

  private disposeTree(root: Object3D): void {
    root.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      if (child.geometry !== sharedBlockGeometry && child.geometry !== sharedPlaneGeometry) child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (this.isSharedMaterial(material)) continue;
        const map = (material as MeshBasicMaterial).map;
        if (map) map.dispose();
        material.dispose();
      }
    });
  }

  private updateDamageEffects(entity: Entity, object: BuildingObject, camera: Camera): void {
    for (const effect of object.effects) {
      const wave = Math.sin(this.sim.tick * 0.12 + effect.phase);
      effect.mesh.position.copy(effect.basePosition);
      if (effect.kind === 'smoke') {
        effect.mesh.position.y += 0.45 + wave * 0.16;
        const material = effect.mesh.material as MeshBasicMaterial;
        material.opacity = entity.destroyed ? 0.38 : 0.18 + 0.08 * (wave + 1);
        effect.mesh.scale.set(effect.baseScale * (1 + wave * 0.01), effect.baseScale * (1 + wave * 0.01), effect.baseScale);
      } else if (effect.kind === 'fire') {
        effect.mesh.position.y += wave * 0.08;
        const material = effect.mesh.material as MeshBasicMaterial;
        material.opacity = 0.48 + 0.2 * (wave + 1);
      } else if (effect.kind === 'ember') {
        const material = effect.mesh.material as MeshBasicMaterial;
        material.opacity = 0.28 + 0.24 * (wave + 1);
        effect.mesh.scale.setScalar(effect.baseScale * (1 + wave * 0.025));
      } else {
        const material = effect.mesh.material as MeshBasicMaterial;
        material.opacity = entity.destroyed ? 0.62 : 0.42 + 0.05 * (wave + 1);
      }
      if (effect.kind === 'smoke' || effect.kind === 'fire') effect.mesh.lookAt(camera.position);
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
    glow.fillMaterial.opacity = 0.24 + pulse * 0.16;
    glow.ringMaterial.opacity = 0.68 + pulse * 0.24;
    const scale = 1 + pulse * 0.055;
    glow.fill.scale.set(scale, scale, 1);
    glow.ring.scale.set(1 + pulse * 0.04, 1 + pulse * 0.04, 1);
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
  details: Group;
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
  kind: DamageEffectKind;
  basePosition: Vector3;
  baseScale: number;
  phase: number;
}

type DamageEffectKind = 'scar' | 'ember' | 'smoke' | 'fire';

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
  block.mesh.scale.set(block.baseScale.x * 0.95, block.baseScale.y * 0.985, block.baseScale.z * 0.95);
  block.mesh.position.y -= block.baseScale.y * 0.025;
  block.mesh.rotation.x = deterministicSigned(block.index, entity.id, 0xb1) * 0.032;
  block.mesh.rotation.z = deterministicSigned(block.index, entity.id, 0xb2) * 0.032;
}

function dressCrackedBlock(entity: Entity, block: DamageBlock, material: Material): void {
  block.mesh.material = material;
  block.mesh.scale.set(block.baseScale.x * 0.92, block.baseScale.y * 0.95, block.baseScale.z * 0.92);
  block.mesh.position.y -= block.baseScale.y * 0.04;
  block.mesh.rotation.x = deterministicSigned(block.index, entity.id, 0xc1) * 0.06;
  block.mesh.rotation.z = deterministicSigned(block.index, entity.id, 0xc2) * 0.06;
}

function dressShrunkBlock(entity: Entity, block: DamageBlock, material: Material): void {
  block.mesh.material = material;
  const shrink = 0.84 + hash2i(block.index, entity.id, 0x120) * 0.06;
  block.mesh.scale.set(block.baseScale.x * shrink, block.baseScale.y * 0.78, block.baseScale.z * shrink);
  block.mesh.position.y -= block.baseScale.y * 0.11;
  block.mesh.rotation.x = deterministicSigned(block.index, entity.id, 0x121) * 0.14;
  block.mesh.rotation.z = deterministicSigned(block.index, entity.id, 0x122) * 0.14;
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

function worstBlocks(blocks: DamageBlock[], damage: StructureDamage, count: number): DamageCell[] {
  return blocks
    .map((block) => ({
      index: block.index,
      value: damage.cells[block.index] ?? 0,
      position: block.basePosition.clone(),
    }))
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

interface DetailPart {
  object: Object3D;
  y: number;
  sx: number;
  sy: number;
  sz: number;
  rx: number;
  ry: number;
  rz: number;
  fragility: number;
}

function createBuildingDetails(entity: Entity, width: number, depth: number, height: number, accentMaterial: Material): Group {
  const root = new Group();
  const kind = entity.building?.kind ?? 'command-yard';
  const concrete = detailMaterial(0x69706f, 0.84, 0.06);
  const dark = detailMaterial(0x1d2424, 0.78, 0.12);
  const metal = detailMaterial(0x4e5759, 0.66, 0.28);
  const roof = detailMaterial(0x303839, 0.82, 0.1);
  const glass = detailMaterial(0x9fb8bd, 0.42, 0.02, 0.88);
  const brass = detailMaterial(0xd1aa55, 0.58, 0.16);
  const warning = detailMaterial(0xe0b95b, 0.64, 0.08);
  const beam = transparentBasic(0xf3c86b, 0.26);
  const parts: DetailPart[] = [];
  const add = <T extends Object3D>(object: T, fragility = 5): T => {
    root.add(object);
    parts.push({
      object,
      y: object.position.y,
      sx: object.scale.x,
      sy: object.scale.y,
      sz: object.scale.z,
      rx: object.rotation.x,
      ry: object.rotation.y,
      rz: object.rotation.z,
      fragility,
    });
    return object;
  };
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, material: Material, fragility = 5): Mesh => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return add(mesh, fragility);
  };
  const cyl = (name: string, rTop: number, rBottom: number, h: number, x: number, y: number, z: number, material: Material, fragility = 5, radial = 14): Mesh => {
    const mesh = new Mesh(new CylinderGeometry(rTop, rBottom, h, radial), material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return add(mesh, fragility);
  };
  const cone = (name: string, r: number, h: number, x: number, y: number, z: number, material: Material, fragility = 5, radial = 14): Mesh => {
    const mesh = new Mesh(new ConeGeometry(r, h, radial), material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return add(mesh, fragility);
  };
  const stripe = (w: number, d: number, x: number, z: number, fragility = 4): Mesh => box('faction-stripe', w, 0.12, d, x, height + 0.15, z, accentMaterial, fragility);
  const door = (w: number, h: number, x: number, z: number, fragility = 4): Mesh => {
    const mesh = box('door', w, h, 0.18, x, h / 2 + 0.1, z, dark, fragility);
    return mesh;
  };

  box('foundation', width * 1.05, 0.34, depth * 1.05, 0, 0.16, 0, dark, 10);

  if (kind === 'command-yard') {
    box('command-main-tower', width * 0.42, height * 0.46, depth * 0.34, -width * 0.16, height + height * 0.23, -depth * 0.06, concrete, 6);
    box('command-control-room', width * 0.28, height * 0.24, depth * 0.22, -width * 0.16, height + height * 0.61, -depth * 0.06, glass, 4);
    box('command-garage', width * 0.44, height * 0.22, depth * 0.28, width * 0.2, height + height * 0.11, depth * 0.14, roof, 6);
    door(width * 0.3, height * 0.32, width * 0.2, depth * 0.51, 5);
    stripe(width * 0.48, depth * 0.08, width * 0.04, depth * 0.2, 4);
    const mast = cyl('command-antenna', 0.08, 0.08, height * 0.9, width * 0.16, height + height * 0.82, -depth * 0.24, metal, 3, 8);
    mast.rotation.z = 0.05;
    const dish = cyl('command-dish', 0.75, 0.75, 0.14, width * 0.16, height + height * 1.24, -depth * 0.24, metal, 3, 20);
    dish.rotation.x = Math.PI * 0.5;
    dish.rotation.z = -0.28;
    box('command-service-arm', width * 0.42, 0.16, 0.16, width * 0.04, height + height * 0.98, -depth * 0.28, brass, 4);
  } else if (kind === 'power-plant') {
    for (const x of [-width * 0.22, width * 0.18]) {
      cyl('cooling-tower', width * 0.09, width * 0.13, height * 0.82, x, height + height * 0.4, -depth * 0.12, concrete, 5, 18);
      cyl('cooling-tower-mouth', width * 0.11, width * 0.11, 0.16, x, height + height * 0.82, -depth * 0.12, dark, 4, 18);
    }
    for (const x of [width * 0.02, width * 0.32]) {
      cyl('smokestack', width * 0.045, width * 0.055, height * 0.88, x, height + height * 0.44, depth * 0.2, metal, 4, 14);
      cyl('stack-cap', width * 0.065, width * 0.065, 0.16, x, height + height * 0.9, depth * 0.2, dark, 4, 14);
    }
    box('generator-hall', width * 0.48, height * 0.22, depth * 0.32, -width * 0.04, height + height * 0.11, depth * 0.2, roof, 6);
    stripe(width * 0.18, depth * 0.08, width * 0.18, depth * 0.03, 4);
    box('power-bolt-a', width * 0.09, 0.16, depth * 0.34, width * 0.08, height + height * 0.75, 0, warning, 3).rotation.z = -0.45;
    box('power-bolt-b', width * 0.09, 0.16, depth * 0.34, width * 0.18, height + height * 0.58, 0, warning, 3).rotation.z = 0.45;
  } else if (kind === 'refinery') {
    box('refinery-hopper', width * 0.32, height * 0.36, depth * 0.28, -width * 0.2, height + height * 0.18, -depth * 0.08, concrete, 6);
    cone('ore-hopper-roof', width * 0.22, height * 0.22, -width * 0.2, height + height * 0.47, -depth * 0.08, roof, 5, 4).rotation.y = Math.PI * 0.25;
    for (const z of [-depth * 0.22, depth * 0.1]) {
      const tank = cyl('refinery-tank', width * 0.095, width * 0.095, depth * 0.25, width * 0.26, height + 0.8, z, metal, 5, 18);
      tank.rotation.z = Math.PI * 0.5;
      box('tank-band', width * 0.02, 0.08, depth * 0.28, width * 0.26, height + 1.08, z, brass, 4);
    }
    for (const x of [-width * 0.03, width * 0.11]) {
      const pipe = cyl('refinery-pipe', 0.11, 0.11, width * 0.52, x, height + 1.6, depth * 0.16, metal, 4, 12);
      pipe.rotation.z = Math.PI * 0.5;
    }
    stripe(width * 0.34, depth * 0.08, -width * 0.12, depth * 0.12, 4);
  } else if (kind === 'barracks') {
    box('barracks-roof-left', width * 0.48, height * 0.12, depth * 0.58, -width * 0.13, height + height * 0.18, 0, roof, 5).rotation.z = -0.12;
    box('barracks-roof-right', width * 0.48, height * 0.12, depth * 0.58, width * 0.13, height + height * 0.18, 0, roof, 5).rotation.z = 0.12;
    box('barracks-entry', width * 0.2, height * 0.35, depth * 0.12, -width * 0.24, height + height * 0.08, depth * 0.36, concrete, 5);
    door(width * 0.15, height * 0.3, -width * 0.24, depth * 0.53, 4);
    for (const x of [-width * 0.02, width * 0.16, width * 0.32]) box('barracks-window', width * 0.07, height * 0.08, 0.16, x, height * 0.78, depth * 0.52, glass, 3);
    stripe(width * 0.16, depth * 0.1, width * 0.04, 0, 4);
  } else if (kind === 'factory') {
    box('factory-high-bay', width * 0.44, height * 0.45, depth * 0.5, -width * 0.12, height + height * 0.22, -depth * 0.02, concrete, 6);
    box('factory-roof-cap', width * 0.48, height * 0.13, depth * 0.54, -width * 0.12, height + height * 0.5, -depth * 0.02, roof, 5);
    door(width * 0.34, height * 0.42, -width * 0.12, depth * 0.53, 5);
    const crane = box('factory-crane-beam', width * 0.58, 0.18, 0.18, width * 0.04, height + height * 0.72, depth * 0.04, warning, 4);
    crane.rotation.y = -0.18;
    for (const x of [-width * 0.22, width * 0.3]) cyl('factory-crane-post', 0.1, 0.1, height * 0.58, x, height + height * 0.35, depth * 0.04, metal, 4, 10);
    box('factory-conveyor', width * 0.42, 0.24, depth * 0.16, width * 0.22, height + 0.26, -depth * 0.36, dark, 5);
    stripe(width * 0.3, depth * 0.08, width * 0.05, -depth * 0.18, 4);
  } else if (kind === 'helipad') {
    box('helipad-deck', width * 0.92, 0.38, depth * 0.92, 0, height + 0.16, 0, roof, 6);
    box('helipad-h-cross-a', width * 0.14, 0.08, depth * 0.62, 0, height + 0.42, 0, warning, 3);
    box('helipad-h-cross-b', width * 0.52, 0.08, depth * 0.12, 0, height + 0.44, 0, warning, 3);
    box('helipad-control-hut', width * 0.2, height * 0.32, depth * 0.18, -width * 0.34, height + height * 0.18, -depth * 0.28, concrete, 5);
    box('helipad-glass', width * 0.16, height * 0.08, 0.14, -width * 0.34, height + height * 0.37, -depth * 0.38, glass, 3);
    const windsock = cyl('windsock-pole', 0.05, 0.05, height * 0.78, width * 0.34, height + height * 0.38, depth * 0.32, metal, 3, 8);
    windsock.rotation.z = -0.04;
    box('windsock', width * 0.16, 0.1, 0.1, width * 0.4, height + height * 0.78, depth * 0.32, accentMaterial, 3);
  } else if (kind === 'wall') {
    for (const x of [-width * 0.28, 0, width * 0.28]) box('wall-buttress', width * 0.18, height * 0.38, depth * 0.82, x, height + height * 0.08, 0, roof, 7);
    box('wall-cap', width * 0.92, 0.22, depth * 0.26, 0, height + height * 0.22, 0, warning, 5);
  } else if (kind === 'guard-tower') {
    cyl('guard-tower-column', width * 0.1, width * 0.16, height * 0.86, 0, height + height * 0.42, 0, concrete, 6, 14);
    box('guard-cabin', width * 0.5, height * 0.28, depth * 0.5, 0, height + height * 0.9, 0, concrete, 5);
    box('guard-window', width * 0.36, height * 0.08, 0.12, 0, height + height * 0.94, depth * 0.26, glass, 3);
    cone('guard-roof', width * 0.36, height * 0.24, 0, height + height * 1.16, 0, roof, 4, 4).rotation.y = Math.PI * 0.25;
    const spotlight = new Mesh(new ConeGeometry(width * 0.28, depth * 0.78, 24, 1, true), beam);
    spotlight.position.set(0, height + height * 0.9, depth * 0.5);
    spotlight.rotation.x = Math.PI * 0.5;
    spotlight.renderOrder = 18;
    add(spotlight, 3);
    stripe(width * 0.26, depth * 0.08, 0, 0, 4);
  } else if (kind === 'aa-tower') {
    box('aa-platform', width * 0.64, height * 0.18, depth * 0.64, 0, height + height * 0.62, 0, metal, 6);
    cyl('aa-mast', width * 0.1, width * 0.15, height * 0.72, 0, height + height * 0.35, 0, concrete, 6, 12);
    const launcher = new Group();
    launcher.position.set(0, height + height * 0.82, 0);
    launcher.rotation.y = -0.5;
    for (const z of [-depth * 0.09, depth * 0.09]) {
      const rail = new Mesh(new CylinderGeometry(width * 0.035, width * 0.035, width * 0.62, 12), metal);
      rail.rotation.z = Math.PI * 0.5;
      rail.position.set(0, 0, z);
      rail.castShadow = true;
      launcher.add(rail);
      const nose = new Mesh(new ConeGeometry(width * 0.055, width * 0.16, 12), warning);
      nose.rotation.z = -Math.PI * 0.5;
      nose.position.set(width * 0.36, 0, z);
      nose.castShadow = true;
      launcher.add(nose);
    }
    add(launcher, 4);
    const dish = cyl('aa-radar-dish', width * 0.16, width * 0.16, 0.12, -width * 0.28, height + height * 0.94, -depth * 0.2, metal, 3, 20);
    dish.rotation.x = Math.PI * 0.5;
    dish.rotation.z = 0.38;
    stripe(width * 0.24, depth * 0.08, 0, 0, 4);
  } else {
    stripe(width * 0.4, depth * 0.08, 0, depth * 0.12, 4);
  }

  syncDetailPartBases(parts);
  root.userData.detailParts = parts;
  return root;
}

function syncDetailPartBases(parts: DetailPart[]): void {
  for (const part of parts) {
    part.y = part.object.position.y;
    part.sx = part.object.scale.x;
    part.sy = part.object.scale.y;
    part.sz = part.object.scale.z;
    part.rx = part.object.rotation.x;
    part.ry = part.object.rotation.y;
    part.rz = part.object.rotation.z;
  }
}

function updateBuildingDetails(root: Group, level: number, destroyed: boolean): void {
  const parts = (root.userData.detailParts ?? []) as DetailPart[];
  for (const part of parts) {
    const t = destroyed ? 1 : Math.max(0, Math.min(1, (level - part.fragility) / 5));
    part.object.visible = !destroyed || part.fragility >= 7 || t < 0.96;
    part.object.position.y = part.y - t * (0.55 + part.y * 0.34);
    part.object.scale.set(part.sx * (1 - t * 0.22), part.sy * (1 - t * 0.44), part.sz * (1 - t * 0.22));
    part.object.rotation.set(part.rx + t * 0.12, part.ry + t * 0.18, part.rz + t * 0.2);
  }
}

function detailMaterial(color: number, roughness: number, metalness: number, opacity = 1): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness, transparent: opacity < 1, opacity });
}

function transparentBasic(color: number, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    toneMapped: false,
  });
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
  const team = FACTION[factionId(entity.team?.id)];
  const accent = options.color ?? team.lightBar;
  const radius = Math.hypot(entity.building!.footprint.w * cellSize, entity.building!.footprint.h * cellSize) * (options.radiusScale ?? 1);
  const fillMaterial = new MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  });
  const ringMaterial = new MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    depthTest: false,
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
