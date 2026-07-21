import { describe, expect, it } from 'vitest';
import { multiplayerInviteUrl, roomFromInvite } from './invite';

describe('multiplayer invite links', () => {
  it('creates a canonical link containing only invite routing data', () => {
    expect(multiplayerInviteUrl(
      'https://game.example/play?start=test&map=frostbite-pass#debug',
      ' ab-cd ',
    )).toBe('https://game.example/play?room=ABCD&invite=1');
  });

  it('reads and normalizes a room from an invitation', () => {
    expect(roomFromInvite(new URLSearchParams('room=ab-cd&invite=1'))).toBe('ABCD');
    expect(roomFromInvite(new URLSearchParams('invite=1'))).toBeUndefined();
  });
});
