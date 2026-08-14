import { describe, expect, it, vi } from 'vitest';
import { markOpeningBriefingSeen, shouldShowOpeningBriefing } from './openingBriefing';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe('opening briefing persistence', () => {
  it('shows once for an identified member', () => {
    const storage = memoryStorage();

    expect(shouldShowOpeningBriefing(storage, 'member-1')).toBe(true);
    markOpeningBriefingSeen(storage, 'member-1');
    expect(shouldShowOpeningBriefing(storage, 'member-1')).toBe(false);
  });

  it('tracks different members independently', () => {
    const storage = memoryStorage();

    markOpeningBriefingSeen(storage, 'member-1');
    expect(shouldShowOpeningBriefing(storage, 'member-1')).toBe(false);
    expect(shouldShowOpeningBriefing(storage, 'member-2')).toBe(true);
  });

  it('shows once for anonymous players on the device', () => {
    const storage = memoryStorage();

    expect(shouldShowOpeningBriefing(storage)).toBe(true);
    markOpeningBriefingSeen(storage);
    expect(shouldShowOpeningBriefing(storage)).toBe(false);
  });

  it('tracks the anonymous device separately from identified members', () => {
    const storage = memoryStorage();

    markOpeningBriefingSeen(storage);
    expect(shouldShowOpeningBriefing(storage)).toBe(false);
    expect(shouldShowOpeningBriefing(storage, 'member-1')).toBe(true);
  });

  it('fails open when browser storage is unavailable', () => {
    const storage = {
      getItem: vi.fn(() => { throw new Error('blocked'); }),
      setItem: vi.fn(() => { throw new Error('blocked'); }),
    };

    expect(shouldShowOpeningBriefing(storage, 'member-1')).toBe(true);
    expect(() => markOpeningBriefingSeen(storage, 'member-1')).not.toThrow();
  });
});
