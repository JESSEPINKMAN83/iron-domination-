export interface ActiveMatchExitGuard {
  complete(): void;
  allowNextUnload(): void;
  dispose(): void;
}

interface GuardTarget {
  addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions | boolean): void;
  removeEventListener(type: string, listener: EventListener, options?: EventListenerOptions | boolean): void;
}

/**
 * Protects an unfinished match from accidental tab closes. Browsers do not
 * allow custom before-unload copy, so all close methods (including
 * Command/Ctrl+W) use the browser's standard confirmation dialog.
 */
export function installActiveMatchExitGuard(
  target: GuardTarget = window,
): ActiveMatchExitGuard {
  let active = true;
  let unloadAllowed = false;

  const onBeforeUnload = ((rawEvent: Event): void => {
    if (!active || unloadAllowed) return;
    const event = rawEvent as BeforeUnloadEvent;
    event.preventDefault();
    // A truthy value is required by Chromium/Safari legacy compatibility.
    // An empty string is the default value and does not trigger the dialog.
    event.returnValue = true;
  }) as EventListener;

  target.addEventListener('beforeunload', onBeforeUnload);

  return {
    complete: () => {
      active = false;
    },
    allowNextUnload: () => {
      unloadAllowed = true;
    },
    dispose: () => {
      active = false;
      target.removeEventListener('beforeunload', onBeforeUnload);
    },
  };
}
