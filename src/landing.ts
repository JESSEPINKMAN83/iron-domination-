import './landing.css';
import { isMobileTouchDevice, isStandaloneMobileExperience } from './mobile/platform';
import { submitToBackoffice } from './backoffice';
import { identityEnabled } from './identity/flag';
import { commanderName, createCommanderChip, currentCommander, rememberLocalCommander } from './identity/commander';
import { memberAuthConfigured } from './identity/config';
import { isMemberSignedIn } from './identity/session';

const FORM_NAME = 'iron-dominion-beta';
const BETA_SIGNUP_ENDPOINT = 'https://formspree.io/f/xjgnkega';
const ACCESS_STORAGE_KEY = 'iron-dominion.beta-access.v1';
const LANDING_MUSIC_VOLUME = 0.32;
const LANDING_MUSIC_ID = 'iron-menu-music';
const LANDING_MUSIC_URL = '/assets/landing/home-theme.mp3';

let landingMusic: HTMLAudioElement | undefined;
let landingMusicEnabled = true;
let landingMusicFading = false;
let landingMusicUnlockAttached = false;
let landingMusicFadeFrame: number | undefined;

export interface LandingOptions {
  inviteRoom?: string;
}

/** Which path the player chose on the landing page. Multiplayer is the gated one. */
export type LandingIntent = 'single' | 'multiplayer';

interface BetaProfile {
  name: string;
  email: string;
}

function encodeForm(data: Record<string, string>): string {
  return new URLSearchParams(data).toString();
}

function ensureLandingMusic(): HTMLAudioElement {
  const existing = document.getElementById(LANDING_MUSIC_ID);
  if (existing instanceof HTMLAudioElement) {
    landingMusic = existing;
    return existing;
  }
  const audio = document.createElement('audio');
  audio.id = LANDING_MUSIC_ID;
  audio.className = 'iron-landing__music';
  audio.src = LANDING_MUSIC_URL;
  audio.preload = 'auto';
  audio.loop = true;
  audio.volume = LANDING_MUSIC_VOLUME;
  document.body.appendChild(audio);
  landingMusic = audio;
  return audio;
}

async function playLandingMusic(): Promise<void> {
  const audio = ensureLandingMusic();
  if (!landingMusicEnabled || landingMusicFading || !audio.paused) return;
  try {
    await audio.play();
  } catch {
    // Audible autoplay is commonly blocked. A later user gesture retries it.
  }
}

function unlockLandingMusic(event: Event): void {
  const target = event.target;
  if (target instanceof Element && target.closest('[data-action="toggle-music"]')) return;
  void playLandingMusic();
}

function attachLandingMusicUnlock(): void {
  if (landingMusicUnlockAttached) return;
  landingMusicUnlockAttached = true;
  window.addEventListener('pointerdown', unlockLandingMusic, { capture: true });
  window.addEventListener('keydown', unlockLandingMusic, { capture: true });
}

function detachLandingMusicUnlock(): void {
  if (!landingMusicUnlockAttached) return;
  landingMusicUnlockAttached = false;
  window.removeEventListener('pointerdown', unlockLandingMusic, { capture: true });
  window.removeEventListener('keydown', unlockLandingMusic, { capture: true });
}

export function startLandingMusic(): void {
  if (landingMusicFading) return;
  ensureLandingMusic();
  attachLandingMusicUnlock();
  void playLandingMusic();
}

export function fadeOutLandingMusic(durationMs = 20_000): void {
  const audio = landingMusic ?? document.getElementById(LANDING_MUSIC_ID);
  if (!(audio instanceof HTMLAudioElement) || landingMusicFading) return;
  landingMusic = audio;
  landingMusicFading = true;
  detachLandingMusicUnlock();
  if (landingMusicFadeFrame !== undefined) cancelAnimationFrame(landingMusicFadeFrame);

  const finish = (): void => {
    audio.pause();
    audio.currentTime = 0;
    audio.remove();
    landingMusic = undefined;
    landingMusicFadeFrame = undefined;
  };

  if (audio.paused || durationMs <= 0) {
    finish();
    return;
  }

  const startedAt = performance.now();
  const startingVolume = audio.volume;
  const step = (now: number): void => {
    const progress = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
    audio.volume = startingVolume * (1 - progress);
    if (progress < 1) {
      landingMusicFadeFrame = requestAnimationFrame(step);
    } else {
      finish();
    }
  };
  landingMusicFadeFrame = requestAnimationFrame(step);
}

