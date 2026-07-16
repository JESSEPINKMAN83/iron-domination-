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
  private readonly resetJoystick: () => void;
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
    const joystick = createJoystick((throttle, turn) => this.input.setMobileDrive({ throttle, turn }));
    this.resetJoystick = joystick.reset;

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
    this.fps.append(lookPad, joystick.root, weaponCluster, this.climbControls, this.possessedLabel);
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
      this.resetJoystick();
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

export function joystickDriveAxes(dx: number, dy: number, deadZone = 0.12): { throttle: number; turn: number } {
  const magnitude = Math.hypot(dx, dy);
  if (!Number.isFinite(magnitude) || magnitude <= deadZone) return { throttle: 0, turn: 0 };
  const clampedMagnitude = Math.min(1, magnitude);
  const strength = (clampedMagnitude - deadZone) / Math.max(0.001, 1 - deadZone);
  return {
    throttle: -(dy / magnitude) * strength,
    turn: -(dx / magnitude) * strength,
  };
}

function createJoystick(onChange: (throttle: number, turn: number) => void): { root: HTMLDivElement; reset: () => void } {
  const root = div('mobile-joystick');
  const track = div('mobile-joystick__track');
  const knob = div('mobile-joystick__knob');
  const center = div('mobile-joystick__center');
  root.setAttribute('role', 'application');
  root.setAttribute('aria-label', 'Movement joystick');
  root.title = 'Drag to move and steer';
  track.append(center, knob);
  root.appendChild(track);

  let pointerId: number | undefined;
  const reset = () => {
    if (pointerId === undefined && !root.classList.contains('is-active')) return;
    pointerId = undefined;
    root.classList.remove('is-active');
    knob.style.transform = '';
    onChange(0, 0);
  };
  const update = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = root.getBoundingClientRect();
    const radius = Math.min(rect.width, rect.height) * 0.36;
    const dx = (event.clientX - (rect.left + rect.width / 2)) / Math.max(1, radius);
    const dy = (event.clientY - (rect.top + rect.height / 2)) / Math.max(1, radius);
    const magnitude = Math.hypot(dx, dy);
    const scale = magnitude > 1 ? 1 / magnitude : 1;
    const visualX = dx * scale;
    const visualY = dy * scale;
    knob.style.transform = `translate(calc(-50% + ${visualX * radius}px),calc(-50% + ${visualY * radius}px))`;
    const drive = joystickDriveAxes(dx, dy);
    onChange(drive.throttle, drive.turn);
  };
  root.addEventListener('pointerdown', (event) => {
    if (pointerId !== undefined) return;
    pointerId = event.pointerId;
    root.classList.add('is-active');
    root.setPointerCapture?.(event.pointerId);
    update(event);
  });
  root.addEventListener('pointermove', update);
  const release = (event: PointerEvent) => {
    if (event.pointerId === pointerId) reset();
  };
  root.addEventListener('pointerup', release);
  root.addEventListener('pointercancel', release);
  root.addEventListener('lostpointercapture', release);
  window.addEventListener('pointerup', release, { capture: true });
  window.addEventListener('pointercancel', release, { capture: true });
  return { root, reset };
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
