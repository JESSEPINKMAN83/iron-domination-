import './howToPlay.css';
import { fieldGuideIllustration as scene } from './ui/fieldGuideIllustrations';
import { ARMY_DOCTRINES } from './content/armyDoctrines';
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
    if (event.key === 'Tab') {
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button, a[href]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
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
          { control: 'Drag', action: 'Draw a selection box; with units selected, drag to set a facing combat formation.' },
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
        { control: 'Cmd + right click', action: 'Order selected armed units to fire at that exact point.' },
        { control: 'A + right click', action: 'Attack-move; X immediately stops selected units.' },
        { control: 'Hold right + drag', action: 'Set facing and shape a column, wedge, or wide battle line with drag length.' },
        { control: 'Ctrl/Cmd + 0–9', action: 'Save a control group; press its number to select it, or double-tap to center the camera.' },
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
        { control: 'Q / E', action: 'Turn your view and aim left or right in V-mode, with any unit. Hold a key to keep turning.' },
        { control: 'Left / right click', action: 'Vehicles fire primary and secondary weapons. F uses a special ability.' },
        { control: 'Infantry', action: 'WASD moves and strafes; hold left-click to fire, right-click to aim, and middle-click for the secondary weapon.' },
        { control: 'Infantry view & stance', action: 'Scroll between first and third person. Space jumps; hold C to crouch. Snipers toggle their scope with right-click.' },
        { control: 'Defense tower', action: 'In V-mode, use the wheel for optical zoom. Hold T to scan; release to lock.' },
        { control: 'Tab', action: 'Swap to the next unit in the currently selected squad.' },
        { control: 'Aircraft', action: 'Space climbs, C descends. Q/E turns your view; the aircraft follows your heading.' },
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

export function guideMarkup(mobile: boolean): string {
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
    <section class="iron-howto__dialog field-guide" role="dialog" aria-modal="true" aria-labelledby="iron-howto-title">
      <header class="iron-howto__header"><div><p>COMMANDER’S FIELD GUIDE · ${mobile ? 'TOUCH' : 'DESKTOP'}</p><h2 id="iron-howto-title">Your first victory starts here.</h2></div><button class="iron-howto__close" type="button" aria-label="Close How to Play">×</button></header>
      <div class="field-guide-lead"><span>BUILD A BASE. COMMAND AN ARMY. JOIN THE FIGHT.</span><p>Start above the battlefield. Build an economy, scout your opponent, and send a mixed force into battle. Take direct control of a unit when you want to fight yourself.</p><strong>Your objective: protect your Command HQ and destroy every hostile Command HQ.</strong></div>
      <nav class="field-guide-nav" aria-label="Guide chapters"><a href="#guide-start">First five minutes</a><a href="#guide-armies">Choose your army</a><a href="#guide-tactics">Fight smarter</a><a href="#guide-care">Protect & repair</a><a href="#guide-controls">Controls</a></nav>
      <section id="guide-start" class="iron-howto__section"><div class="iron-howto__section-heading"><span>01</span><h3>First five minutes</h3></div><div class="field-guide-split">${scene('base')}<ol class="field-guide-steps"><li><b>Power your base</b><p>Build a Power Plant. Keep power production ahead of demand so production stays efficient.</p></li><li><b>Secure income</b><p>Place a Refinery near resources. Collectors gather and return cargo for credits. Use the idle-collector notice to locate a collector that needs attention.</p></li><li><b>Build a fighting force</b><p>Barracks produce infantry; Factories produce armor. Mix affordable scouts, M-17 tanks, and powerful Mauler siege guns instead of buying only one unit type.</p></li><li><b>Scout, then commit</b><p>Reveal enemy positions before attacking. Protect collectors and production while your main force advances.</p></li></ol></div></section>
      <section id="guide-armies" class="iron-howto__section"><div class="iron-howto__section-heading"><span>02</span><h3>Israel or Iran. Two ways to win.</h3></div><p>Choose each army’s side in battle setup. Extra Israel-side armies fight as the United States and allies; extra Iran-side armies as Hezbollah and the Houthis. Both build an economy and field ground forces; their special capabilities change your plan.</p><div class="field-guide-armies"><article>${scene('air')}<small>AIR POWER & DEFENSE</small><h4>${ARMY_DOCTRINES['iron-legion'].label}</h4><p>Produce AH-1 Cobra, AH-64 Apache, and Yasur strike gunships from Air Bases. Use air power to flank ground forces and support your tanks.</p><ul><li>Layer Iron Dome, Arrow 3, and Phalanx defenses around valuable buildings.</li><li>Aircraft give you mobile pressure and a direct-control fighting option.</li><li><b>Tradeoff:</b> no strategic missile program.</li></ul><aside>Try this: send aircraft around the flank while armor presses the front.</aside></article><article>${scene('missile')}<small>LONG-RANGE STRIKE</small><h4>${ARMY_DOCTRINES['missile-command'].label}</h4><p>Build the IRGC Aerospace HQ and Missile City, then mark a location for a Fattah missile strike. Upgrade warheads and accuracy as your economy grows.</p><ul><li>Use Fattah missiles and Shahed drone swarms to saturate valuable locations.</li><li>Scout targets: a marked location is not a promise that an enemy will stay there.</li><li><b>Tradeoff:</b> no Air Bases or aircraft production.</li></ul><aside>Try this: pressure production with a strike, then follow with ground troops.</aside></article></div></section>
      <section id="guide-tactics" class="iron-howto__section"><div class="iron-howto__section-heading"><span>03</span><h3>Give your squad a plan</h3></div><div class="field-guide-split">${scene('route')}<div><h4>Define tactics → plot waypoints → choose behavior</h4><p>Select a unit or squad, open <b>Define tactics</b>, and click up to 64 waypoints or use <b>Draw path</b> to drag a route. Adjust <b>Formation variation</b> to stagger departures and vary each unit’s path; the squad spreads out at the final point.</p><div class="field-guide-modes"><article><b>Attack as you move</b><p>Keep moving through the route and fire at available targets. Incoming fire does not make the squad stop to duel. The squad holds at the final point.</p></article><article><b>Attack-move</b><p>Choose this when engaging enemies matters more than passing through without stopping.</p></article><article><b>Hold / attack a target</b><p>Finish in position or give the squad a specific target. Choose the option that matches your mission.</p></article></div><aside>Scenario: facing strong front defenses? Route around the side and threaten the refinery or factory.</aside></div></div><div class="field-guide-callout"><b>Command from above. Fight from inside.</b><p>${mobile ? 'Select a unit and tap CONTROL.' : 'Select a unit and press V.'} Drive, aim, and fire yourself; swap within the selected squad. Return to strategy view to manage the whole battle.</p></div></section>
      <section id="guide-care" class="iron-howto__section"><div class="iron-howto__section-heading"><span>04</span><h3>Keep your base alive</h3></div><div class="field-guide-split">${scene('repair')}<div><h4>Repair before rebuilding</h4><p>Hover a damaged, completed friendly building and click <b>🔧 Repair</b>. It restores health gradually and repairs visible damage.</p><ul><li><b>10 credits per second per building.</b> A full health bar takes 20 paid seconds; partial damage takes less.</li><li>Repairs pause without credits and stop automatically at full health.</li><li>A destroyed building cannot be repaired. Keep troops nearby to protect the repair.</li></ul><h4>Watch the minimap</h4><p>Flashing red dots warn of hostile missiles approaching your base. Spread valuable buildings and use your army’s available defenses.</p><aside>Hard commanders attack earlier, flank, and raid income or production. Defend more than your front gate.</aside></div></div></section>
      <section id="guide-controls" class="iron-howto__section"><div class="iron-howto__section-heading"><span>05</span><h3>${mobile ? 'Touch controls' : 'Keyboard & mouse'}</h3></div><p>You can reopen this guide during a game. Start with selection, movement, and direct control; learn the shortcuts as you play.</p><div class="iron-howto__controls">${controls}</div></section>
      <footer class="iron-howto__footer"><p><strong>Your next move:</strong> choose an army, secure income, scout, then launch one supported attack.</p><button class="iron-howto__footer-close" type="button">Ready for battle</button></footer>
    </section>
  `;
}
