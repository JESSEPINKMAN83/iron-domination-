import type { StructureKind, UnitKind } from '../content/phase3';
import type { Entity } from '../sim/components';
import {
  cancelStructureBuild,
  cancelUnitQueue,
  enterReadyStructurePlacement,
  issueHarvesterReturnOrder,
  issueHarvestOrder,
  placeStructure,
  queueUnit,
  setPrimaryProducer,
  setProducerRally,
  startStructureBuild,
  updatePlacement,
  type EconomyState,
} from '../sim/economy';
import type { Heightfield } from '../sim/heightfield';
import { issueAttackOrder, manualFireAt } from '../sim/combat';
import { purchaseUnitUpgrade, type UnitUpgradeId } from '../sim/upgrades';
import { areTeamsHostile, entityById, issueMoveOrder, stopEntities, type GameSim } from '../sim/world';
import { hashSim } from '../sim/world';
import { restoreEconomyState, restoreSerializedSim, serializeMatchState, type SerializedMatchState } from '../sim/serialize';
import { MultiplayerClient, type MultiplayerEvent, type MultiplayerSession, type TacticalPing, type TacticalPingKind } from './multiplayer';

export type NetCommand =
  | { type: 'move'; ids: number[]; x: number; z: number; attackMove: boolean; faceYaw?: number; formationSpread?: number }
  | { type: 'attack'; ids: number[]; targetId: number }
  | { type: 'harvest'; ids: number[]; x: number; z: number }
  | { type: 'return-harvesters'; ids: number[]; x: number; z: number }
  | { type: 'stop'; ids: number[] }
  | { type: 'start-structure'; kind: StructureKind }
  | { type: 'cancel-structure' }
  | { type: 'place-structure'; kind: StructureKind; x: number; z: number }
  | { type: 'queue-unit'; kind: UnitKind; producerId?: number }
  | { type: 'cancel-unit'; kind: UnitKind; producerId?: number }
  | { type: 'primary-producer'; producerId: number }
  | { type: 'rally'; producerId: number; x: number; z: number }
  | { type: 'upgrade-units'; ids: number[]; upgradeId: UnitUpgradeId }
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
  | { type: 'possess-fire'; id: number; followerIds?: number[]; slot: 'primary' | 'secondary' | 'special'; x: number; z: number; y?: number; aimYaw: number; targetId?: number }
  | { type: 'possess-follow'; leaderId: number; followerIds: number[]; x: number; z: number; faceYaw: number }
  | { type: 'possess-release'; id: number }
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
}

const DEFAULT_INPUT_DELAY_TICKS = 8;
const HASH_INTERVAL_TICKS = 30 * 5;
const HASH_HISTORY_TICKS = 30 * 30;

