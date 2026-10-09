import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Path,
  PlaneGeometry,
  RingGeometry,
  Raycaster,
  Vector2,
  Shape,
  ShapeGeometry,
  SphereGeometry,
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
import { createHullPanelTexture } from './textures';

const DEFAULT_BUILDING_HEIGHT = 5.4;
const DESTROYED_TOTAL = 20;
const COLLAPSE_SECONDS = 1.2;
const BLOCK_GAP = 0.08;
const BUILDING_PICK_PADDING_PX = 14;
const BUILDING_PICK_MIN_SIZE_PX = 38;
export const BUILDING_HEALTH_REVEAL_TICKS = 90;

const sharedBlockGeometry = new BoxGeometry(1, 1, 1);
const sharedPlaneGeometry = new PlaneGeometry(1, 1);
const sharedHealthPlane = new PlaneGeometry(1, 1);
const sharedRubbleGeometries = [
  makeRubbleGeometry(11, 0.4),
  makeRubbleGeometry(29, 0.52),
  makeRubbleGeometry(47, 0.34),
];
const sharedGeometries = new Set([
  sharedBlockGeometry,
  sharedPlaneGeometry,
  sharedHealthPlane,
  ...sharedRubbleGeometries,
]);

export class BuildingView {
  readonly group = new Group();
  private readonly objects = new Map<Entity, BuildingObject>();
  private hiddenEntity?: Entity;
  private readonly selectedGlows = new Map<Entity, SelectionGlow>();
  private readonly producerGlows = new Map<Entity, SelectionGlow>();
  private readonly producerHighlightIds = new Set<number>();
  private readonly healthBars = new Map<Entity, BuildingHealthBar>();
  private hoveredEntity?: Entity;
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
  private readonly healthBackMaterial = new MeshBasicMaterial({
    color: 0x050806,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
  });
  private readonly healthFrameMaterial = new MeshBasicMaterial({
    color: 0xd7c37a,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
  });
  private readonly healthTrackMaterial = new MeshBasicMaterial({
    color: 0x1a2420,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
  });

