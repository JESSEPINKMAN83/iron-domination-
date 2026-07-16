import { isMobileTouchDevice } from '../mobile/platform';

export interface TouchCameraGesture {
  panX: number;
  panY: number;
  pinch: number;
  twist: number;
}

export interface MobileDriveState {
  throttle: number;
  turn: number;
  climb: number;
  boost: boolean;
}

// Central keyboard/mouse/touch state. Consumers poll state per frame;
// discrete key presses can also be subscribed via onKeyDown.
export class Input {
  readonly keys = new Set<string>();
  mouseX = typeof window === 'undefined' ? 0 : window.innerWidth / 2;
  mouseY = typeof window === 'undefined' ? 0 : window.innerHeight / 2;
  buttons = 0;
  pointerInWindow = false;
  readonly isTouchDevice: boolean;
  private metaPointer = false;

  private wheelAcc = 0;
  private dxAcc = 0;
  private dyAcc = 0;
  private readonly touchPointers = new Map<number, { x: number; y: number }>();
  private touchCamera: TouchCameraGesture = { panX: 0, panY: 0, pinch: 0, twist: 0 };
  private mobileDrive: MobileDriveState = { throttle: 0, turn: 0, climb: 0, boost: false };
  private readonly keyHandlers = new Map<string, Set<() => void>>();

  constructor(touchDevice = isMobileTouchDevice()) {
    this.isTouchDevice = touchDevice;
  }