function setupLandingMusicControl(root: HTMLElement): void {
  const audio = ensureLandingMusic();
  const toggle = root.querySelector<HTMLButtonElement>('[data-action="toggle-music"]')!;
  const label = toggle.querySelector<HTMLElement>('[data-music-label]')!;

  const updateControl = (): void => {
    const playing = landingMusicEnabled && !audio.paused;
    toggle.classList.toggle('is-playing', playing);
    toggle.classList.toggle('is-muted', !landingMusicEnabled);
    label.textContent = !landingMusicEnabled ? 'Music off' : playing ? 'Music on' : 'Play music';
    toggle.setAttribute('aria-label', playing ? 'Mute landing page music' : 'Play landing page music');
    toggle.setAttribute('aria-pressed', playing ? 'true' : 'false');
  };

  toggle.onclick = () => {
    if (landingMusicEnabled && !audio.paused) {
      landingMusicEnabled = false;
      audio.pause();
    } else {
      landingMusicEnabled = true;
      void playLandingMusic();
    }
    updateControl();
  };

  audio.addEventListener('playing', updateControl);
  audio.addEventListener('pause', updateControl);
  audio.addEventListener('error', updateControl);
  updateControl();
}

export function hasBetaAccess(): boolean {
  try {
    return window.localStorage.getItem(ACCESS_STORAGE_KEY) === 'granted';
  } catch {
    return false;
  }
}

function rememberBetaAccess(profile?: BetaProfile): void {
  try {
    window.localStorage.setItem(ACCESS_STORAGE_KEY, 'granted');
  } catch {
    // Access still works for this visit when browser storage is unavailable.
  }
  if (profile) rememberLocalCommander(profile);
}

export function betaPlayerName(): string | undefined {
  return commanderName();
}

