import './landingGuide.css';

type Lesson = {
  name: string; subtitle: string; intro: string;
  steps: Array<[string, string]>; do: string; avoid: string;
};
const LESSONS: Lesson[] = [
  { name: 'Build', subtitle: 'Give your army a foundation.',
    intro: 'A strong base turns resources into options. Establish your economy before committing to a long fight.',
    steps: [
      ['Power comes first', 'Start with a Power Plant. Watch your power balance as your base grows.'],
      ['Put credits to work', 'Add a Refinery to establish income. Protect collectors and keep their routes clear.'],
      ['Open your production lines', 'Build Barracks for infantry and a Factory for vehicles. Check each building’s requirements before planning your next purchase.'],
      ['Protect the heart of your base', 'Defend your Command Yard and economy. Leave space for movement instead of trapping your units between structures.'],
    ], do: 'Balance spending between income, production, and a force that can defend them.',
    avoid: 'Spending every credit on defenses while your economy and army fall behind.' },
  { name: 'Deploy', subtitle: 'Send a force. Have a plan.',
    intro: 'The right mix of units matters more than a crowded production queue. Give every group a job before it leaves your base.',
    steps: [
      ['Scout before you commit', 'Find enemy defenses and approach routes before sending your main army into unknown ground.'],
      ['Build a mixed force', 'Combine units with different roles. Support your frontline and bring an answer to the threats you have actually seen.'],
      ['Keep your army together', 'Send reinforcements to support your force rather than feeding isolated units into a defended position.'],
      ['Leave a reserve', 'Keep enough protection at home to respond when the enemy attacks your economy.'],
    ], do: 'Use control groups to manage your frontline, support units, and home defense separately.',
    avoid: 'Sending your entire army away without scouting or leaving anything to defend your base.' },
  { name: 'Fight', subtitle: 'Command above. Make a difference below.',
    intro: 'Move between strategy and direct control. Choose the view that helps you solve the next problem, then keep the wider battle in mind.',
    steps: [
      ['Choose the engagement', 'Use command view to position your force and identify a target before starting the fight.'],
      ['Focus your pressure', 'Concentrate fire on a useful target. Protect vulnerable support units while your frontline engages.'],
      ['Take direct control', 'Select a unit and press V on desktop, or CONTROL on touch devices, to join the action. Return to command view when your army needs orders.'],
      ['Keep checking home', 'A close fight can distract you from idle production, exposed collectors, or an attack on your Command Yard.'],
    ], do: 'Switch views with a purpose: position the army, influence the fight, then reassess.',
    avoid: 'Staying in one unit so long that the rest of your army and economy are left unattended.' },
  { name: 'Adapt', subtitle: 'Read the battle. Change the plan.',
    intro: 'A good opening is only the beginning. Watch what the enemy builds, understand what is failing, and spend your next credits accordingly.',
    steps: [
      ['Identify the real threat', 'Look at the enemy’s army composition and attack direction. React to what you can see rather than guessing.'],
      ['Change your composition', 'Add anti-air when aircraft threaten you. Bring support and suitable counters when a frontal attack stops working.'],
      ['Upgrade with intent', 'Choose upgrades that strengthen the units you are fielding. Keep enough credits available to replace losses.'],
      ['Find another route', 'If one approach is heavily defended, scout another. Pressure exposed production and economy while protecting your own.'],
    ], do: 'After each engagement, ask what worked, what you lost, and what should change next.',
    avoid: 'Repeating the same attack with the same army after the enemy has already shown a counter.' },
];

export function installLandingGuides(root: HTMLElement): void {
  const cards = root.querySelectorAll<HTMLButtonElement>('[data-guide]');
  cards.forEach((card, index) => {
    card.onclick = () => openGuide(root, card, index);
  });
}

