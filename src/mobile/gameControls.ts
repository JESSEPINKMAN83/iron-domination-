import type { Input } from '../engine/input';
import type { Sidebar } from '../ui/sidebar';

interface MobileControlActions {
  enterFirstPerson(): boolean;
  exitFirstPerson(): void;
  cyclePossessed(): boolean;
  firePrimary(): boolean;
  fireSecondary(): boolean;
  useSpecial(): boolean;
}

export interface MobileControlState {
  firstPerson: boolean;
  flying: boolean;
  selectedCount: number;
  possessedName?: string;
}

export class MobileGameControls {
  private readonly root: HTMLDivElement;
  private readonly rts: HTMLDivElement;
  private readonly fps: HTMLDivElement;
  private readonly modeButton: HTMLButtonElement;
  private readonly buildButton: HTMLButtonElement;
  private readonly climbControls: HTMLDivElement;
  private readonly possessedLabel: HTMLDivElement;
  private readonly nextUnitButton: HTMLButtonElement;
  private readonly resetSpeedHold: () => void;
  private lastState = '';
  private firstPerson = false;

  constructor(
    private readonly input: Input,
    private readonly sidebar: Sidebar,
    private readonly actions: MobileControlActions,
  ) {
    this.root = div('mobile-game-controls');
    this.root.setAttribute('aria-label', 'Mobile game controls');
    this.root.addEventListener('contextmenu', (event) => event.preventDefault());

    this.rts = div('mobile-game-controls__rts');
    this.modeButton = button('', 'Take direct control of the selected unit');
    this.modeButton.classList.add('mobile-mode-toggle');
    this.modeButton.innerHTML = '<span aria-hidden="true">◎</span><small>CONTROL</small>';
    this.modeButton.onclick = () => {
      if (this.firstPerson) this.actions.exitFirstPerson();
      else this.actions.enterFirstPerson();
    };
    this.buildButton = button('BUILD', 'Open construction and production');
    this.buildButton.classList.add('mobile-build-button');
    this.buildButton.onclick = () => {
      const open = this.sidebar.toggleMobileExpanded();
      this.buildButton.classList.toggle('is-active', open);
      this.buildButton.textContent = open ? 'CLOSE' : 'BUILD';
    };
    this.rts.append(this.buildButton);

    this.fps = div('mobile-game-controls__fps');
    const dpad = createDpad((throttle, turn) => this.input.setMobileDrive({ throttle, turn }));

    const lookPad = div('mobile-look-pad');
    lookPad.setAttribute('aria-label', 'Drag to aim');
    bindLookPad(lookPad, (dx, dy) => this.input.addLookDelta(dx * 1.35, dy * 1.35));

    const weaponCluster = div('mobile-weapon-cluster');
    const fire = button('FIRE', 'Fire primary weapon');
    fire.classList.add('mobile-fire-button');
    const secondary = button('MISSILE', 'Fire secondary weapon or use scope');
    const special = button('SPECIAL', 'Use special ability');
    const speed = button('SPEED', 'Hold for maximum movement speed');
    this.nextUnitButton = button('NEXT UNIT', 'Control the next unit in the selected group');
    secondary.classList.add('mobile-secondary-button');
    special.classList.add('mobile-special-button');
    speed.classList.add('mobile-speed-button');
    this.nextUnitButton.classList.add('mobile-next-unit-button');
    bindRepeatAction(fire, () => this.actions.firePrimary(), 115);
    bindRepeatAction(secondary, () => this.actions.fireSecondary());
    bindRepeatAction(special, () => this.actions.useSpecial());
    this.nextUnitButton.onclick = () => this.actions.cyclePossessed();
    this.resetSpeedHold = bindHold(speed, (held) => this.input.setMobileDrive({ boost: held }));
    weaponCluster.append(fire, secondary, special, speed, this.nextUnitButton);

    this.climbControls = div('mobile-climb-controls');
    const climb = button('UP', 'Climb');
    const descend = button('DOWN', 'Descend');
    bindHold(climb, (held) => this.input.setMobileDrive({ climb: held ? 1 : 0 }));
    bindHold(descend, (held) => this.input.setMobileDrive({ climb: held ? -1 : 0 }));
    this.climbControls.append(climb, descend);

    this.possessedLabel = div('mobile-possessed-label');
    this.fps.append(lookPad, dpad, weaponCluster, this.climbControls, this.possessedLabel);
    this.root.append(this.rts, this.fps, this.modeButton);
    document.body.appendChild(this.root);
    this.update({ firstPerson: false, flying: false, selectedCount: 0 });
  }