export class LockstepRuntime {
  private readonly queue: QueuedCommand[] = [];
  private readonly seen = new Set<string>();
  private connected = false;
  private roomPaused = false;
  private lastHashSent = 0;
  private recoveryPending = false;
  private peerMissing = false;
  private connectionInterrupted = false;
  private readonly hashHistory = new Map<number, number>();
  private estimatedRttMs = 160;
  private recoveryResumeTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: LockstepRuntimeOptions) {}

  get localTeam(): number {
    return this.options.session.player.index;
  }

  connect(): void {
    this.connected = true;
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
        if (this.connectionInterrupted) {
          this.connectionInterrupted = false;
          if (this.localTeam === 1) this.sendRecoverySnapshot('Reconnected — synchronizing match state');
          else {
            this.recoveryPending = true;
            this.roomPaused = true;
            void this.send(
              { type: 'snapshot-request', hash: hashSim(this.options.sim), expectedHash: 0, tick: this.options.sim.tick },
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
    return this.connected && !this.roomPaused;
  }

  tick(): void {
    const tick = this.options.sim.tick;
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
    this.rememberHash(tick, hashSim(this.options.sim));
    for (const queued of due) {
      if (queued.command.type === 'sim-hash') this.apply(queued.playerIndex, queued.command, queued.tick);
    }
    if (this.connected && !hasActivePossession(this.options.sim) && tick - this.lastHashSent >= HASH_INTERVAL_TICKS) {
      this.lastHashSent = tick;
      void this.send({ type: 'sim-hash', hash: this.hashHistory.get(tick)! }, tick);
    }
  }

  issue(command: NetCommand): boolean {
    const roomDelay = this.options.session.room.inputDelay ?? DEFAULT_INPUT_DELAY_TICKS;
    const tick = this.options.sim.tick + roomDelay;
    this.queue.push({ tick, playerIndex: this.localTeam, command });
    this.queue.sort((a, b) => a.tick - b.tick);
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
      this.connected = false;
      this.roomPaused = true;
      const message =
        event.playerIndex === this.localTeam ? 'You forfeited the match' : `${event.name || `Commander ${event.playerIndex}`} forfeited — victory`;
      this.options.onStatus?.(message, true);
      return;
    }
    if (event.type === 'room-state' || event.type === 'match-start') {
      if (event.type === 'match-start' && event.rematch) {
        this.options.onRematchStart?.();
        return;
      }
      const missing = event.room.players.some((player) => player.index !== this.localTeam && !player.connected);
      const connected = event.room.players.filter((player) => player.connected).length;
      const localPing = event.room.players.find((player) => player.index === this.localTeam)?.pingMs;
      if (Number.isFinite(localPing)) this.estimatedRttMs = Math.max(20, Math.min(500, Number(localPing)));
      const peerReconnected = this.peerMissing && !missing;
      this.peerMissing = missing;
      this.roomPaused = missing || this.recoveryPending;
      if (missing) this.options.onStatus?.('Opponent disconnected — match paused', true);
      else if (peerReconnected) {
        if (this.localTeam === 1) this.sendRecoverySnapshot('Opponent reconnected — synchronizing match state');
        else {
          this.recoveryPending = true;
          this.roomPaused = true;
          void this.send(
            { type: 'snapshot-request', hash: hashSim(this.options.sim), expectedHash: 0, tick: this.options.sim.tick },
            this.options.sim.tick,
          );
          this.options.onStatus?.('Reconnected — synchronizing with host');
        }
      } else if (connected >= event.room.armyCount && !this.recoveryPending) this.options.onStatus?.('All commanders connected');
      return;
    }
    if (event.type === 'room-closed') {
      this.clearRecoveryResumeTimer();
      this.connected = false;
      this.roomPaused = true;
      this.options.onStatus?.(roomClosedMessage(event.reason, this.localTeam), true);
      return;
    }
    if (event.type === 'tactical-ping') {
      if (!areTeamsHostile(this.options.sim, this.localTeam, event.playerIndex)) this.options.onTacticalPing?.(event);
      return;
    }
    if (event.type !== 'command') return;
    const command = event.command as NetCommand;
    if (!isNetCommand(command)) return;
    if (event.playerId === this.options.session.player.id) return;
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
    this.queue.push({ tick: event.tick, playerIndex: event.playerIndex, command });
    this.queue.sort((a, b) => a.tick - b.tick);
  }

  private apply(playerIndex: number, command: NetCommand, commandTick = this.options.sim.tick): void {
    const economy = this.options.economies[playerIndex];
    if (!economy) return;
    if (command.type === 'sim-hash') {
      if (hasActivePossession(this.options.sim) || this.recoveryPending) return;
      const localHash = this.hashHistory.get(commandTick);
      if (localHash === undefined) return;
      if (localHash !== command.hash) this.handleHashMismatch(localHash, command.hash);
      return;
    }
    if (command.type === 'snapshot-request') {
      if (this.localTeam === 1) this.sendRecoverySnapshot(`Snapshot requested after desync ${command.hash} vs ${command.expectedHash}`);
      return;
    }
    if (command.type === 'match-snapshot') {
      if (this.localTeam === 1 || !isSerializedMatchState(command.state)) return;
      this.restoreSnapshot(command.state, command.hash);
      return;
    }
    if (command.type === 'snapshot-applied') {
      if (this.localTeam !== 1 || !this.recoveryPending) return;
      const localHash = hashSim(this.options.sim);
      if (localHash === command.hash && this.options.sim.tick === command.tick) {
        void this.send({ type: 'snapshot-resume', hash: localHash, tick: command.tick }, command.tick);
        this.scheduleHostRecoveryResume(command.tick);
      } else {
        this.sendRecoverySnapshot(`Recovery acknowledgement differed — retrying snapshot (${localHash} vs ${command.hash})`);
      }
      return;
    }
    if (command.type === 'snapshot-resume') {
      if (this.localTeam === 1 || !this.recoveryPending) return;
      const localHash = hashSim(this.options.sim);
      if (localHash !== command.hash || this.options.sim.tick !== command.tick) return;
      this.recoveryPending = false;
      this.roomPaused = this.peerMissing;
      this.options.onStatus?.(`Match synchronized at tick ${command.tick}`);
      return;
    }
    if (command.type === 'move') {
      issueMoveOrder(this.options.sim, ownedEntities(this.options.sim, command.ids, playerIndex), command.x, command.z, command.attackMove, command.faceYaw, command.formationSpread);
    } else if (command.type === 'attack') {
      const target = entityById(this.options.sim, command.targetId);
      if (target) issueAttackOrder(this.options.sim, ownedEntities(this.options.sim, command.ids, playerIndex), target);
    } else if (command.type === 'harvest') {
      issueHarvestOrder(this.options.sim, ownedEntities(this.options.sim, command.ids, playerIndex), command.x, command.z);
    } else if (command.type === 'return-harvesters') {
      issueHarvesterReturnOrder(this.options.sim, ownedEntities(this.options.sim, command.ids, playerIndex), command.x, command.z);
    } else if (command.type === 'stop') {
      stopEntities(ownedEntities(this.options.sim, command.ids, playerIndex));
    } else if (command.type === 'start-structure') {
      startStructureBuild(this.options.sim, economy, command.kind);
    } else if (command.type === 'cancel-structure') {
      cancelStructureBuild(this.options.sim, economy);
    } else if (command.type === 'place-structure') {
      economy.selectedStructure = command.kind;
      economy.readyStructure = command.kind;
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
      purchaseUnitUpgrade(this.options.sim, economy, command.ids, command.upgradeId, playerIndex);
    } else if (command.type === 'possess-input') {
      const entity = ownedEntity(this.options.sim, command.id, playerIndex);
      if (!entity?.possessable || !entity.mover) return;
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
      const entity = ownedEntity(this.options.sim, command.id, playerIndex);
      if (!entity?.possessable) return;
      entity.playerControlled = {
        throttle: entity.playerControlled?.throttle ?? 0,
        turn: entity.playerControlled?.turn ?? 0,
        aimYaw: command.aimYaw,
        climb: entity.playerControlled?.climb ?? 0,
        strafe: entity.playerControlled?.strafe ?? 0,
        boost: entity.playerControlled?.boost ?? false,
      };
      if (entity.turret) entity.turret.yaw = Math.atan2(command.x - entity.transform.x, command.z - entity.transform.z);
      manualFireAt(this.options.sim, entity, command.x, command.z, command.slot, command.y, command.targetId);
      const followers = ownedEntities(this.options.sim, command.followerIds ?? [], playerIndex).filter((follower) => follower.id !== entity.id);
      for (const follower of followers) {
        if (follower.turret) follower.turret.yaw = Math.atan2(command.x - follower.transform.x, command.z - follower.transform.z);
        manualFireAt(this.options.sim, follower, command.x, command.z, command.slot, command.y);
        if (command.slot === 'secondary') manualFireAt(this.options.sim, follower, command.x, command.z, 'primary', command.y);
      }
    } else if (command.type === 'possess-follow') {
      if (!ownedEntity(this.options.sim, command.leaderId, playerIndex)) return;
      issueMoveOrder(
        this.options.sim,
        ownedEntities(this.options.sim, command.followerIds, playerIndex),
        command.x,
        command.z,
        false,
        command.faceYaw,
      );
    } else if (command.type === 'possess-release') {
      const entity = ownedEntity(this.options.sim, command.id, playerIndex);
      if (entity) delete entity.playerControlled;
    }
  }

  private handleHashMismatch(localHash: number, expectedHash: number): void {
    if (this.localTeam === 1) {
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

  private sendRecoverySnapshot(message: string): void {
    this.clearRecoveryResumeTimer();
    this.queue.length = 0;
    this.hashHistory.clear();
    this.rememberHash(this.options.sim.tick, hashSim(this.options.sim));
    const state = serializeMatchState(this.options.sim, Object.values(this.options.economies));
    this.recoveryPending = true;
    this.roomPaused = true;
    void this.send({ type: 'match-snapshot', state, hash: hashSim(this.options.sim), tick: this.options.sim.tick }, this.options.sim.tick);
    this.options.onStatus?.(message, true);
  }

  private restoreSnapshot(state: SerializedMatchState, expectedHash: number): void {
    restoreSerializedSim(this.options.sim, this.options.hf, state.sim);
    for (const economyState of state.economies) {
      const economy = this.options.economies[economyState.team];
      if (economy) restoreEconomyState(economy, this.options.sim, economyState);
    }
    this.queue.length = 0;
    this.hashHistory.clear();
    this.rememberHash(this.options.sim.tick, hashSim(this.options.sim));
    this.recoveryPending = true;
    this.roomPaused = true;
    this.options.onSnapshotRestored?.();
    const localHash = hashSim(this.options.sim);
    void this.send({ type: 'snapshot-applied', hash: localHash, tick: this.options.sim.tick }, this.options.sim.tick);
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