function openGuide(root: HTMLElement, source: HTMLButtonElement, initial: number): void {
  if (root.querySelector('.landing-guide')) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bounds = source.getBoundingClientRect();
  const dialog = document.createElement('dialog');
  dialog.className = 'landing-guide';
  dialog.setAttribute('aria-labelledby', 'landing-guide-title');
  dialog.innerHTML = `
    <div class="landing-guide__shell">
      <header class="landing-guide__header"><span>FIELD SCHOOL <i>/</i> COMMANDER ESSENTIALS</span><button type="button" class="landing-guide__close" aria-label="Close field school">CLOSE <span aria-hidden="true">×</span></button></header>
      <div class="landing-guide__layout">
        <div class="landing-guide__portrait" aria-hidden="true"></div>
        <div class="landing-guide__reading">
          <nav class="landing-guide__nav" aria-label="Field school chapters">${LESSONS.map((lesson, i) => `<button type="button" data-chapter="${i}"><span>0${i + 1}</span>${lesson.name}</button>`).join('')}</nav>
          <article class="landing-guide__lesson"></article>
          <footer class="landing-guide__footer"><span>LEARN THE BASICS. FIND YOUR OWN DOCTRINE.</span><button type="button" class="landing-guide__next"></button></footer>
        </div>
      </div>
    </div>`;
  root.append(dialog);
  let chapter = initial;
  let closing = false;
  let opening = false;
  const openingAnimations: Animation[] = [];
  const shell = dialog.querySelector<HTMLElement>('.landing-guide__shell')!;
  const frame = document.createElement('div');
  frame.className = 'landing-guide__frame';
  frame.setAttribute('aria-hidden', 'true');
  const emblem = document.createElement('div');
  emblem.className = 'landing-guide__emblem';
  emblem.setAttribute('aria-hidden', 'true');
  emblem.innerHTML = source.innerHTML;
  dialog.prepend(frame, emblem);
  const fullFrame = (): Keyframe => ({ left: '0px', top: '0px', width: `${innerWidth}px`, height: `${innerHeight}px` });
  const cardFrame = (): Keyframe => {
    const rect = source.getBoundingClientRect();
    return { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` };
  };
  const emblemStart: Keyframe = { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px`, opacity: 1, transform: 'scale(1)' };
  const emblemEnd = (): Keyframe => ({ left: `${(innerWidth - bounds.width) / 2}px`, top: `${(innerHeight - bounds.height) / 2}px`, width: `${bounds.width}px`, height: `${bounds.height}px`, opacity: 0, transform: 'scale(1.35)' });
  const article = dialog.querySelector<HTMLElement>('article')!;
  const portrait = dialog.querySelector<HTMLElement>('.landing-guide__portrait')!;
  const next = dialog.querySelector<HTMLButtonElement>('.landing-guide__next')!;
  const render = (index: number): void => {
    chapter = index;
    const lesson = LESSONS[index];
    const illustration = document.createElement('img');
    illustration.className = 'landing-guide__commander';
    illustration.alt = '';
    illustration.decoding = 'async';
    illustration.src = `${import.meta.env.BASE_URL}assets/landing/commander/${lesson.name.toLowerCase()}.png`;
    illustration.onload = () => {
      if (!reducedMotion && !opening && illustration.isConnected) illustration.animate(
        [{ opacity: 0, transform: 'translateX(-12px)' }, { opacity: 1, transform: 'translateX(0)' }],
        { duration: 320, easing: 'ease-out' },
      );
    };
    portrait.replaceChildren(illustration);
    article.innerHTML = `<p class="landing-guide__eyebrow">0${index + 1} / THE ART OF ${lesson.name.toUpperCase()}</p><h2 id="landing-guide-title">${lesson.name}</h2><p class="landing-guide__subtitle">${lesson.subtitle}</p><p class="landing-guide__intro">${lesson.intro}</p><ol class="landing-guide__steps">${lesson.steps.map(([title, copy], i) => `<li><span class="landing-guide__number">0${i + 1}</span><div><h3>${title}</h3><p>${copy}</p></div></li>`).join('')}</ol><div class="landing-guide__advice"><section><h3>MAKE IT A HABIT</h3><p>${lesson.do}</p></section><section><h3>AVOID THIS</h3><p>${lesson.avoid}</p></section></div>`;
    dialog.querySelectorAll<HTMLButtonElement>('[data-chapter]').forEach((button, i) => {
      if (i === index) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    next.textContent = index === LESSONS.length - 1 ? 'Back to headquarters ↗' : `Next: ${LESSONS[index + 1].name} →`;
    article.scrollTop = 0;
    if (!reducedMotion && !opening) article.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 260, easing: 'ease-out' });
  };
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    for (const animation of openingAnimations) animation.finish();
    if (!reducedMotion) {
      // Clear the lesson first, then fold the same surface back into its card.
      await shell.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).finished;
      emblem.animate([emblemEnd(), { ...cardFrame(), opacity: 1, transform: 'scale(1)' }], { duration: 540, easing: 'cubic-bezier(.65,0,.25,1)', fill: 'forwards' });
      await frame.animate([fullFrame(), cardFrame()], { duration: 540, easing: 'cubic-bezier(.65,0,.25,1)', fill: 'forwards' }).finished;
    }
    dialog.close();
    dialog.remove();
    source.focus();
  };
  dialog.querySelector<HTMLButtonElement>('.landing-guide__close')!.onclick = () => void close();
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); void close(); });
  dialog.querySelectorAll<HTMLButtonElement>('[data-chapter]').forEach((button, i) => { button.onclick = () => render(i); });
  next.onclick = () => { if (chapter === LESSONS.length - 1) void close(); else render(chapter + 1); };
  opening = true;
  render(initial);
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('.landing-guide__close')!.focus();
  if (!reducedMotion) {
    const animate = (target: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions): Animation => {
      const animation = target.animate(frames, { fill: 'both', ...options });
      openingAnimations.push(animation);
      return animation;
    };
    animate(frame, [cardFrame(), fullFrame()], { duration: 760, easing: 'cubic-bezier(.76,0,.18,1)' });
    animate(emblem, [emblemStart, { ...emblemEnd(), opacity: 1, offset: .6 }, emblemEnd()], { duration: 720, easing: 'cubic-bezier(.65,0,.2,1)' });
    animate(shell, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 520 });
    animate(portrait, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { duration: 480, delay: 580, easing: 'cubic-bezier(.2,.8,.2,1)' });
    const divider = document.createElement('div');
    divider.className = 'landing-guide__divider';
    divider.setAttribute('aria-hidden', 'true');
    dialog.querySelector('.landing-guide__layout')!.append(divider);
    animate(divider, [{ transform: 'scaleY(0)', opacity: 0 }, { transform: 'scaleY(1)', opacity: 1 }], { duration: 480, delay: 580, easing: 'cubic-bezier(.2,.8,.2,1)' });
    const content = [
      article.querySelector<HTMLElement>('.landing-guide__eyebrow')!,
      article.querySelector<HTMLElement>('h2')!,
      article.querySelector<HTMLElement>('.landing-guide__subtitle')!,
      article.querySelector<HTMLElement>('.landing-guide__intro')!,
      ...Array.from(article.querySelectorAll<HTMLElement>('.landing-guide__steps li')),
      article.querySelector<HTMLElement>('.landing-guide__advice')!,
    ];
    content.forEach((element, i) => animate(element, [{ opacity: 0, transform: 'translateY(22px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 400, delay: 660 + i * 45, easing: 'cubic-bezier(.2,.8,.2,1)' }));
    void Promise.all(openingAnimations.map((animation) => animation.finished)).then(() => { opening = false; });
  } else {
    frame.remove();
    emblem.remove();
    opening = false;
  }
}