export function showLandingScreen(options: LandingOptions = {}): Promise<LandingIntent> {
  return new Promise((resolve) => {
    const splitPaths = identityEnabled();
    const returningPlayer = hasBetaAccess();
    const inviteRoom = options.inviteRoom;
    const fullscreenHint = isMobileTouchDevice() && !isStandaloneMobileExperience()
      ? '<p class="iron-landing__fullscreen-hint">For true fullscreen on iPhone: tap Share → Add to Home Screen, then launch the game from its icon.</p>'
      : '';
    const primaryIntent: LandingIntent = inviteRoom ? 'multiplayer' : 'single';
    const signupFields = `
          <div class="iron-landing__signup-panel" hidden>
            <p class="iron-landing__signup-title">${splitPaths ? 'Create your commander account' : 'Request beta clearance'}</p>
            <div class="iron-landing__fields">
              <label>
                <span>Name</span>
                <input name="name" type="text" autocomplete="name" placeholder="Your name" required>
              </label>
              <label>
                <span>Email</span>
                <input name="email" type="email" autocomplete="email" placeholder="you@example.com" required>
              </label>
            </div>
            <label class="iron-landing__consent">
              <input name="release-updates" type="checkbox" value="yes">
              <span>Email me occasional development updates and news about the official release.</span>
            </label>
            <p class="iron-landing__error" role="alert" hidden></p>
            <button class="iron-landing__cta iron-landing__cta--submit" data-action="submit-signup" type="submit">${inviteRoom ? 'Sign up & join room' : 'Enter battlefield'}</button>
          </div>`;
    const splitActions = `
        <div class="iron-landing__actions">
          <button class="iron-landing__cta" data-action="choose-primary" type="button">${inviteRoom ? 'Join room' : 'Play now'}</button>
          <button class="iron-landing__cta iron-landing__cta--ghost" data-action="choose-secondary" type="button">${inviteRoom ? 'Play single player' : 'Multiplayer'}</button>
        </div>
        ${returningPlayer ? '' : `
        <form class="iron-landing__form" name="${FORM_NAME}" method="POST" action="${BETA_SIGNUP_ENDPOINT}" novalidate>${signupFields}
        </form>`}
        <p class="iron-landing__paths-note">Single player starts instantly · multiplayer needs a free account</p>`;
    const root = document.createElement('main');
    root.id = 'iron-landing';
    root.className = 'iron-landing';
    root.innerHTML = `
      <div class="iron-landing__background" aria-hidden="true">
        <video autoplay muted loop playsinline preload="auto" poster="/assets/landing/home-page-bg-38.jpg">
          <source src="/assets/landing/home-page-bg-38.mp4" type="video/mp4">
        </video>
      </div>
      <button class="iron-landing__music-toggle" data-action="toggle-music" type="button" aria-label="Play landing page music" aria-pressed="false">
        <span class="iron-landing__music-meter" aria-hidden="true"><i></i><i></i><i></i></span>
        <span data-music-label>Play music</span>
      </button>
      <section class="iron-landing__hero">
        <p class="iron-landing__eyebrow">${inviteRoom ? `Multiplayer invitation · Room ${inviteRoom}` : 'Beta access · Play free'}</p>
        <h1 aria-label="Iron Domination">
          <span data-text="Iron">Iron</span>
          <span data-text="Domination">Domination</span>
        </h1>
        <p class="iron-landing__copy">
          ${inviteRoom ? 'Your friend is waiting in the battle room.' : 'Command a war from above. Then drop into the fight yourself.'}
        </p>
        <p class="iron-landing__detail">
          ${inviteRoom
            ? 'Enter your details once. You will join the room automatically as soon as signup is complete.'
            : 'Iron Dominion is a hybrid strategy war game where you build your base, deploy armies, and switch into first-person mode to fight alongside your troops on the ground.'}
        </p>
        ${splitPaths ? splitActions : returningPlayer ? `
          <div class="iron-landing__returning">
            <button class="iron-landing__cta" data-action="start-game" type="button">${inviteRoom ? 'Join room' : 'Play game'}</button>
          </div>
        ` : `
        <form class="iron-landing__form" name="${FORM_NAME}" method="POST" action="${BETA_SIGNUP_ENDPOINT}" novalidate>
          <button class="iron-landing__cta" data-action="open-signup" type="button" aria-expanded="false">Play game</button>
          <div class="iron-landing__signup-panel" hidden>
            <p class="iron-landing__signup-title">Request beta clearance</p>
            <div class="iron-landing__fields">
              <label>
                <span>Name</span>
                <input name="name" type="text" autocomplete="name" placeholder="Your name" required>
              </label>
              <label>
                <span>Email</span>
                <input name="email" type="email" autocomplete="email" placeholder="you@example.com" required>
              </label>
            </div>
            <label class="iron-landing__consent">
              <input name="release-updates" type="checkbox" value="yes">
              <span>Email me occasional development updates and news about the official release.</span>
            </label>
            <p class="iron-landing__error" role="alert" hidden></p>
            <button class="iron-landing__cta iron-landing__cta--submit" data-action="submit-signup" type="submit">${inviteRoom ? 'Sign up & join room' : 'Enter battlefield'}</button>
          </div>
        </form>
        `}
        ${fullscreenHint}
        <ul class="iron-landing__doctrine" aria-label="Core game features">
          <li>
            <img src="/assets/ui/command-icons/command-yard.png" alt="">
            <strong>Build</strong><span>Your base</span>
          </li>
          <li>
            <img src="/assets/ui/command-icons/infantry.png" alt="">
            <strong>Deploy</strong><span>Your army</span>
          </li>
          <li class="is-active">
            <i class="iron-landing__reticle" aria-hidden="true"></i>
            <strong>Fight</strong><span>On the ground</span>
          </li>
          <li>
            <img src="/assets/ui/command-icons/siege-tank.png" alt="">
            <strong>Adapt</strong><span>And conquer</span>
          </li>
        </ul>
      </section>
    `;
    document.body.appendChild(root);
    startLandingMusic();
    setupLandingMusicControl(root);
    const showCommanderChip = (): void => {
      const identity = currentCommander();
      if (!identity || root.querySelector('.iron-landing__commander')) return;
      const holder = document.createElement('div');
      holder.className = 'iron-landing__commander';
      holder.append(createCommanderChip(identity));
      if (identity.source === 'member') {
        const signOut = document.createElement('button');
        signOut.type = 'button';
        signOut.className = 'iron-landing__sign-out';
        signOut.textContent = 'Sign out';
        signOut.onclick = async () => {
          signOut.disabled = true;
          const { signOutCommander } = await import('./identity/session');
          await signOutCommander();
        };
        holder.append(signOut);
      }
      root.append(holder);
    };
    if (splitPaths) showCommanderChip();
    const completeLanding = (intent: LandingIntent): void => {
      root.classList.add('is-setup-open');
      resolve(intent);
    };

    if (splitPaths) {
      const primary = root.querySelector<HTMLButtonElement>('[data-action="choose-primary"]')!;
      const secondary = root.querySelector<HTMLButtonElement>('[data-action="choose-secondary"]')!;
      const openLocalSignup = (): void => {
        const panel = root.querySelector<HTMLElement>('.iron-landing__signup-panel')!;
        panel.hidden = false;
        root.querySelector<HTMLFormElement>('.iron-landing__form')?.classList.add('is-open');
        root.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
      };
      const openMemberSignIn = async (): Promise<void> => {
        const hero = root.querySelector<HTMLElement>('.iron-landing__hero') ?? root;
        primary.hidden = true;
        secondary.hidden = true;
        const { openAccountPanel } = await import('./identity/accountPanel');
        openAccountPanel({
          host: hero,
          intent: { action: 'multiplayer', roomCode: inviteRoom },
          onCancel: () => {
            primary.hidden = false;
            secondary.hidden = false;
          },
        });
      };
      const choose = (intent: LandingIntent): void => {
        // Single player is never gated. Multiplayer needs an account.
        if (intent === 'single') {
          primary.disabled = true;
          secondary.disabled = true;
          completeLanding(intent);
          return;
        }
        if (memberAuthConfigured()) {
          if (isMemberSignedIn()) {
            primary.disabled = true;
            secondary.disabled = true;
            completeLanding(intent);
            return;
          }
          void openMemberSignIn();
          return;
        }
        if (returningPlayer) {
          primary.disabled = true;
          secondary.disabled = true;
          completeLanding(intent);
          return;
        }
        openLocalSignup();
      };
      primary.onclick = () => choose(primaryIntent);
      secondary.onclick = () => choose(primaryIntent === 'single' ? 'multiplayer' : 'single');
      if (!returningPlayer) bindSignupForm(root, 'multiplayer', inviteRoom, completeLanding);
      return;
    }

    if (returningPlayer) {
      const cta = root.querySelector<HTMLButtonElement>('[data-action="start-game"]')!;
      cta.onclick = () => {
        cta.disabled = true;
        completeLanding('single');
      };
      return;
    }

    const form = root.querySelector<HTMLFormElement>('.iron-landing__form')!;
    const openSignup = root.querySelector<HTMLButtonElement>('[data-action="open-signup"]')!;
    const signupPanel = root.querySelector<HTMLElement>('.iron-landing__signup-panel')!;
    openSignup.onclick = () => {
      openSignup.hidden = true;
      openSignup.setAttribute('aria-expanded', 'true');
      signupPanel.hidden = false;
      form.classList.add('is-open');
      root.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
    };
    bindSignupForm(root, 'single', inviteRoom, completeLanding);
  });
}