  private readonly accentMaterials: Record<FactionId, Material>;
  private readonly accentBoostTargets: { material: MeshStandardMaterial; base: number }[] = [];

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
    for (const material of Object.values(this.accentMaterials)) {
      if (material instanceof MeshStandardMaterial) {
        this.accentBoostTargets.push({ material, base: material.emissiveIntensity || 1 });
      }
    }
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
    this.smokeMaterial = new MeshBasicMaterial({ color: 0x2c2b28, transparent: true, opacity: 0.42, depthWrite: false, side: DoubleSide });
    this.fireMaterial = new MeshBasicMaterial({
      color: 0xff7b24,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    });
    const hullSteel = createHullPanelTexture('steel');
    const hullConcrete = createHullPanelTexture('concrete');
    const hullRust = createHullPanelTexture('rust');
    const hullDeck = createHullPanelTexture('deck');
    this.materials = {
      'command-yard': ctx.setupLitMaterial(new MeshStandardMaterial({
        color: 0xb8c0c4,
        map: hullSteel,
        roughness: 0.74,
        metalness: 0.18,
      })),
      'power-plant': ctx.setupLitMaterial(new MeshStandardMaterial({
        color: 0x6a7c8c,
        map: hullSteel,
        roughness: 0.42,
        metalness: 0.38,
      })),
      refinery: ctx.setupLitMaterial(new MeshStandardMaterial({
        color: 0xc4b49a,
        map: hullRust,
        roughness: 0.82,
        metalness: 0.1,
      })),
      barracks: ctx.setupLitMaterial(new MeshStandardMaterial({
        color: 0xb7c0a8,
        map: hullConcrete,
        roughness: 0.86,
        metalness: 0.06,
      })),
      factory: ctx.setupLitMaterial(new MeshStandardMaterial({
        color: 0xb0b8bc,
        map: hullSteel,
        roughness: 0.76,
        metalness: 0.16,
      })),
      helipad: ctx.setupLitMaterial(new MeshStandardMaterial({
        color: 0xa8b6ba,
        map: hullDeck,
        roughness: 0.8,
        metalness: 0.16,
      })),
      wall: ctx.setupLitMaterial(new MeshStandardMaterial({
        color: 0xb0b4aa,
        map: hullConcrete,
        roughness: 0.88,
        metalness: 0.08,
      })),
      'guard-tower': ctx.setupLitMaterial(new MeshStandardMaterial({
        color: 0xb4bcc2,
        map: hullSteel,
        roughness: 0.78,
        metalness: 0.16,
      })),
      'aa-tower': ctx.setupLitMaterial(new MeshStandardMaterial({
        color: 0xa8b8c4,
        map: hullSteel,
        roughness: 0.74,
        metalness: 0.2,
      })),
      'intelligence-center': ctx.setupLitMaterial(new MeshStandardMaterial({
        color: 0x86949b,
        map: hullSteel,
        roughness: 0.62,
        metalness: 0.28,
      })),
      'strategic-silo': ctx.setupLitMaterial(new MeshStandardMaterial({
        color: 0xa7aaa4,
        map: hullConcrete,
        roughness: 0.72,
        metalness: 0.18,
      })),
      'missile-defense': ctx.setupLitMaterial(new MeshStandardMaterial({
        color: 0x9babb2,
        map: hullSteel,
        roughness: 0.66,
        metalness: 0.26,
      })),
      'skylance-ciws': ctx.setupLitMaterial(new MeshStandardMaterial({
        color: 0xaab8bc,
        map: hullSteel,
        roughness: 0.58,
        metalness: 0.34,
      })),
    };
    this.ensureGhostCount(1);
  }


  setHovered(entity?: Entity): void {
    this.hoveredEntity = entity;
  }

  setAccentEmissiveMul(multiplier: number): void {
    const mul = Math.max(1, multiplier);
    for (const target of this.accentBoostTargets) target.material.emissiveIntensity = target.base * mul;
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
          skirts: false,
        });
        this.producerGlows.set(entity, producerGlow);
        this.group.add(producerGlow.root);

        if (entity.health) {
          const healthBar = createBuildingHealthBar(this.healthBackMaterial, this.healthFrameMaterial, this.healthTrackMaterial);
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
      this.updateHealthBar(entity, object, groundY, camera, fogged);
    }
    this.updateGhost(economy.placement);
  }

  setProducerHighlights(ids: Iterable<number>): void {
    this.producerHighlightIds.clear();
    for (const id of ids) this.producerHighlightIds.add(id);
  }

  private hoveredBuilding?: Entity;

  setHoveredBuilding(entity?: Entity): void {
    this.hoveredBuilding = entity;
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
    const roots = new Map<Object3D, Entity>();
    const broadBounds = new Box3();
    for (const [entity, object] of this.objects) {
      if (!entity.building || entity.destroyed || !object.root.visible) continue;
      object.root.updateWorldMatrix(true, true);
      broadBounds.setFromObject(object.root, false);
      const screen = projectBuildingHitBounds(broadBounds, camera, viewportW, viewportH, 12, 24);
      if (!screen || screenX < screen.left || screenX > screen.right || screenY < screen.top || screenY > screen.bottom) continue;
      roots.set(object.root, entity);
    }
    const hit = pickBuildingGeometry([...roots.keys()], camera, screenX, screenY, viewportW, viewportH);
    return hit ? roots.get(hit) : undefined;
  }

  private createBuildingObject(entity: Entity): BuildingObject {
    const root = new Group();
    const damage = structureDamageFor(entity);
    const kind = entity.building?.kind;
    const sharedBaseMaterial = this.materials[kind ?? 'command-yard'] ?? this.materials['command-yard'];
    const baseMaterial = createFactionBuildingMaterial(sharedBaseMaterial, factionId(entity.team?.id));
    const buildingHeight = heightForStructure(kind);
    const fullW = (entity.building?.footprint.w ?? 4) * this.hf.cellSize * 2;
    const fullD = (entity.building?.footprint.h ?? 4) * this.hf.cellSize * 2;
    const profile = normalizeBodyProfile(bodyProfileFor(kind), damage.tiers);
    const blocks: DamageBlock[] = [];
    let tierBaseY = 0;

    for (let tier = 0; tier < damage.tiers; tier++) {
      const tierProfile = profile[tier]!;
      const tierH = buildingHeight * tierProfile.heightShare;
      const tierW = fullW * tierProfile.widthScale;
      const tierD = fullD * tierProfile.depthScale;
      const blockW = tierW / damage.cols - BLOCK_GAP;
      const blockD = tierD / damage.rows - BLOCK_GAP;
      const blockH = Math.max(0.05, tierH - BLOCK_GAP);
      for (let row = 0; row < damage.rows; row++) {
        for (let col = 0; col < damage.cols; col++) {
          const index = tier * damage.cols * damage.rows + row * damage.cols + col;
          const mesh = new Mesh(sharedBlockGeometry, baseMaterial);
          const position = new Vector3(
            -tierW / 2 + (col + 0.5) * (tierW / damage.cols),
            tierBaseY + tierH * 0.5,
            -tierD / 2 + (row + 0.5) * (tierD / damage.rows),
          );
          const scale = new Vector3(blockW, blockH, blockD);
          mesh.position.copy(position);
          mesh.scale.copy(scale);
          mesh.castShadow = false;
          mesh.receiveShadow = true;
          root.add(mesh);
          blocks.push({ mesh, index, col, row, tier, basePosition: position, baseScale: scale, baseMaterial });
        }
      }
      tierBaseY += tierH;
    }

    const isTower = kind === 'guard-tower' || kind === 'aa-tower' || kind === 'missile-defense' || kind === 'skylance-ciws';
    const isPowerPlant = kind === 'power-plant';
    const accentY = isTower
      ? buildingHeight * profile[0]!.heightShare + 0.16
      : buildingHeight + (isPowerPlant ? 0.42 : 0.16);
    const accentZ = isTower ? fullD * 0.48 : fullD * (isPowerPlant ? 0.36 : 0.4);
    const accent = new Mesh(
      new BoxGeometry(fullW * (isTower ? 0.42 : 0.5), 0.22, Math.max(0.5, fullD * 0.12)),
      this.accentMaterials[factionId(entity.team?.id)],
    );
    // Towers keep the identity plate on the plinth front edge; other buildings
    // keep it on a clear roof edge so roof machinery does not hide it. The
    // power plant needs extra clearance for its larger roof equipment.
    accent.position.set(0, accentY, accentZ);
    accent.castShadow = true;
    const label = createBuildingLabel(entity.building?.label ?? entity.name ?? 'Building', fullW * (isTower ? 0.42 : 0.5), Math.max(0.5, fullD * 0.12), buildingHeight);
    label.position.copy(accent.position);
    // The label plane needs a meaningful gap above the accent box; a 2 cm
    // separation is below depth-buffer precision at far RTS zoom levels.
    label.position.y += 0.23;
    label.position.z += 0.01;
    root.add(accent, label);
    const details = createBuildingDetails(entity, fullW, fullD, buildingHeight, this.accentMaterials[factionId(entity.team?.id)]);
    // Tiny trim, pipes and windows do not need separate draws in every cascaded
    // shadow map. Keep their normal shading and let the main body cast shadows.
    details.traverse((part) => { if (part instanceof Mesh) part.castShadow = false; });
    // One hidden-color envelope supplies the building's coarse shadow instead
    // of drawing every damage cell or decoration into each cascade.
    const shadowEnvelope = new Mesh(sharedBlockGeometry, new MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    shadowEnvelope.name = 'building-shadow-envelope';
    shadowEnvelope.scale.set(fullW, buildingHeight, fullD);
    shadowEnvelope.position.y = buildingHeight * 0.5;
    shadowEnvelope.castShadow = true;
    shadowEnvelope.raycast = () => {};
    root.add(shadowEnvelope);
    root.add(details);
    const turretPivot = details.userData.turretPivot as Group | undefined;
    const refineryDock = entity.building?.kind === 'refinery' ? createRefineryDock(fullW, fullD, buildingHeight) : undefined;
    if (refineryDock) root.add(refineryDock.root);
    root.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(root);

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
      chromeLift: Math.max(buildingHeight + 1.9, bounds.max.y + 1.7),
      lastHealth: entity.health?.current ?? 0,
      lastDamageTick: -9999,
      impactPunch: 0,
    };
  }

  private applyDamageDressing(entity: Entity, object: BuildingObject): void {
    const damage = structureDamageFor(entity);
    const level = damageLevel(entity);
    const destroyedRemaining = entity.destroyed?.remaining;
    const needsCollapseFrame = destroyedRemaining !== undefined && destroyedRemaining > DESTROYED_TOTAL - COLLAPSE_SECONDS - 0.1;
    if (object.appliedVersion === damage.version && object.appliedLevel === level && !needsCollapseFrame) return;

    const versionChanged = object.appliedVersion !== damage.version && damage.version > 0;
    object.appliedVersion = damage.version;
    object.appliedLevel = level;
    object.leanX = 0;
    object.leanZ = 0;
    object.collapsed = Boolean(entity.destroyed);
    if (versionChanged) object.impactPunch = 1;
    this.clearEffects(object);

    const worst = worstBlocks(object.blocks, damage, 8);
    const lean = damageVector(damage);
    if (level >= 8) {
      object.leanX = lean.z * 0.035;
      object.leanZ = -lean.x * 0.035;
    }

    let debrisBudget = 8;
    for (const block of object.blocks) {
      const value = damage.cells[block.index] ?? 0;
      resetBlock(block);
      if (entity.destroyed) {
        dressCollapsedBlock(entity, block, this.rubbleMaterial, destroyedRemaining ?? 0);
        continue;
      }
      const kind = blockDressKind(value, level, level >= 8 && isCornerCell(damage, block));
      if (level >= 9 && block.tier === damage.tiers - 1 && value > 62) dressRemovedBlock(block, this.interiorMaterial);
      else if (kind === 'removed') dressRemovedBlock(block, this.interiorMaterial);
      else if (kind === 'rubble') dressRubbleBlock(entity, block, this.rubbleMaterial);
      else if (kind === 'shrunk') dressShrunkBlock(entity, block, this.crackMaterial);
      else if (kind === 'cracked') dressCrackedBlock(entity, block, this.crackMaterial);
      else if (kind === 'scorched') dressScorchedBlock(entity, block, this.scorchMaterial);
      if (level >= 7 && block.tier > 0 && supportCellBroken(damage, block)) {
        block.mesh.position.y -= block.baseScale.y * 0.18;
        block.mesh.rotation.x += deterministicSigned(block.index, entity.id, 0x57) * 0.1;
        block.mesh.rotation.z += deterministicSigned(block.index, entity.id, 0x58) * 0.1;
      }
      if (debrisBudget > 0 && value >= 58) {
        this.addDebrisChip(entity, object, block, damage, value);
        debrisBudget--;
      }
    }

    for (const accent of object.accents) accent.visible = level < 4 && !entity.destroyed;
    updateBuildingDetails(object.details, damage, level, Boolean(entity.destroyed));

    const hasLocalizedDamage = worst.some((cell) => cell.value > 0);
    const scarCount = Math.min(worst.length, level >= 7 ? 6 : level >= 3 ? 5 : 4);
    const smokeCount = !hasLocalizedDamage ? 0 : level >= 9 ? 5 : level >= 7 ? 4 : level >= 4 ? 3 : 2;
    const fireCount = level >= 9 ? 4 : level >= 7 ? 3 : level >= 5 ? 2 : worst.some((cell) => cell.value >= 128) ? 1 : 0;
    const emberCount = level >= 8 ? 4 : level >= 5 ? 3 : level >= 2 ? 2 : hasLocalizedDamage ? 1 : 0;
    for (let i = 0; i < scarCount; i++) this.addEffect(entity, object, worst[i], 'scar', level, damage);
    for (let i = 0; i < Math.min(smokeCount, worst.length); i++) this.addEffect(entity, object, worst[i], 'smoke', level, damage);
    for (let i = 0; i < Math.min(fireCount, worst.length); i++) this.addEffect(entity, object, worst[i], 'fire', level, damage);
    for (let i = 0; i < Math.min(emberCount, worst.length); i++) this.addEffect(entity, object, worst[i], 'ember', level, damage);
    if (versionChanged) {
      for (let i = 0; i < Math.min(2, worst.length); i++) this.addEffect(entity, object, worst[i], 'flash', level, damage);
    }
  }

  private addDebrisChip(entity: Entity, object: BuildingObject, block: DamageBlock, damage: StructureDamage, value: number): void {
    const outward = facadeOutward(block, damage);
    const mesh = new Mesh(rubbleGeometryFor(block.index, entity.id), this.rubbleMaterial);
    const size = 0.28 + (value / 255) * 0.55;
    mesh.scale.set(
      size * (0.7 + hash2i(block.index, entity.id, 0xd11) * 0.5),
      size * (0.35 + hash2i(block.index, entity.id, 0xd12) * 0.4),
      size * (0.7 + hash2i(block.index, entity.id, 0xd13) * 0.5),
    );
    mesh.position.set(
      block.basePosition.x + outward.x * (block.baseScale.x * 0.62 + 0.2),
      0.16 + hash2i(block.index, entity.id, 0xd14) * 0.28,
      block.basePosition.z + outward.z * (block.baseScale.z * 0.62 + 0.2),
    );
    mesh.rotation.set(
      deterministicSigned(block.index, entity.id, 0xd15) * 0.8,
      hash2i(block.index, entity.id, 0xd16) * Math.PI,
      deterministicSigned(block.index, entity.id, 0xd17) * 0.8,
    );
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    object.root.add(mesh);
    object.effects.push({
      mesh,
      kind: 'debris',
      basePosition: mesh.position.clone(),
      baseScale: size,
      phase: hash2i(block.index, entity.id, 0xd18) * Math.PI * 2,
    });
  }

  private addEffect(entity: Entity, object: BuildingObject, cell: DamageCell, kind: DamageEffectKind, level: number, damage: StructureDamage): void {
    const material =
      kind === 'smoke'
        ? this.smokeMaterial.clone()
        : kind === 'fire'
          ? this.fireMaterial.clone()
          : kind === 'ember'
            ? this.emberSpotMaterial.clone()
            : kind === 'flash'
              ? this.emberSpotMaterial.clone()
              : this.scarMaterial.clone();
    const mesh = new Mesh(sharedPlaneGeometry, material);
    const severity = Math.max(0.2, Math.min(1, cell.value / 180));
    const size =
      kind === 'smoke'
        ? 2.1 + level * 0.28
        : kind === 'fire'
          ? 1.55 + level * 0.14
          : kind === 'ember'
            ? 0.7 + severity * 0.9
            : kind === 'flash'
              ? 1.8 + severity * 1.1
              : 1.45 + severity * 1.7;
    const block = object.blocks.find((candidate) => candidate.index === cell.index);
    const outward = block ? facadeOutward(block, damage) : { x: 0, z: 1 };
    mesh.scale.set(kind === 'fire' || kind === 'smoke' ? size * 0.82 : size, kind === 'fire' ? size * 1.35 : size, size);
    if (kind === 'scar') {
      mesh.position.set(
        cell.position.x + outward.x * ((block?.baseScale.x ?? 1) * 0.52 + 0.04),
        cell.position.y,
        cell.position.z + outward.z * ((block?.baseScale.z ?? 1) * 0.52 + 0.04),
      );
      mesh.rotation.y = Math.atan2(outward.x, outward.z);
    } else {
      mesh.position.set(cell.position.x, cell.position.y + (kind === 'smoke' ? 1.85 : kind === 'fire' ? 1.05 : kind === 'flash' ? 0.2 : 0.1), cell.position.z);
      mesh.rotation.x = kind === 'ember' || kind === 'flash' ? -Math.PI / 2 : 0;
      mesh.rotation.z = kind === 'ember' ? hash2i(cell.index, entity.id, 0xe9) * Math.PI : 0;
    }
    mesh.renderOrder = kind === 'smoke' ? 26 : kind === 'fire' ? 27 : kind === 'flash' ? 29 : 28;
    object.root.add(mesh);
    object.effects.push({
      mesh,
      kind,
      basePosition: mesh.position.clone(),
      baseScale: size,
      phase: hash2i(cell.index, entity.id, kind === 'smoke' ? 0x5a10 : 0xf117) * Math.PI * 2,
    });
  }

  private clearEffects(object: BuildingObject): void {
    for (const effect of object.effects) {
      object.root.remove(effect.mesh);
      const materials = Array.isArray(effect.mesh.material) ? effect.mesh.material : [effect.mesh.material];
      for (const material of materials) {
        if (this.isSharedMaterial(material)) continue;
        material.dispose();
      }
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
      m === this.healthFrameMaterial ||
      m === this.healthTrackMaterial ||
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
      if (!sharedGeometries.has(child.geometry)) child.geometry.dispose();
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
    if (object.impactPunch > 0) object.impactPunch = Math.max(0, object.impactPunch - 0.07);
    for (const effect of object.effects) {
      const wave = Math.sin(this.sim.tick * 0.12 + effect.phase);
      if (effect.kind === 'debris') continue;
      effect.mesh.position.copy(effect.basePosition);
      if (effect.kind === 'smoke') {
        effect.mesh.position.y += 0.7 + wave * 0.28;
        const material = effect.mesh.material as MeshBasicMaterial;
        material.opacity = entity.destroyed ? 0.5 : 0.28 + 0.14 * (wave + 1);
        effect.mesh.scale.set(effect.baseScale * (1 + wave * 0.04), effect.baseScale * (1.15 + wave * 0.06), effect.baseScale);
      } else if (effect.kind === 'fire') {
        effect.mesh.position.y += wave * 0.12;
        const material = effect.mesh.material as MeshBasicMaterial;
        material.opacity = 0.58 + 0.28 * (wave + 1);
        effect.mesh.scale.set(effect.baseScale * 0.85, effect.baseScale * (1.25 + wave * 0.12), effect.baseScale);
      } else if (effect.kind === 'ember') {
        const material = effect.mesh.material as MeshBasicMaterial;
        material.opacity = 0.34 + 0.3 * (wave + 1);
        effect.mesh.scale.setScalar(effect.baseScale * (1 + wave * 0.04));
      } else if (effect.kind === 'flash') {
        const material = effect.mesh.material as MeshBasicMaterial;
        material.opacity = 0.15 + object.impactPunch * 0.7;
        effect.mesh.scale.setScalar(effect.baseScale * (0.85 + object.impactPunch * 0.45));
        effect.mesh.visible = object.impactPunch > 0.02;
      } else {
        const material = effect.mesh.material as MeshBasicMaterial;
        material.opacity = entity.destroyed ? 0.7 : 0.52 + 0.08 * (wave + 1);
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

  private updateHealthBar(entity: Entity, object: BuildingObject, groundY: number, camera: Camera, fogged: boolean): void {
    const healthBar = this.healthBars.get(entity);
    if (!healthBar || !entity.health || !entity.building) return;
    if (entity.health.current < object.lastHealth - 0.01) object.lastDamageTick = this.sim.tick;
    object.lastHealth = entity.health.current;
    if (fogged) {
      healthBar.root.visible = false;
      return;
    }
    const pct = Math.max(0, Math.min(1, entity.health.current / entity.health.max));
    const selected = entity.selectable?.selected ?? false;
    const hovered = this.hoveredEntity === entity;
    const ticksSinceDamage = this.sim.tick - object.lastDamageTick;
    healthBar.root.visible = buildingHealthBarVisible({
      fogged: false,
      destroyed: Boolean(entity.destroyed),
      selected,
      hovered,
      pct,
      ticksSinceDamage,
    });
    if (!healthBar.root.visible) return;
    const barWidth = Math.max(7.4, Math.max(entity.building.footprint.w, entity.building.footprint.h) * this.hf.cellSize * 1.05);
    const barHeight = 0.82;
    const recentHit = ticksSinceDamage >= 0 && ticksSinceDamage <= 24;
    const pulse = recentHit ? 1 + Math.sin(this.sim.tick * 0.9) * 0.04 : 1;
    healthBar.root.position.set(entity.transform.x, groundY + object.chromeLift, entity.transform.z);
    healthBar.root.lookAt(camera.position);
    healthBar.frame.scale.set(barWidth * pulse, barHeight * pulse, 1);
    healthBar.back.scale.set(barWidth * 0.97, barHeight * 0.78, 1);
    healthBar.track.scale.set(barWidth * 0.93, barHeight * 0.46, 1);
    const fillWidth = barWidth * 0.93 * Math.max(0.02, pct);
    healthBar.fill.scale.set(fillWidth, barHeight * 0.42, 1);
    healthBar.fill.position.set(-barWidth * 0.465 + fillWidth * 0.5, 0, 0.04);
    healthBar.fillMaterial.color.setHex(pct < 0.3 ? 0xff5142 : pct < 0.62 ? 0xffc04a : 0x79f06f);
  }

  private updateSelectionGlow(entity: Entity, groundY: number): void {
    const glow = this.selectedGlows.get(entity);
    if (!glow) return;
    const selected = (entity.selectable?.selected ?? false) && !entity.destroyed;
    const hovered = entity === this.hoveredBuilding && !entity.destroyed;
    glow.root.visible = selected || hovered;
    if (!selected && !hovered) return;
    const pulse = 0.5 + 0.5 * Math.sin(this.sim.tick * 0.16 + entity.id * 0.7);
    glow.root.position.set(entity.transform.x, groundY, entity.transform.z);
    glow.ringMaterial.opacity = selected ? 0.72 + pulse * 0.22 : 0.48;
    if (glow.skirtMaterial) glow.skirtMaterial.opacity = selected ? 0.34 + pulse * 0.28 : 0.14;
  }

  private updateProducerGlow(entity: Entity, groundY: number): void {
    const glow = this.producerGlows.get(entity);
    if (!glow) return;
    const highlighted =
      this.producerHighlightIds.has(entity.id) &&
      !entity.destroyed &&
      entity.building?.complete &&
      entity.building.kind !== 'command-yard';
    glow.root.visible = !!highlighted;
    if (!highlighted) return;
    const pulse = 0.5 + 0.5 * Math.sin(this.sim.tick * 0.22 + entity.id * 0.41);
    glow.root.position.set(entity.transform.x, groundY, entity.transform.z);
    glow.ringMaterial.opacity = 0.52 + pulse * 0.24;
    if (glow.skirtMaterial) glow.skirtMaterial.opacity = 0.22 + pulse * 0.2;
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

/** Pick visible surfaces, rather than the empty space inside a projected box. */
export function pickBuildingGeometry(
  roots: Object3D[], camera: Camera, x: number, y: number, width: number, height: number,
): Object3D | undefined {
  if (width <= 0 || height <= 0) return undefined;
  const ray = new Raycaster();
  const point = new Vector2();
  // Exact cursor hit wins. A small edge allowance helps at normal RTS zoom.
  for (const [dx, dy] of [[0, 0], [-5, 0], [5, 0], [0, -5], [0, 5], [-5, -5], [5, -5], [-5, 5], [5, 5], [-10, 0], [10, 0], [0, -10], [0, 10]]) {
    point.set((x + dx) / width * 2 - 1, 1 - (y + dy) / height * 2);
    ray.setFromCamera(point, camera);
    for (const hit of ray.intersectObjects(roots, true)) {
      let node: Object3D | null = hit.object;
      let root: Object3D | undefined;
      let visible = true;
      while (node) {
        if (!node.visible) visible = false;
        if (roots.includes(node)) root = node;
        node = node.parent;
      }
      if (visible && root) return root;
    }
  }
  return undefined;
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

interface BuildingHealthBar {
  root: Group;
  fill: Mesh;
  fillMaterial: MeshBasicMaterial;
  back: Mesh;
  frame: Mesh;
  track: Mesh;
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
  chromeLift: number;
  lastHealth: number;
  lastDamageTick: number;
  impactPunch: number;
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

type DamageEffectKind = 'scar' | 'ember' | 'smoke' | 'fire' | 'flash' | 'debris';

interface DamageCell {
  index: number;
  value: number;
  position: Vector3;
}

interface SelectionGlow {
  root: Group;
  ring: Mesh;
  skirts: Mesh[];
  ringMaterial: MeshBasicMaterial;
  skirtMaterial?: MeshBasicMaterial;
}

function structureDamageFor(entity: Entity): StructureDamage {
  if (!entity.structureDamage) {
    const kind = entity.building?.kind;
    const tiers = kind === 'guard-tower' || kind === 'aa-tower' || kind === 'missile-defense' || kind === 'skylance-ciws' ? 3 : 2;
    return { cols: 3, rows: 3, tiers, cells: new Uint8Array(3 * 3 * tiers), version: 0 };
  }
  return entity.structureDamage;
}

interface BodyTierProfile {
  widthScale: number;
  depthScale: number;
  heightShare: number;
}

function bodyProfileFor(kind?: string): BodyTierProfile[] | undefined {
  if (kind === 'guard-tower' || kind === 'aa-tower' || kind === 'missile-defense' || kind === 'skylance-ciws') {
    return [
      { widthScale: 1, depthScale: 1, heightShare: 0.2 },
      { widthScale: 0.42, depthScale: 0.42, heightShare: 0.45 },
      { widthScale: 0.58, depthScale: 0.58, heightShare: 0.35 },
    ];
  }
  if (kind === 'command-yard') {
    return [
      { widthScale: 1, depthScale: 1, heightShare: 0.58 },
      { widthScale: 0.78, depthScale: 0.82, heightShare: 0.42 },
    ];
  }
  if (kind === 'barracks') {
    return [
      { widthScale: 0.9, depthScale: 0.82, heightShare: 0.8 },
      { widthScale: 0.68, depthScale: 0.82, heightShare: 0.2 },
    ];
  }
  if (kind === 'factory') {
    return [
      { widthScale: 1, depthScale: 1, heightShare: 0.52 },
      { widthScale: 0.72, depthScale: 0.78, heightShare: 0.48 },
    ];
  }
  if (kind === 'refinery') {
    return [
      { widthScale: 1, depthScale: 1, heightShare: 0.48 },
      { widthScale: 0.68, depthScale: 0.74, heightShare: 0.52 },
    ];
  }
  if (kind === 'helipad') {
    return [
      { widthScale: 1, depthScale: 1, heightShare: 0.7 },
      { widthScale: 0.96, depthScale: 0.96, heightShare: 0.3 },
    ];
  }
  if (kind === 'power-plant') {
    return [
      { widthScale: 1, depthScale: 1, heightShare: 0.62 },
      { widthScale: 0.84, depthScale: 0.84, heightShare: 0.38 },
    ];
  }
  return undefined;
}

function normalizeBodyProfile(profile: BodyTierProfile[] | undefined, tiers: number): BodyTierProfile[] {
  if (!profile || profile.length === 0) {
    const share = 1 / Math.max(1, tiers);
    return Array.from({ length: tiers }, () => ({ widthScale: 1, depthScale: 1, heightShare: share }));
  }
  if (profile.length === tiers) return profile;
  const shares = profile.map((tier) => tier.heightShare);
  const total = shares.reduce((sum, value) => sum + value, 0) || 1;
  const scaled = profile.map((tier) => ({ ...tier, heightShare: tier.heightShare / total }));
  if (scaled.length > tiers) return scaled.slice(0, tiers);
  const padShare = scaled.reduce((sum, tier) => sum + tier.heightShare, 0);
  const remaining = Math.max(0, 1 - padShare);
  const extra = tiers - scaled.length;
  for (let i = 0; i < extra; i++) {
    scaled.push({ widthScale: 1, depthScale: 1, heightShare: remaining / extra });
  }
  return scaled;
}

export type BlockDressKind = 'intact' | 'scorched' | 'cracked' | 'shrunk' | 'rubble' | 'removed';

export function blockDressKind(value: number, level: number, cornerCollapse = false): BlockDressKind {
  if (value >= 182) return 'removed';
  if (value >= 128 || (cornerCollapse && value >= 86)) return 'rubble';
  if (value >= 58) return 'shrunk';
  if (value >= 18 || (level >= 2 && value >= 8)) return 'cracked';
  if (value > 0) return 'scorched';
  return 'intact';
}

export function buildingHealthBarVisible(state: {
  fogged: boolean;
  destroyed: boolean;
  selected: boolean;
  hovered: boolean;
  pct: number;
  ticksSinceDamage: number;
}): boolean {
  if (state.fogged || state.destroyed) return false;
  if (state.selected || state.hovered) return true;
  if (state.pct < 0.995) return true;
  return state.ticksSinceDamage >= 0 && state.ticksSinceDamage <= BUILDING_HEALTH_REVEAL_TICKS;
}

export function detailWoundFromGrid(
  damage: StructureDamage,
  x: number,
  y: number,
  z: number,
  fullW: number,
  fullD: number,
  height: number,
): number {
  if (damage.cols <= 0 || damage.rows <= 0 || damage.tiers <= 0) return 0;
  const col = Math.max(0, Math.min(damage.cols - 1, Math.floor((x / Math.max(0.001, fullW) + 0.5) * damage.cols)));
  const row = Math.max(0, Math.min(damage.rows - 1, Math.floor((z / Math.max(0.001, fullD) + 0.5) * damage.rows)));
  const tier = Math.max(0, Math.min(damage.tiers - 1, Math.floor((y / Math.max(0.001, height)) * damage.tiers)));
  let max = 0;
  for (let t = Math.max(0, tier - 1); t <= Math.min(damage.tiers - 1, tier + 1); t++) {
    for (let r = Math.max(0, row - 1); r <= Math.min(damage.rows - 1, row + 1); r++) {
      for (let c = Math.max(0, col - 1); c <= Math.min(damage.cols - 1, col + 1); c++) {
        max = Math.max(max, damage.cells[t * damage.cols * damage.rows + r * damage.cols + c] ?? 0);
      }
    }
  }
  return max;
}

function damageLevel(entity: Entity): number {
  if (entity.destroyed) return 10;
  if (!entity.health) return 0;
  return Math.max(0, Math.min(10, Math.ceil(10 * (1 - entity.health.current / entity.health.max))));
}

function resetBlock(block: DamageBlock): void {
  block.mesh.visible = true;
  block.mesh.geometry = sharedBlockGeometry;
  block.mesh.material = block.baseMaterial;
  block.mesh.position.copy(block.basePosition);
  block.mesh.scale.copy(block.baseScale);
  block.mesh.rotation.set(0, 0, 0);
}

function dressScorchedBlock(entity: Entity, block: DamageBlock, material: Material): void {
  block.mesh.material = material;
  block.mesh.scale.set(block.baseScale.x * 0.9, block.baseScale.y * 0.97, block.baseScale.z * 0.9);
  block.mesh.position.y -= block.baseScale.y * 0.04;
  block.mesh.rotation.x = deterministicSigned(block.index, entity.id, 0xb1) * 0.05;
  block.mesh.rotation.z = deterministicSigned(block.index, entity.id, 0xb2) * 0.05;
}

function dressCrackedBlock(entity: Entity, block: DamageBlock, material: Material): void {
  block.mesh.material = material;
  block.mesh.scale.set(block.baseScale.x * 0.82, block.baseScale.y * 0.9, block.baseScale.z * 0.82);
  block.mesh.position.y -= block.baseScale.y * 0.07;
  block.mesh.rotation.x = deterministicSigned(block.index, entity.id, 0xc1) * 0.1;
  block.mesh.rotation.z = deterministicSigned(block.index, entity.id, 0xc2) * 0.1;
}

function dressShrunkBlock(entity: Entity, block: DamageBlock, material: Material): void {
  block.mesh.material = material;
  const shrink = 0.68 + hash2i(block.index, entity.id, 0x120) * 0.08;
  block.mesh.scale.set(block.baseScale.x * shrink, block.baseScale.y * 0.62, block.baseScale.z * shrink);
  block.mesh.position.y -= block.baseScale.y * 0.18;
  block.mesh.rotation.x = deterministicSigned(block.index, entity.id, 0x121) * 0.18;
  block.mesh.rotation.z = deterministicSigned(block.index, entity.id, 0x122) * 0.18;
}

function dressRubbleBlock(entity: Entity, block: DamageBlock, material: Material): void {
  block.mesh.geometry = rubbleGeometryFor(block.index, entity.id);
  block.mesh.material = material;
  block.mesh.scale.set(block.baseScale.x * 0.95, block.baseScale.y * 0.38, block.baseScale.z * 0.9);
  block.mesh.position.y = Math.max(block.baseScale.y * 0.16, block.basePosition.y - block.baseScale.y * 0.42);
  block.mesh.rotation.x = deterministicSigned(block.index, entity.id, 0x211) * 0.42;
  block.mesh.rotation.y = hash2i(block.index, entity.id, 0x212) * Math.PI;
  block.mesh.rotation.z = deterministicSigned(block.index, entity.id, 0x213) * 0.42;
}

function dressRemovedBlock(block: DamageBlock, interior: Material): void {
  block.mesh.material = interior;
  block.mesh.visible = true;
  block.mesh.scale.set(block.baseScale.x * 0.42, block.baseScale.y * 0.38, block.baseScale.z * 0.42);
  block.mesh.position.y = block.basePosition.y - block.baseScale.y * 0.22;
}

function dressCollapsedBlock(entity: Entity, block: DamageBlock, material: Material, remaining: number): void {
  const since = Math.max(0, DESTROYED_TOTAL - remaining);
  const delay = block.tier === 0 ? 0.18 : 0;
  const t = Math.max(0, Math.min(1, (since - delay - hash2i(block.index, entity.id, 0xdead) * 0.18) / COLLAPSE_SECONDS));
  const fall = t * t;
  if (t > 0.45) block.mesh.geometry = rubbleGeometryFor(block.index, entity.id);
  block.mesh.material = material;
  const driftX = deterministicSigned(block.index, entity.id, 0xd1) * block.baseScale.x * 0.62 * fall;
  const driftZ = deterministicSigned(block.index, entity.id, 0xd2) * block.baseScale.z * 0.62 * fall;
  block.mesh.position.set(block.basePosition.x + driftX, Math.max(0.16, block.basePosition.y - fall * (block.basePosition.y + 0.45)), block.basePosition.z + driftZ);
  block.mesh.scale.set(block.baseScale.x * (1 - fall * 0.28), block.baseScale.y * (1 - fall * 0.58), block.baseScale.z * (1 - fall * 0.28));
  block.mesh.rotation.x = deterministicSigned(block.index, entity.id, 0xd3) * fall * 1.35;
  block.mesh.rotation.y = deterministicSigned(block.index, entity.id, 0xd4) * fall * 1.7;
  block.mesh.rotation.z = deterministicSigned(block.index, entity.id, 0xd5) * fall * 1.35;
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

function makeRubbleGeometry(seed: number, flatten: number): IcosahedronGeometry {
  const geometry = new IcosahedronGeometry(0.5, 1);
  const pos = geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const k = 0.72 + hash2i(i, seed, 0x51) * 0.5;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * flatten, pos.getZ(i) * k);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function rubbleGeometryFor(index: number, id: number): IcosahedronGeometry {
  return sharedRubbleGeometries[Math.floor(hash2i(index, id, 0x90b) * sharedRubbleGeometries.length) % sharedRubbleGeometries.length];
}

function facadeOutward(block: DamageBlock, damage: StructureDamage): { x: number; z: number } {
  const edgeX = block.col <= 0 ? -1 : block.col >= damage.cols - 1 ? 1 : 0;
  const edgeZ = block.row <= 0 ? -1 : block.row >= damage.rows - 1 ? 1 : 0;
  if (edgeX === 0 && edgeZ === 0) {
    const cx = (damage.cols - 1) * 0.5;
    const cz = (damage.rows - 1) * 0.5;
    const x = block.col - cx;
    const z = block.row - cz;
    const len = Math.hypot(x, z) || 1;
    return { x: x / len, z: z / len };
  }
  const len = Math.hypot(edgeX, edgeZ) || 1;
  return { x: edgeX / len, z: edgeZ / len };
}

function heightForStructure(kind?: string): number {
  if (kind === 'wall') return 2.6;
  if (kind === 'guard-tower' || kind === 'aa-tower') return 10.5;
  if (kind === 'missile-defense') return 8.4;
  if (kind === 'skylance-ciws') return 5.6;
  if (kind === 'intelligence-center') return 6.6;
  if (kind === 'strategic-silo') return 4.4;
  if (kind === 'helipad') return 4.8;
  if (kind === 'refinery') return 6.8;
  if (kind === 'factory') return 7.0;
  if (kind === 'command-yard') return 7.2;
  if (kind === 'barracks') return 4.2;
  if (kind === 'power-plant') return 6.0;
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

  const isDefenseTower = kind === 'guard-tower' || kind === 'aa-tower' || kind === 'missile-defense' || kind === 'skylance-ciws';
  box('foundation', width * (isDefenseTower ? 1.02 : 1.06), 0.38, depth * (isDefenseTower ? 1.02 : 1.06), 0, 0.18, 0, dark, 10);
  if (kind !== 'wall' && kind !== 'power-plant' && !isDefenseTower) {
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
    box('hq-operations-wing', width * 0.64, height * 0.34, depth * 0.6, -width * 0.12, height * 1.17, 0, concrete, 7);
    box('hq-roof-overhang', width * 0.72, 0.24, depth * 0.68, -width * 0.12, height * 1.36, 0, roof, 6);
    box('hq-observation-window', width * 0.54, height * 0.13, 0.12, -width * 0.12, height * 1.19, depth * 0.305, glass, 4);
    frontPanel('hq-armored-entry', width * 0.2, height * 0.5, -width * 0.2, height * 0.26, dark, 7);
    box('hq-entry-hood', width * 0.3, 0.2, depth * 0.22, -width * 0.2, height * 0.57, depth * 0.5, accentMaterial, 5);
    cyl('hq-radio-mast', 0.08, 0.12, height * 0.9, width * 0.3, height * 1.45, -depth * 0.24, metal, 4, 8);
    box('hq-radio-crossbar', width * 0.3, 0.1, 0.1, width * 0.3, height * 1.83, -depth * 0.24, metal, 4);
  } else if (kind === 'power-plant') {
    // Twin cooling towers replace the elaborate animated reactor assembly.
    for (const x of [-width * 0.24, width * 0.24]) {
      cyl('power-cooling-tower', width * 0.16, width * 0.22, height * 0.9, x, height * 1.35, 0, concrete, 7, 10);
      cyl('power-tower-opening', width * 0.13, width * 0.13, 0.08, x, height * 1.805, 0, dark, 5, 10);
      cyl('power-tower-collar', width * 0.175, width * 0.175, 0.16, x, height * 1.77, 0, metal, 6, 10);
    }
    frontPanel('power-turbine-grille', width * 0.65, height * 0.45, 0, height * 0.45, dark, 7);
    for (const x of [-width * 0.24, -width * 0.08, width * 0.08, width * 0.24]) {
      frontPanel('power-intake-slat', width * 0.025, height * 0.4, x, height * 0.45, metal, 5);
    }
    box('power-service-cap', width * 0.9, 0.22, depth * 0.18, 0, height, depth * 0.36, warning, 6);
  } else if (kind === 'refinery') {
    // Storage drums and exposed process pipes read as a resource facility.
    for (const x of [-width * 0.26, width * 0.22]) {
      cyl('refinery-storage-tank', width * 0.19, width * 0.19, height * 0.65, x, height * 1.32, -depth * 0.1, metal, 7, 12);
      cyl('refinery-tank-cap', width * 0.2, width * 0.2, 0.18, x, height * 1.66, -depth * 0.1, roof, 6, 12);
      cyl('refinery-team-band', width * 0.192, width * 0.192, 0.22, x, height * 1.4, -depth * 0.1, accentMaterial, 5, 12);
    }
    box('refinery-pipe-bridge', width * 0.64, 0.3, 0.3, 0, height * 1.15, depth * 0.24, brass, 5);
    cyl('refinery-distillation-stack', width * 0.065, width * 0.08, height * 1.25, width * 0.36, height * 1.6, depth * 0.26, metal, 5, 8);
    frontPanel('refinery-collector-dock', width * 0.52, height * 0.55, -width * 0.12, height * 0.32, dark, 8);
    box('refinery-dock-header', width * 0.58, 0.22, 0.28, -width * 0.12, height * 0.64, depth * 0.52, warning, 5);
  } else if (kind === 'barracks') {
    // Low troop quarters: a full pitched roof and a clearly human-sized entry.
    // Fixed primitive meshes only; no new effects or animation work.
    for (const side of [-1, 1]) {
      box('barracks-pitched-roof', width * 0.52, 0.24, depth * 0.94,
        side * width * 0.23, height + width * 0.055, 0, roof, 5).rotation.z = -side * 0.24;
    }
    box('barracks-ridge', 0.18, 0.2, depth * 0.96, 0, height + width * 0.115, 0, metal, 5);
    frontPanel('barracks-personnel-entry', width * 0.14, height * 0.62, -width * 0.24, height * 0.32, dark, 6);
    box('barracks-entry-porch', width * 0.24, 0.18, depth * 0.24, -width * 0.24, height * 0.7, depth * 0.48, accentMaterial, 4);
    for (const x of [0, width * 0.16, width * 0.32]) {
      frontPanel('barracks-window', width * 0.1, height * 0.2, x, height * 0.6, glass, 4);
    }
    box('barracks-step', width * 0.24, 0.24, depth * 0.18, -width * 0.24, 0.12, depth * 0.5, concrete, 6);
    cyl('barracks-flagpole', 0.055, 0.055, height * 1.9, width * 0.4, height * 0.95, depth * 0.38, metal, 4, 6);
    box('barracks-unit-banner', width * 0.2, height * 0.36, 0.06, width * 0.3, height * 1.7, depth * 0.38, accentMaterial, 4);
  } else if (kind === 'factory') {
    // Vehicle assembly hall: broad loading bay, sawtooth roof and twin exhausts.
    frontPanel('factory-vehicle-bay', width * 0.7, height * 0.7, 0, height * 0.38, dark, 8);
    for (const x of [-width * 0.37, width * 0.37]) {
      box('factory-bay-jamb', width * 0.045, height * 0.76, 0.3, x, height * 0.4, depth * 0.515, warning, 6);
    }
    box('factory-bay-header', width * 0.78, 0.3, 0.32, 0, height * 0.8, depth * 0.515, warning, 6);
    for (const z of [-depth * 0.26, 0, depth * 0.26]) {
      box('factory-sawtooth-roof', width * 0.82, 0.22, depth * 0.3, 0, height + 0.6, z, roof, 5).rotation.x = -0.25;
      box('factory-clerestory', width * 0.72, 0.65, 0.12, 0, height + 0.45, z - depth * 0.14, glass, 4);
    }
    for (const z of [-depth * 0.28, depth * 0.05]) {
      cyl('factory-exhaust-stack', width * 0.045, width * 0.06, height * 0.85, width * 0.4, height * 1.35, z, metal, 5, 8);
    }
    box('factory-loading-apron', width * 0.7, 0.14, depth * 0.25, 0, 0.07, depth * 0.5, metal, 7);
    for (const x of [-width * 0.22, width * 0.22]) {
      box('factory-track-guide', width * 0.04, 0.04, depth * 0.25, x, 0.16, depth * 0.5, warning, 4);
    }
  } else if (kind === 'helipad') {
    box('helipad-flight-deck', width * 1.02, 0.3, depth * 1.02, 0, height + 0.15, 0, roof, 7);
    box('helipad-h-left', width * 0.08, 0.04, depth * 0.48, -width * 0.16, height + 0.32, 0, warning, 4);
    box('helipad-h-right', width * 0.08, 0.04, depth * 0.48, width * 0.16, height + 0.32, 0, warning, 4);
    box('helipad-h-middle', width * 0.4, 0.04, depth * 0.07, 0, height + 0.32, 0, warning, 4);
    box('helipad-control-cabin', width * 0.25, height * 0.48, depth * 0.23, -width * 0.32, height * 1.28, -depth * 0.32, concrete, 6);
    box('helipad-control-glass', width * 0.23, height * 0.16, 0.1, -width * 0.32, height * 1.36, -depth * 0.2, glass, 4);
    box('helipad-cabin-roof', width * 0.29, 0.16, depth * 0.27, -width * 0.32, height * 1.54, -depth * 0.32, accentMaterial, 5);
    for (const x of [-width * 0.44, width * 0.44]) {
      box('helipad-edge-marker', width * 0.045, 0.04, depth * 0.7, x, height + 0.32, 0, warning, 4);
    }
  } else if (kind === 'wall') {
    for (const x of [-width * 0.42, -width * 0.14, width * 0.14, width * 0.42]) {
      box('wall-buttress', width * 0.16, height * 0.62, depth * 0.9, x, height + height * 0.14, 0, roof, 8);
      frontPanel('wall-armor-plate', width * 0.12, height * 0.5, x, height * 0.48, metal, 8);
      box('wall-crenel', width * 0.12, 0.32, depth * 0.22, x, height + height * 0.42, depth * 0.08, concrete, 7);
    }
    box('wall-cap', width * 0.94, 0.24, depth * 0.28, 0, height + height * 0.24, 0, warning, 5);
    for (const x of [-width * 0.32, 0, width * 0.32]) {
      frontPanel('wall-firing-slit', width * 0.12, height * 0.12, x, height * 0.72, dark, 6);
    }
    box('wall-rear-walkway', width * 0.88, 0.2, depth * 0.36, 0, height + height * 0.36, -depth * 0.22, metal, 7);
    for (const x of [-width * 0.48, width * 0.48]) {
      box('wall-end-post', width * 0.12, height * 0.9, depth * 0.22, x, height * 0.55, 0, dark, 8);
    }
  } else if (kind === 'intelligence-center') {
    box('intel-roof', width * 0.98, 0.32, depth * 0.94, 0, height + 0.16, 0, roof, 7);
    for (const x of [-width * 0.35, width * 0.35]) {
      box('intel-server-wing', width * 0.18, height * 0.5, depth * 0.62, x, height * 1.25, 0, concrete, 6);
      box('intel-server-cap', width * 0.22, 0.16, depth * 0.66, x, height * 1.52, 0, accentMaterial, 5);
    }
    frontPanel('intel-console-bank', width * 0.58, height * 0.32, 0, height * 0.5, dark, 6);
    for (const x of [-width * 0.22, 0, width * 0.22]) {
      frontPanel('intel-screen', width * 0.14, height * 0.13, x, height * 0.53, signal, 4);
    }
    const radar = new Group();
    radar.name = 'intelligence-radar';
    radar.position.set(0, height + 1.45, 0);
    const radarMast = new Mesh(new CylinderGeometry(0.18, 0.24, 2.6, 10), metal);
    radarMast.position.y = -0.2;
    radarMast.castShadow = true;
    radar.add(radarMast);
    const dish = new Mesh(new RingGeometry(width * 0.18, width * 0.38, 28, 1, 0, Math.PI), metal);
    dish.name = 'intelligence-dish';
    dish.rotation.x = -0.78;
    dish.rotation.z = -0.35;
    dish.position.y = 1.25;
    dish.castShadow = true;
    radar.add(dish);
    const receiver = new Mesh(new CylinderGeometry(0.12, 0.12, 1.25, 8), warning);
    receiver.rotation.z = Math.PI * 0.5;
    receiver.position.set(width * 0.19, 1.5, 0);
    radar.add(receiver);
    add(radar, 4);
    activity(radar, 'spin-y', 0.3, 1, 1.1);
    for (const x of [-width * 0.38, width * 0.38]) {
      const mast = cyl('intel-comms-mast', 0.06, 0.09, height * 0.9, x, height + height * 0.45, -depth * 0.3, metal, 4, 8);
      activity(perimeterLight('intel-comms-light', x, mast.position.y + height * 0.48, -depth * 0.3), 'pulse', 2.1, 1, x < 0 ? 0 : 0.7);
    }
    stripe(width * 0.38, depth * 0.07, 0, depth * 0.49, 4);
  } else if (kind === 'strategic-silo') {
    box('silo-roof-deck', width * 0.92, 0.42, depth * 0.9, 0, height + 0.2, 0, roof, 8);
    box('silo-control-bunker', width * 0.28, height * 0.34, depth * 0.3, -width * 0.33, height + height * 0.18, depth * 0.28, metal, 6);
    frontPanel('silo-control-screen', width * 0.16, height * 0.1, -width * 0.33, height * 0.28, signal, 4);
    const launchCluster = new Group();
    launchCluster.name = 'strategic-missile-cluster';
    launchCluster.position.y = height + 0.42;
    const missilePositions: readonly [number, number][] = [
      [-width * 0.22, -depth * 0.2], [0, -depth * 0.12], [width * 0.22, -depth * 0.2],
      [-width * 0.12, depth * 0.18], [width * 0.16, depth * 0.2],
    ];
    for (let i = 0; i < missilePositions.length; i++) {
      const [x, z] = missilePositions[i];
      const rack = new Mesh(new CylinderGeometry(width * 0.075, width * 0.09, height * 0.48, 12), dark);
      rack.position.set(x, height * 0.22, z);
      rack.castShadow = true;
      launchCluster.add(rack);
      const missile = new Mesh(new CylinderGeometry(width * 0.045, width * 0.055, height * 0.56, 12), concrete);
      missile.position.set(x, height * 0.5, z);
      missile.castShadow = true;
      launchCluster.add(missile);
      const nose = new Mesh(new ConeGeometry(width * 0.058, height * 0.18, 12), warning);
      nose.position.set(x, height * 0.87, z);
      nose.castShadow = true;
      launchCluster.add(nose);
      const band = new Mesh(new CylinderGeometry(width * 0.057, width * 0.057, 0.22, 12), accentMaterial);
      band.position.set(x, height * 0.38, z);
      launchCluster.add(band);
    }
    add(launchCluster, 4);
    for (const x of [-width * 0.46, width * 0.46]) {
      box('silo-launch-rail', 0.2, height * 0.72, 0.2, x, height + height * 0.36, 0, metal, 5);
      box('silo-gantry-arm', width * 0.16, 0.16, 0.16, x * 0.82, height + height * 0.64, 0, warning, 4);
    }
    stripe(width * 0.42, depth * 0.07, 0, depth * 0.49, 5);
  } else if (kind === 'missile-defense') {
    const defenseDeck = new Group();
    defenseDeck.name = 'missile-defense-pivot';
    defenseDeck.position.y = height + 0.3;
    const turntable = new Mesh(new CylinderGeometry(width * 0.3, width * 0.34, 0.5, 18), dark);
    turntable.castShadow = true;
    defenseDeck.add(turntable);
    const launcher = new Group();
    launcher.position.set(0, 0.8, 0);
    launcher.rotation.x = -0.45;
    for (const x of [-width * 0.15, 0, width * 0.15]) {
      const tube = new Mesh(new CylinderGeometry(width * 0.055, width * 0.055, depth * 0.72, 12), metal);
      tube.rotation.x = Math.PI * 0.5;
      tube.position.set(x, 0, 0.35);
      tube.castShadow = true;
      launcher.add(tube);
      const cap = new Mesh(new ConeGeometry(width * 0.065, 0.4, 12), warning);
      cap.rotation.x = Math.PI * 0.5;
      cap.position.set(x, 0, depth * 0.72);
      launcher.add(cap);
    }
    defenseDeck.add(launcher);
    const radar = new Mesh(new RingGeometry(width * 0.16, width * 0.28, 24, 1, 0, Math.PI), signal);
    radar.position.set(width * 0.32, 1.2, -depth * 0.1);
    radar.rotation.x = -0.72;
    defenseDeck.add(radar);
    add(defenseDeck, 4);
    activity(defenseDeck, 'spin-y', 0.24, 1, 0.5);
    root.userData.turretPivot = defenseDeck;
    door(width * 0.22, height * 0.26, 0, depth * 0.51, 5);
    stripe(width * 0.34, depth * 0.07, 0, depth * 0.49, 5);
  } else if (kind === 'skylance-ciws') {
    const ciws = new Group();
    ciws.name = 'skylance-ciws-pivot';
    ciws.position.y = height + 0.22;
    const turntable = new Mesh(new CylinderGeometry(width * 0.34, width * 0.4, 0.48, 18), dark);
    turntable.castShadow = true;
    ciws.add(turntable);
    const cradle = new Mesh(new BoxGeometry(width * 0.44, 0.62, depth * 0.32), metal);
    cradle.position.y = 0.58;
    cradle.castShadow = true;
    ciws.add(cradle);
    for (const x of [-width * 0.11, width * 0.11]) {
      const barrel = new Mesh(new CylinderGeometry(0.09, 0.12, depth * 0.86, 10), concrete);
      barrel.rotation.x = Math.PI * 0.5;
      barrel.position.set(x, 0.72, depth * 0.34);
      barrel.castShadow = true;
      ciws.add(barrel);
      const muzzle = new Mesh(new CylinderGeometry(0.14, 0.14, 0.24, 10), warning);
      muzzle.rotation.x = Math.PI * 0.5;
      muzzle.position.set(x, 0.72, depth * 0.78);
      ciws.add(muzzle);
    }
    const sensor = new Mesh(new RingGeometry(width * 0.16, width * 0.28, 24, 1, 0, Math.PI), signal);
    sensor.position.set(0, 1.28, -depth * 0.12);
    sensor.rotation.x = -0.72;
    ciws.add(sensor);
    add(ciws, 4);
    activity(ciws, 'spin-y', 0.42, 1, 0.35);
    root.userData.turretPivot = ciws;
    stripe(width * 0.3, depth * 0.07, 0, depth * 0.49, 5);
  } else if (kind === 'guard-tower') {
    const plinthH = height * 0.2;
    const shaftH = height * 0.45;
    const shaftW = width * 0.42;
    const headW = width * 0.58;
    const headTop = height;
    const shaftTop = plinthH + shaftH;

    // --- Plinth surface detail ---
    door(1.2, 1.8, 0, depth * 0.51, 5);
    for (const x of [-width * 0.28, width * 0.28]) {
      frontPanel('guard-plinth-armor', width * 0.22, plinthH * 0.55, x, plinthH * 0.55, metal, 7);
    }
    for (const z of [-depth * 0.22, depth * 0.22]) {
      sidePanel('guard-plinth-side-armor', depth * 0.2, plinthH * 0.5, z, plinthH * 0.52, metal, 7);
    }
    box('guard-plinth-warning', width * 0.96, 0.1, 0.14, 0, plinthH + 0.05, depth * 0.5, warning, 6);
    box('guard-plinth-warning-side', 0.14, 0.1, depth * 0.96, width * 0.5, plinthH + 0.05, 0, warning, 6);

    // --- Shaft detail ---
    const ladderX = -shaftW * 0.52;
    box('guard-bunker-visor', width * 0.72, 0.3, depth * 0.22, 0, height * 0.96, depth * 0.23, concrete, 6);
    box('guard-ladder-rail-l', 0.08, shaftH * 0.92, 0.08, ladderX - 0.22, plinthH + shaftH * 0.5, shaftW * 0.52, metal, 6);
    box('guard-ladder-rail-r', 0.08, shaftH * 0.92, 0.08, ladderX + 0.22, plinthH + shaftH * 0.5, shaftW * 0.52, metal, 6);
    for (let i = 0; i < 4; i++) {
      box(`guard-ladder-rung-${i}`, 0.44, 0.06, 0.08, ladderX, plinthH + 0.35 + i * (shaftH * 0.21), shaftW * 0.52, dark, 6);
    }
    box('guard-shaft-vent-a', 0.55, 0.35, 0.1, shaftW * 0.52, plinthH + shaftH * 0.35, 0, dark, 5).rotation.y = Math.PI / 2;
    box('guard-shaft-vent-b', 0.55, 0.35, 0.1, shaftW * 0.52, plinthH + shaftH * 0.62, depth * 0.08, dark, 5).rotation.y = Math.PI / 2;
    box('guard-shaft-accent-band', shaftW * 1.02, 0.22, shaftW * 1.02, 0, shaftTop - 0.35, 0, accentMaterial, 4);
    box('guard-cable-conduit', 0.18, shaftH * 0.95, 0.18, shaftW * 0.28, plinthH + shaftH * 0.48, -shaftW * 0.52, dark, 5);

    // --- Head / deck ---
    box('guard-head-ring', headW * 1.02, 0.16, headW * 1.02, 0, shaftTop + 0.08, 0, metal, 5);
    const railH = 0.55;
    const railY = headTop - 0.2;
    const halfDeck = headW * 0.48;
    for (const [x, z, w, d] of [
      [0, halfDeck, headW * 0.9, 0.08],
      [0, -halfDeck, headW * 0.9, 0.08],
      [halfDeck, 0, 0.08, headW * 0.9],
      [-halfDeck, 0, 0.08, headW * 0.9],
    ] as const) {
      box('guard-deck-rail', w, railH, d, x, railY, z, metal, 4);
    }
    const antenna = cyl('guard-antenna', 0.06, 0.06, 2.2, headW * 0.32, headTop + 1.1, -headW * 0.28, metal, 3, 8);
    activity(perimeterLight('guard-antenna-tip', antenna.position.x, headTop + 2.25, antenna.position.z), 'pulse', 2.8, 1, 0.5);
    box('guard-floodlight', 0.35, 0.22, 0.4, -headW * 0.3, headTop + 0.35, headW * 0.35, brass, 4).rotation.x = 0.35;

    // Searchlight: sweeps on the building, never parented to the turret (avoids
    // reading as a frozen muzzle flash locked to the tubes).
    const searchlight = new Group();
    searchlight.name = 'guard-searchlight';
    searchlight.position.set(headW * 0.22, headTop + 0.45, -headW * 0.2);
    const searchHousing = new Mesh(new BoxGeometry(0.4, 0.28, 0.45), dark);
    searchHousing.castShadow = true;
    searchlight.add(searchHousing);
    const searchBeam = new Mesh(new ConeGeometry(0.85, 3.6, 20, 1, true), transparentBasic(0xf3c86b, 0.16));
    searchBeam.position.set(0, -0.4, 1.6);
    searchBeam.rotation.x = Math.PI * 0.5 + 0.44; // ~25° downward
    searchBeam.renderOrder = 18;
    searchlight.add(searchBeam);
    add(searchlight, 3);
    activity(searchlight, 'spin-y', 0.35, 1, 1.1);

    // --- Turret / launcher (yaw-tracked) ---
    const launcher = new Group();
    launcher.name = 'fortress-launcher-pivot';
    launcher.position.set(0, headTop + 0.35, 0);
    const deck = new Mesh(new CylinderGeometry(headW * 0.28, headW * 0.3, 0.28, 18), dark);
    deck.castShadow = true;
    launcher.add(deck);
    // Armored tube housing ~2.8 × 1.6 × 3.4
    const housing = new Mesh(new BoxGeometry(2.8, 1.6, 3.4), metal);
    housing.position.set(0, 1.05, 0.15);
    housing.castShadow = true;
    launcher.add(housing);
    const blastShield = new Mesh(new BoxGeometry(3.0, 1.4, 0.18), dark);
    blastShield.position.set(0, 1.05, -1.65);
    blastShield.castShadow = true;
    launcher.add(blastShield);
    for (const x of [-0.55, 0.55]) {
      for (const y of [0.55, 1.35]) {
        const rail = new Mesh(new BoxGeometry(0.16, 0.1, 5.2), dark);
        rail.position.set(x, y - 0.28, 0.35);
        launcher.add(rail);
        const tube = new Mesh(new CylinderGeometry(0.34, 0.34, 5.5, 12), metal);
        tube.position.set(x, y, 0.45);
        tube.rotation.x = Math.PI * 0.5;
        tube.castShadow = true;
        launcher.add(tube);
        const nose = new Mesh(new ConeGeometry(0.36, 0.9, 12), warning);
        nose.position.set(x, y, 3.35);
        nose.rotation.x = Math.PI * 0.5;
        nose.castShadow = true;
        launcher.add(nose);
      }
    }
    const sight = new Mesh(new CylinderGeometry(0.3, 0.3, 1.1, 12), brass);
    sight.position.set(0, 2.15, -0.2);
    sight.castShadow = true;
    launcher.add(sight);
    const rangefinder = new Mesh(new BoxGeometry(0.7, 0.22, 0.35), signal);
    rangefinder.position.set(0, 1.85, 1.1);
    launcher.add(rangefinder);
    activity(rangefinder, 'pulse', 2.6, 0.8, 0.7);
    add(launcher, 4);
    root.userData.turretPivot = launcher;
    stripe(width * 0.22, depth * 0.06, 0, depth * 0.48, 4);
  } else if (kind === 'aa-tower') {
    const plinthH = height * 0.2;
    const shaftH = height * 0.45;
    const shaftW = width * 0.42;
    const headW = width * 0.58;
    const headTop = height;
    const shaftTop = plinthH + shaftH;

    door(1.2, 1.8, 0, depth * 0.51, 5);
    for (const x of [-width * 0.28, width * 0.28]) {
      frontPanel('aa-plinth-armor', width * 0.22, plinthH * 0.55, x, plinthH * 0.55, metal, 7);
    }
    for (const z of [-depth * 0.22, depth * 0.22]) {
      sidePanel('aa-plinth-side-armor', depth * 0.2, plinthH * 0.5, z, plinthH * 0.52, metal, 7);
    }
    box('aa-plinth-warning', width * 0.96, 0.1, 0.14, 0, plinthH + 0.05, depth * 0.5, warning, 6);
    box('aa-plinth-warning-side', 0.14, 0.1, depth * 0.96, width * 0.5, plinthH + 0.05, 0, warning, 6);

    const ladderX = shaftW * 0.52;
    cyl('aa-radar-backplate', width * 0.22, width * 0.22, 0.2, 0, height * 1.1, -depth * 0.28, metal, 5, 8).rotation.x = Math.PI / 2;
    box('aa-ladder-rail-l', 0.08, shaftH * 0.92, 0.08, ladderX - 0.22, plinthH + shaftH * 0.5, shaftW * 0.5, metal, 6);
    box('aa-ladder-rail-r', 0.08, shaftH * 0.92, 0.08, ladderX + 0.22, plinthH + shaftH * 0.5, shaftW * 0.5, metal, 6);
    for (let i = 0; i < 4; i++) {
      box(`aa-ladder-rung-${i}`, 0.44, 0.06, 0.08, ladderX, plinthH + 0.35 + i * (shaftH * 0.21), shaftW * 0.5, dark, 6);
    }
    box('aa-shaft-vent-a', 0.55, 0.35, 0.1, -shaftW * 0.52, plinthH + shaftH * 0.38, 0, dark, 5).rotation.y = Math.PI / 2;
    box('aa-shaft-vent-b', 0.55, 0.35, 0.1, -shaftW * 0.52, plinthH + shaftH * 0.65, -depth * 0.06, dark, 5).rotation.y = Math.PI / 2;
    box('aa-shaft-accent-band', shaftW * 1.02, 0.22, shaftW * 1.02, 0, shaftTop - 0.35, 0, accentMaterial, 4);
    box('aa-cable-conduit', 0.18, shaftH * 0.95, 0.18, -shaftW * 0.28, plinthH + shaftH * 0.48, -shaftW * 0.52, dark, 5);

    box('aa-head-ring', headW * 1.02, 0.16, headW * 1.02, 0, shaftTop + 0.08, 0, metal, 5);
    const railH = 0.55;
    const railY = headTop - 0.2;
    const halfDeck = headW * 0.48;
    for (const [x, z, w, d] of [
      [0, halfDeck, headW * 0.9, 0.08],
      [0, -halfDeck, headW * 0.9, 0.08],
      [halfDeck, 0, 0.08, headW * 0.9],
      [-halfDeck, 0, 0.08, headW * 0.9],
    ] as const) {
      box('aa-deck-rail', w, railH, d, x, railY, z, metal, 4);
    }
    const antenna = cyl('aa-antenna', 0.06, 0.06, 2.2, -headW * 0.3, headTop + 1.1, headW * 0.28, metal, 3, 8);
    activity(perimeterLight('aa-antenna-tip', antenna.position.x, headTop + 2.25, antenna.position.z), 'pulse', 2.8, 1, 0.9);
    box('aa-floodlight', 0.35, 0.22, 0.4, headW * 0.28, headTop + 0.35, headW * 0.32, brass, 4).rotation.x = 0.35;

    // Compact AA launcher (~1/3 of head visual weight)
    const launcher = new Group();
    launcher.position.set(0, headTop + 0.4, 0);
    launcher.rotation.y = -0.5;
    const aaHousing = new Mesh(new BoxGeometry(1.6, 0.85, 1.5), metal);
    aaHousing.position.y = 0.55;
    aaHousing.castShadow = true;
    launcher.add(aaHousing);
    for (const y of [-0.22, 0.22]) {
      for (const z of [-0.28, 0.28]) {
        const rail = new Mesh(new CylinderGeometry(0.22, 0.22, 2.6, 12), metal);
        rail.rotation.z = Math.PI * 0.5;
        rail.position.set(0.15, 0.55 + y, z);
        rail.castShadow = true;
        launcher.add(rail);
        const nose = new Mesh(new ConeGeometry(0.24, 0.55, 12), warning);
        nose.rotation.z = -Math.PI * 0.5;
        nose.position.set(1.55, 0.55 + y, z);
        nose.castShadow = true;
        launcher.add(nose);
      }
    }
    add(launcher, 4);
    root.userData.turretPivot = launcher;

    // Lattice mast for radar (not floating)
    const mastX = -headW * 0.28;
    const mastZ = -headW * 0.22;
    const mastBaseY = headTop + 0.2;
    box('aa-lattice-a', 0.08, 1.4, 0.08, mastX - 0.18, mastBaseY + 0.7, mastZ - 0.18, metal, 3);
    box('aa-lattice-b', 0.08, 1.4, 0.08, mastX + 0.18, mastBaseY + 0.7, mastZ + 0.18, metal, 3);
    box('aa-lattice-cross', 0.08, 0.08, 0.55, mastX, mastBaseY + 0.55, mastZ, metal, 3).rotation.y = Math.PI / 4;
    box('aa-lattice-cross-2', 0.08, 0.08, 0.55, mastX, mastBaseY + 1.0, mastZ, metal, 3).rotation.y = -Math.PI / 4;
    const dish = cyl('aa-radar-dish', 0.55, 0.55, 0.1, mastX, mastBaseY + 1.55, mastZ, metal, 3, 20);
    dish.rotation.x = Math.PI * 0.5;
    dish.rotation.z = 0.38;
    const radarSweep = new Group();
    radarSweep.name = 'aa-radar-sweep';
    radarSweep.position.set(mastX, mastBaseY + 1.7, mastZ);
    const radarArm = new Mesh(new BoxGeometry(1.35, 0.08, 0.1), signal);
    radarArm.position.x = 0.4;
    radarSweep.add(radarArm);
    add(radarSweep, 3);
    activity(radarSweep, 'spin-y', 1.15, 1, 0.2);
    activity(perimeterLight('aa-lock-light', headW * 0.28, headTop + 0.55, headW * 0.22), 'pulse', 3.2, 1, 1.8);
    stripe(width * 0.22, depth * 0.06, 0, depth * 0.48, 4);
  } else {
    stripe(width * 0.4, depth * 0.08, 0, depth * 0.12, 4);
  }

  syncDetailPartBases(parts);
  root.userData.detailParts = parts;
  root.userData.activityParts = activityParts;
  root.userData.hullSize = { fullW: width, fullD: depth, height };
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
  const simSeconds = tick / 30;
  const realSeconds = typeof performance !== 'undefined' ? performance.now() * 0.001 : simSeconds;
  for (const part of parts) {
    const wave = Math.sin(simSeconds * part.speed + part.phase + entityId * 0.13);
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
    if (part.kind === 'spin-y') part.object.rotation.y = part.baseRy + realSeconds * part.speed;
    else if (part.kind === 'spin-z') part.object.rotation.z = part.baseRz + realSeconds * part.speed;
    else if (part.kind === 'slide-x') part.object.position.x = part.baseX + wave * part.amplitude;
    else if (part.kind === 'rock-z') part.object.rotation.z = part.baseRz + wave * part.amplitude;
  }
}

function updateBuildingDetails(root: Group, damage: StructureDamage, level: number, destroyed: boolean): void {
  const parts = (root.userData.detailParts ?? []) as DetailPart[];
  const hull = root.userData.hullSize as { fullW: number; fullD: number; height: number } | undefined;
  for (const part of parts) {
    const local = hull
      ? detailWoundFromGrid(damage, part.object.position.x, part.object.position.y, part.object.position.z, hull.fullW, hull.fullD, hull.height)
      : 0;
    const globalT = destroyed ? 1 : Math.max(0, Math.min(1, (level - part.fragility) / 5));
    const localT = Math.max(0, Math.min(1, (local - 14 - part.fragility * 4) / 140));
    const t = Math.max(localT, globalT * 0.42);
    part.object.visible = !destroyed || part.fragility >= 7 || t < 0.96;
    part.object.position.y = part.y - t * (0.7 + part.y * 0.38);
    part.object.scale.set(part.sx * (1 - t * 0.28), part.sy * (1 - t * 0.52), part.sz * (1 - t * 0.28));
    part.object.rotation.set(part.rx + t * 0.16, part.ry + t * 0.22, part.rz + t * 0.26);
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

export interface BuildingSelectionFootprint {
  wallHalfW: number;
  wallHalfD: number;
  ringHalfW: number;
  ringHalfD: number;
  ringWidth: number;
  skirtHeight: number;
  cornerRadius: number;
}

/** Ground-contact selection outline: visual foundation, not the circumcircle. */
export function buildingSelectionFootprint(
  footprint: { w: number; h: number },
  cellSize: number,
  kind?: string,
  options: { radiusScale?: number; outerAdd?: number } = {},
): BuildingSelectionFootprint {
  const foundationScale = kind === 'guard-tower' || kind === 'aa-tower' || kind === 'missile-defense' || kind === 'skylance-ciws' ? 1.02 : 1.06;
  const wallHalfW = Math.max(0.6, footprint.w * cellSize * foundationScale);
  const wallHalfD = Math.max(0.6, footprint.h * cellSize * foundationScale);
  const extra = ((options.radiusScale ?? 1) - 1) * Math.max(wallHalfW, wallHalfD) * 0.18 + (options.outerAdd ?? 0) * 0.12;
  const gap = 0.07 + extra;
  const ringWidth = (kind === 'wall' ? 0.39 : 0.51) + extra * 0.35;
  return {
    wallHalfW,
    wallHalfD,
    ringHalfW: wallHalfW + gap + ringWidth,
    ringHalfD: wallHalfD + gap + ringWidth,
    ringWidth,
    skirtHeight: kind === 'wall' ? 0.4 : 0.58,
    cornerRadius: Math.min(0.18, wallHalfW * 0.06, wallHalfD * 0.06),
  };
}

function addRoundedRect(path: Path, halfW: number, halfD: number, radius: number): void {
  const r = Math.min(radius, halfW, halfD);
  path.moveTo(-halfW + r, -halfD);
  path.lineTo(halfW - r, -halfD);
  path.quadraticCurveTo(halfW, -halfD, halfW, -halfD + r);
  path.lineTo(halfW, halfD - r);
  path.quadraticCurveTo(halfW, halfD, halfW - r, halfD);
  path.lineTo(-halfW + r, halfD);
  path.quadraticCurveTo(-halfW, halfD, -halfW, halfD - r);
  path.lineTo(-halfW, -halfD + r);
  path.quadraticCurveTo(-halfW, -halfD, -halfW + r, -halfD);
}

function createFootprintRingGeometry(halfW: number, halfD: number, ringWidth: number, corner: number): ShapeGeometry {
  const outer = new Shape();
  addRoundedRect(outer, halfW, halfD, corner);
  const hole = new Path();
  addRoundedRect(hole, Math.max(0.15, halfW - ringWidth), Math.max(0.15, halfD - ringWidth), Math.max(0, corner - ringWidth));
  outer.holes.push(hole);
  return new ShapeGeometry(outer);
}

function glowMaterial(color: number, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: DoubleSide,
    blending: AdditiveBlending,
  });
}

function createFactionBuildingMaterial(base: Material, id: FactionId): Material {
  if (!(base instanceof MeshStandardMaterial)) return base;
  const material = base.clone();
  const palette = FACTION[id];
  material.color.lerp(new Color(palette.hull), 0.34);
  material.emissive.setHex(palette.accentEmissive);
  material.emissiveIntensity = Math.max(material.emissiveIntensity, 0.08);
  return material;
}

function createSelectionGlow(
  entity: Entity,
  cellSize: number,
  options: { color?: number; radiusScale?: number; outerAdd?: number; renderOrder?: number; skirts?: boolean } = {},
): SelectionGlow {
  const root = new Group();
  root.visible = false;
  const order = options.renderOrder ?? 34;
  root.renderOrder = order;
  const team = FACTION[factionId(entity.team?.id)];
  const accent = options.color ?? team.lightBar;
  const footprint = buildingSelectionFootprint(entity.building!.footprint, cellSize, entity.building?.kind, options);
  const ringMaterial = glowMaterial(accent, 0.7);
  const skirtMaterial = options.skirts === false ? undefined : glowMaterial(accent, 0.4);
  const ring = new Mesh(
    createFootprintRingGeometry(footprint.ringHalfW, footprint.ringHalfD, footprint.ringWidth, footprint.cornerRadius),
    ringMaterial,
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  ring.renderOrder = order + 1;
  ring.castShadow = false;
  ring.receiveShadow = false;
  root.add(ring);

  const skirts: Mesh[] = [];
  if (skirtMaterial) {
    const skirtY = footprint.skirtHeight * 0.42;
    const front = new Mesh(sharedPlaneGeometry, skirtMaterial);
    front.scale.set(footprint.wallHalfW * 2 * 0.98, footprint.skirtHeight, 1);
    front.position.set(0, skirtY, footprint.wallHalfD + 0.05);
    const back = new Mesh(sharedPlaneGeometry, skirtMaterial);
    back.scale.set(footprint.wallHalfW * 2 * 0.98, footprint.skirtHeight, 1);
    back.position.set(0, skirtY, -(footprint.wallHalfD + 0.05));
    back.rotation.y = Math.PI;
    const right = new Mesh(sharedPlaneGeometry, skirtMaterial);
    right.scale.set(footprint.wallHalfD * 2 * 0.98, footprint.skirtHeight, 1);
    right.position.set(footprint.wallHalfW + 0.05, skirtY, 0);
    right.rotation.y = Math.PI / 2;
    const left = new Mesh(sharedPlaneGeometry, skirtMaterial);
    left.scale.set(footprint.wallHalfD * 2 * 0.98, footprint.skirtHeight, 1);
    left.position.set(-(footprint.wallHalfW + 0.05), skirtY, 0);
    left.rotation.y = -Math.PI / 2;
    skirts.push(front, back, right, left);
    for (const skirt of skirts) {
      skirt.renderOrder = order + 2;
      skirt.castShadow = false;
      skirt.receiveShadow = false;
      root.add(skirt);
    }
  }
  return { root, ring, skirts, ringMaterial, skirtMaterial };
}

function createBuildingHealthBar(
  backMaterial: Material,
  frameMaterial: Material,
  trackMaterial: Material,
): BuildingHealthBar {
  const root = new Group();
  root.visible = false;
  const frame = new Mesh(sharedHealthPlane, frameMaterial);
  frame.renderOrder = 41;
  root.add(frame);
  const back = new Mesh(sharedHealthPlane, backMaterial);
  back.position.z = 0.01;
  back.renderOrder = 42;
  root.add(back);
  const track = new Mesh(sharedHealthPlane, trackMaterial);
  track.position.z = 0.02;
  track.renderOrder = 43;
  root.add(track);
  const fillMaterial = new MeshBasicMaterial({
    color: 0x79f06f,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
  });
  const fill = new Mesh(sharedHealthPlane, fillMaterial);
  fill.position.z = 0.03;
  fill.renderOrder = 44;
  root.add(fill);
  return { root, fill, fillMaterial, back, frame, track };
}
