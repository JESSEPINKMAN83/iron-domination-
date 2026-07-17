export interface MobileCapabilitySnapshot {
  maxTouchPoints: number;
  coarsePointer: boolean;
}

export interface MobileViewportSnapshot {
  layoutWidth: number;
  layoutHeight: number;
  visualWidth?: number;
  visualHeight?: number;
  visualOffsetLeft?: number;
  visualOffsetTop?: number;
  screenWidth?: number;
  screenHeight?: number;
  landscape: boolean;
}

export interface MobileViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Uses the live visual viewport for browser-toolbar changes. On affected iPhones
 * Safari can expose a landscape layout viewport with the two safe-area strips
 * removed even when viewport-fit=cover is present. In that specific, bounded
 * case, bleed the visual layer symmetrically back to the device edges.
 */
export function resolveMobileViewport(snapshot: MobileViewportSnapshot): MobileViewportRect {
  const visualWidth = positiveDimension(snapshot.visualWidth, snapshot.layoutWidth);
  const visualHeight = positiveDimension(snapshot.visualHeight, snapshot.layoutHeight);
  let left = finiteCoordinate(snapshot.visualOffsetLeft);
  const top = finiteCoordinate(snapshot.visualOffsetTop);
  let width = visualWidth;

  if (snapshot.landscape) {
    const screenLongEdge = Math.max(
      positiveDimension(snapshot.screenWidth, 0),
      positiveDimension(snapshot.screenHeight, 0),
    );
    const missingWidth = screenLongEdge - visualWidth;
    const plausibleSafeArea = missingWidth > 0 && missingWidth <= visualWidth * 0.35;
    if (plausibleSafeArea) {
      left -= missingWidth / 2;
      width = screenLongEdge;
    }
  }

  return {
    left,
    top,
    width: Math.max(1, width),
    height: Math.max(1, visualHeight),
  };
}

function positiveDimension(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value! : Math.max(0, fallback);
}

function finiteCoordinate(value: number | undefined): number {
  return Number.isFinite(value) ? value! : 0;
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
    window.addEventListener('resize', () => this.scheduleRefresh());
    window.addEventListener('orientationchange', () => {
      this.scheduleRefresh();
      window.setTimeout(() => this.scheduleRefresh(), 180);
      window.setTimeout(() => this.scheduleRefresh(), 500);
    });
    window.addEventListener('pageshow', () => this.scheduleRefresh());
    window.visualViewport?.addEventListener('resize', () => this.scheduleRefresh());
    window.visualViewport?.addEventListener('scroll', () => this.scheduleRefresh());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.scheduleRefresh();
    });
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
    this.syncAppViewport();
  }

  private refreshFrame = 0;

  private scheduleRefresh(): void {
    if (this.refreshFrame !== 0) cancelAnimationFrame(this.refreshFrame);
    this.refreshFrame = requestAnimationFrame(() => {
      this.refreshFrame = 0;
      this.refresh();
    });
  }

  private syncAppViewport(): void {
    const visualViewport = window.visualViewport;
    const viewport = resolveMobileViewport({
      layoutWidth: window.innerWidth,
      layoutHeight: window.innerHeight,
      visualWidth: visualViewport?.width,
      visualHeight: visualViewport?.height,
      visualOffsetLeft: visualViewport?.offsetLeft,
      visualOffsetTop: visualViewport?.offsetTop,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      landscape: window.matchMedia('(orientation: landscape)').matches,
    });
    const root = document.documentElement;
    root.style.setProperty('--mobile-app-left', `${viewport.left}px`);
    root.style.setProperty('--mobile-app-top', `${viewport.top}px`);
    root.style.setProperty('--mobile-app-width', `${viewport.width}px`);
    root.style.setProperty('--mobile-app-height', `${viewport.height}px`);
    root.classList.add('mobile-app-viewport');
  }
}
