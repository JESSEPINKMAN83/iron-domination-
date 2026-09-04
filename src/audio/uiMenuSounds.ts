export interface UiMenuHoverSample {
  url: string;
  gain: number;
  maxDuration?: number;
}

export const UI_GAME_CLICK_SAMPLES: readonly UiMenuHoverSample[] = [
  { url: '/assets/sfx/ui-game-click-01.wav', gain: 0.14, maxDuration: 0.3 },
  { url: '/assets/sfx/ui-game-click-02.wav', gain: 0.12, maxDuration: 0.68 },
];

export const UI_GAME_HOVER_SAMPLES: readonly UiMenuHoverSample[] = [
  { url: '/assets/sfx/ui-game-hover-01.wav', gain: 0.022, maxDuration: 0.32 },
  { url: '/assets/sfx/ui-game-hover-02.wav', gain: 0.036, maxDuration: 0.32 },
  { url: '/assets/sfx/ui-game-hover-03.wav', gain: 0.05, maxDuration: 0.32 },
];

export const ACTIVE_UI_GAME_HOVER: UiMenuHoverSample = {
  url: '/assets/sfx/ui-button-hover-active-02.wav',
  gain: 0.06,
  maxDuration: 0.58,
};
export const ACTIVE_UI_GAME_CLICK: UiMenuHoverSample = {
  url: '/assets/sfx/ui-button-click-active-02.wav',
  gain: 0.5,
  maxDuration: 0.1,
};

const BUTTON_HOVER_COOLDOWN_MS = 75;

export function installStandaloneButtonSounds(root: HTMLElement): void {
  let lastPlayedAt = -Infinity;
  let active: HTMLAudioElement | undefined;
  let stopTimer: number | undefined;

  for (const sample of [ACTIVE_UI_GAME_HOVER, ACTIVE_UI_GAME_CLICK]) {
    const preload = new Audio(sample.url);
    preload.preload = 'auto';
  }

  const enabledButton = (target: EventTarget | null): HTMLButtonElement | undefined => {
    const button = target instanceof Element ? target.closest('button') : null;
    return button instanceof HTMLButtonElement && !button.disabled && button.getAttribute('aria-disabled') !== 'true'
      ? button
      : undefined;
  };
  const play = (sample: UiMenuHoverSample): void => {
    active?.pause();
    if (stopTimer !== undefined) window.clearTimeout(stopTimer);
    const audio = new Audio(sample.url);
    audio.preload = 'auto';
    audio.volume = sample.gain * 0.74;
    active = audio;
    const clear = (): void => {
      if (active === audio) active = undefined;
    };
    audio.addEventListener('ended', clear, { once: true });
    void audio.play().catch(clear);
    if (sample.maxDuration !== undefined) {
      stopTimer = window.setTimeout(() => {
        if (active !== audio) return;
        audio.pause();
        audio.currentTime = 0;
        clear();
      }, sample.maxDuration * 1000);
    }
  };

  root.addEventListener('pointerover', (event) => {
    if (!(event instanceof PointerEvent) || event.pointerType === 'touch') return;
    const button = enabledButton(event.target);
    if (!button) return;
    if (event.relatedTarget instanceof Node && button.contains(event.relatedTarget)) return;
    const now = performance.now();
    if (now - lastPlayedAt < BUTTON_HOVER_COOLDOWN_MS) return;
    lastPlayedAt = now;
    play(ACTIVE_UI_GAME_HOVER);
  });
  root.addEventListener('pointerdown', (event) => {
    if (!(event instanceof PointerEvent) || event.button !== 0 || !enabledButton(event.target)) return;
    play(ACTIVE_UI_GAME_CLICK);
  }, { capture: true });
  root.addEventListener('keydown', (event) => {
    if (!(event instanceof KeyboardEvent) || (event.code !== 'Enter' && event.code !== 'Space')) return;
    if (!enabledButton(event.target) || event.repeat) return;
    play(ACTIVE_UI_GAME_CLICK);
  });
}
