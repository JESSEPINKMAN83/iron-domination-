import { describe, expect, it } from 'vitest';
import { hasAskedTacticFeedback } from './tacticFeedbackPrompt';

describe('tactic feedback prompt storage', () => {
  it('stays unasked until storage is marked after an answer', () => {
    const store = new Map<string, string>();
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => store.clear(),
      },
    });
    try {
      expect(hasAskedTacticFeedback()).toBe(false);
      store.set('iron-dominion.tactic-feedback-asked.v3', '1');
      expect(hasAskedTacticFeedback()).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
    }
  });
});
