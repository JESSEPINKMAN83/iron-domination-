import { describe, expect, it, vi } from 'vitest';
import { installActiveMatchExitGuard } from './activeMatchExitGuard';

class FakeTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe('active match exit protection', () => {
  it('warns before an active match unload and stops after completion', () => {
    const target = new FakeTarget();
    const guard = installActiveMatchExitGuard(target);
    const activeEvent = { preventDefault: vi.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent;

    target.dispatch('beforeunload', activeEvent as unknown as Event);
    expect(activeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(activeEvent.returnValue).toBe(true);

    guard.complete();
    const completedEvent = { preventDefault: vi.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent;
    target.dispatch('beforeunload', completedEvent as unknown as Event);
    expect(completedEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('warns for other unload attempts but permits intentional navigation', () => {
    const target = new FakeTarget();
    const guard = installActiveMatchExitGuard(target);
    const accidental = { preventDefault: vi.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent;

    target.dispatch('beforeunload', accidental as unknown as Event);
    expect(accidental.preventDefault).toHaveBeenCalledOnce();
    expect(accidental.returnValue).toBe(true);

    guard.allowNextUnload();
    const intentional = { preventDefault: vi.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent;
    target.dispatch('beforeunload', intentional as unknown as Event);
    expect(intentional.preventDefault).not.toHaveBeenCalled();
  });
});
