// Phase 6 — utility-based enemy commander. Runs inside the deterministic sim
// tick (no randomness beyond sim state, stable iteration orders). Honesty rule:
// target *selection* only uses what the AI's own visibility grid has seen.
import { STRUCTURES, type StructureKind, type UnitKind } from '../content/phase3';
import { AI_DIFFICULTY, AI_PERSONALITY, type Difficulty, type DifficultyDef, type Personality, type PersonalityDef } from '../content/phase6';
import type { Entity } from '../sim/components';
import { buildings, canBuildStructure, placeStructure, queueUnit, startStructureBuild, updatePlacement, type EconomyState } from '../sim/economy';
import type { Heightfield } from '../sim/heightfield';
import type { VisibilityGrid } from '../sim/visibility';
import { issueMoveOrder, type GameSim } from '../sim/world';

interface Squad {
  units: Entity[];
  state: 'attacking' | 'retreating';
  nextOrderAt: number; // sim tick
}

export class EnemyCommander {
  readonly stats = { structuresPlaced: 0, rebuilds: 0, attacksLaunched: 0, retreats: 0 };
  private readonly personality: PersonalityDef;
  private readonly difficulty: DifficultyDef;
  private readonly buildQueue: StructureKind[];
  private readonly everCompleted = new Set<StructureKind>();
  private readonly squads: Squad[] = [];
  private timer = 0;
  private elapsed = 0;
  private scoutIndex = 0;

  constructor(
    private readonly sim: GameSim,
    private readonly hf: Heightfield,
    readonly economy: EconomyState,
    private readonly vision: VisibilityGrid,
    personality: Personality = 'balanced',
    difficulty: Difficulty = 'normal',
    /** map-geography scouting hints (e.g. known start locations) — not unit intel */
    private readonly scoutHints: { x: number; z: number }[] = [],
  ) {
    this.personality = AI_PERSONALITY[personality];
    this.difficulty = AI_DIFFICULTY[difficulty];
    economy.incomeMultiplier = this.difficulty.incomeMultiplier;
    this.buildQueue = [...this.personality.buildOrder];
    this.log(`online — ${personality}/${difficulty}, build order: ${this.buildQueue.join(' → ')}`);
  }

  step(dt: number): void {
    this.elapsed += dt;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.difficulty.reactionDelay;
    if (this.aliveBuildings().length === 0) return; // commander eliminated
    this.maintainBase();
    this.maintainProduction();
    this.commandSquads();
  }

  private aliveBuildings(): Entity[] {
    return buildings(this.sim, this.economy.team).filter((entity) => !entity.destroyed);
  }

  private base(): Entity | undefined {
    const mine = this.aliveBuildings();
    return mine.find((entity) => entity.building?.kind === 'command-yard') ?? mine[0];
  }

  private count(kind: StructureKind | 'command-yard'): number {
    return this.aliveBuildings().filter((entity) => entity.building?.kind === kind).length;
  }

  private maintainBase(): void {
    for (const kind of Object.keys(STRUCTURES) as StructureKind[]) {
      if (this.aliveBuildings().some((b) => b.building?.kind === kind && b.building.complete)) {
        this.everCompleted.add(kind);
      }
    }

    let next: StructureKind | undefined = this.buildQueue[0];
    let rebuilding = false;
    if (!next) {
      if (this.economy.powerProduced < this.economy.powerUsed + 10) next = 'power-plant';
      else if (this.count('refinery') < this.personality.targetRefineries) next = 'refinery';
      else if (this.count('factory') < this.personality.targetFactories) next = 'factory';
      else if (this.personality.wantsBarracks && this.count('barracks') < 1) next = 'barracks';
      else if (this.count('factory') > 0 && this.count('helipad') < 1 && this.economy.credits > 1200) next = 'helipad';
      rebuilding = next !== undefined && this.everCompleted.has(next) && this.count(next) === 0;
    }
    if (!next) return;
    if (this.economy.readyStructure) {
      const spot = this.findPlacement(this.economy.readyStructure);
      if (!spot) return;
      const placedKind = this.economy.readyStructure;
      if (!placeStructure(this.sim, this.hf, this.economy, spot)) return;
      if (this.buildQueue[0] === placedKind) this.buildQueue.shift();
      this.stats.structuresPlaced++;
      if (rebuilding) {
        this.stats.rebuilds++;
        this.log(`rebuilding lost ${STRUCTURES[placedKind].label}`);
      } else {
        this.log(`expanding — constructed ${STRUCTURES[placedKind].label} (${this.count(placedKind)} total)`);
      }
      return;
    }
    if (this.economy.structureLine) return;
    if (!canBuildStructure(this.sim, this.economy, next).ok) return;
    const spot = this.findPlacement(next);
    if (!spot) return;
    if (!startStructureBuild(this.sim, this.economy, next)) return;
    this.log(`expanding — building ${STRUCTURES[next].label}`);
  }