  update(state: MobileControlState): void {
    const key = `${state.firstPerson}:${state.flying}:${state.selectedCount}:${state.possessedName ?? ''}`;
    if (key === this.lastState) return;
    this.lastState = key;
    this.firstPerson = state.firstPerson;
    this.root.classList.toggle('is-first-person', state.firstPerson);
    this.rts.hidden = state.firstPerson;
    this.fps.hidden = !state.firstPerson;
    this.modeButton.disabled = !state.firstPerson && state.selectedCount === 0;
    this.modeButton.innerHTML = state.firstPerson
      ? '<span aria-hidden="true">⌃</span><small>STRATEGY</small>'
      : '<span aria-hidden="true">◎</span><small>CONTROL</small>';
    this.modeButton.setAttribute('aria-label', state.firstPerson ? 'Return to strategy view' : 'Take direct control of the selected unit');
    const canCycleUnits = state.firstPerson && state.selectedCount > 1;
    this.nextUnitButton.hidden = !canCycleUnits;
    this.nextUnitButton.parentElement?.classList.toggle('has-next-unit', canCycleUnits);
    this.climbControls.hidden = !state.flying;
    this.possessedLabel.textContent = state.possessedName?.toUpperCase() ?? '';
    if (!state.firstPerson) {
      this.resetSpeedHold();
      this.input.resetMobileDrive();
    }
    if (state.firstPerson) {
      this.buildButton.classList.remove('is-active');
      this.buildButton.textContent = 'BUILD';
    }
  }

}

function div(className: string): HTMLDivElement {
  const element = document.createElement('div');
  element.className = className;
  return element;
}

function button(label: string, description: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.title = description;
  element.setAttribute('aria-label', description);
  element.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  element.addEventListener('pointerup', (event) => event.stopPropagation());
  return element;
}

function createDpad(onChange: (throttle: number, turn: number) => void): HTMLDivElement {
  const root = div('mobile-dpad');
  const held = { up: false, down: false, left: false, right: false };
  const sync = () => onChange((held.up ? 1 : 0) - (held.down ? 1 : 0), (held.left ? 1 : 0) - (held.right ? 1 : 0));
  const add = (direction: keyof typeof held, label: string) => {
    const control = button(label, `${direction} movement`);
    control.classList.add(`mobile-dpad__${direction}`);
    bindHold(control, (pressed) => {
      held[direction] = pressed;
      sync();
    });
    root.appendChild(control);
  };
  add('up', '▲');
  add('left', '◀');
  add('right', '▶');
  add('down', '▼');
  return root;
}

function bindLookPad(pad: HTMLElement, onMove: (dx: number, dy: number) => void): void {
  let pointerId: number | undefined;
  let lastX = 0;
  let lastY = 0;
  pad.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    pad.setPointerCapture?.(event.pointerId);
  });
  pad.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    onMove(event.clientX - lastX, event.clientY - lastY);
    lastX = event.clientX;
    lastY = event.clientY;
  });
  const release = (event: PointerEvent) => {
    if (event.pointerId === pointerId) pointerId = undefined;
  };
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);
}

function bindHold(element: HTMLElement, onChange: (held: boolean) => void): () => void {
  let pointerId: number | undefined;
  element.addEventListener('pointerdown', (event) => {
    pointerId = event.pointerId;
    element.setPointerCapture?.(event.pointerId);
    element.classList.add('is-active');
    onChange(true);
  });
  const release = (event?: PointerEvent) => {
    if (event && pointerId !== event.pointerId) return;
    if (pointerId === undefined) return;
    pointerId = undefined;
    element.classList.remove('is-active');
    onChange(false);
  };
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);
  element.addEventListener('lostpointercapture', release);
  window.addEventListener('pointerup', release, { capture: true });
  window.addEventListener('pointercancel', release, { capture: true });
  return () => release();
}

function bindRepeatAction(element: HTMLElement, action: () => unknown, cadence?: number): void {
  let timer: number | undefined;
  element.addEventListener('pointerdown', (event) => {
    element.setPointerCapture?.(event.pointerId);
    action();
    if (cadence) timer = window.setInterval(action, cadence);
  });
  const release = () => {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
  };
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);
  element.addEventListener('lostpointercapture', release);
}
