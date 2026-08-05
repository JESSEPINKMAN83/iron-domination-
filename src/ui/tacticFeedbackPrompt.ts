import './tacticFeedbackPrompt.css';

const ASKED_KEY = 'iron-dominion.tactic-feedback-asked.v3';

/** Hide without counting as answered — used while the planner modal is open. */
export function hideTacticFeedbackPrompt(): void {
  document.getElementById('iron-tactic-feedback')?.remove();
}

/** Keep asking after every Define Tactic close until the player answers Yes/No. */
export function maybeAskTacticFeedback(onAnswer: (useful: boolean) => void): void {
  if (hasAskedTacticFeedback()) return;

  // Wait a beat so the selection bar (and Define Tactic button) are back on screen.
  window.setTimeout(() => showTacticFeedbackPrompt(onAnswer), 120);
}

function showTacticFeedbackPrompt(onAnswer: (useful: boolean) => void): void {
  if (hasAskedTacticFeedback()) return;

  const existing = document.getElementById('iron-tactic-feedback');
  if (existing) {
    positionBesideDefineTactic(existing);
    return;
  }

  const root = document.createElement('div');
  root.id = 'iron-tactic-feedback';
  root.className = 'iron-tactic-feedback';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Define Tactic feedback');
  root.innerHTML = `
    <p class="iron-tactic-feedback__label">Was Define Tactic useful?</p>
    <div class="iron-tactic-feedback__actions">
      <button type="button" data-answer="yes">Yes</button>
      <button type="button" data-answer="no">No</button>
    </div>
  `;

  const dismiss = (useful: boolean): void => {
    markAskedTacticFeedback();
    root.remove();
    onAnswer(useful);
  };

  root.querySelector<HTMLButtonElement>('[data-answer="yes"]')!.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    dismiss(true);
  };
  root.querySelector<HTMLButtonElement>('[data-answer="no"]')!.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    dismiss(false);
  };
  root.onpointerdown = (event) => event.stopPropagation();

  document.body.appendChild(root);
  positionBesideDefineTactic(root);
  requestAnimationFrame(() => positionBesideDefineTactic(root));
  window.setTimeout(() => positionBesideDefineTactic(root), 160);
}

export function hasAskedTacticFeedback(): boolean {
  try {
    return globalThis.localStorage?.getItem(ASKED_KEY) === '1';
  } catch {
    return false;
  }
}

function markAskedTacticFeedback(): void {
  try {
    globalThis.localStorage?.setItem(ASKED_KEY, '1');
  } catch {
    // Ignore storage failures; answering still dismisses this session.
  }
}

function positionBesideDefineTactic(root: HTMLElement): void {
  const button = document.querySelector<HTMLElement>('[data-define-tactic="true"]');
  const bar = document.querySelector<HTMLElement>('.game-selection-bar');
  const sidebar = document.querySelector<HTMLElement>('.game-sidebar');
  const width = Math.min(260, window.innerWidth - 24);
  const height = Math.max(root.getBoundingClientRect().height, root.offsetHeight, 88);
  const gap = 10;

  const sidebarLeft = sidebar?.getBoundingClientRect().width
    ? sidebar.getBoundingClientRect().left
    : window.innerWidth;
  const maxRight = Math.min(window.innerWidth - 12, sidebarLeft - gap);
  const maxLeft = Math.max(12, maxRight - width);

  const place = (left: number, top: number): void => {
    root.style.left = `${Math.round(Math.max(12, Math.min(left, maxLeft)))}px`;
    root.style.top = `${Math.round(Math.max(12, top))}px`;
    root.style.bottom = 'auto';
    root.style.right = 'auto';
    root.style.width = `${width}px`;
  };

  const barRect = bar?.getBoundingClientRect();
  const buttonRect = button?.getBoundingClientRect();
  const barVisible = !!barRect && barRect.width >= 2 && getComputedStyle(bar!).display !== 'none';

  if (!barVisible) {
    place((Math.min(window.innerWidth, sidebarLeft) - width) / 2, window.innerHeight - height - 120);
    return;
  }

  // Always sit fully above the Selected Force container — never inside/overlapping it.
  // Horizontally align with Define Tactic when present; otherwise the bar's right edge.
  const left = buttonRect
    ? buttonRect.right - width
    : barRect.right - width;
  const top = barRect.top - height - gap;
  place(left, top);
}
