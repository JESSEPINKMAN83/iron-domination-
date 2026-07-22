import './howToPlay.css';
import { isMobileTouchDevice } from './mobile/platform';

type GuideSection = {
  title: string;
  items: Array<{ control: string; action: string }>;
};

type GuideLifecycle = {
  onOpen?: () => void;
  onClose?: () => void;
};

let activeLifecycle: GuideLifecycle = {};

export function configureHowToPlayLifecycle(lifecycle: GuideLifecycle): void {
  activeLifecycle = lifecycle;
}

export function showHowToPlayWidget(): void {
  if (document.getElementById('iron-howto-widget')) return;
  const widget = document.createElement('div');
  widget.id = 'iron-howto-widget';
  widget.className = 'iron-howto';
  widget.innerHTML = '<button class="iron-howto__trigger" type="button" aria-haspopup="dialog">How to play</button>';
  widget.querySelector<HTMLButtonElement>('.iron-howto__trigger')!.onclick = () => openHowToPlay();
  document.body.appendChild(widget);
}

export function hideHowToPlayWidget(): void {
  document.getElementById('iron-howto-widget')?.remove();
}

export function openHowToPlay(options: { forceMobile?: boolean; lifecycle?: GuideLifecycle } = {}): void {
  const existing = document.getElementById('iron-howto-dialog');
  if (existing) return;

  const lifecycle = options.lifecycle ?? activeLifecycle;
  const mobile = options.forceMobile ?? isMobileTouchDevice();
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  lifecycle.onOpen?.();

  const overlay = document.createElement('div');
  overlay.id = 'iron-howto-dialog';
  overlay.className = 'iron-howto__overlay';
  overlay.innerHTML = guideMarkup(mobile);
  document.body.classList.add('iron-howto-open');

  const dialog = overlay.querySelector<HTMLElement>('.iron-howto__dialog')!;
  const closeButton = overlay.querySelector<HTMLButtonElement>('.iron-howto__close')!;
  const footerCloseButton = overlay.querySelector<HTMLButtonElement>('.iron-howto__footer-close')!;
  const close = (): void => {
    window.removeEventListener('keydown', onKeyDown);
    overlay.remove();
    document.body.classList.remove('iron-howto-open');
    lifecycle.onClose?.();
    previousFocus?.focus();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };

  closeButton.onclick = close;
  footerCloseButton.onclick = close;
  overlay.onclick = (event) => {
    if (event.target === overlay) close();
  };
  dialog.onclick = (event) => event.stopPropagation();
  window.addEventListener('keydown', onKeyDown);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => closeButton.focus());
}

export function controlGuideSections(mobile: boolean): GuideSection[] {
  if (mobile) {
    return [
      {
        title: 'Command view',
        items: [
          { control: 'Tap', action: 'Select a friendly unit or issue a move/attack order.' },
          { control: 'Drag', action: 'Draw a selection box; with units selected, drag to set a facing line.' },
          { control: 'Two fingers', action: 'Drag to pan, pinch to zoom, and twist to rotate the battlefield.' },
          { control: 'BUILD', action: 'Open construction and production; tap CLOSE to return to the battlefield.' },
        ],
      },
      {
        title: 'Direct control',
        items: [
          { control: 'CONTROL', action: 'Take over the selected unit; STRATEGY returns to command view.' },
          { control: 'Left control', action: 'Drag to move and steer. Hold SPEED for maximum movement.' },
          { control: 'Right side', action: 'Drag to aim. Use FIRE, MISSILE, and SPECIAL to attack.' },
          { control: 'Aircraft', action: 'Use UP/DOWN for altitude and NEXT UNIT to swap within a group.' },
        ],
      },
    ];
  }

  return [
    {
      title: 'Command view',
      items: [
        { control: 'Left click / drag', action: 'Select one unit or draw a box around several units.' },
        { control: 'Right click', action: 'Move to ground or attack the enemy under the pointer.' },
        { control: 'A + right click', action: 'Attack-move; S immediately stops selected units.' },
        { control: 'Hold right + drag', action: 'Place units in a spread line facing the drag direction.' },
        { control: 'Ctrl/Cmd + 0–9', action: 'Save a control group; press its number to select it again.' },
      ],
    },
    {
      title: 'Camera & building',
      items: [
        { control: 'WASD / arrows', action: 'Pan the battlefield. Moving the pointer to an edge also pans.' },
        { control: 'Wheel / Q / E', action: 'Zoom with the wheel and rotate the command camera with Q or E.' },
        { control: 'Space + drag', action: 'Grab and pan. Empty right-drag or Ctrl/Cmd-drag rotates the view.' },
        { control: 'Build panel', action: 'Queue a structure, then left-click valid terrain. Escape cancels placement.' },
      ],
    },
    {
      title: 'Direct control',
      items: [
        { control: 'V / Escape', action: 'Take over the selected unit or return to command view.' },
        { control: 'W/S · A/D · Shift', action: 'Drive, steer, and boost. Move the mouse to aim.' },
        { control: 'Left / right click', action: 'Fire primary and secondary weapons. F uses a special ability.' },
        { control: 'Tab', action: 'Swap to the next unit in the currently selected squad.' },
        { control: 'Aircraft', action: 'Q/E hard turn, Space climbs, and C descends.' },
      ],
    },
    {
      title: 'Utility',
      items: [
        { control: 'F1', action: 'Open this field guide at any time.' },
        { control: 'M', action: 'Mute or restore game audio.' },
        { control: 'MENU', action: 'Pause, save, restart, or return to battle setup.' },
      ],
    },
  ];
}