  /** Deterministic ring search around the base for a valid footprint. */
  private findPlacement(kind: StructureKind) {
    if (kind === 'refinery') {
      const resourceSpot = this.findResourceRefineryPlacement();
      if (resourceSpot) return resourceSpot;
    }
    const base = this.base();
    if (!base) return undefined;
    for (const radius of [26, 34, 44, 54, 66, 78]) {
      for (let step = 0; step < 12; step++) {
        const angle = (step / 12) * Math.PI * 2;
        const placement = updatePlacement(
          this.sim,
          this.hf,
          kind,
          base.transform.x + Math.cos(angle) * radius,
          base.transform.z + Math.sin(angle) * radius,
          this.economy.team,
        );
        if (placement.valid) return placement;
      }
    }
    return undefined;
  }

  private findResourceRefineryPlacement() {
    const base = this.base();
    if (!base) return undefined;
    const refineries = this.aliveBuildings().filter((entity) => entity.building?.kind === 'refinery');
    const nodes = this.sim.resourceNodes
      .filter((node) => node.remaining > node.capacity * 0.08)
      .filter((node) => refineries.every((refinery) => Math.hypot(refinery.transform.x - node.x, refinery.transform.z - node.z) > node.radius + 52))
      .sort((a, b) => Math.hypot(a.x - base.transform.x, a.z - base.transform.z) - Math.hypot(b.x - base.transform.x, b.z - base.transform.z));
    const anchors = this.aliveBuildings().sort((a, b) => a.id - b.id);
    for (const node of nodes) {
      for (const angleStep of [0, 2, 4, 6, 1, 3, 5, 7]) {
        const angle = (angleStep / 8) * Math.PI * 2;
        const placement = updatePlacement(this.sim, this.hf, 'refinery', node.x + Math.cos(angle) * (node.radius + 18), node.z + Math.sin(angle) * (node.radius + 18), this.economy.team);
        if (placement.valid) return placement;
      }
      for (const anchor of anchors) {
        const dx = node.x - anchor.transform.x;
        const dz = node.z - anchor.transform.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.001) continue;
        const ux = dx / d;
        const uz = dz / d;
        for (const distance of [46, 64, 82]) {
          const placement = updatePlacement(this.sim, this.hf, 'refinery', anchor.transform.x + ux * distance, anchor.transform.z + uz * distance, this.economy.team);
          if (placement.valid) return placement;
        }
      }
    }
    return undefined;
  }

  private maintainProduction(): void {
    // saving up for a pending structure beats another tank
    if (this.buildQueue.length > 0 && this.economy.credits < 1500) return;
    const mine = this.myUnits();
    const tanks = mine.filter((entity) => entity.selectable?.type === 'tank').length;
    const infantry = mine.filter((entity) => entity.selectable?.type === 'infantry').length;
    const aircraft = mine.filter((entity) => entity.flight).length;
    if (tanks < this.difficulty.tankCap) queueUnit(this.sim, this.economy, this.nextVehicleKind(tanks));
    else if (this.count('helipad') > 0 && aircraft < Math.max(2, Math.floor(this.difficulty.tankCap / 7))) {
      queueUnit(this.sim, this.economy, this.nextAircraftKind(aircraft));
    } else if (infantry < this.difficulty.infantryCap) {
      queueUnit(this.sim, this.economy, this.nextInfantryKind(infantry));
    }
  }

  private nextVehicleKind(count: number): UnitKind {
    return (['scout-tank', 'tank', 'tank', 'siege-tank', 'scout-tank', 'tank'] as UnitKind[])[count % 6];
  }

  private nextInfantryKind(count: number): UnitKind {
    return (['infantry', 'grenadier', 'rocket-infantry', 'infantry', 'rocket-infantry'] as UnitKind[])[count % 5];
  }

  private nextAircraftKind(count: number): UnitKind {
    return (['wasp', 'vulture', 'wasp', 'hammerhead'] as UnitKind[])[count % 4];
  }

  private myUnits(): Entity[] {
    const out: Entity[] = [];
    for (const entity of this.sim.world.entities) {
      if (entity.team?.id !== this.economy.team || entity.destroyed || entity.building || entity.harvester || !entity.mover) continue;
      out.push(entity);
    }
    return out.sort((a, b) => a.id - b.id);
  }

  private commandSquads(): void {
    const base = this.base();
    for (const squad of this.squads) {
      squad.units = squad.units.filter((unit) => !unit.destroyed && this.sim.world.has(unit));
    }
    for (let i = this.squads.length - 1; i >= 0; i--) {
      if (this.squads[i].units.length === 0) this.squads.splice(i, 1);
    }

    const inSquads = new Set(this.squads.flatMap((squad) => squad.units));
    const idle = this.myUnits().filter((unit) => !inSquads.has(unit));

    const attacking = this.squads.filter((squad) => squad.state === 'attacking').length;
    if (
      attacking < this.personality.maxSquads &&
      this.elapsed >= this.personality.attackDelay &&
      idle.length - this.personality.homeGuard >= this.personality.squadSize
    ) {
      const units = idle.slice(0, this.personality.squadSize);
      this.squads.push({ units, state: 'attacking', nextOrderAt: 0 });
      this.stats.attacksLaunched++;
      this.log(`attack squad of ${units.length} rolling out (${this.stats.attacksLaunched} launched so far)`);
    }

    for (const squad of this.squads) {
      const totals = squad.units.reduce(
        (acc, unit) => ({ hp: acc.hp + (unit.health?.current ?? 0), max: acc.max + (unit.health?.max ?? 1) }),
        { hp: 0, max: 0 },
      );
      const strength = totals.max > 0 ? totals.hp / totals.max : 0;

      if (squad.state === 'attacking' && strength < 0.4) {
        squad.state = 'retreating';
        squad.nextOrderAt = 0;
        this.stats.retreats++;
        this.log(`squad at ${Math.round(strength * 100)}% strength — retreating to base`);
      }

      if (this.sim.tick < squad.nextOrderAt) continue;
      squad.nextOrderAt = this.sim.tick + 30 * 4;

      if (squad.state === 'retreating') {
        if (!base) continue;
        const lead = squad.units[0];
        const nearHome = lead && Math.hypot(lead.transform.x - base.transform.x, lead.transform.z - base.transform.z) < 60;
        if (nearHome) {
          squad.units = []; // disband into the defense pool
        } else {
          issueMoveOrder(this.sim, squad.units, base.transform.x, base.transform.z, false);
        }
        continue;
      }

      const target = this.pickTarget(squad);
      issueMoveOrder(this.sim, squad.units, target.x, target.z, true);
    }
  }

  /** Honest targeting: only positions the AI's own vision grid currently sees. */
  private pickTarget(squad: Squad): { x: number; z: number } {
    let possessed: Entity | undefined;
    let economyTarget: Entity | undefined;
    let building: Entity | undefined;
    let unit: Entity | undefined;
    let economyScore = Number.POSITIVE_INFINITY;
    let buildingD = Number.POSITIVE_INFINITY;
    let unitD = Number.POSITIVE_INFINITY;
    const base = this.base();
    const bx = base?.transform.x ?? 0;
    const bz = base?.transform.z ?? 0;
    const lead = squad.units[0];
    const sx = lead?.transform.x ?? bx;
    const sz = lead?.transform.z ?? bz;
    for (const entity of this.sim.world.entities) {
      if (entity.team?.id === this.economy.team || !entity.team || entity.destroyed) continue;
      if (!this.vision.isVisibleWorld(entity.transform.x, entity.transform.z)) continue;
      const d = Math.hypot(entity.transform.x - bx, entity.transform.z - bz);
      const squadD = Math.hypot(entity.transform.x - sx, entity.transform.z - sz);
      if (entity.playerControlled) possessed = entity;
      const isEconomyTarget = entity.harvester || entity.building?.kind === 'refinery';
      if (isEconomyTarget) {
        const score = squadD + (entity.harvester ? 0 : 36);
        if (score < economyScore) {
          economyTarget = entity;
          economyScore = score;
        }
      }
      if (entity.building && d < buildingD) {
        building = entity;
        buildingD = d;
      } else if (!entity.building && d < unitD) {
        unit = entity;
        unitD = d;
      }
    }
    // the player's possessed unit is a high-value target — chase it for pressure
    const chosen = possessed ?? economyTarget ?? building ?? unit;
    if (chosen) {
      if (possessed) this.log('spotted the possessed unit — converging on it');
      else if (chosen.harvester) this.log('spotted enemy collector — raiding economy');
      else if (chosen.building?.kind === 'refinery') this.log('spotted enemy refinery — raiding economy');
      return { x: chosen.transform.x, z: chosen.transform.z };
    }
    // nothing seen: scout known start areas first, then ore fields (map geography, not unit intel)
    const waypoints = [...this.scoutHints, ...this.hf.oreFields];
    if (waypoints.length === 0) waypoints.push({ x: 0, z: 0 });
    let waypoint = waypoints[this.scoutIndex % waypoints.length];
    // hold course until the squad actually arrives, then move to the next waypoint
    const scoutLead = squad.units[0];
    if (scoutLead && Math.hypot(scoutLead.transform.x - waypoint.x, scoutLead.transform.z - waypoint.z) < 50) {
      this.scoutIndex++;
      waypoint = waypoints[this.scoutIndex % waypoints.length];
    }
    return { x: waypoint.x, z: waypoint.z };
  }

  private log(message: string): void {
    console.info(`[ai] ${message}`);
  }
}
