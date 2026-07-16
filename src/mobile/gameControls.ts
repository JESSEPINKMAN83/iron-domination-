import type { Input } from '../engine/input';
import type { RtsController } from '../modes/rtsController';
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
  private readonly selectButton: HTMLButtonElement;
  private readonly attackButton: HTMLButtonElement;
  private readonly controlButton: HTMLButtonElement;
  private readonly buildButton: HTMLButtonElement;
  private readonly climbControls: HTMLDivElement;
  private readonly possessedLabel: HTMLDivElement;
  private lastState = '';

  constructor(
    private readonly input: Input,
    private readonly controller: RtsController,
    private readonly sidebar: Sidebar,
    private readonly actions: MobileControlActions,
  ) {
    this.root = div('mobile-game-controls');
    this.root.setAttribute('aria-label', 'Mobile game controls');
    this.root.addEventListener('contextmenu', (event) => event.preventDefault());

    this.rts = div('mobile-game-controls__rts');
    const commandStrip = div('mobile-command-strip');
    this.selectButton = button('SELECT', 'Draw a selection box');
    this.attackButton = button('ATTACK', 'Toggle attack-move');
    const stopButton = button('STOP', 'Stop selected units');
    this.controlButton = button('CONTROL', 'Control the selected unit');
    this.selectButton.onclick = () => {
      this.controller.setMobileSelectionMode(!this.controller.isMobileSelectionMode());
      this.syncButtonStates();
    };
    this.attackButton.onclick = () => {
      this.controller.toggleMobileAttackMove();
      this.syncButtonStates();
    };
    stopButton.onclick = () => this.controller.stopSelected();
    this.controlButton.onclick = () => this.actions.enterFirstPerson();
    commandStrip.append(this.selectButton, this.attackButton, stopButton, this.controlButton);
    this.buildButton = button('BUILD', 'Open construction and production');
    this.buildButton.classList.add('mobile-build-button');
    this.buildButton.onclick = () => {
      const open = this.sidebar.toggleMobileExpanded();
      this.buildButton.classList.toggle('is-active', open);
      this.buildButton.textContent = open ? 'CLOSE' : 'BUILD';
    };
    this.rts.append(commandStrip, this.buildButton);

    this.fps = div('mobile-game-controls__fps');
    const joystick = div('mobile-joystick');
    const stick = div('mobile-joystick__stick');
    joystick.appendChild(stick);
    bindJoystick(joystick, stick, (x, y) => this.input.setMobileDrive({ throttle: -y, turn: -x }));

    const lookPad = div('mobile-look-pad');
    lookPad.setAttribute('aria-label', 'Drag to aim');
    bindLookPad(lookPad, (dx, dy) => this.input.addLookDelta(dx * 1.35, dy * 1.35));

    const weaponCluster = div('mobile-weapon-cluster');
    const fire = button('FIRE', 'Fire primary weapon');
    fire.classList.add('mobile-fire-button');
    const secondary = button('ALT', 'Fire alternate weapon or use scope');
    const special = button('SPECIAL', 'Use special ability');
    bindRepeatAction(fire, () => this.actions.firePrimary(), 115);
    bindRepeatAction(secondary, () => this.actions.fireSecondary());
    bindRepeatAction(special, () => this.actions.useSpecial());
    weaponCluster.append(fire, secondary, special);

    const utilityCluster = div('mobile-fps-utility');
    const exit = button('RTS', 'Return to strategy view');
    const swap = button('SWAP', 'Control another selected unit');
    const boost = button('BOOST', 'Hold to boost');
    exit.onclick = () => this.actions.exitFirstPerson();
    swap.onclick = () => this.actions.cyclePossessed();
    bindHold(boost, (held) => this.input.setMobileDrive({ boost: held }));
    utilityCluster.append(exit, swap, boost);

    this.climbControls = div('mobile-climb-controls');
    const climb = button('UP', 'Climb');
    const descend = button('DOWN', 'Descend');
    bindHold(climb, (held) => this.input.setMobileDrive({ climb: held ? 1 : 0 }));
    bindHold(descend, (held) => this.input.setMobileDrive({ climb: held ? -1 : 0 }));
    this.climbControls.append(climb, descend);

    this.possessedLabel = div('mobile-possessed-label');
    this.fps.append(lookPad, joystick, weaponCluster, utilityCluster, this.climbControls, this.possessedLabel);
    this.root.append(this.rts, this.fps);
    document.body.appendChild(this.root);
    this.update({ firstPerson: false, flying: false, selectedCount: 0 });
  }

  update(state: MobileControlState): void {
    const key = `${state.firstPerson}:${state.flying}:${state.selectedCount}:${state.possessedName ?? ''}`;
    this.syncButtonStates();
    if (key === this.lastState) return;
    this.lastState = key;
    this.root.classList.toggle('is-first-person', state.firstPerson);
    this.rts.hidden = state.firstPerson;
    this.fps.hidden = !state.firstPerson;
    this.controlButton.disabled = state.selectedCount === 0;
    this.attackButton.disabled = state.selectedCount === 0;
    this.climbControls.hidden = !state.flying;
    this.possessedLabel.textContent = state.possessedName?.toUpperCase() ?? '';
    if (!state.firstPerson) this.input.resetMobileDrive();
    if (state.firstPerson) {
      this.buildButton.classList.remove('is-active');
      this.buildButton.textContent = 'BUILD';
    }
  }

  private syncButtonStates(): void {
    this.selectButton.classList.toggle('is-active', this.controller.isMobileSelectionMode());
    this.attackButton.classList.toggle('is-active', this.controller.mobileAttackMoveQueued());
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

function bindJoystick(
  pad: HTMLElement,
  stick: HTMLElement,
  onChange: (x: number, y: number) => void,
): void {
  let pointerId: number | undefined;
  const update = (event: PointerEvent) => {
    const rect = pad.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.34);
    let x = (event.clientX - (rect.left + rect.width / 2)) / radius;
    let y = (event.clientY - (rect.top + rect.height / 2)) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    stick.style.transform = `translate(calc(-50% + ${x * radius}px),calc(-50% + ${y * radius}px))`;
    onChange(x, y);
  };
  pad.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    pointerId = event.pointerId;
    pad.setPointerCapture?.(event.pointerId);
    update(event);
  });
  pad.addEventListener('pointermove', (event) => {
    if (event.pointerId === pointerId) update(event);
  });
  const release = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    pointerId = undefined;
    stick.style.transform = 'translate(-50%,-50%)';
    onChange(0, 0);
  };
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);
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

function bindHold(element: HTMLElement, onChange: (held: boolean) => void): void {
  let pointerId: number | undefined;
  element.addEventListener('pointerdown', (event) => {
    pointerId = event.pointerId;
    element.setPointerCapture?.(event.pointerId);
    element.classList.add('is-active');
    onChange(true);
  });
  const release = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    pointerId = undefined;
    element.classList.remove('is-active');
    onChange(false);
  };
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);
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
