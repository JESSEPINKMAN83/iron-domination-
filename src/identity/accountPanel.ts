import './accountPanel.css';
import {
  requestPasswordReset,
  signInCommander,
  signUpCommander,
  submitVerificationCode,
  type PendingIntent,
  type SignInResult,
} from './session';

type Mode = 'signup' | 'login';

export interface AccountPanelOptions {
  intent: PendingIntent;
  /** Rendered inside this element so the landing art stays behind it. */
  host: HTMLElement;
  onCancel?: () => void;
}

const PASSWORD_MIN = 8;

function field(label: string, input: HTMLInputElement): HTMLLabelElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'account-panel__field';
  const caption = document.createElement('span');
  caption.textContent = label;
  wrapper.append(caption, input);
  return wrapper;
}

function textInput(name: string, type: string, placeholder: string, autocomplete: AutoFill): HTMLInputElement {
  const input = document.createElement('input');
  input.name = name;
  input.type = type;
  input.placeholder = placeholder;
  input.autocomplete = autocomplete;
  input.required = true;
  return input;
}

/**
 * Sign up / log in for Wix Headless members. A successful attempt navigates away
 * to Wix's authorization page, so this panel never has to render a "signed in"
 * state — boot picks the session back up on return.
 */
export function openAccountPanel(options: AccountPanelOptions): HTMLElement {
  const root = document.createElement('section');
  root.className = 'account-panel';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Commander account');

  const tabs = document.createElement('div');
  tabs.className = 'account-panel__tabs';
  const signupTab = document.createElement('button');
  signupTab.type = 'button';
  signupTab.textContent = 'Create account';
  const loginTab = document.createElement('button');
  loginTab.type = 'button';
  loginTab.textContent = 'Log in';
  tabs.append(signupTab, loginTab);

  const intro = document.createElement('p');
  intro.className = 'account-panel__intro';

  const form = document.createElement('form');
  form.className = 'account-panel__form';
  form.noValidate = true;

  const nameInput = textInput('name', 'text', 'Your commander name', 'username');
  nameInput.maxLength = 28;
  const emailInput = textInput('email', 'email', 'you@example.com', 'email');
  const confirmEmailInput = textInput('confirmEmail', 'email', 'Repeat your email', 'email');
  const passwordInput = textInput('password', 'password', `At least ${PASSWORD_MIN} characters`, 'new-password');

  const nameField = field('Commander name', nameInput);
  const emailField = field('Email', emailInput);
  const confirmField = field('Confirm email', confirmEmailInput);
  const passwordField = field('Password', passwordInput);

  const codeInput = textInput('code', 'text', '6-digit code', 'one-time-code');
  codeInput.inputMode = 'numeric';
  const codeField = field('Verification code', codeInput);
  codeField.hidden = true;

  const message = document.createElement('p');
  message.className = 'account-panel__message';
  message.setAttribute('role', 'alert');
  message.hidden = true;

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'account-panel__submit';

  const secondary = document.createElement('button');
  secondary.type = 'button';
  secondary.className = 'account-panel__link';
  secondary.textContent = 'Forgot your password?';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'account-panel__link account-panel__cancel';
  cancel.textContent = 'Back';

  form.append(nameField, emailField, confirmField, passwordField, codeField, message, submit, secondary, cancel);
  root.append(tabs, intro, form);
  options.host.append(root);

  let mode: Mode = 'signup';
  let verifyStateToken: string | undefined;
  let busy = false;

  const say = (text: string, tone: 'error' | 'info' = 'error'): void => {
    message.textContent = text;
    message.hidden = false;
    message.classList.toggle('is-info', tone === 'info');
  };

  const render = (): void => {
    const verifying = verifyStateToken !== undefined;
    signupTab.classList.toggle('is-active', mode === 'signup' && !verifying);
    loginTab.classList.toggle('is-active', mode === 'login' && !verifying);
    tabs.hidden = verifying;
    nameField.hidden = verifying || mode === 'login';
    confirmField.hidden = verifying || mode === 'login';
    emailField.hidden = verifying;
    passwordField.hidden = verifying;
    codeField.hidden = !verifying;
    secondary.hidden = verifying || mode === 'signup';
    passwordInput.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    intro.textContent = verifying
      ? 'We emailed you a verification code. Enter it to finish.'
      : mode === 'signup'
        ? 'Multiplayer needs a free account, so your name and progress follow you to any device.'
        : 'Welcome back, commander.';
    submit.textContent = verifying ? 'Verify' : mode === 'signup' ? 'Create account & continue' : 'Log in & continue';
    submit.disabled = busy;
    if (busy) submit.textContent = 'Contacting command…';
  };

  const handle = (result: SignInResult): void => {
    if (result.status === 'redirecting') {
      say('Signing you in…', 'info');
      submit.disabled = true;
      return;
    }
    if (result.status === 'verify-email') {
      verifyStateToken = result.stateToken;
      message.hidden = true;
      render();
      codeInput.focus();
      return;
    }
    if (result.status === 'owner-approval') {
      tabs.hidden = true;
      form.hidden = true;
      intro.textContent = 'Your account is waiting for approval. You can play single player in the meantime.';
      return;
    }
    // When Wix tells us the player is on the wrong tab, move them there and keep
    // what they already typed rather than making them work it out.
    if (result.suggest && result.suggest !== mode) {
      mode = result.suggest;
      render();
    }
    say(result.message);
  };

  const run = async (task: Promise<SignInResult>): Promise<void> => {
    busy = true;
    message.hidden = true;
    render();
    try {
      handle(await task);
    } finally {
      busy = false;
      // A redirect leaves the button disabled on purpose; anything else re-enables it.
      if (message.classList.contains('is-info')) submit.disabled = true;
      else render();
    }
  };

  form.onsubmit = (event) => {
    event.preventDefault();
    if (busy) return;
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (verifyStateToken) {
      const code = codeInput.value.trim();
      if (!code) return say('Enter the code from your email.');
      void run(submitVerificationCode({ code, stateToken: verifyStateToken }, options.intent));
      return;
    }
    if (!email.includes('@')) return say('Enter a valid email address.');
    if (password.length < PASSWORD_MIN) return say(`Use a password of at least ${PASSWORD_MIN} characters.`);
    if (mode === 'login') {
      void run(signInCommander({ email, password }, options.intent));
      return;
    }
    // Catches the mistyped address that would otherwise make the account unrecoverable.
    if (email !== confirmEmailInput.value.trim()) return say('The two email addresses do not match.');
    void run(signUpCommander({ email, password, name: nameInput.value.trim() || undefined }, options.intent));
  };

  signupTab.onclick = () => {
    mode = 'signup';
    message.hidden = true;
    render();
    nameInput.focus();
  };
  loginTab.onclick = () => {
    mode = 'login';
    message.hidden = true;
    render();
    emailInput.focus();
  };
  secondary.onclick = async () => {
    const email = emailInput.value.trim();
    if (!email.includes('@')) return say('Enter your email address first, then tap this again.');
    say(
      (await requestPasswordReset(email))
        ? 'If that address has an account, a reset email is on its way.'
        : 'We could not send the reset email. Try again in a moment.',
      'info',
    );
  };
  cancel.onclick = () => {
    root.remove();
    options.onCancel?.();
  };

  render();
  nameInput.focus();
  return root;
}
