import './landingGuide.css';

import { FACTION_LESSONS, GUIDE_FACTIONS, guideFlag, type GuideFaction } from './landingGuideContent';

export function installLandingGuides(root: HTMLElement): void {
  let selectedFaction: GuideFaction = 'israel';
  const cards = root.querySelectorAll<HTMLButtonElement>('[data-guide]');
  cards.forEach((card, index) => {
    card.onclick = () => openGuide(root, card, index, selectedFaction, (faction) => { selectedFaction = faction; });
  });
}

function openGuide(root: HTMLElement, source: HTMLButtonElement, initial: number, initialFaction: GuideFaction, rememberFaction: (faction: GuideFaction) => void): void {
  if (root.querySelector('.landing-guide')) return;
  let faction = initialFaction;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bounds = source.getBoundingClientRect();
  const dialog = document.createElement('dialog');
  dialog.className = 'landing-guide';
  dialog.setAttribute('aria-labelledby', 'landing-guide-title');
  dialog.innerHTML = `
    <div class="landing-guide__shell">
      <header class="landing-guide__header"><span>FIELD SCHOOL <i>/</i> COMMANDER ESSENTIALS</span><button type="button" class="landing-guide__close" aria-label="Close field school">CLOSE <span aria-hidden="true">×</span></button></header>
      <div class="landing-guide__layout">
        <div class="landing-guide__portrait">
          <div class="landing-guide__factions" role="group" aria-label="Choose your army">${(['israel', 'iran'] as const).map((id) => `<button type="button" data-faction="${id}" aria-label="${GUIDE_FACTIONS[id].name} field guide" title="${GUIDE_FACTIONS[id].name}">${guideFlag(id)}</button>`).join('')}</div>
          <div class="landing-guide__figure"></div>
          <p class="landing-guide__identity"></p>
        </div>
        <div class="landing-guide__reading">
          <nav class="landing-guide__nav" aria-label="Field school chapters">${FACTION_LESSONS.israel.map((lesson, i) => `<button type="button" data-chapter="${i}"><span>0${i + 1}</span>${lesson.name}</button>`).join('')}</nav>
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
  const figure = dialog.querySelector<HTMLElement>('.landing-guide__figure')!;
  const identity = dialog.querySelector<HTMLElement>('.landing-guide__identity')!;
  const next = dialog.querySelector<HTMLButtonElement>('.landing-guide__next')!;
  const render = (index: number): void => {
    chapter = index;
    const lessons = FACTION_LESSONS[faction];
    const lesson = lessons[index];
    dialog.dataset.faction = faction;
    identity.textContent = `${GUIDE_FACTIONS[faction].name.toUpperCase()} / ${GUIDE_FACTIONS[faction].specialty}`;
    dialog.querySelectorAll<HTMLButtonElement>('[data-faction]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.faction === faction));
    });
    const illustration = document.createElement('img');
    illustration.className = 'landing-guide__commander';
    illustration.alt = faction === 'israel' ? 'Israeli female field instructor in olive uniform' : 'Iranian male field instructor in camouflage uniform';
    illustration.decoding = 'async';
    illustration.src = `${import.meta.env.BASE_URL}assets/landing/commander/factions/${faction}-${lesson.name.toLowerCase()}.webp`;
    illustration.onload = () => {
      if (!reducedMotion && !opening && illustration.isConnected) illustration.animate(
        [{ opacity: 0, transform: 'translateX(-12px)' }, { opacity: 1, transform: 'translateX(0)' }],
        { duration: 320, easing: 'ease-out' },
      );
    };
    figure.replaceChildren(illustration);
    article.innerHTML = `<p class="landing-guide__eyebrow">${GUIDE_FACTIONS[faction].name.toUpperCase()} FIELD GUIDE · 0${index + 1} / THE ART OF ${lesson.name.toUpperCase()}</p><h2 id="landing-guide-title">${lesson.name}</h2><p class="landing-guide__subtitle">${lesson.subtitle}</p><p class="landing-guide__intro">${lesson.intro}</p><ol class="landing-guide__steps">${lesson.steps.map(([title, copy], i) => `<li><span class="landing-guide__number">0${i + 1}</span><div><h3>${title}</h3><p>${copy}</p></div></li>`).join('')}</ol><div class="landing-guide__advice"><section><h3>MAKE IT A HABIT</h3><p>${lesson.do}</p></section><section><h3>AVOID THIS</h3><p>${lesson.avoid}</p></section></div>`;
    dialog.querySelectorAll<HTMLButtonElement>('[data-chapter]').forEach((button, i) => {
      if (i === index) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    next.textContent = index === lessons.length - 1 ? 'Back to headquarters ↗' : `Next: ${lessons[index + 1].name} →`;
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
  dialog.querySelectorAll<HTMLButtonElement>('[data-faction]').forEach((button) => { button.onclick = () => {
    const chosen = button.dataset.faction as GuideFaction;
    if (chosen === faction) return;
    faction = chosen; rememberFaction(faction); render(chapter);
  }; });
  next.onclick = () => { if (chapter === FACTION_LESSONS[faction].length - 1) void close(); else render(chapter + 1); };
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
