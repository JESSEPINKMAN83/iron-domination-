import { describe, expect, it } from 'vitest';
import { aiControlledTeams, shouldAutostartFromUrl } from './startup';

describe('match startup routing', () => {
  it('keeps multiplayer invite links on the setup lobby', () => {
    expect(shouldAutostartFromUrl(new URLSearchParams('room=ABC123'))).toBe(false);
  });

  it('autostarts explicit match and QA query links', () => {
    expect(shouldAutostartFromUrl(new URLSearchParams('map=frostbite-pass&seed=42'))).toBe(true);
    expect(shouldAutostartFromUrl(new URLSearchParams('start=test'))).toBe(true);
  });

  it('does not autostart for unrelated tracking parameters', () => {
    expect(shouldAutostartFromUrl(new URLSearchParams('utm_source=invite'))).toBe(false);
  });

  it('assigns every multiplayer army without a joined commander to AI control', () => {
    expect(aiControlledTeams(2, [1])).toEqual([2]);
    expect(aiControlledTeams(4, [1, 3])).toEqual([2, 4]);
    expect(aiControlledTeams(3, [1, 2, 3])).toEqual([]);
  });
});
