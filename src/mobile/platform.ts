export interface MobileCapabilitySnapshot {
  maxTouchPoints: number;
  coarsePointer: boolean;
}

export function shouldUseMobileControls(snapshot: MobileCapabilitySnapshot): boolean {
  return snapshot.maxTouchPoints > 0 && snapshot.coarsePointer;
}

export function isMobileTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (new URLSearchParams(window.location.search).get('mobile-preview') === '1') return true;
  return shouldUseMobileControls({
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
  });
}

export function isStandaloneMobileExperience(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const iosNavigator = navigator as Navigator & { standalone?: boolean };
  return iosNavigator.standalone === true || window.matchMedia?.('(display-mode: fullscreen), (display-mode: standalone)').matches === true;
}

export async function requestFullscreenExperience(): Promise<void> {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch {
    // iPhone Safari normally requires Add to Home Screen for true fullscreen.
  }
  try {
    await (screen.orientation as ScreenOrientationWithLock | undefined)?.lock?.('landscape');
  } catch {
    // The portrait gate remains the cross-browser fallback.
  }
}

type ScreenOrientationWithLock = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>;
};

export class MobileLandscapeGate {
  private readonly overlay: HTMLDivElement;
  private active = false;
  private blocked = false;

  constructor(private readonly enabled = isMobileTouchDevice()) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'mobile-landscape-gate';
    this.overlay.hidden = true;
    this.overlay.innerHTML = `
      <div class="mobile-landscape-gate__device" aria-hidden="true"><span></span></div>
      <p>ROTATE TO COMMAND</p>
      <strong>Iron Domination plays in landscape.</strong>
      <small>Turn your phone sideways to continue.</small>
    `;
    document.body.appendChild(this.overlay);
    if (!this.enabled) return;
    window.addEventListener('resize', () => this.refresh());
    window.addEventListener('orientationchange', () => this.refresh());
    document.addEventListener('pointerdown', (event) => {
      const target = event.target instanceof Element ? event.target : undefined;
      if (target?.closest('.iron-landing__cta,.war-start,.war-lobby__cta,.war-button--primary,.mobile-mode-toggle')) void this.requestLandscape();
    }, { capture: true, passive: true });
  }

  activate(): void {
    if (!this.enabled) return;
    this.active = true;
    document.documentElement.classList.add('mobile-touch-device');
    this.refresh();
  }

  get isBlocked(): boolean {
    return this.blocked;
  }

  async requestLandscape(): Promise<void> {
    if (!this.enabled) return;
    await requestFullscreenExperience();
    this.refresh();
  }

  private refresh(): void {
    if (!this.enabled || !this.active) {
      this.blocked = false;
      this.overlay.hidden = true;
      return;
    }
    this.blocked = window.matchMedia('(orientation: portrait)').matches;
    this.overlay.hidden = !this.blocked;
    document.documentElement.classList.toggle('mobile-orientation-blocked', this.blocked);
  }
}
