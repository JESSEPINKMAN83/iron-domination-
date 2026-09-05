import type { StructureKind, UnitKind } from '../content/phase3';
import { isFortressTower } from '../content/fortress';
import type { Entity } from '../sim/components';
import {
  cancelStructureBuild,
  cancelUnitQueue,
  enterReadyStructurePlacement,
  hashEconomy,
  issueHarvesterReturnOrder,
  issueHarvestOrder,
  placeStructure,
  queueUnit,
  setPrimaryProducer,
  setProducerRally,
  startStructureBuild,
  upgradeEmberDroneQuantity,
  upgradeEmberDroneWarhead,
  upgradeStrategicAccuracy,
  upgradeStrategicMissile,
  updatePlacement,
  type EconomyState,
} from '../sim/economy';
import type { Heightfield } from '../sim/heightfield';
import { issueAttackOrder, issueGroundAttack, manualFireAt } from '../sim/combat';
import { purchaseUnitUpgrade, type UnitUpgradeId } from '../sim/upgrades';
import { areTeamsHostile, entityById, hashCriticalSimState, hashSim, issueMoveOrder, stopEntities, type GameSim } from '../sim/world';
import { issueTacticOrder } from '../sim/tactics';
import { launchEmberDroneAt, launchStrategicMissileAt } from '../sim/strategicWarfare';
import type { TacticEndAction } from '../sim/components';
import { restoreEconomyState, restoreSerializedSim, serializeMatchState, type SerializedMatchState } from '../sim/serialize';
import { MultiplayerClient, type MultiplayerEvent, type MultiplayerSession, type TacticalPing, type TacticalPingKind } from './multiplayer';

export type NetCommand =
  | { type: 'move'; ids: number[]; x: number; z: number; attackMove: boolean; faceYaw?: number; formationSpread?: number; sprint?: boolean }
  | { type: 'attack'; ids: number[]; targetId: number }
  | { type: 'ground-fire'; ids: number[]; x: number; z: number }
  | {
      type: 'tactic';
      ids: number[];
      waypoints: Array<{ x: number; z: number }>;
      endAction: 'hold' | 'attack-move' | 'attack';
      endTargetId?: number;
      sprint?: boolean;
    }
  | { type: 'harvest'; ids: number[]; x: number; z: number }
  | { type: 'return-harvesters'; ids: number[]; x: number; z: number }
  | { type: 'stop'; ids: number[] }
  | { type: 'start-structure'; kind: StructureKind }
  | { type: 'cancel-structure'; kind?: StructureKind }
  | { type: 'place-structure'; kind: StructureKind; x: number; z: number }
  | { type: 'queue-unit'; kind: UnitKind; producerId?: number }
  | { type: 'cancel-unit'; kind: UnitKind; producerId?: number }
  | { type: 'primary-producer'; producerId: number }
  | { type: 'rally'; producerId: number; x: number; z: number }
  | { type: 'upgrade-units'; ids: number[]; upgradeId: UnitUpgradeId }
  | { type: 'upgrade-strategic'; upgrade: 'accuracy' | 'warhead' | 'ember-quantity' | 'ember-warhead' }
  | { type: 'launch-strategic'; weapon: 'missile' | 'ember'; enemyTeam: number; x: number; z: number }
  | {
      type: 'possess-input';
      id: number;
      throttle: number;
      turn: number;
      aimYaw: number;
      climb?: number;
      strafe?: number;
      boost?: boolean;
    }
  | { type: 'possess-fire'; id: number; followerIds?: number[]; slot: 'primary' | 'secondary' | 'special'; x: number; z: number; y?: number; aimYaw: number; targetId?: number; strategicTargetId?: number }
  | { type: 'possess-follow'; leaderId: number; followerIds: number[]; x: number; z: number; faceYaw: number }
  | { type: 'possess-release'; id: number }
  | { type: 'tick-ready' }
  | { type: 'sim-hash'; hash: number }
  | { type: 'snapshot-request'; hash: number; expectedHash: number; tick: number }
  | { type: 'match-snapshot'; state: SerializedMatchState; hash: number; tick: number }
  | { type: 'snapshot-applied'; hash: number; tick: number }
  | { type: 'snapshot-resume'; hash: number; tick: number };

interface QueuedCommand {
  tick: number;
  playerIndex: number;
  command: NetCommand;
}

