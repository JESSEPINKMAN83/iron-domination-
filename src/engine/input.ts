// Central keyboard/mouse state. Consumers poll state per frame; discrete key
// presses can also be subscribed via onKeyDown.
export class Input {
  readonly keys = new Set<string>();
  mouseX = window.innerWidth / 2;
  mouseY = window.innerHeight / 2;
  buttons = 0;
  pointerInWindow = false;
  private metaPointer = false;

  private wheelAcc = 0;
  private dxAcc = 0;
  private dyAcc = 0;
  private readonly keyHandlers = new Map<string, Set<() => void>>();

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
      this.keys.clear();
      this.buttons = 0;
      this.metaPointer = false;
    });

    const move = (e: MouseEvent | PointerEvent) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.pointerInWindow = true;
      this.metaPointer = e.metaKey;
      if (e.buttons !== undefined) this.buttons = pointerButtonsToMask(e.buttons);
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      this.dxAcc += dx;
      this.dyAcc += dy;
    };
    const down = (e: MouseEvent | PointerEvent) => {
      if (e.metaKey && e.button === 0) e.preventDefault();
      this.metaPointer = e.metaKey;
      this.buttons |= 1 << e.button;
    };
    const up = (e: MouseEvent | PointerEvent) => {
      this.metaPointer = e.metaKey;
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
}

function pointerButtonsToMask(buttons: number): number {
  let mask = 0;
  if (buttons & 1) mask |= 1 << 0; // primary/left
  if (buttons & 4) mask |= 1 << 1; // auxiliary/middle
  if (buttons & 2) mask |= 1 << 2; // secondary/right
  return mask;
}
