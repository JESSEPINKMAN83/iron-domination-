import type { EnemyCommander } from '../ai/commander';
import type { Entity } from '../sim/components';
import type { EconomyState } from '../sim/economy';
import type { CombatEvent, GameSim } from '../sim/world';

export interface ArmyDebriefStats {
  team: number;
  side: number;
  label: string;
  isLocal: boolean;
  eliminated: boolean;
  credits: number;
  income: number;
  spent: number;
  refunds: number;
  unitsDeployed: number;
  unitsSurviving: number;
  unitLosses: number;
  buildingsConstructed: number;
  buildingsSurviving: number;
  buildingLosses: number;
  collectorsSurviving: number;
  shotsFired: number;
  hits: number;
  damageDealt: number;
  damageReceived: number;
  unitKills: number;
  buildingKills: number;
  attacksLaunched: number;
  rebuilds: number;
  retreats: number;
}

export interface MatchSnapshot {
  elapsedSeconds: number;
  playerCredits: number;
  playerBuildings: number;
  enemyBuildings: number;
  playerUnits: number;
  enemyUnits: number;
  playerCollectors: number;
  enemyCollectors: number;
  armies: ArmyDebriefStats[];
}

export interface DebriefArmyRuntime {
  team: number;
  side: number;
  economy: EconomyState;
  commander?: EnemyCommander;
  label?: string;
}

interface TrackedArmy {
  shotsFired: number;
  hits: number;
  damageDealt: number;
  damageReceived: number;
  unitKills: number;
  buildingKills: number;
  unitsDeployed: number;
  buildingsConstructed: number;
  unitLosses: number;
  buildingLosses: number;
}

interface EntityRecord {
  team: number;
  building: boolean;
}

function blankTrackedArmy(): TrackedArmy {
  return {
    shotsFired: 0,
    hits: 0,
    damageDealt: 0,
    damageReceived: 0,
    unitKills: 0,
    buildingKills: 0,
    unitsDeployed: 0,
    buildingsConstructed: 0,
    unitLosses: 0,
    buildingLosses: 0,
  };
}

function reportableEntity(entity: Entity): EntityRecord | undefined {
  if (!entity.team || (!entity.building && !entity.selectable)) return undefined;
  return { team: entity.team.id, building: Boolean(entity.building) };
}

function isWeaponLaunch(event: CombatEvent): boolean {
  return Boolean(event.sourceTeamId && event.weaponKind && !event.kind.endsWith('-impact') && event.kind !== 'impact-reaction');
}

function isDamageEvent(event: CombatEvent): boolean {
  return event.damage > 0 &&
    event.kind !== 'impact-reaction' &&
    event.kind !== 'crash' &&
    event.kind !== 'hard-bounce' &&
    !event.kind.endsWith('-launch');
}

/**
 * Lightweight, presentation-only match accounting. It observes the same event
 * stream already consumed by rendering/audio and never mutates deterministic sim state.
 */
export class BattleDebriefTracker {
  private readonly stats = new Map<number, TrackedArmy>();
  private readonly entities = new Map<number, EntityRecord>();
  private readonly countedDestroyed = new Set<number>();

  constructor(
    private readonly sim: GameSim,
    private readonly armies: DebriefArmyRuntime[],
    private readonly localTeam: number,
  ) {
    for (const army of armies) this.stats.set(army.team, blankTrackedArmy());
    for (const entity of sim.world.entities) this.trackEntity(entity, true);
    sim.world.onEntityAdded.subscribe((entity) => this.trackEntity(entity, false));
    sim.world.onEntityRemoved.subscribe((entity) => this.recordLoss(entity));
  }

  recordEvents(events: readonly CombatEvent[]): void {
    for (const event of events) {
      const source = event.sourceTeamId ? this.stats.get(event.sourceTeamId) : undefined;
      if (source && isWeaponLaunch(event)) source.shotsFired++;
      if (isDamageEvent(event)) {
        if (source) {
          source.damageDealt += event.damage;
          source.hits++;
        }
        const damageTarget = event.targetId === undefined ? undefined : this.entities.get(event.targetId);
        if (damageTarget) this.stats.get(damageTarget.team)!.damageReceived += event.damage;
      }
      const targetRecord = event.targetId === undefined ? undefined : this.entities.get(event.targetId);
      if (!event.killed || event.targetId === undefined || this.countedDestroyed.has(event.targetId)) continue;
      this.countedDestroyed.add(event.targetId);
      if (targetRecord) {
        const targetStats = this.stats.get(targetRecord.team);
        if (targetStats) {
          if (targetRecord.building) targetStats.buildingLosses++;
          else targetStats.unitLosses++;
        }
        if (source && targetRecord.team !== event.sourceTeamId) {
          if (targetRecord.building) source.buildingKills++;
          else source.unitKills++;
        }
      }
    }
  }

