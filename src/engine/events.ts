// Minimal typed event bus for engine ↔ UI ↔ sim decoupling in later phases.
export type Listener<T> = (payload: T) => void;

export class EventBus<TEvents extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof TEvents, Set<Listener<never>>>();

  on<K extends keyof TEvents>(event: K, fn: Listener<TEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<never>);
    return () => set.delete(fn as Listener<never>);
  }

  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    this.listeners.get(event)?.forEach((fn) => (fn as Listener<TEvents[K]>)(payload));
  }
}
