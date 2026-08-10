import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { advanceTick } from '../match/advanceTick';
import { createEconomy, createInitialBase } from '../sim/economy';
import { generateHeightfield } from '../sim/heightfield';
import { createGameSim, spawnTankAt } from '../sim/world';
import { hashMultiplayerState, LockstepRuntime } from './commands';
import type { MultiplayerClient, MultiplayerEvent, MultiplayerPlayer, MultiplayerRoom, MultiplayerSession } from './multiplayer';

describe('two-peer lockstep barrier', () => {
  it('stalls a faster peer until delayed tick packets arrive and still converges', () => {
    const room: MultiplayerRoom = {
      code: 'SYNC',
      seed: 1,
      ai: 'normal',
      aiStyle: 'balanced',
      armyCount: 2,
      armySides: [1, 2, 3, 4],
      inputDelay: 4,
      status: 'in-game',
      hostPlayerId: 'host',
      players: [
        { id: 'host', index: 1, armyId: 1, role: 'commander', name: 'Host', connected: true },
        { id: 'guest', index: 2, armyId: 2, role: 'commander', name: 'Guest', connected: true },
      ],
    };
    const bus = new DelayedCommandBus(room.players);
    const host = createPeer(room, room.players[0], bus);
    const guest = createPeer(room, room.players[1], bus);

    host.runtime.connect();
    guest.runtime.connect();
    expect(host.runtime.canAdvance()).toBe(false);
    expect(guest.runtime.canAdvance()).toBe(false);

    host.runtime.issue({ type: 'start-structure', kind: 'power-plant' });
    guest.runtime.issue({ type: 'move', ids: [guest.tankId], x: 75, z: 70, attackMove: false });

    const targetTick = 120;
    for (let frame = 0; frame < 4000 && (host.sim.tick < targetTick || guest.sim.tick < targetTick); frame++) {
      bus.pump();
      // Host renders three times as often. The barrier must keep it from running
      // past command availability instead of applying the guest order late.
      if (host.sim.tick < targetTick && host.runtime.canAdvance()) host.advance();
      if (frame % 3 === 0 && guest.sim.tick < targetTick && guest.runtime.canAdvance()) guest.advance();
    }

    expect(host.sim.tick).toBe(targetTick);
    expect(guest.sim.tick).toBe(targetTick);
    expect(hashMultiplayerState(host.sim, host.economies)).toBe(hashMultiplayerState(guest.sim, guest.economies));
    expect(host.economies[0].structureLine?.kind).toBe('power-plant');
    expect(guest.economies[0].structureLine?.kind).toBe('power-plant');
  });
});

function createPeer(room: MultiplayerRoom, player: MultiplayerPlayer, bus: DelayedCommandBus) {
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  const economies = [createEconomy(1), createEconomy(2)];
  for (const economy of economies) createInitialBase(sim, hf, economy);
  // Both simulations create the exact same roster in the same id order.
  const hostTank = spawnTankAt(sim, 45, 45, 'Host Tank', 1);
  const guestTank = spawnTankAt(sim, 55, 55, 'Guest Tank', 2);
  const tank = player.index === 1 ? hostTank : guestTank;
  const session: MultiplayerSession = { room: structuredClone(room), player: structuredClone(player) };
  const runtime = new LockstepRuntime({
    sim,
    hf,
    economies: { 1: economies[0], 2: economies[1] },
    client: bus.clientFor(player),
    session,
  });
  return {
    sim,
    economies,
    runtime,
    tankId: tank.id,
    advance: () => advanceTick({
      sim,
      hf,
      economies,
      visions: [],
      commanders: [],
      lockstep: runtime,
      autoFire: false,
      runCommanders: false,
    }),
  };
}

class DelayedCommandBus {
  private readonly handlers = new Map<string, (event: MultiplayerEvent) => void>();
  private readonly pending: Array<{ due: number; order: number; targetId: string; event: MultiplayerEvent }> = [];
  private readonly lastDue = new Map<string, number>();
  private now = 0;
  private order = 0;

  constructor(private readonly players: MultiplayerPlayer[]) {}

  clientFor(sender: MultiplayerPlayer): MultiplayerClient {
    return {
      connect: (_roomCode: string, playerId: string, onEvent: (event: MultiplayerEvent) => void) => {
        this.handlers.set(playerId, onEvent);
      },
      disconnect: () => {
        this.handlers.delete(sender.id);
      },
      sendCommand: async (_roomCode: string, _playerId: string, tick: number, command: unknown) => {
        for (const target of this.players) {
          if (target.id === sender.id) continue;
          const route = `${sender.id}:${target.id}`;
          const jitter = 1 + ((this.order * 7) % 5);
          const due = Math.max(this.now + jitter, (this.lastDue.get(route) ?? 0) + 1);
          this.lastDue.set(route, due);
          this.pending.push({
            due,
            order: this.order++,
            targetId: target.id,
            event: {
              type: 'command',
              playerId: sender.id,
              playerIndex: sender.index,
              armyId: sender.armyId ?? sender.index,
              tick,
              command,
            },
          });
        }
      },
    } as unknown as MultiplayerClient;
  }

  pump(): void {
    this.now++;
    this.pending.sort((a, b) => a.due - b.due || a.order - b.order);
    for (let index = 0; index < this.pending.length; ) {
      const message = this.pending[index];
      const handler = this.handlers.get(message.targetId);
      if (message.due > this.now || !handler) {
        index++;
        continue;
      }
      this.pending.splice(index, 1);
      handler(message.event);
    }
  }
}
