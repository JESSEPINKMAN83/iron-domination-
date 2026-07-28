import {
  AdditiveBlending,
  Box3,
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
const BUILDING_PICK_PADDING_PX = 14;
const BUILDING_PICK_MIN_SIZE_PX = 38;

const sharedBlockGeometry = new BoxGeometry(1, 1, 1);
const sharedPlaneGeometry = new PlaneGeometry(1, 1);

export class BuildingView {
  readonly group = new Group();
  private readonly objects = new Map<Entity, BuildingObject>();
  private hiddenEntity?: Entity;
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
      const hiddenForFortressView = entity === this.hiddenEntity;
      object.root.visible = object.everSeen && !hiddenForFortressView;
      if (hiddenForFortressView) {
        const selectedGlow = this.selectedGlows.get(entity);
        const producerGlow = this.producerGlows.get(entity);
        const healthBar = this.healthBars.get(entity);
        if (selectedGlow) selectedGlow.root.visible = false;
        if (producerGlow) producerGlow.root.visible = false;
        if (healthBar) healthBar.root.visible = false;
      }
      if (!object.root.visible) continue;

      if (!fogged) this.applyDamageDressing(entity, object);
      if (object.turretPivot && entity.turret && !entity.destroyed) {
        object.turretPivot.rotation.y = entity.turret.yaw - entity.transform.rot;
      }
      object.root.rotation.x = entity.destroyed ? 0 : object.leanX;
      object.root.rotation.z = entity.destroyed ? object.leanZ * 0.35 : object.leanZ;
      this.updateDamageEffects(entity, object, camera);
      // fogged enemy buildings freeze — no live health/dock intel through the shroud
      this.updateRefineryDock(entity, object, fogged);
      updateBuildingActivity(
        object.details,
        this.sim.tick,
        entity.id,
        !fogged && !entity.destroyed && entity.building.buildProgress >= 1 && damageLevel(entity) < 6,
      );
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

  setHiddenEntity(entity?: Entity): void {
    this.hiddenEntity = entity;
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

  pickAtScreen(
    camera: Camera,
    screenX: number,
    screenY: number,
    viewportW: number,
    viewportH: number,
  ): Entity | undefined {
    let best: Entity | undefined;
    let bestDepth = Number.POSITIVE_INFINITY;
    let bestCenterDistance = Number.POSITIVE_INFINITY;
    const box = new Box3();
    for (const [entity, object] of this.objects) {
      if (!entity.building || !object.root.visible) continue;
      object.root.updateWorldMatrix(true, true);
      box.setFromObject(object.root, true);
      const bounds = projectBuildingHitBounds(box, camera, viewportW, viewportH);
      if (!bounds || screenX < bounds.left || screenX > bounds.right || screenY < bounds.top || screenY > bounds.bottom) continue;
      const centerDistance = Math.hypot(screenX - bounds.centerX, screenY - bounds.centerY);
      if (bounds.depth < bestDepth || (bounds.depth === bestDepth && centerDistance < bestCenterDistance)) {
        best = entity;
        bestDepth = bounds.depth;
        bestCenterDistance = centerDistance;
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
          mesh.castShadow = false;
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
    // Keep the identity plate on a clear roof edge. The previous central
    // position intersected large roof machinery and could flicker or appear
    // partially hidden at normal RTS camera angles.
    accent.position.set(0, buildingHeight + 0.16, fullD * 0.4);
    accent.castShadow = true;
    const label = createBuildingLabel(entity.building?.label ?? entity.name ?? 'Building', fullW * 0.5, Math.max(0.5, fullD * 0.12), buildingHeight);
    label.position.copy(accent.position);
    // The label plane needs a meaningful gap above the accent box; a 2 cm
    // separation is below depth-buffer precision at far RTS zoom levels.
    label.position.y += 0.23;
    label.position.z += 0.01;
    root.add(accent, label);
    const details = createBuildingDetails(entity, fullW, fullD, buildingHeight, this.accentMaterials[factionId(entity.team?.id)]);
    root.add(details);
    const turretPivot = details.userData.turretPivot as Group | undefined;
    const refineryDock = entity.building?.kind === 'refinery' ? createRefineryDock(fullW, fullD, buildingHeight) : undefined;
    if (refineryDock) root.add(refineryDock.root);

    return {
      root,
      blocks,
      accents: [accent, label],
      details,
      turretPivot,
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

export interface BuildingScreenHitBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
  depth: number;
}

export function projectBuildingHitBounds(
  box: Box3,
  camera: Camera,
  viewportW: number,
  viewportH: number,
  padding = BUILDING_PICK_PADDING_PX,
  minSize = BUILDING_PICK_MIN_SIZE_PX,
): BuildingScreenHitBounds | undefined {
  if (box.isEmpty() || viewportW <= 0 || viewportH <= 0) return undefined;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  let projected = 0;
  const point = new Vector3();
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        point.set(x, y, z).project(camera);
        if (point.z < -1 || point.z > 1) continue;
        const sx = (point.x * 0.5 + 0.5) * viewportW;
        const sy = (-point.y * 0.5 + 0.5) * viewportH;
        left = Math.min(left, sx);
        right = Math.max(right, sx);
        top = Math.min(top, sy);
        bottom = Math.max(bottom, sy);
        projected++;
      }
    }
  }
  if (projected === 0) return undefined;
  const center = box.getCenter(new Vector3()).project(camera);
  const centerX = (center.x * 0.5 + 0.5) * viewportW;
  const centerY = (-center.y * 0.5 + 0.5) * viewportH;
  const widthExpansion = Math.max(padding, (minSize - (right - left)) * 0.5);
  const heightExpansion = Math.max(padding, (minSize - (bottom - top)) * 0.5);
  return {
    left: left - widthExpansion,
    right: right + widthExpansion,
    top: top - heightExpansion,
    bottom: bottom + heightExpansion,
    centerX,
    centerY,
    depth: center.z,
  };
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
  turretPivot?: Group;
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

type BuildingActivityKind = 'spin-y' | 'spin-z' | 'slide-x' | 'pulse' | 'rock-z';

interface BuildingActivityPart {
  object: Object3D;
  kind: BuildingActivityKind;
  speed: number;
  amplitude: number;
  phase: number;
  baseX: number;
  baseRy: number;
  baseRz: number;
}

function createBuildingDetails(entity: Entity, width: number, depth: number, height: number, accentMaterial: Material): Group {
  const root = new Group();
  const kind = entity.building?.kind ?? 'command-yard';
  const concrete = detailMaterial(0x69706f, 0.84, 0.06);
  const dark = detailMaterial(0x1d2424, 0.78, 0.12);
  const metal = detailMaterial(0x4e5759, 0.66, 0.28);
  const roof = detailMaterial(0x303839, 0.82, 0.1);
  // Opaque armored glass is more stable than transparent panes layered over
  // the damage-block façade and still reads as glass through color/roughness.
  const glass = detailMaterial(0x9fb8bd, 0.38, 0.08);
  const brass = detailMaterial(0xd1aa55, 0.58, 0.16);
  const warning = detailMaterial(0xe0b95b, 0.64, 0.08);
  const beam = transparentBasic(0xf3c86b, 0.26);
  const accentHex = accentMaterial instanceof MeshStandardMaterial ? accentMaterial.color.getHex() : 0xe6bd55;
  const signal = new MeshStandardMaterial({
    color: accentHex,
    emissive: accentHex,
    emissiveIntensity: 1.15,
    roughness: 0.38,
    metalness: 0.08,
  });
  const hotCore = new MeshStandardMaterial({
    color: 0xffb23d,
    emissive: 0xff7a18,
    emissiveIntensity: 1.35,
    roughness: 0.42,
    metalness: 0.06,
  });
  const ore = detailMaterial(0x8d6a35, 0.96, 0.02);
  const activityParts: BuildingActivityPart[] = [];
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
  const activity = <T extends Object3D>(
    object: T,
    activityKind: BuildingActivityKind,
    speed: number,
    amplitude = 1,
    phase = 0,
  ): T => {
    activityParts.push({
      object,
      kind: activityKind,
      speed,
      amplitude,
      phase,
      baseX: object.position.x,
      baseRy: object.rotation.y,
      baseRz: object.rotation.z,
    });
    return object;
  };
  const frontPanel = (name: string, w: number, h: number, x: number, y: number, material: Material = dark, fragility = 5): Mesh =>
    box(name, w, h, 0.26, x, y, depth * 0.512, material, fragility);
  const sidePanel = (name: string, w: number, h: number, z: number, y: number, material: Material = dark, fragility = 5): Mesh => {
    const panel = box(name, w, h, 0.26, width * 0.512, y, z, material, fragility);
    panel.rotation.y = Math.PI / 2;
    return panel;
  };
  const ventBank = (prefix: string, count: number, x: number, y: number, z: number, horizontal = true): Group => {
    const vents = new Group();
    vents.name = `${prefix}-vents`;
    vents.position.set(x, y, z);
    for (let i = 0; i < count; i++) {
      const slat = new Mesh(new BoxGeometry(horizontal ? width * 0.055 : 0.12, 0.12, horizontal ? 0.16 : depth * 0.055), metal);
      if (horizontal) slat.position.x = (i - (count - 1) / 2) * width * 0.07;
      else slat.position.z = (i - (count - 1) / 2) * depth * 0.07;
      slat.rotation.z = horizontal ? -0.16 : 0;
      slat.castShadow = true;
      vents.add(slat);
    }
    return add(vents, 4);
  };
  const perimeterLight = (name: string, x: number, y: number, z: number, fragility = 3): Mesh =>
    // Each light gets its own material so an animated beacon cannot pulse every
    // signal, gauge, and façade light that happens to share the base material.
    box(name, 0.34, 0.2, 0.18, x, y, z, signal.clone(), fragility);

  box('foundation', width * 1.06, 0.38, depth * 1.06, 0, 0.18, 0, dark, 10);
  if (kind !== 'wall') {
    box('front-armored-skirt', width * 0.9, 0.52, 0.28, 0, 0.48, depth * 0.512, metal, 8);
    box('side-armored-skirt', 0.28, 0.52, depth * 0.9, width * 0.512, 0.48, 0, metal, 8);
    for (const x of [-width * 0.43, width * 0.43]) {
      box('front-corner-pier', width * 0.065, height * 0.72, 0.36, x, height * 0.38, depth * 0.518, dark, 7);
    }
    for (const z of [-depth * 0.43, depth * 0.43]) {
      box('side-corner-pier', 0.36, height * 0.72, depth * 0.065, width * 0.518, height * 0.38, z, dark, 7);
    }
    for (const x of [-width * 0.38, width * 0.38]) perimeterLight('faction-status-light', x, height * 0.72, depth * 0.532);
  }

  if (kind === 'command-yard') {
    frontPanel('command-facade-inset', width * 0.58, height * 0.44, 0, height * 0.47, roof, 7);
    frontPanel('command-operations-window', width * 0.38, height * 0.13, 0, height * 0.64, glass, 4);
    for (const x of [-width * 0.29, width * 0.29]) {
      frontPanel('command-blast-shield', width * 0.1, height * 0.5, x, height * 0.48, concrete, 7);
    }
    ventBank('command', 5, width * 0.28, height * 0.26, depth * 0.52);
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
    const radarPivot = new Group();
    radarPivot.name = 'command-radar-array';
    radarPivot.position.set(width * 0.25, height + height * 0.78, depth * 0.2);
    const radarMast = new Mesh(new CylinderGeometry(0.08, 0.12, height * 0.48, 10), metal);
    radarMast.position.y = height * 0.24;
    const radarBar = new Mesh(new BoxGeometry(width * 0.28, 0.12, 0.16), signal);
    radarBar.position.y = height * 0.52;
    const radarTip = new Mesh(new ConeGeometry(width * 0.035, height * 0.2, 8), brass);
    radarTip.position.y = height * 0.68;
    radarPivot.add(radarMast, radarBar, radarTip);
    add(radarPivot, 3);
    activity(radarBar, 'spin-y', 0.72, 1, entity.id * 0.17);
    activity(perimeterLight('command-pulse', 0, height + height * 1.48, -depth * 0.24), 'pulse', 2.4, 1, 0.4);
  } else if (kind === 'power-plant') {
    frontPanel('power-intake', width * 0.54, height * 0.38, -width * 0.06, height * 0.46, dark, 7);
    for (const x of [-width * 0.25, -width * 0.08, width * 0.09]) {
      const fan = new Group();
      fan.name = 'power-turbine-intake';
      fan.position.set(x, height * 0.48, depth * 0.525);
      const rim = new Mesh(new CylinderGeometry(width * 0.065, width * 0.065, 0.2, 18), metal);
      rim.rotation.x = Math.PI / 2;
      fan.add(rim);
      const rotor = new Group();
      rotor.position.z = 0.12;
      for (let i = 0; i < 4; i++) {
        const blade = new Mesh(new BoxGeometry(width * 0.055, width * 0.012, 0.08), brass);
        blade.rotation.z = i * Math.PI * 0.5;
        rotor.add(blade);
      }
      fan.add(rotor);
      add(fan, 5);
      activity(rotor, 'spin-z', 2.6 + x * 0.02, 1, x);
    }
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
    for (const z of [-depth * 0.26, 0, depth * 0.26]) {
      const coil = cyl('transformer-coil', width * 0.055, width * 0.055, height * 0.34, width * 0.42, height + height * 0.2, z, hotCore, 4, 12);
      for (const y of [-height * 0.1, 0, height * 0.1]) {
        const ring = new Mesh(new CylinderGeometry(width * 0.075, width * 0.075, 0.05, 12), brass);
        ring.position.y = y;
        coil.add(ring);
      }
      activity(coil, 'pulse', 2.8, 0.9, z);
    }
    box('power-bus-duct', width * 0.12, height * 0.18, depth * 0.74, width * 0.36, height + height * 0.12, 0, metal, 6);
  } else if (kind === 'refinery') {
    frontPanel('refinery-processor-face', width * 0.48, height * 0.42, -width * 0.1, height * 0.45, roof, 7);
    for (const x of [-width * 0.26, -width * 0.1, width * 0.06]) {
      frontPanel('refinery-pressure-gauge', width * 0.09, height * 0.12, x, height * 0.58, signal, 3);
    }
    sidePanel('refinery-service-panel', depth * 0.38, height * 0.36, depth * 0.08, height * 0.44, dark, 6);
    box('refinery-hopper', width * 0.32, height * 0.36, depth * 0.28, -width * 0.2, height + height * 0.18, -depth * 0.08, concrete, 6);
    cone('ore-hopper-roof', width * 0.22, height * 0.22, -width * 0.2, height + height * 0.47, -depth * 0.08, roof, 5, 4).rotation.y = Math.PI * 0.25;
    const oreTray = box('ore-feed-tray', width * 0.34, 0.18, depth * 0.24, -width * 0.28, height + height * 0.56, -depth * 0.08, dark, 5);
    for (let i = 0; i < 9; i++) {
      const chunk = new Mesh(new BoxGeometry(width * (0.025 + (i % 3) * 0.006), 0.2 + (i % 2) * 0.08, depth * 0.025), ore);
      chunk.position.set((i % 3 - 1) * width * 0.065, 0.2 + (i % 2) * 0.05, (Math.floor(i / 3) - 1) * depth * 0.05);
      chunk.rotation.set(i * 0.21, i * 0.47, i * 0.13);
      oreTray.add(chunk);
    }
    for (const z of [-depth * 0.22, depth * 0.1]) {
      const tank = cyl('refinery-tank', width * 0.095, width * 0.095, depth * 0.25, width * 0.26, height + 0.8, z, metal, 5, 18);
      tank.rotation.z = Math.PI * 0.5;
      box('tank-band', width * 0.02, 0.08, depth * 0.28, width * 0.26, height + 1.08, z, brass, 4);
    }
    for (const x of [-width * 0.03, width * 0.11]) {
      const pipe = cyl('refinery-pipe', 0.11, 0.11, width * 0.52, x, height + 1.6, depth * 0.16, metal, 4, 12);
      pipe.rotation.z = Math.PI * 0.5;
    }
    const rollerRack = new Group();
    rollerRack.name = 'refinery-ore-conveyor';
    rollerRack.position.set(-width * 0.13, height + 0.55, depth * 0.35);
    for (let i = 0; i < 6; i++) {
      const roller = new Mesh(new CylinderGeometry(0.12, 0.12, width * 0.08, 10), metal);
      roller.rotation.z = Math.PI / 2;
      roller.position.x = (i - 2.5) * width * 0.075;
      rollerRack.add(roller);
      activity(roller, 'spin-z', 3.2, 1, i * 0.3);
    }
    add(rollerRack, 4);
    cyl('refinery-flare-stack', 0.1, 0.14, height * 0.92, width * 0.4, height + height * 0.46, -depth * 0.34, metal, 4, 10);
    activity(perimeterLight('refinery-flare', width * 0.4, height + height * 0.96, -depth * 0.34), 'pulse', 4.4, 1.2, 1.1);
    stripe(width * 0.34, depth * 0.08, -width * 0.12, depth * 0.12, 4);
  } else if (kind === 'barracks') {
    frontPanel('barracks-armored-front', width * 0.64, height * 0.48, 0, height * 0.44, concrete, 7);
    frontPanel('barracks-entry-recess', width * 0.22, height * 0.4, -width * 0.24, height * 0.32, dark, 6);
    box('barracks-roof-left', width * 0.43, height * 0.12, depth * 0.58, -width * 0.22, height + height * 0.18, 0, roof, 5).rotation.z = -0.12;
    box('barracks-roof-right', width * 0.43, height * 0.12, depth * 0.58, width * 0.22, height + height * 0.18, 0, roof, 5).rotation.z = 0.12;
    box('barracks-roof-ridge', width * 0.075, height * 0.15, depth * 0.62, 0, height + height * 0.26, 0, metal, 6);
    box('barracks-entry', width * 0.2, height * 0.35, depth * 0.12, -width * 0.24, height + height * 0.08, depth * 0.36, concrete, 5);
    door(width * 0.15, height * 0.3, -width * 0.24, depth * 0.53, 4);
    for (const x of [-width * 0.02, width * 0.16, width * 0.32]) box('barracks-window', width * 0.07, height * 0.08, 0.16, x, height * 0.78, depth * 0.52, glass, 3);
    box('barracks-entry-canopy', width * 0.24, 0.16, depth * 0.14, -width * 0.24, height * 0.7, depth * 0.58, warning, 4).rotation.x = -0.08;
    for (const x of [width * 0.1, width * 0.24, width * 0.38]) {
      frontPanel('barracks-locker', width * 0.09, height * 0.24, x, height * 0.25, metal, 5);
      frontPanel('barracks-locker-slot', width * 0.055, 0.1, x, height * 0.3, dark, 4);
    }
    for (const x of [-width * 0.38, width * 0.38]) {
      box('barracks-supply-crate', width * 0.12, height * 0.12, depth * 0.13, x, height + 0.36, -depth * 0.23, brass, 4);
    }
    cyl('barracks-radio-mast', 0.055, 0.07, height * 0.72, width * 0.34, height + height * 0.43, -depth * 0.28, metal, 3, 8);
    activity(perimeterLight('barracks-ready-light', width * 0.34, height + height * 0.82, -depth * 0.28), 'pulse', 1.8, 0.8, 2);
    stripe(width * 0.16, depth * 0.1, width * 0.04, 0, 4);
  } else if (kind === 'factory') {
    frontPanel('factory-hangar-recess', width * 0.62, height * 0.58, -width * 0.08, height * 0.42, dark, 8);
    for (let i = 0; i < 6; i++) {
      frontPanel(
        'factory-hangar-door-panel',
        width * 0.085,
        height * 0.48,
        -width * 0.29 + i * width * 0.105,
        height * 0.4,
        i % 2 === 0 ? metal : roof,
        6,
      );
    }
    box('factory-hangar-header', width * 0.68, 0.28, 0.34, -width * 0.08, height * 0.73, depth * 0.515, warning, 6);
    box('factory-high-bay', width * 0.44, height * 0.45, depth * 0.5, -width * 0.12, height + height * 0.22, -depth * 0.02, concrete, 6);
    box('factory-roof-cap', width * 0.48, height * 0.13, depth * 0.54, -width * 0.12, height + height * 0.5, -depth * 0.02, roof, 5);
    door(width * 0.34, height * 0.42, -width * 0.12, depth * 0.53, 5);
    const crane = box('factory-crane-beam', width * 0.58, 0.18, 0.18, width * 0.04, height + height * 0.72, depth * 0.04, warning, 4);
    crane.rotation.y = -0.18;
    for (const x of [-width * 0.22, width * 0.3]) cyl('factory-crane-post', 0.1, 0.1, height * 0.58, x, height + height * 0.35, depth * 0.04, metal, 4, 10);
    box('factory-conveyor', width * 0.42, 0.24, depth * 0.16, width * 0.22, height + 0.26, -depth * 0.36, dark, 5);
    const gantryCar = new Group();
    gantryCar.name = 'factory-gantry-car';
    gantryCar.position.set(width * 0.03, height + height * 0.7, depth * 0.04);
    const gantryBody = new Mesh(new BoxGeometry(width * 0.12, 0.28, depth * 0.13), brass);
    const gantryHook = new Mesh(new CylinderGeometry(0.08, 0.08, height * 0.35, 8), metal);
    gantryHook.position.y = -height * 0.2;
    gantryCar.add(gantryBody, gantryHook);
    add(gantryCar, 4);
    activity(gantryCar, 'slide-x', 0.54, width * 0.18, 0.8);
    const chassis = new Group();
    chassis.name = 'factory-vehicle-chassis';
    chassis.position.set(width * 0.24, height + 0.58, -depth * 0.32);
    const chassisDeck = new Mesh(new BoxGeometry(width * 0.26, 0.34, depth * 0.12), metal);
    chassis.add(chassisDeck);
    for (const x of [-width * 0.09, width * 0.09]) {
      for (const z of [-depth * 0.07, depth * 0.07]) {
        const wheel = new Mesh(new CylinderGeometry(0.22, 0.22, 0.16, 10), dark);
        wheel.position.set(x, -0.2, z);
        wheel.rotation.x = Math.PI / 2;
        chassis.add(wheel);
      }
    }
    add(chassis, 5);
    for (const z of [-depth * 0.34, -depth * 0.18, 0, depth * 0.18]) {
      const exhaust = cyl('factory-roof-exhaust', width * 0.035, width * 0.045, height * 0.36, width * 0.4, height + height * 0.28, z, dark, 4, 10);
      exhaust.rotation.z = -0.08;
    }
    stripe(width * 0.3, depth * 0.08, width * 0.05, -depth * 0.18, 4);
  } else if (kind === 'helipad') {
    frontPanel('helipad-maintenance-bay', width * 0.48, height * 0.42, width * 0.08, height * 0.42, dark, 7);
    for (let i = 0; i < 4; i++) {
      frontPanel('helipad-bay-door-panel', width * 0.095, height * 0.34, -width * 0.08 + i * width * 0.11, height * 0.38, metal, 5);
    }
    box('helipad-deck', width * 0.92, 0.38, depth * 0.92, 0, height + 0.16, 0, roof, 6);
    box('helipad-h-cross-a', width * 0.14, 0.08, depth * 0.62, 0, height + 0.44, 0, warning, 3);
    box('helipad-h-cross-b', width * 0.52, 0.08, depth * 0.12, 0, height + 0.52, 0, warning, 3);
    box('helipad-control-hut', width * 0.2, height * 0.32, depth * 0.18, -width * 0.34, height + height * 0.18, -depth * 0.28, concrete, 5);
    box('helipad-glass', width * 0.16, height * 0.08, 0.14, -width * 0.34, height + height * 0.37, -depth * 0.38, glass, 3);
    const windsock = cyl('windsock-pole', 0.05, 0.05, height * 0.78, width * 0.34, height + height * 0.38, depth * 0.32, metal, 3, 8);
    windsock.rotation.z = -0.04;
    activity(box('windsock', width * 0.16, 0.1, 0.1, width * 0.4, height + height * 0.78, depth * 0.32, accentMaterial, 3), 'rock-z', 1.7, 0.16, 0.3);
    const landingRing = new Group();
    landingRing.name = 'helipad-landing-lights';
    landingRing.position.y = height + 0.48;
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const light = new Mesh(new BoxGeometry(0.28, 0.1, 0.28), signal);
      light.position.set(Math.cos(angle) * width * 0.36, 0, Math.sin(angle) * depth * 0.36);
      landingRing.add(light);
    }
    add(landingRing, 3);
    activity(landingRing, 'pulse', 2.2, 1, 1.3);
    for (const z of [-depth * 0.24, 0, depth * 0.24]) {
      const fuelTank = cyl('helipad-fuel-tank', width * 0.055, width * 0.055, depth * 0.19, -width * 0.4, height + 0.75, z, metal, 5, 14);
      fuelTank.rotation.x = Math.PI / 2;
      box('helipad-fuel-band', width * 0.12, 0.08, depth * 0.025, -width * 0.4, height + 0.75, z, warning, 4);
    }
    sidePanel('helipad-service-gantry', depth * 0.42, height * 0.22, 0, height * 0.62, roof, 6);
  } else if (kind === 'wall') {
    for (const x of [-width * 0.42, -width * 0.14, width * 0.14, width * 0.42]) {
      box('wall-buttress', width * 0.14, height * 0.52, depth * 0.88, x, height + height * 0.12, 0, roof, 8);
      frontPanel('wall-armor-plate', width * 0.1, height * 0.45, x, height * 0.48, metal, 8);
    }
    box('wall-cap', width * 0.92, 0.22, depth * 0.26, 0, height + height * 0.22, 0, warning, 5);
    for (const x of [-width * 0.32, 0, width * 0.32]) {
      frontPanel('wall-firing-slit', width * 0.12, height * 0.1, x, height * 0.72, dark, 6);
    }
    box('wall-rear-walkway', width * 0.84, 0.18, depth * 0.34, 0, height + height * 0.34, -depth * 0.22, metal, 7);
  } else if (kind === 'guard-tower') {
    for (const x of [-width * 0.36, width * 0.36]) {
      box('guard-support-leg', width * 0.1, height * 0.85, depth * 0.11, x, height * 0.58, 0, metal, 8);
      frontPanel('guard-armor-chevron', width * 0.13, height * 0.32, x, height * 0.5, warning, 6);
    }
    cyl('guard-tower-column', width * 0.1, width * 0.16, height * 0.86, 0, height + height * 0.42, 0, concrete, 6, 14);
    box('guard-cabin', width * 0.5, height * 0.28, depth * 0.5, 0, height + height * 0.9, 0, concrete, 5);
    box('guard-window', width * 0.36, height * 0.08, 0.12, 0, height + height * 0.94, depth * 0.26, glass, 3);
    cone('guard-roof', width * 0.36, height * 0.24, 0, height + height * 1.16, 0, roof, 4, 4).rotation.y = Math.PI * 0.25;
    const launcher = new Group();
    launcher.name = 'fortress-launcher-pivot';
    launcher.position.set(0, height + height * 1.28, 0);
    const deck = new Mesh(new CylinderGeometry(width * 0.3, width * 0.34, height * 0.13, 18), dark);
    deck.castShadow = true;
    launcher.add(deck);
    const armoredCore = new Mesh(new BoxGeometry(width * 0.28, height * 0.2, depth * 0.32), metal);
    armoredCore.position.y = height * 0.13;
    armoredCore.castShadow = true;
    launcher.add(armoredCore);
    for (const x of [-width * 0.19, width * 0.19]) {
      for (const y of [height * 0.04, height * 0.2]) {
        const tube = new Mesh(new CylinderGeometry(width * 0.055, width * 0.065, depth * 0.72, 12), metal);
        tube.position.set(x, y, depth * 0.12);
        tube.rotation.x = Math.PI * 0.5;
        tube.castShadow = true;
        launcher.add(tube);
        const nose = new Mesh(new ConeGeometry(width * 0.06, width * 0.19, 12), warning);
        nose.position.set(x, y, depth * 0.52);
        nose.rotation.x = Math.PI * 0.5;
        nose.castShadow = true;
        launcher.add(nose);
      }
    }
    const sight = new Mesh(new CylinderGeometry(width * 0.055, width * 0.07, height * 0.42, 12), brass);
    sight.position.set(0, height * 0.42, 0);
    sight.castShadow = true;
    launcher.add(sight);
    const rangefinder = new Mesh(new BoxGeometry(width * 0.22, height * 0.08, depth * 0.08), signal);
    rangefinder.position.set(0, height * 0.34, depth * 0.18);
    launcher.add(rangefinder);
    activity(rangefinder, 'pulse', 2.6, 0.8, 0.7);
    add(launcher, 4);
    root.userData.turretPivot = launcher;
    const spotlight = new Mesh(new ConeGeometry(width * 0.28, depth * 0.78, 24, 1, true), beam);
    spotlight.position.set(0, height * 0.08, depth * 0.62);
    spotlight.rotation.x = Math.PI * 0.5;
    spotlight.renderOrder = 18;
    launcher.add(spotlight);
    for (const x of [-width * 0.28, width * 0.28]) {
      const ammoDrum = cyl('guard-ammo-drum', width * 0.09, width * 0.09, height * 0.18, x, height + height * 1.24, -depth * 0.2, dark, 5, 14);
      ammoDrum.rotation.z = Math.PI / 2;
    }
    stripe(width * 0.26, depth * 0.08, 0, 0, 4);
  } else if (kind === 'aa-tower') {
    for (const x of [-width * 0.34, width * 0.34]) {
      box('aa-stabilizer-leg', width * 0.11, height * 0.75, depth * 0.13, x, height * 0.54, 0, metal, 8);
      frontPanel('aa-hazard-panel', width * 0.14, height * 0.28, x, height * 0.46, warning, 6);
    }
    box('aa-platform', width * 0.64, height * 0.18, depth * 0.64, 0, height + height * 0.62, 0, metal, 6);
    cyl('aa-mast', width * 0.1, width * 0.15, height * 0.72, 0, height + height * 0.35, 0, concrete, 6, 12);
    const launcher = new Group();
    launcher.position.set(0, height + height * 0.82, 0);
    launcher.rotation.y = -0.5;
    for (const y of [-height * 0.08, height * 0.08]) {
      for (const z of [-depth * 0.12, depth * 0.12]) {
        const rail = new Mesh(new CylinderGeometry(width * 0.035, width * 0.042, width * 0.68, 12), metal);
        rail.rotation.z = Math.PI * 0.5;
        rail.position.set(0, y, z);
        rail.castShadow = true;
        launcher.add(rail);
        const nose = new Mesh(new ConeGeometry(width * 0.055, width * 0.18, 12), warning);
        nose.rotation.z = -Math.PI * 0.5;
        nose.position.set(width * 0.39, y, z);
        nose.castShadow = true;
        launcher.add(nose);
      }
    }
    add(launcher, 4);
    root.userData.turretPivot = launcher;
    const dish = cyl('aa-radar-dish', width * 0.16, width * 0.16, 0.12, -width * 0.28, height + height * 0.94, -depth * 0.2, metal, 3, 20);
    dish.rotation.x = Math.PI * 0.5;
    dish.rotation.z = 0.38;
    const radarSweep = new Group();
    radarSweep.name = 'aa-radar-sweep';
    radarSweep.position.set(-width * 0.28, height + height * 1.05, -depth * 0.2);
    const radarArm = new Mesh(new BoxGeometry(width * 0.42, 0.1, 0.12), signal);
    radarArm.position.x = width * 0.12;
    radarSweep.add(radarArm);
    add(radarSweep, 3);
    activity(radarSweep, 'spin-y', 1.15, 1, 0.2);
    activity(perimeterLight('aa-lock-light', width * 0.28, height + height * 1.02, depth * 0.22), 'pulse', 3.2, 1, 1.8);
    stripe(width * 0.24, depth * 0.08, 0, 0, 4);
  } else {
    stripe(width * 0.4, depth * 0.08, 0, depth * 0.12, 4);
  }

  syncDetailPartBases(parts);
  root.userData.detailParts = parts;
  root.userData.activityParts = activityParts;
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

function updateBuildingActivity(root: Group, tick: number, entityId: number, active: boolean): void {
  const parts = (root.userData.activityParts ?? []) as BuildingActivityPart[];
  const seconds = tick / 30;
  for (const part of parts) {
    const wave = Math.sin(seconds * part.speed + part.phase + entityId * 0.13);
    if (part.kind === 'pulse') {
      part.object.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          if (material instanceof MeshStandardMaterial && material.emissive.getHex() !== 0) {
            material.emissiveIntensity = active ? 0.88 + wave * 0.18 * part.amplitude : 0.12;
          } else if (material instanceof MeshBasicMaterial && material.transparent) {
            material.opacity = active ? 0.54 + wave * 0.08 * part.amplitude : 0.18;
          }
        }
      });
      continue;
    }
    if (!active) continue;
    if (part.kind === 'spin-y') part.object.rotation.y = part.baseRy + seconds * part.speed;
    else if (part.kind === 'spin-z') part.object.rotation.z = part.baseRz + seconds * part.speed;
    else if (part.kind === 'slide-x') part.object.position.x = part.baseX + wave * part.amplitude;
    else if (part.kind === 'rock-z') part.object.rotation.z = part.baseRz + wave * part.amplitude;
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
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: DoubleSide,
    blending: AdditiveBlending,
  });
  const ringMaterial = new MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
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
