import './feedback.css';
import { submitToBackoffice, type FeedbackMatchMetadata } from './backoffice';

const FEEDBACK_FORM_NAME = 'iron-dominion-game-feedback';
const FEEDBACK_ENDPOINT = 'https://formspree.io/f/xykrzdka';
let matchMetadataProvider: (() => FeedbackMatchMetadata | undefined) | undefined;

export function setFeedbackMatchMetadataProvider(provider: () => FeedbackMatchMetadata | undefined): void {
  matchMetadataProvider = provider;
}

export function showFeedbackWidget(): void {
  if (document.getElementById('iron-feedback-widget')) return;

  const widget = document.createElement('div');
  widget.id = 'iron-feedback-widget';
  widget.className = 'iron-feedback';
  widget.innerHTML = `
    <button class="iron-feedback__trigger" type="button" aria-haspopup="dialog">Feedback</button>
    <div class="iron-feedback__overlay" hidden>
      <section class="iron-feedback__dialog" role="dialog" aria-modal="true" aria-labelledby="iron-feedback-title">
        <div class="iron-feedback__header">
          <div>
            <p>FIELD REPORT</p>
            <h2 id="iron-feedback-title">Send feedback</h2>
          </div>
          <button class="iron-feedback__close" type="button" aria-label="Close feedback">×</button>
        </div>
        <p class="iron-feedback__intro">Tell us what worked, what broke, or what would make the battle better.</p>
        <form name="${FEEDBACK_FORM_NAME}" method="POST" action="${FEEDBACK_ENDPOINT}" novalidate>
          <input type="hidden" name="page" value="">
          <label>
            <span>Your name</span>
            <input name="name" type="text" autocomplete="name" placeholder="Your name" required>
          </label>
          <fieldset class="iron-feedback__rating">
            <legend>Rate the game</legend>
            <div>
              <label><input type="radio" name="rating" value="1" required><span>1 ★</span></label>
              <label><input type="radio" name="rating" value="2"><span>2 ★</span></label>
              <label><input type="radio" name="rating" value="3"><span>3 ★</span></label>
              <label><input type="radio" name="rating" value="4"><span>4 ★</span></label>
              <label><input type="radio" name="rating" value="5"><span>5 ★</span></label>
            </div>
          </fieldset>
          <label>
            <span>Feedback about the game</span>
            <textarea name="message" rows="6" placeholder="Tell us what worked, what broke, or what should improve…" required></textarea>
          </label>
          <p class="iron-feedback__message" role="status" hidden></p>
          <button class="iron-feedback__submit" type="submit">Send feedback</button>
        </form>
      </section>
    </div>
  `;

  const trigger = widget.querySelector<HTMLButtonElement>('.iron-feedback__trigger')!;
  const overlay = widget.querySelector<HTMLElement>('.iron-feedback__overlay')!;
  const dialog = widget.querySelector<HTMLElement>('.iron-feedback__dialog')!;
  const close = widget.querySelector<HTMLButtonElement>('.iron-feedback__close')!;
  const form = widget.querySelector<HTMLFormElement>('form')!;
  const textarea = widget.querySelector<HTMLTextAreaElement>('textarea')!;
  const submit = widget.querySelector<HTMLButtonElement>('.iron-feedback__submit')!;
  const message = widget.querySelector<HTMLElement>('.iron-feedback__message')!;
  const page = widget.querySelector<HTMLInputElement>('input[name="page"]')!;

  const closeDialog = (): void => {
    overlay.hidden = true;
    trigger.focus();
  };
  const openDialog = (): void => {
    overlay.hidden = false;
    page.value = location.href;
    requestAnimationFrame(() => textarea.focus());
  };

  trigger.onclick = openDialog;
  close.onclick = closeDialog;
  overlay.onclick = (event) => {
    if (event.target === overlay) closeDialog();
  };
  dialog.onclick = (event) => event.stopPropagation();
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) closeDialog();
  });

  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    message.hidden = true;
    const data = new FormData(form);
    const feedback = {
      name: String(data.get('name') ?? ''),
      rating: Number(data.get('rating') ?? 0),
      message: String(data.get('message') ?? ''),
      page: String(data.get('page') ?? location.href),
      match: matchMetadataProvider?.(),
    };
    try {
      const savedToWix = await submitToBackoffice({ kind: 'feedback', ...feedback });
      if (!savedToWix) {
        const response = await fetch(FEEDBACK_ENDPOINT, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            '_subject': 'New Iron Dominion game feedback',
            name: feedback.name,
            rating: String(feedback.rating),
            message: feedback.message,
            page: feedback.page,
            match_id: feedback.match?.matchId ?? '',
            match_context: feedback.match ? JSON.stringify(feedback.match) : '',
          }).toString(),
        });
        if (!response.ok) throw new Error(`Feedback failed (${response.status})`);
      }
      form.reset();
      message.textContent = 'Field report received. Thank you.';
      message.dataset.state = 'success';
      message.hidden = false;
      submit.disabled = false;
    } catch {
      message.textContent = 'We could not send your feedback. Please check your connection and try again.';
      message.dataset.state = 'error';
      message.hidden = false;
      submit.disabled = false;
    }
  };

  document.body.appendChild(widget);
}
