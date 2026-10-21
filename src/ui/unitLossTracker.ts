import type { Entity } from '../sim/components';
import type { GameSim } from '../sim/world';
import { unitDisplayName } from './unitDisplayName';

export interface UnitLossReport {
  tick: number;
  count: number;
  units: Map<string, number>;
}

/** Presentation-only accounting catches splash/crash deaths without relying on hit-event attribution. */
export class UnitLossTracker {
  readonly reports: UnitLossReport[] = [];
  readonly totals = new Map<string, number>();
  total = 0;
  private readonly tracked = new Map<number, Entity>();
  private readonly counted = new Set<number>();
  private lastTick = -1;

  constructor(private readonly sim: GameSim, private readonly team: number) {
    for (const entity of sim.world.entities) this.track(entity);
    sim.world.onEntityAdded.subscribe(entity => this.track(entity));
    sim.world.onEntityRemoved.subscribe(entity => {
      if (this.tracked.has(entity.id)) this.record(entity);
      this.tracked.delete(entity.id);
    });
  }

  update(): void {
    // Local roster only, at 10 Hz; never scan the battlefield per rendered frame.
    if (this.sim.tick >= this.lastTick && this.sim.tick - this.lastTick < 3) return;
    this.lastTick = this.sim.tick;
    for (const entity of this.tracked.values()) {
      if (this.record(entity)) this.tracked.delete(entity.id);
    }
  }

  private track(entity: Entity): void {
    if (entity.team?.id !== this.team || entity.building || !entity.selectable || !entity.health) return;
    // Existing wrecks in a loaded/recovered state are not new casualties.
    if (entity.destroyed || entity.health.current <= 0) { this.counted.add(entity.id); return; }
    if (!this.counted.has(entity.id)) this.tracked.set(entity.id, entity);
  }

  private record(entity: Entity): boolean {
    if (entity.team?.id !== this.team || (!entity.destroyed && (entity.health?.current ?? 1) > 0) || this.counted.has(entity.id)) return false;
    this.counted.add(entity.id);
    const label = unitDisplayName(entity);
    const previous = this.reports[this.reports.length - 1];
    const report = previous && this.sim.tick - previous.tick <= 90 && this.sim.tick >= previous.tick
      ? previous : { tick: this.sim.tick, count: 0, units: new Map<string, number>() };
    if (report !== previous) this.reports.push(report);
    report.count++;
    report.units.set(label, (report.units.get(label) ?? 0) + 1);
    this.totals.set(label, (this.totals.get(label) ?? 0) + 1);
    this.total++;
    return true;
  }
}