export interface LockstepRuntimeOptions {
  sim: GameSim;
  hf: Heightfield;
  economies: Record<number, EconomyState>;
  client: MultiplayerClient;
  session: MultiplayerSession;
  onStatus?: (message: string, bad?: boolean) => void;
  onSnapshotRestored?: () => void;
  onTacticalPing?: (ping: TacticalPing) => void;
  onRematchStart?: () => void;
  onRoomClosed?: () => void;
  /** A forfeit ends the match without destroying anything, so the runtime reports it. */
  onMatchOutcome?: (outcome: 'victory' | 'defeat') => void;
}

export function hashMultiplayerState(
  sim: GameSim,
  economies: Iterable<EconomyState>,
  criticalOnly = false,
): number {
  let hash = criticalOnly ? hashCriticalSimState(sim) : hashSim(sim);
  for (const economy of Array.from(economies).sort((a, b) => a.team - b.team)) {
    hash = Math.imul((hash ^ hashEconomy(economy)) >>> 0, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const DEFAULT_INPUT_DELAY_TICKS = 8;
const FULL_HASH_INTERVAL_TICKS = 30 * 5;
const CRITICAL_HASH_INTERVAL_TICKS = 30;
const HASH_HISTORY_TICKS = 30 * 30;

export class LockstepRuntime {
  private readonly queue: QueuedCommand[] = [];
  private readonly seen = new Set<string>();
  private connected = false;
  private roomPaused = false;
  private lastHashSent = 0;
  private recoveryPending = false;
  private peerMissing = false;
  private connectedPlayerCount = 0;
  private connectionInterrupted = false;
  private readonly hashHistory = new Map<number, number>();
  private estimatedRttMs = 160;
  private recoveryResumeTimer?: ReturnType<typeof setTimeout>;
  private lateRemoteCommandTick?: number;
  private readonly possessionOwners = new Map<number, number>();
  private readonly readyPlayersByTick = new Map<number, Set<number>>();
  private barrierEnabled = false;
  private barrierWaitStartedAt?: number;
  private barrierWaitingShown = false;

  constructor(private readonly options: LockstepRuntimeOptions) {}

  get localTeam(): number {
    return this.options.session.player.armyId ?? this.options.session.player.index;
  }

  get localPlayerIndex(): number {
    return this.options.session.player.index;
  }

  get canManageEconomy(): boolean {
    return (this.options.session.player.role ?? 'commander') === 'commander';
  }

  canPossess(entityId: number): boolean {
    const owner = this.possessionOwners.get(entityId);
    return owner === undefined || owner === this.localPlayerIndex;
  }

  private get isHost(): boolean {
    const hostPlayerId = this.options.session.room.hostPlayerId ?? this.options.session.room.players.find((player) => player.index === 1)?.id;
    return hostPlayerId ? hostPlayerId === this.options.session.player.id : this.localPlayerIndex === 1;
  }

  connect(): void {
    const rejoinedAfterRefresh = this.options.session.rejoinedAfterRefresh === true;
    this.options.session.rejoinedAfterRefresh = false;
    this.connected = true;
    this.barrierEnabled = this.options.session.room.players.filter((player) => player.connected).length > 1;
    this.primeTickBarrier(this.options.sim.tick);
    this.options.onStatus?.('Multiplayer connected');
    this.options.client.connect(
      this.options.session.room.code,
      this.options.session.player.id,
      (event) => this.handleEvent(event),
      () => {
        this.connected = false;
        this.roomPaused = true;
        this.connectionInterrupted = true;
        this.options.onStatus?.('Multiplayer connection interrupted', true);
      },
      () => {
        this.connected = true;
        if (this.connectionInterrupted || rejoinedAfterRefresh) {
          this.connectionInterrupted = false;
          if (this.isHost) this.sendRecoverySnapshot('Reconnected — synchronizing match state');
          else {
            this.recoveryPending = true;
            this.roomPaused = true;
            void this.send(
              { type: 'snapshot-request', hash: this.currentHash(), expectedHash: 0, tick: this.options.sim.tick },
              this.options.sim.tick,
            );
            this.options.onStatus?.('Reconnected — synchronizing with host');
          }
        } else {
          this.options.onStatus?.('Multiplayer connected');
        }
      },
    );
  }

  disconnect(): void {
    this.clearRecoveryResumeTimer();
    this.options.client.disconnect();
    this.connected = false;
  }

  canAdvance(): boolean {
    if (!this.connected || this.roomPaused) return false;
    if (!this.barrierEnabled) return true;
    const ready = this.readyPlayersByTick.get(this.options.sim.tick);
    const waiting = this.requiredPlayerIndexes().some((playerIndex) => !ready?.has(playerIndex));
    if (!waiting) {
      if (this.barrierWaitingShown) this.options.onStatus?.(`Network synchronized at tick ${this.options.sim.tick}`);
      this.barrierWaitStartedAt = undefined;
      this.barrierWaitingShown = false;
      return true;
    }
    this.barrierWaitStartedAt ??= Date.now();
    if (!this.barrierWaitingShown && Date.now() - this.barrierWaitStartedAt >= 500) {
      this.barrierWaitingShown = true;
      this.options.onStatus?.(`Waiting for player input at tick ${this.options.sim.tick}`);
    }
    return false;
  }

  tick(): void {
    const tick = this.options.sim.tick;
    this.pruneTickBarrier(tick);
    const due: QueuedCommand[] = [];
    for (let i = 0; i < this.queue.length; ) {
      const queued = this.queue[i];
      if (queued.tick > tick) {
        i++;
        continue;
      }
      due.push(queued);
      this.queue.splice(i, 1);
    }
    for (const queued of due) {
      if (queued.command.type !== 'sim-hash') this.apply(queued.playerIndex, queued.command, queued.tick);
    }
    if (this.lateRemoteCommandTick !== undefined && !this.recoveryPending) {
      const lateTick = this.lateRemoteCommandTick;
      this.lateRemoteCommandTick = undefined;
      this.handleLateRemoteCommand(lateTick);
      return;
    }
    const criticalOnly = hasActivePossession(this.options.sim);
    this.rememberHash(tick, this.currentHash(criticalOnly));
    for (const queued of due) {
      if (queued.command.type === 'sim-hash') this.apply(queued.playerIndex, queued.command, queued.tick);
    }
    const hashInterval = criticalOnly ? CRITICAL_HASH_INTERVAL_TICKS : FULL_HASH_INTERVAL_TICKS;
    if (this.connected && tick - this.lastHashSent >= hashInterval) {
      this.lastHashSent = tick;
      void this.send({ type: 'sim-hash', hash: this.hashHistory.get(tick)! }, tick);
    }
    this.closeTickPacket(tick + (this.options.session.room.inputDelay ?? DEFAULT_INPUT_DELAY_TICKS));
  }

  issue(command: NetCommand): boolean {
    const roomDelay = this.options.session.room.inputDelay ?? DEFAULT_INPUT_DELAY_TICKS;
    const tick = this.options.sim.tick + roomDelay;
    if (isEconomyCommand(command) && !this.canManageEconomy) {
      this.options.onStatus?.('Field Officers can command and possess units; the Commander manages production.', true);
      return false;
    }
    this.queue.push({ tick, playerIndex: this.localPlayerIndex, command });
    sortCommandQueue(this.queue);
    void this.send(command, tick);
    return true;
  }

  sendTacticalPing(kind: TacticalPingKind, x: number, z: number): void {
    try {
      this.options.client.sendTacticalPing(this.options.session.room.code, this.options.session.player.id, kind, x, z);
    } catch (err) {
      this.options.onStatus?.(`Tactical ping failed: ${String((err as Error).message ?? err)}`, true);
    }
  }

  requestRematch(): void {
    try {
      this.options.client.requestRematch(this.options.session.room.code, this.options.session.player.id);
    } catch (err) {
      this.options.onStatus?.(`Rematch request failed: ${String((err as Error).message ?? err)}`, true);
    }
  }

  private async send(command: NetCommand, tick = this.options.sim.tick + (this.options.session.room.inputDelay ?? DEFAULT_INPUT_DELAY_TICKS)): Promise<void> {
    try {
      await this.options.client.sendCommand(this.options.session.room.code, this.options.session.player.id, tick, command);
    } catch (err) {
      this.options.onStatus?.(`Command send failed: ${String((err as Error).message ?? err)}`, true);
    }
  }

  private handleEvent(event: MultiplayerEvent): void {
    if (!this.connected) this.options.onStatus?.('Multiplayer connected');
    this.connected = true;
    if (event.type === 'heartbeat') return;
    if (event.type === 'player-forfeit') {
      const armyDefeated = event.armyDefeated !== false;
      const isLocal = event.playerId === this.options.session.player.id;
      if (armyDefeated || isLocal) {
        this.connected = false;
        this.roomPaused = true;
      }
      const message = isLocal
        ? 'You left the match'
        : armyDefeated
          ? `${event.name || `Commander ${event.playerIndex}`} forfeited — victory`
          : `${event.name || `Player ${event.playerIndex}`} left; their teammate remains in command`;
      this.options.onStatus?.(message, true);
      // A teammate leaving while their army fights on is not an outcome for anyone.
      if (isLocal) this.options.onMatchOutcome?.('defeat');
      else if (armyDefeated) this.options.onMatchOutcome?.('victory');
      return;
    }
    if (event.type === 'room-state' || event.type === 'match-start') {
      this.options.session.room = event.room;
      const latestLocalPlayer = event.room.players.find((player) => player.id === this.options.session.player.id);
      if (latestLocalPlayer) this.options.session.player = latestLocalPlayer;
      if (event.type === 'match-start' && event.rematch) {
        this.options.onRematchStart?.();
        return;
      }
      const representedArmies = new Set(event.room.players.map((player) => player.armyId ?? player.index));
      const missing = Array.from(representedArmies).some(
        (armyId) => armyId !== this.localTeam && !event.room.players.some(
          (player) => (player.armyId ?? player.index) === armyId && player.connected,
        ),
      );
      const disconnectedIndexes = new Set(event.room.players.filter((player) => !player.connected).map((player) => player.index));
      let releasedPossession = false;
      for (const [entityId, ownerIndex] of this.possessionOwners) {
        if (!disconnectedIndexes.has(ownerIndex)) continue;
        this.possessionOwners.delete(entityId);
        const entity = entityById(this.options.sim, entityId);
        if (entity) delete entity.playerControlled;
        releasedPossession = true;
      }
      const connected = event.room.players.filter((player) => player.connected).length;
      const localPing = event.room.players.find((player) => player.id === this.options.session.player.id)?.pingMs;
      if (Number.isFinite(localPing)) this.estimatedRttMs = Math.max(20, Math.min(500, Number(localPing)));
      const previousConnected = this.connectedPlayerCount;
      this.connectedPlayerCount = connected;
      const peerReconnected = this.peerMissing && !missing;
      const peerDisconnected = !this.peerMissing && missing;
      this.peerMissing = missing;
      this.roomPaused = missing || this.recoveryPending;
      if (releasedPossession && this.isHost && !this.recoveryPending) {
        this.sendRecoverySnapshot('Teammate control released after disconnect — synchronizing match state');
      }
      if (peerDisconnected || (missing && previousConnected !== connected)) this.options.onStatus?.('Opponent disconnected — match paused', true);
      else if (peerReconnected) {
        if (this.isHost) this.sendRecoverySnapshot('Opponent reconnected — synchronizing match state');
        else {
          this.recoveryPending = true;
          this.roomPaused = true;
          void this.send(
            { type: 'snapshot-request', hash: this.currentHash(), expectedHash: 0, tick: this.options.sim.tick },
            this.options.sim.tick,
          );
          this.options.onStatus?.('Reconnected — synchronizing with host');
        }
      } else if (connected >= event.room.armyCount && previousConnected < event.room.armyCount && !this.recoveryPending) {
        this.options.onStatus?.('All commanders connected');
      }
      return;
    }
    if (event.type === 'room-closed') {
      this.clearRecoveryResumeTimer();
      this.connected = false;
      this.roomPaused = true;
      this.options.onRoomClosed?.();
      this.options.onStatus?.(roomClosedMessage(event.reason, this.localTeam), true);
      return;
    }
    if (event.type === 'tactical-ping') {
      if (!areTeamsHostile(this.options.sim, this.localTeam, event.armyId ?? event.playerIndex)) this.options.onTacticalPing?.(event);
      return;
    }
    if (event.type !== 'command') return;
    const command = event.command as NetCommand;
    if (!isNetCommand(command)) return;
    if (event.playerId === this.options.session.player.id) return;
    if (command.type === 'tick-ready') {
      this.markTickReady(event.tick, event.playerIndex);
      return;
    }
    const key = `${event.playerId}:${event.tick}:${JSON.stringify(command)}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (
      command.type === 'snapshot-request' ||
      command.type === 'match-snapshot' ||
      command.type === 'snapshot-applied' ||
      command.type === 'snapshot-resume'
    ) {
      this.apply(event.playerIndex, command, event.tick);
      return;
    }
    // Steering is continuous state, not a one-shot action. Applying a delayed
    // steering update immediately is smoother and safe; the frequent critical
    // hash still catches any resulting health/death disagreement. Discrete
    // actions such as firing must continue to trigger authoritative recovery.
    const latencyTolerantControl = command.type === 'possess-input';
    if (!this.recoveryPending && command.type !== 'sim-hash' && !latencyTolerantControl && event.tick < this.options.sim.tick) {
      this.lateRemoteCommandTick = this.lateRemoteCommandTick === undefined
        ? event.tick
        : Math.min(this.lateRemoteCommandTick, event.tick);
    }
    this.queue.push({ tick: event.tick, playerIndex: event.playerIndex, command });
    sortCommandQueue(this.queue);
  }

  private apply(playerIndex: number, command: NetCommand, commandTick = this.options.sim.tick): void {
    const player = this.options.session.room.players.find((candidate) => candidate.index === playerIndex);
    const team = player?.armyId ?? playerIndex;
    const economy = this.options.economies[team];
    if (!economy) return;
    if (isEconomyCommand(command) && (player?.role ?? 'commander') !== 'commander') return;
    if (command.type === 'sim-hash') {
      if (this.recoveryPending) return;
      const localHash = this.hashHistory.get(commandTick);
      if (localHash === undefined) return;
      if (localHash !== command.hash) this.handleHashMismatch(localHash, command.hash);
      return;
    }
    if (command.type === 'snapshot-request') {
      if (this.isHost) this.sendRecoverySnapshot(`Snapshot requested after desync ${command.hash} vs ${command.expectedHash}`);
      return;
    }
    if (command.type === 'match-snapshot') {
      if (this.isHost || !isSerializedMatchState(command.state)) return;
      this.restoreSnapshot(command.state, command.hash);
      return;
    }
    if (command.type === 'snapshot-applied') {
      if (!this.isHost || !this.recoveryPending) return;
      const localHash = this.currentHash();
      if (localHash === command.hash && this.options.sim.tick === command.tick) {
        // The acknowledgement proves this peer restored the host's exact tick. Mark
        // it ready explicitly in case its tick-ready packet raced this handshake.
        this.markTickReady(command.tick, playerIndex);
        void this.send({ type: 'snapshot-resume', hash: localHash, tick: command.tick }, command.tick);
        this.primeTickBarrier(command.tick);
        this.scheduleHostRecoveryResume(command.tick);
      } else {
        this.sendRecoverySnapshot(`Recovery acknowledgement differed — retrying snapshot (${localHash} vs ${command.hash})`);
      }
      return;
    }
    if (command.type === 'snapshot-resume') {
      if (this.isHost || !this.recoveryPending) return;
      const localHash = this.currentHash();
      if (localHash !== command.hash || this.options.sim.tick !== command.tick) return;
      // A matching resume packet likewise proves the host is ready at this tick.
      this.markTickReady(command.tick, playerIndex);
      this.recoveryPending = false;
      this.roomPaused = this.peerMissing;
      this.options.onStatus?.(`Match synchronized at tick ${command.tick}`);
      return;
    }
    if (command.type === 'move') {
      issueMoveOrder(
        this.options.sim,
        ownedEntities(this.options.sim, command.ids, team),
        command.x,
        command.z,
        command.attackMove,
        command.faceYaw,
        command.formationSpread,
        command.sprint,
      );
    } else if (command.type === 'tactic') {
      const endAction = tacticEndActionFromCommand(command);
      if (endAction) {
        issueTacticOrder(
          this.options.sim,
          ownedEntities(this.options.sim, command.ids, team),
          command.waypoints,
          endAction,
          command.sprint,
        );
      }
    } else if (command.type === 'attack') {
      const target = entityById(this.options.sim, command.targetId);
      if (target) issueAttackOrder(this.options.sim, ownedEntities(this.options.sim, command.ids, team), target);
    } else if (command.type === 'ground-fire') {
      issueGroundAttack(this.options.sim, ownedEntities(this.options.sim, command.ids, team), command.x, command.z);
    } else if (command.type === 'harvest') {
      issueHarvestOrder(this.options.sim, ownedEntities(this.options.sim, command.ids, team), command.x, command.z);
    } else if (command.type === 'return-harvesters') {
      issueHarvesterReturnOrder(this.options.sim, ownedEntities(this.options.sim, command.ids, team), command.x, command.z);
    } else if (command.type === 'stop') {
      stopEntities(ownedEntities(this.options.sim, command.ids, team));
    } else if (command.type === 'start-structure') {
      startStructureBuild(this.options.sim, economy, command.kind);
    } else if (command.type === 'cancel-structure') {
      cancelStructureBuild(this.options.sim, economy, command.kind);
    } else if (command.type === 'place-structure') {
      economy.selectedStructure = command.kind;
      const placement = updatePlacement(this.options.sim, this.options.hf, command.kind, command.x, command.z, economy.team, economy);
      placeStructure(this.options.sim, this.options.hf, economy, placement);
      economy.selectedStructure = undefined;
      economy.placement = undefined;
    } else if (command.type === 'queue-unit') {
      queueUnit(this.options.sim, economy, command.kind, command.producerId ? entityById(this.options.sim, command.producerId) : undefined);
    } else if (command.type === 'cancel-unit') {
      cancelUnitQueue(this.options.sim, economy, command.kind, command.producerId ? entityById(this.options.sim, command.producerId) : undefined);
    } else if (command.type === 'primary-producer') {
      const producer = entityById(this.options.sim, command.producerId);
      if (producer) setPrimaryProducer(economy, producer);
    } else if (command.type === 'rally') {
      const producer = entityById(this.options.sim, command.producerId);
      if (producer) setProducerRally(this.options.sim, economy, producer, command.x, command.z);
    } else if (command.type === 'upgrade-units') {
      purchaseUnitUpgrade(this.options.sim, economy, command.ids, command.upgradeId, team);
    } else if (command.type === 'upgrade-strategic') {
      if (command.upgrade === 'accuracy') upgradeStrategicAccuracy(this.options.sim, economy);
      else if (command.upgrade === 'warhead') upgradeStrategicMissile(this.options.sim, economy);
      else if (command.upgrade === 'ember-quantity') upgradeEmberDroneQuantity(this.options.sim, economy);
      else upgradeEmberDroneWarhead(this.options.sim, economy);
    } else if (command.type === 'launch-strategic') {
      if (command.weapon === 'ember') launchEmberDroneAt(this.options.sim, economy, command.enemyTeam, command.x, command.z);
      else launchStrategicMissileAt(this.options.sim, economy, command.enemyTeam, command.x, command.z);
    } else if (command.type === 'possess-input') {
      const entity = ownedEntity(this.options.sim, command.id, team);
      if (!entity?.possessable || (!entity.mover && !isFortressTower(entity))) return;
      const owner = this.possessionOwners.get(entity.id);
      if (owner !== undefined && owner !== playerIndex) return;
      this.possessionOwners.set(entity.id, playerIndex);
      entity.playerControlled = {
        throttle: clampUnit(command.throttle),
        turn: clampUnit(command.turn),
        aimYaw: command.aimYaw,
        climb: clampUnit(command.climb ?? 0),
        strafe: clampUnit(command.strafe ?? 0),
        boost: Boolean(command.boost),
      };
      if (entity.turret) entity.turret.yaw = command.aimYaw;
    } else if (command.type === 'possess-fire') {
      const entity = ownedEntity(this.options.sim, command.id, team);
      if (!entity?.possessable) return;
      const owner = this.possessionOwners.get(entity.id);
      if (owner !== undefined && owner !== playerIndex) return;
      this.possessionOwners.set(entity.id, playerIndex);
      entity.playerControlled = {
        throttle: entity.playerControlled?.throttle ?? 0,
        turn: entity.playerControlled?.turn ?? 0,
        aimYaw: command.aimYaw,
        climb: entity.playerControlled?.climb ?? 0,
        strafe: entity.playerControlled?.strafe ?? 0,
        boost: entity.playerControlled?.boost ?? false,
      };
      if (entity.turret) entity.turret.yaw = Math.atan2(command.x - entity.transform.x, command.z - entity.transform.z);
      manualFireAt(this.options.sim, entity, command.x, command.z, command.slot, command.y, command.targetId, command.strategicTargetId);
      const followers = ownedEntities(this.options.sim, command.followerIds ?? [], team).filter((follower) => follower.id !== entity.id);
      for (const follower of followers) {
        if (follower.turret) follower.turret.yaw = Math.atan2(command.x - follower.transform.x, command.z - follower.transform.z);
        manualFireAt(this.options.sim, follower, command.x, command.z, command.slot, command.y, undefined, command.strategicTargetId);
        if (command.slot === 'secondary') manualFireAt(this.options.sim, follower, command.x, command.z, 'primary', command.y, undefined, command.strategicTargetId);
      }
    } else if (command.type === 'possess-follow') {
      if (!ownedEntity(this.options.sim, command.leaderId, team)) return;
      issueMoveOrder(
        this.options.sim,
        ownedEntities(this.options.sim, command.followerIds, team),
        command.x,
        command.z,
        false,
        command.faceYaw,
      );
    } else if (command.type === 'possess-release') {
      const entity = ownedEntity(this.options.sim, command.id, team);
      const owner = entity ? this.possessionOwners.get(entity.id) : undefined;
      if (entity && (owner === undefined || owner === playerIndex)) {
        this.possessionOwners.delete(entity.id);
        delete entity.playerControlled;
      }
    }
  }

  private handleHashMismatch(localHash: number, expectedHash: number): void {
    if (this.isHost) {
      this.sendRecoverySnapshot(`Desync detected — sent recovery snapshot (${localHash} vs ${expectedHash})`);
      return;
    }
    if (!this.recoveryPending) {
      this.recoveryPending = true;
      this.roomPaused = true;
      void this.send({ type: 'snapshot-request', hash: localHash, expectedHash, tick: this.options.sim.tick }, this.options.sim.tick);
    }
    this.options.onStatus?.(`Desync detected — requesting host snapshot (${localHash} vs ${expectedHash})`, true);
  }

  private handleLateRemoteCommand(commandTick: number): void {
    const localHash = this.currentHash();
    if (this.isHost) {
      this.sendRecoverySnapshot(`Late network command for tick ${commandTick} — resynchronizing combat state`);
      return;
    }
    this.recoveryPending = true;
    this.roomPaused = true;
    void this.send({ type: 'snapshot-request', hash: localHash, expectedHash: 0, tick: this.options.sim.tick }, this.options.sim.tick);
    this.options.onStatus?.(`Late network command for tick ${commandTick} — requesting host state`, true);
  }

  private sendRecoverySnapshot(message: string): void {
    this.clearRecoveryResumeTimer();
    this.lateRemoteCommandTick = undefined;
    this.queue.length = 0;
    this.hashHistory.clear();
    this.resetTickBarrier();
    this.rememberHash(this.options.sim.tick, this.currentHash());
    const state = serializeMatchState(this.options.sim, Object.values(this.options.economies));
    this.recoveryPending = true;
    this.roomPaused = true;
    void this.send({ type: 'match-snapshot', state, hash: this.currentHash(), tick: this.options.sim.tick }, this.options.sim.tick);
    this.options.onStatus?.(message, true);
  }

  private restoreSnapshot(state: SerializedMatchState, expectedHash: number): void {
    restoreSerializedSim(this.options.sim, this.options.hf, state.sim);
    this.possessionOwners.clear();
    for (const economyState of state.economies) {
      const economy = this.options.economies[economyState.team];
      if (economy) restoreEconomyState(economy, this.options.sim, economyState);
    }
    this.queue.length = 0;
    this.lateRemoteCommandTick = undefined;
    this.hashHistory.clear();
    this.resetTickBarrier();
    this.rememberHash(this.options.sim.tick, this.currentHash());
    this.recoveryPending = true;
    this.roomPaused = true;
    this.options.onSnapshotRestored?.();
    const localHash = this.currentHash();
    void this.send({ type: 'snapshot-applied', hash: localHash, tick: this.options.sim.tick }, this.options.sim.tick);
    this.primeTickBarrier(this.options.sim.tick);
    this.options.onStatus?.(
      localHash === expectedHash ? `Snapshot applied at tick ${state.sim.tick} — waiting for host` : `Recovered snapshot hash differs: ${localHash} vs ${expectedHash}`,
      localHash !== expectedHash,
    );
  }

  private scheduleHostRecoveryResume(tick: number): void {
    this.clearRecoveryResumeTimer();
    const delayMs = Math.max(35, Math.min(250, this.estimatedRttMs * 0.5));
    this.recoveryResumeTimer = setTimeout(() => {
      this.recoveryResumeTimer = undefined;
      this.recoveryPending = false;
      this.roomPaused = this.peerMissing;
      this.options.onStatus?.(`Match synchronized at tick ${tick}`);
    }, delayMs);
  }

  private currentHash(criticalOnly = false): number {
    return hashMultiplayerState(this.options.sim, Object.values(this.options.economies), criticalOnly);
  }

  private requiredPlayerIndexes(): number[] {
    return this.options.session.room.players
      .filter((player) => player.connected)
      .map((player) => player.index)
      .sort((a, b) => a - b);
  }

  private markTickReady(tick: number, playerIndex: number): void {
    if (!this.barrierEnabled || tick < this.options.sim.tick) return;
    let ready = this.readyPlayersByTick.get(tick);
    if (!ready) {
      ready = new Set<number>();
      this.readyPlayersByTick.set(tick, ready);
    }
    ready.add(playerIndex);
  }

  private closeTickPacket(tick: number): void {
    if (!this.barrierEnabled) return;
    this.markTickReady(tick, this.localPlayerIndex);
    void this.send({ type: 'tick-ready' }, tick);
  }

  private primeTickBarrier(startTick: number): void {
    if (!this.barrierEnabled) return;
    const delay = this.options.session.room.inputDelay ?? DEFAULT_INPUT_DELAY_TICKS;
    for (let tick = startTick; tick < startTick + delay; tick++) this.closeTickPacket(tick);
  }

  private pruneTickBarrier(currentTick: number): void {
    for (const tick of this.readyPlayersByTick.keys()) {
      if (tick < currentTick) this.readyPlayersByTick.delete(tick);
    }
  }

  private resetTickBarrier(): void {
    this.readyPlayersByTick.clear();
    this.barrierWaitStartedAt = undefined;
    this.barrierWaitingShown = false;
  }

  private clearRecoveryResumeTimer(): void {
    if (this.recoveryResumeTimer === undefined) return;
    clearTimeout(this.recoveryResumeTimer);
    this.recoveryResumeTimer = undefined;
  }

  private rememberHash(tick: number, hash: number): void {
    this.hashHistory.set(tick, hash);
    const oldestTick = tick - HASH_HISTORY_TICKS;
    for (const recordedTick of this.hashHistory.keys()) {
      if (recordedTick >= oldestTick) break;
      this.hashHistory.delete(recordedTick);
    }
  }
}

function ownedEntity(sim: GameSim, id: number, team: number): Entity | undefined {
  const entity = entityById(sim, id);
  return entity && !entity.destroyed && entity.team?.id === team ? entity : undefined;
}

function ownedEntities(sim: GameSim, ids: number[], team: number): Entity[] {
  return ids
    .map((id) => entityById(sim, id))
    .filter((entity): entity is Entity => !!entity && !entity.destroyed && entity.team?.id === team);
}

function tacticEndActionFromCommand(
  command: Extract<NetCommand, { type: 'tactic' }>,
): TacticEndAction | undefined {
  if (command.endAction === 'hold') return { kind: 'hold' };
  if (command.endAction === 'attack-move') return { kind: 'attack-move' };
  if (command.endAction === 'attack' && Number.isInteger(command.endTargetId) && (command.endTargetId ?? 0) > 0) {
    return { kind: 'attack', targetId: command.endTargetId! };
  }
  return undefined;
}

function sortCommandQueue(queue: QueuedCommand[]): void {
  queue.sort((a, b) => a.tick - b.tick || a.playerIndex - b.playerIndex);
}

function isEconomyCommand(command: NetCommand): boolean {
  return command.type === 'start-structure' ||
    command.type === 'cancel-structure' ||
    command.type === 'place-structure' ||
    command.type === 'queue-unit' ||
    command.type === 'cancel-unit' ||
    command.type === 'primary-producer' ||
    command.type === 'upgrade-units' ||
    command.type === 'upgrade-strategic' ||
    command.type === 'launch-strategic';
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function hasActivePossession(sim: GameSim): boolean {
  return sim.world.entities.some((entity) => !entity.destroyed && !!entity.playerControlled);
}

function isNetCommand(value: unknown): value is NetCommand {
  return !!value && typeof value === 'object' && 'type' in value && typeof (value as { type: unknown }).type === 'string';
}

function isSerializedMatchState(value: unknown): value is SerializedMatchState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<SerializedMatchState>;
  return state.version === 1 && !!state.sim && Array.isArray(state.economies);
}

function roomClosedMessage(reason: string, localTeam: number): string {
  const forfeit = /^forfeit:(\d+)$/.exec(reason);
  if (forfeit) {
    const team = Number(forfeit[1]);
    return team === localTeam ? 'You forfeited the match' : `Commander ${team} forfeited — victory`;
  }
  const disconnect = /^disconnect-timeout:(\d+)$/.exec(reason);
  if (disconnect) {
    const team = Number(disconnect[1]);
    return team === localTeam ? 'Connection recovery timed out — defeat' : `Commander ${team} did not reconnect — victory`;
  }
  if (reason === 'reconnect-expired') return 'Could not recover the multiplayer room';
  return `Room closed: ${reason}`;
}