/** Shared signup submit: same Wix pipeline for both the legacy gate and the multiplayer path. */
function bindSignupForm(
  root: HTMLElement,
  intent: LandingIntent,
  inviteRoom: string | undefined,
  completeLanding: (intent: LandingIntent) => void,
): void {
  const form = root.querySelector<HTMLFormElement>('.iron-landing__form')!;
  const submitSignup = root.querySelector<HTMLButtonElement>('[data-action="submit-signup"]')!;
  const error = root.querySelector<HTMLElement>('.iron-landing__error')!;
  form.onsubmit = async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      submitSignup.disabled = true;
      error.hidden = true;
      const formData = new FormData(form);
      const signup = {
        name: String(formData.get('name') ?? ''),
        email: String(formData.get('email') ?? ''),
        releaseUpdates: formData.get('release-updates') === 'yes',
      };
      try {
        const savedToWix = await submitToBackoffice({
          kind: 'signup',
          ...signup,
          source: inviteRoom ? `Multiplayer invitation · room ${inviteRoom}` : 'Iron Dominion landing page',
        });
        if (!savedToWix) {
          const response = await fetch(BETA_SIGNUP_ENDPOINT, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: encodeForm({
              '_subject': 'New Iron Dominion beta signup',
              name: signup.name,
              email: signup.email,
              release_updates: signup.releaseUpdates ? 'yes' : 'no',
            }),
          });
          if (!response.ok) throw new Error(`Signup failed (${response.status})`);
        }
        rememberBetaAccess({ name: signup.name, email: signup.email });
        completeLanding(intent);
      } catch {
        error.textContent = 'We could not save your beta signup. Please check your connection and try again.';
        error.hidden = false;
        submitSignup.disabled = false;
      }
    };
}
