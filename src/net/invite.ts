import { normalizeRoomCode } from './multiplayer';

export function roomFromInvite(params: URLSearchParams): string | undefined {
  const room = normalizeRoomCode(params.get('room') ?? '');
  return room || undefined;
}

export function multiplayerInviteUrl(currentHref: string, roomCode: string): string {
  const current = new URL(currentHref);
  const invite = new URL(current.pathname || '/', current.origin);
  invite.searchParams.set('room', normalizeRoomCode(roomCode));
  invite.searchParams.set('invite', '1');
  return invite.toString();
}
