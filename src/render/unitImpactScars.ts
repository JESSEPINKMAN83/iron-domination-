import { DynamicDrawUsage, Group, InstancedMesh, Mesh, Object3D, PlaneGeometry, type Material } from 'three';
const geometry = new PlaneGeometry(1, 1);
geometry.userData.ironDominionSharedUnitGeometry = true;
export interface ScarLayout { halfX: number; halfZ: number; topY: number; aircraft: boolean; sideY?: number; frontZ?: number; frontY?: number; }
export interface ScarHit { localX: number; localZ: number; top: boolean; force: number; }
/** Approximate the known hull face; no triangle raycast or per-hit decal geometry. */
export function positionUnitScar(mark: Object3D, layout: ScarLayout, hit: ScarHit): void {
  const size = Math.min(2.3, 0.7 + Math.max(0, hit.force) * 1.3);
  mark.rotation.set(0, 0, 0);
  if (hit.top || layout.aircraft) {
    mark.position.set(Math.sign(hit.localX) * layout.halfX * 0.23, layout.topY + 0.045, Math.sign(hit.localZ || 1) * layout.halfZ * 0.55);
    mark.rotation.x = -Math.PI / 2;
    mark.scale.set(size, size * 0.9, 1);
  } else if (Math.abs(hit.localX) / layout.halfX > Math.abs(hit.localZ) / layout.halfZ) {
    const side = hit.localX >= 0 ? 1 : -1;
    mark.position.set(side * (layout.halfX + 0.025), (layout.sideY ?? layout.topY * 0.61), Math.sign(hit.localZ) * layout.halfZ * 0.18);
    mark.rotation.y = side * Math.PI / 2;
    mark.scale.set(size, Math.min(size, layout.topY * 0.75), 1);
  } else {
    const side = hit.localZ >= 0 ? 1 : -1;
    mark.position.set(Math.sign(hit.localX) * layout.halfX * 0.18, (side > 0 ? layout.frontY : layout.sideY) ?? layout.topY * 0.61, side * ((side > 0 ? layout.frontZ : layout.halfZ) ?? layout.halfZ) + side * 0.025);
    mark.rotation.y = side > 0 ? 0 : Math.PI;
    mark.scale.set(size, Math.min(size, layout.topY * 0.75), 1);
  }
}

/** Three persistent marks in one draw, plus one short-lived heat flash. */
export class UnitImpactScars {
  readonly root = new Group();
  readonly marks: InstancedMesh;
  private readonly poses = Array.from({ length: 3 }, () => new Object3D());
  private readonly heat: Mesh;
  private count = 0;
  private cursor = 0;
  private dirty = true;
  private stage = -1;
  private hitTime = -Infinity;
  private lastHealth = 1;
  constructor(private readonly layout: ScarLayout, private readonly scarMaterial: Material, heatMaterial: Material) {
    this.marks = new InstancedMesh(geometry, scarMaterial, 3);
    this.root.name = 'unit-surface-damage'; this.root.visible = false;
    this.marks.name = 'unit-impact-scars'; this.marks.count = 0;
    this.marks.instanceMatrix.setUsage(DynamicDrawUsage);
    this.marks.renderOrder = 35;
    this.heat = new Mesh(geometry, heatMaterial); this.heat.name = 'unit-impact-heat'; this.heat.visible = false; this.heat.renderOrder = 39;
    this.root.add(this.marks, this.heat);
    for (let i = 0; i < 3; i++) positionUnitScar(this.poses[i], layout, { localX: i - 1, localZ: i % 2 ? -1 : 1, top: true, force: 0.3 + i * 0.2 });
  }
  stamp(hit: ScarHit, time: number): void {
    const pose = this.poses[this.cursor++ % 3]; positionUnitScar(pose, this.layout, hit);
    this.heat.position.copy(pose.position); this.heat.rotation.copy(pose.rotation); this.heat.scale.copy(pose.scale);
    this.heat.userData.sizeX = pose.scale.x; this.heat.userData.sizeY = pose.scale.y;
    this.hitTime = time; this.count = Math.min(3, this.count + 1); this.dirty = true;
  }
  update(stage: number, time: number, healthFraction: number): void {
    if (healthFraction >= 0.999 && this.lastHealth < 0.999) { this.count = 0; this.cursor = 0; this.hitTime = -Infinity; this.dirty = true; }
    this.lastHealth = healthFraction;
    if (stage !== this.stage || this.dirty) {
      this.stage = stage; this.dirty = false;
      this.marks.count = Math.min(3, Math.max(this.count, stage));
      for (let i = 0; i < this.marks.count; i++) { this.poses[i].updateMatrix(); this.marks.setMatrixAt(i, this.poses[i].matrix); }
      this.marks.instanceMatrix.needsUpdate = true;
      if (this.marks.count) this.marks.computeBoundingSphere();
      this.marks.visible = this.marks.count > 0;
    }
    const heat = Math.max(0, 1 - (time - this.hitTime) / 0.3);
    this.heat.visible = heat > 0;
    if (heat > 0) this.heat.scale.set(this.heat.userData.sizeX * Math.sqrt(heat), this.heat.userData.sizeY * Math.sqrt(heat), 1);
    this.root.visible = this.marks.count > 0 || this.heat.visible;
  }
  dispose(): void { this.marks.dispose(); }
}