function guideMarkup(mobile: boolean): string {
  const controls = controlGuideSections(mobile)
    .map((section) => `
      <section class="iron-howto__control-group">
        <h3>${section.title}</h3>
        <dl>
          ${section.items.map((item) => `<div><dt>${item.control}</dt><dd>${item.action}</dd></div>`).join('')}
        </dl>
      </section>
    `)
    .join('');

  return `
    <section class="iron-howto__dialog" role="dialog" aria-modal="true" aria-labelledby="iron-howto-title">
      <header class="iron-howto__header">
        <div>
          <p>FIELD MANUAL · ${mobile ? 'MOBILE' : 'DESKTOP'}</p>
          <h2 id="iron-howto-title">How to play</h2>
        </div>
        <button class="iron-howto__close" type="button" aria-label="Close How to Play">×</button>
      </header>

      <div class="iron-howto__intro-grid">
        <div class="iron-howto__intro">
          <span>THE BATTLE</span>
          <p>Iron Dominion combines real-time strategy with direct first-person combat. Build and command from above, then take control of any selected unit and join the fight yourself.</p>
        </div>
        <div class="iron-howto__objective">
          <span>YOUR MISSION · WIN CONDITION</span>
          <strong>Destroy the enemy Command Yard</strong>
          <p>Protect your own base and eliminate every hostile Command Yard to win the battle.</p>
        </div>
      </div>

      <section class="iron-howto__section">
        <div class="iron-howto__section-heading"><span>01</span><h3>The battle plan</h3></div>
        <ol class="iron-howto__loop">
          <li><b>Establish</b><span>Build a Power Plant, then a Refinery to unlock a working economy.</span></li>
          <li><b>Expand</b><span>Collectors harvest oil for credits. Add Barracks, a Factory, and a Helipad.</span></li>
          <li><b>Command</b><span>Mix infantry, armor, defenses, and aircraft. Scout before committing your army.</span></li>
          <li><b>Dominate</b><span>Break enemy production, protect your base, and destroy the hostile Command Yard.</span></li>
        </ol>
      </section>

      <section class="iron-howto__section">
        <div class="iron-howto__section-heading"><span>02</span><h3>What you can do</h3></div>
        <div class="iron-howto__capabilities">
          <article><b>Build a base</b><span>Power, economy, production, walls, and defensive towers.</span></article>
          <article><b>Field an army</b><span>Infantry, snipers, rockets, tanks, artillery, and aircraft.</span></article>
          <article><b>Control any unit</b><span>Switch from command view to direct combat whenever it matters.</span></article>
          <article><b>Adapt your force</b><span>Use upgrades and unit counters to answer the enemy composition.</span></article>
        </div>
      </section>

      <section class="iron-howto__section">
        <div class="iron-howto__section-heading"><span>03</span><h3>${mobile ? 'Touch controls' : 'Keyboard & mouse'}</h3></div>
        <div class="iron-howto__controls">${controls}</div>
      </section>

      <footer class="iron-howto__footer">
        <p><strong>New commander tip:</strong> start small—secure income, build one production line, scout, then expand.</p>
        <button class="iron-howto__footer-close" type="button">Ready for battle</button>
      </footer>
    </section>
  `;
}
