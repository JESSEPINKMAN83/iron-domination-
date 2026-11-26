import { BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Group, InstancedMesh, LineBasicMaterial, LineSegments, MeshBasicMaterial, Object3D, RingGeometry } from 'three';
import type { Entity } from '../sim/components';
import { sampleHeight, type Heightfield } from '../sim/heightfield';

export const MAX_SELECTED_TARGETS = 64;
export interface SelectedTarget { source: Entity; target: Entity; engaging: boolean; }

/** Read weapon state, not hover state; never turn a hidden target into new intel. */
export function selectedTargets(units: readonly Entity[], byId: ReadonlyMap<number, Entity>, visible: (target: Entity) => boolean, engaging: (source: Entity, target: Entity) => boolean = () => true): SelectedTarget[] {
  const result: SelectedTarget[] = [];
  for (const source of units) {
    if (source.destroyed) continue;
    const active = new Set([source.weapon?.targetId, source.weapons?.primary.targetId, source.weapons?.secondary?.targetId].filter((id): id is number => id !== undefined));
    const ordered = source.mover?.attackTargetId;
    const ids = new Set(active);
    if (ordered !== undefined) ids.add(ordered);
    for (const id of ids) {
      const target = byId.get(id);
      if (!target || target === source || target.destroyed || !target.health || target.health.current <= 0 || !visible(target)) continue;
      result.push({ source, target, engaging: active.has(id) && engaging(source, target) });
      if (result.length === MAX_SELECTED_TARGETS) return result;
    }
  }
  return result;
}

export function selectedTargetSummary(records: readonly SelectedTarget[]): string {
  if (!records.length) return '';
  const activeRecords = records.filter(r => r.engaging), orderedRecords = records.filter(r => !r.engaging);
  const names = (values: readonly SelectedTarget[]) => {
    const labels = [...new Set(values.map(r => r.target.name ?? r.target.selectable?.type ?? 'Target'))];
    return labels.slice(0, 2).join(', ') + (labels.length > 2 ? ` +${labels.length - 2}` : '');
  };
  const count = (values: readonly SelectedTarget[]) => new Set(values.map(r => r.source.id)).size;
  return [activeRecords.length ? `Engaging (${count(activeRecords)}): ${names(activeRecords)}` : '',
    orderedRecords.length ? `Ordered (${count(orderedRecords)}): ${names(orderedRecords)}` : ''].filter(Boolean).join(' · ');
}

/** Two bounded draws for the selected force, refreshed with existing HUD cadence. */
export class SelectedTargetView {
  readonly group = new Group();
  private readonly lines: LineSegments;
  private readonly rings: InstancedMesh;
  private readonly transform = new Object3D();
  private readonly color = new Color();
  constructor(private readonly hf: Heightfield) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(MAX_SELECTED_TARGETS * 6), 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(MAX_SELECTED_TARGETS * 6), 3).setUsage(DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.lines = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false }));
    this.rings = new InstancedMesh(new RingGeometry(0.88, 1, 32), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, side: DoubleSide, forceSinglePass: true }), MAX_SELECTED_TARGETS);
    this.rings.instanceMatrix.setUsage(DynamicDrawUsage);
    this.rings.count = 0;
    this.lines.frustumCulled = this.rings.frustumCulled = false;
    this.lines.renderOrder = 71; this.rings.renderOrder = 72;
    this.group.add(this.lines, this.rings); this.group.visible = false;
  }
  update(records: readonly SelectedTarget[]): void {
    const positions = this.lines.geometry.getAttribute('position'), colors = this.lines.geometry.getAttribute('color');
    const marked = new Set<number>();
    let count = 0, rings = 0;
    // Active engagements own a target ring when several selected units share it.
    for (const record of [...records].sort((a, b) => Number(b.engaging) - Number(a.engaging)).slice(0, MAX_SELECTED_TARGETS)) {
      const { source, target, engaging } = record;
      const sx = source.transform.x, sz = source.transform.z, tx = target.transform.x, tz = target.transform.z;
      this.color.setHex(engaging ? 0xff8065 : 0xf0d56a);
      positions.setXYZ(count * 2, sx, (source.transform.y ?? sampleHeight(this.hf, sx, sz)) + 1.8, sz);
      positions.setXYZ(count * 2 + 1, tx, (target.transform.y ?? sampleHeight(this.hf, tx, tz)) + 1.8, tz);
      for (let end = 0; end < 2; end++) colors.setXYZ(count * 2 + end, this.color.r, this.color.g, this.color.b);
      count++;
      if (marked.has(target.id)) continue;
      marked.add(target.id);
      const radius = Math.max(2.5, Math.min(24, target.building ? Math.hypot(target.building.footprint.w, target.building.footprint.h) * this.hf.cellSize * 0.5 : (target.collider?.radius ?? 2) + 1));
      this.transform.position.set(tx, (target.flight ? target.transform.y ?? 0 : sampleHeight(this.hf, tx, tz)) + 0.5, tz);
      this.transform.rotation.set(-Math.PI / 2, 0, 0); this.transform.scale.set(radius, radius, 1); this.transform.updateMatrix();
      this.rings.setMatrixAt(rings, this.transform.matrix); this.rings.setColorAt(rings++, this.color);
    }
    this.lines.geometry.setDrawRange(0, count * 2); this.rings.count = rings;
    positions.needsUpdate = colors.needsUpdate = true; this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    this.group.visible = count > 0;
  }
}