  snapshot(elapsedSeconds: number): MatchSnapshot {
    const armyReports = this.armies.map((army) => this.armySnapshot(army));
    const local = armyReports.find((army) => army.team === this.localTeam) ?? armyReports[0];
    const enemies = armyReports.filter((army) => army.side !== local.side);
    const sum = (pick: (army: ArmyDebriefStats) => number): number => enemies.reduce((total, army) => total + pick(army), 0);
    return {
      elapsedSeconds,
      playerCredits: local.credits,
      playerBuildings: local.buildingsSurviving,
      enemyBuildings: sum((army) => army.buildingsSurviving),
      playerUnits: local.unitsSurviving,
      enemyUnits: sum((army) => army.unitsSurviving),
      playerCollectors: local.collectorsSurviving,
      enemyCollectors: sum((army) => army.collectorsSurviving),
      armies: armyReports,
    };
  }

  private trackEntity(entity: Entity, initial: boolean): void {
    const record = reportableEntity(entity);
    if (!record || !this.stats.has(record.team) || this.entities.has(entity.id)) return;
    this.entities.set(entity.id, record);
    const stats = this.stats.get(record.team)!;
    if (record.building) stats.buildingsConstructed++;
    else stats.unitsDeployed++;
    if (entity.destroyed && !initial) this.recordLoss(entity);
  }

  private recordLoss(entity: Entity): void {
    const record = this.entities.get(entity.id);
    if (!record || !entity.destroyed || this.countedDestroyed.has(entity.id)) return;
    this.countedDestroyed.add(entity.id);
    const stats = this.stats.get(record.team);
    if (!stats) return;
    if (record.building) stats.buildingLosses++;
    else stats.unitLosses++;
  }

  private armySnapshot(army: DebriefArmyRuntime): ArmyDebriefStats {
    const tracked = this.stats.get(army.team) ?? blankTrackedArmy();
    let unitsSurviving = 0;
    let buildingsSurviving = 0;
    let collectorsSurviving = 0;
    for (const entity of this.sim.world.entities) {
      if (entity.team?.id !== army.team || entity.destroyed) continue;
      if (entity.building) buildingsSurviving++;
      else if (entity.selectable) unitsSurviving++;
      if (entity.harvester) collectorsSurviving++;
    }
    const income = army.economy.ledger
      .filter((entry) => entry.type === 'income')
      .reduce((total, entry) => total + entry.amount, 0);
    const spent = army.economy.ledger
      .filter((entry) => entry.type === 'spend')
      .reduce((total, entry) => total + Math.abs(entry.amount), 0);
    const refunds = army.economy.ledger
      .filter((entry) => entry.type === 'refund')
      .reduce((total, entry) => total + entry.amount, 0);
    const commander = army.commander?.stats;
    return {
      team: army.team,
      side: army.side,
      label: army.label ?? (army.team === this.localTeam ? 'YOUR ARMY' : `ARMY ${army.team}`),
      isLocal: army.team === this.localTeam,
      eliminated: buildingsSurviving === 0,
      credits: Math.round(army.economy.credits),
      income: Math.round(income),
      spent: Math.round(spent),
      refunds: Math.round(refunds),
      unitsDeployed: tracked.unitsDeployed,
      unitsSurviving,
      unitLosses: Math.max(tracked.unitLosses, tracked.unitsDeployed - unitsSurviving),
      buildingsConstructed: tracked.buildingsConstructed,
      buildingsSurviving,
      buildingLosses: Math.max(tracked.buildingLosses, tracked.buildingsConstructed - buildingsSurviving),
      collectorsSurviving,
      shotsFired: tracked.shotsFired,
      hits: tracked.hits,
      damageDealt: Math.round(tracked.damageDealt),
      damageReceived: Math.round(tracked.damageReceived),
      unitKills: tracked.unitKills,
      buildingKills: tracked.buildingKills,
      attacksLaunched: commander?.attacksLaunched ?? 0,
      rebuilds: commander?.rebuilds ?? 0,
      retreats: commander?.retreats ?? 0,
    };
  }
}