  attach(target: HTMLElement): void {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Tab' || e.code === 'F1' || e.code === 'F3' || e.code.startsWith('Arrow')) {
        e.preventDefault();
      }
      this.keys.add(e.code);
      if (e.key === ' ') this.keys.add('Space');
      if (!e.repeat) {
        this.keyHandlers.get(e.code)?.forEach((fn) => fn());
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.key === ' ') this.keys.delete('Space');
    });
    window.addEventListener('blur', () => {
      this.resetTransientInputs();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.resetTransientInputs();
    });

    const move = (e: MouseEvent | PointerEvent) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.pointerInWindow = true;
      this.metaPointer = e.metaKey;
      if (e.buttons !== undefined) this.buttons = pointerButtonsToMask(e.buttons);
      if (e instanceof PointerEvent && e.pointerType === 'touch' && this.touchPointers.has(e.pointerId)) {
        this.trackTouchMove(e);
        return;
      }
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      this.dxAcc += dx;
      this.dyAcc += dy;
    };
    const down = (e: MouseEvent | PointerEvent) => {
      if (e.metaKey && e.button === 0) e.preventDefault();
      this.metaPointer = e.metaKey;
      this.buttons |= 1 << e.button;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (e instanceof PointerEvent && e.pointerType === 'touch') {
        this.touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
    };
    const up = (e: MouseEvent | PointerEvent) => {
      this.metaPointer = e.metaKey;
      if (e instanceof PointerEvent && e.pointerType === 'touch') this.touchPointers.delete(e.pointerId);
      if (e.button < 0) {
        this.buttons = 0;
        return;
      }
      this.buttons &= ~(1 << e.button);
    };
    const supportsPointerEvents = 'PointerEvent' in globalThis;
    if (supportsPointerEvents) {
      window.addEventListener('pointermove', move);
      target.addEventListener('pointerdown', down);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    } else {
      window.addEventListener('mousemove', move);
      target.addEventListener('mousedown', down);
      window.addEventListener('mouseup', up);
    }
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.wheelAcc += e.deltaY * (e.deltaMode === 1 ? 33 : 1);
      },
      { passive: false },
    );
    document.addEventListener('mouseleave', () => (this.pointerInWindow = false));
    document.addEventListener('mouseenter', () => (this.pointerInWindow = true));
  }

  onKeyDown(code: string, fn: () => void): void {
    let set = this.keyHandlers.get(code);
    if (!set) {
      set = new Set();
      this.keyHandlers.set(code, set);
    }
    set.add(fn);
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  isButton(button: number): boolean {
    return (this.buttons & (1 << button)) !== 0;
  }

  isMetaDown(): boolean {
    return this.metaPointer || this.keys.has('MetaLeft') || this.keys.has('MetaRight');
  }

  isCommandLookModifierDown(): boolean {
    return this.isMetaDown() || this.keys.has('ControlLeft') || this.keys.has('ControlRight');
  }

  consumeWheel(): number {
    const w = this.wheelAcc;
    this.wheelAcc = 0;
    return w;
  }

  consumeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.dxAcc, dy: this.dyAcc };
    this.dxAcc = 0;
    this.dyAcc = 0;
    return d;
  }

  addLookDelta(dx: number, dy: number): void {
    this.dxAcc += dx;
    this.dyAcc += dy;
  }

  addWheelDelta(delta: number): void {
    this.wheelAcc += delta;
  }

  consumeTouchCameraGesture(): TouchCameraGesture {
    const gesture = this.touchCamera;
    this.touchCamera = { panX: 0, panY: 0, pinch: 0, twist: 0 };
    return gesture;
  }

  clearTouchCameraGesture(): void {
    this.touchCamera = { panX: 0, panY: 0, pinch: 0, twist: 0 };
  }

  setMobileDrive(state: Partial<MobileDriveState>): void {
    this.mobileDrive = {
      throttle: clampAxis(state.throttle ?? this.mobileDrive.throttle),
      turn: clampAxis(state.turn ?? this.mobileDrive.turn),
      climb: clampAxis(state.climb ?? this.mobileDrive.climb),
      boost: state.boost ?? this.mobileDrive.boost,
    };
  }

  getMobileDrive(): Readonly<MobileDriveState> {
    return this.mobileDrive;
  }

  resetMobileDrive(): void {
    this.mobileDrive = { throttle: 0, turn: 0, climb: 0, boost: false };
  }

  resetTransientInputs(): void {
    this.keys.clear();
    this.buttons = 0;
    this.metaPointer = false;
    this.wheelAcc = 0;
    this.dxAcc = 0;
    this.dyAcc = 0;
    this.touchPointers.clear();
    this.clearTouchCameraGesture();
    this.resetMobileDrive();
  }

  private trackTouchMove(e: PointerEvent): void {
    const before = touchMetrics(this.touchPointers);
    const previous = this.touchPointers.get(e.pointerId);
    this.touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!previous) return;
    const after = touchMetrics(this.touchPointers);
    if (this.touchPointers.size === 1) {
      // One finger belongs to selection/orders. Two fingers control the RTS camera.
      return;
    }
    if (!before || !after) return;
    this.touchCamera.panX += after.centerX - before.centerX;
    this.touchCamera.panY += after.centerY - before.centerY;
    this.touchCamera.pinch += after.distance - before.distance;
    this.touchCamera.twist += shortestAngle(after.angle - before.angle);
  }
}

interface TouchMetrics {
  centerX: number;
  centerY: number;
  distance: number;
  angle: number;
}

function touchMetrics(points: ReadonlyMap<number, { x: number; y: number }>): TouchMetrics | undefined {
  if (points.size < 2) return undefined;
  const pair = Array.from(points.values()).slice(0, 2);
  const dx = pair[1].x - pair[0].x;
  const dy = pair[1].y - pair[0].y;
  return {
    centerX: (pair[0].x + pair[1].x) / 2,
    centerY: (pair[0].y + pair[1].y) / 2,
    distance: Math.hypot(dx, dy),
    angle: Math.atan2(dy, dx),
  };
}

function shortestAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clampAxis(value: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

function pointerButtonsToMask(buttons: number): number {
  let mask = 0;
  if (buttons & 1) mask |= 1 << 0; // primary/left
  if (buttons & 4) mask |= 1 << 1; // auxiliary/middle
  if (buttons & 2) mask |= 1 << 2; // secondary/right
  return mask;
}
