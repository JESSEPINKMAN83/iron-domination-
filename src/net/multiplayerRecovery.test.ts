import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MultiplayerClient, type MultiplayerSession } from './multiplayer';

class Socket extends EventTarget {
  static OPEN = 1; static CONNECTING = 0;
  static instances: Socket[] = [];
  readyState = 0;
  sent: any[] = [];
  onmessage?: (event: {data: string}) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor(_url: string) { super(); Socket.instances.push(this); }
  open(): void { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  close(): void { this.readyState = 3; this.onclose?.(); this.dispatchEvent(new Event('close')); }
  send(value: string): void { if (this.readyState !== 1) throw new Error('closed'); this.sent.push(JSON.parse(value)); }
  receive(value: unknown): void { this.onmessage?.({data: JSON.stringify(value)}); }
}
const session: MultiplayerSession = {
  room: {code:'ROOM12', seed:1, ai:'normal', aiStyle:'balanced', armyCount:2, armySides:[1,2], status:'in-game', players:[]},
  player: {id:'11111111-1111-4111-8111-111111111111', index:1, armyId:1, role:'commander',name:'Host',connected:true},
};
const flush = async (): Promise<void> => { for (let i=0;i<5;i++) await Promise.resolve(); };
const clients: MultiplayerClient[] = [];
beforeEach(() => {
  vi.useFakeTimers(); Socket.instances = [];
  const events = new EventTarget();
  vi.stubGlobal('window', {setTimeout, clearTimeout, setInterval, clearInterval, addEventListener:events.addEventListener.bind(events), removeEventListener:events.removeEventListener.bind(events)});
  vi.stubGlobal('navigator', {userAgent:'Chrome'});
  vi.stubGlobal('WebSocket', Socket);
});
afterEach(() => { for (const client of clients.splice(0)) client.disconnect(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function hosted(): Promise<{client: MultiplayerClient; socket: Socket}> {
  const client = new MultiplayerClient('https://relay.example.com'); clients.push(client);
  const pending = client.host({seed:1,ai:'normal',aiStyle:'balanced'});
  const socket = Socket.instances[0]; socket.open(); await flush();
  socket.receive({type:'session',requestId:socket.sent[0].requestId,...session});
  await pending; return {client,socket};
}
describe('multiplayer transport recovery', () => {
  it('rejects a closed connecting socket immediately instead of waiting 20 seconds', async () => {
    const client = new MultiplayerClient('https://relay.example.com'); clients.push(client);
    const pending = client.join('ROOM12'); const result = expect(pending).rejects.toThrow('server-unreachable');
    Socket.instances[0].close(); await result;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps the player slot on retry and ignores stale socket close events', async () => {
    const {client,socket} = await hosted(); const error = vi.fn(), open = vi.fn();
    client.connect('ROOM12',session.player.id,vi.fn(),error,open);
    client.retryConnection();
    expect(error).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    const replacement = Socket.instances[1]; replacement.open(); await flush();
    const join = replacement.sent.find(m=>m.type==='join');
    expect(join.playerId).toBe(session.player.id); expect(join.code).toBe('ROOM12');
    socket.onclose?.();
    replacement.receive({type:'session',requestId:join.requestId,...session}); await flush();
    expect(open).toHaveBeenCalledTimes(2); expect(error).toHaveBeenCalledTimes(1);
  });
  it('replaces a silent open connection but does not churn a connecting replacement', async () => {
    const {client,socket} = await hosted();
    client.connect('ROOM12',session.player.id,vi.fn(),vi.fn());
    await vi.advanceTimersByTimeAsync(35_501);
    expect(socket.readyState).toBe(3); expect(Socket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(Socket.instances).toHaveLength(2); expect(Socket.instances[1].readyState).toBe(0);
  });
  it('does not reconnect healthy or intentionally closed sessions', async () => {
    const {client,socket} = await hosted(); const error = vi.fn();
    client.connect('ROOM12',session.player.id,vi.fn(),error);
    for(let i=0;i<3;i++){ await vi.advanceTimersByTimeAsync(15_000); socket.receive({type:'heartbeat',now:Date.now()}); }
    expect(Socket.instances).toHaveLength(1);
    client.disconnect(); await vi.advanceTimersByTimeAsync(40_000);
    expect(Socket.instances).toHaveLength(1); expect(error).not.toHaveBeenCalled();
  });
});
