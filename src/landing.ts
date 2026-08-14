import './landing.css';
import { isMobileTouchDevice, isStandaloneMobileExperience } from './mobile/platform';
import { submitToBackoffice } from './backoffice';
import { identityEnabled } from './identity/flag';
import {
  commanderEmail,
  commanderName,
  createCommanderChip,
  currentCommander,
  rememberLocalCommander,
} from './identity/commander';
import { enlist, enlistedCommander } from './identity/enlist';

const FORM_NAME = 'iron-dominion-beta';

/** Tactical two-tone marks built for the landing cards' smoked-steel surface. */
const DOCTRINE_ICONS = {
  build: svgIcon(
    '<path class="iron-landing__doctrine-accent" d="M13 48h38l-4 7H17z"/>' +
    '<path d="M16 48V25l8-5v8l8-5 8 5v-8l8 5v23"/>' +
    '<path d="M12 48h40M24 20v-7M40 20v-7M21 13h6M37 13h6"/>' +
    '<path d="M27 48V37h10v11M20 32h5M39 32h5"/>',
  ),
  deploy: svgIcon(
    '<path class="iron-landing__doctrine-accent" d="M32 9c-11 0-19 7-21 17 6-4 10-4 15 0 4-4 8-4 12 0 5-4 9-4 15 0C51 16 43 9 32 9z"/>' +
    '<path d="M11 26c2-10 10-17 21-17s19 7 21 17c-6-4-10-4-15 0-4-4-8-4-12 0-5-4-9-4-15 0z"/>' +
    '<path d="M26 26l4 15M38 26l-4 15M32 9v32"/>' +
    '<path d="M24 43h16v11H24zM28 47h8M32 43v11"/>',
  ),
  fight: svgIcon(
    '<circle class="iron-landing__doctrine-accent" cx="32" cy="32" r="9"/>' +
    '<circle cx="32" cy="32" r="19"/><circle cx="32" cy="32" r="9"/>' +
    '<path d="M32 7v11M32 46v11M7 32h11M46 32h11"/>' +
    '<path d="M32 27v10M27 32h10"/>',
  ),
  adapt: svgIcon(
    '<path class="iron-landing__doctrine-accent" d="M14 40h34l5 8H18z"/>' +
    '<path d="M14 40h34l5 8H18zM21 40l4-10h17l6 10M30 30v-6h10l6 6M40 24l9-4"/>' +
    '<circle cx="23" cy="48" r="4"/><circle cx="33" cy="48" r="4"/><circle cx="43" cy="48" r="4"/>' +
    '<path d="M13 24c3-7 10-12 18-13M13 24l-1-8M13 24l8-2M51 15c2 5 2 10 0 15M51 15l-7 4M51 15l5 7"/>',
  ),
} as const;

function svgIcon(paths: string): string {
  return (
    '<svg class="iron-landing__doctrine-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true">' +
    '<path class="iron-landing__doctrine-brackets" d="M17 6H8v9M47 6h9v9M17 58H8v-9M47 58h9v-9"/>' +
    '<g class="iron-landing__doctrine-mark">' + paths + '</g>' +
    '</svg>'
  );
}
const BETA_SIGNUP_ENDPOINT = 'https://formspree.io/f/xjgnkega';
const ACCESS_STORAGE_KEY = 'iron-dominion.beta-access.v1';
const LANDING_MUSIC_VOLUME = 0.16;
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

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
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
    const knownName = escapeAttribute(commanderName() ?? '');
    const knownEmail = escapeAttribute(commanderEmail() ?? '');
    const signupFields = `
          <div class="iron-landing__signup-panel" hidden>
            <p class="iron-landing__signup-title">${splitPaths ? 'Enlist for multiplayer' : 'Request beta clearance'}</p>
            <div class="iron-landing__fields">
              <label>
                <span>Name</span>
                <input name="name" type="text" autocomplete="name" placeholder="Your name" value="${knownName}" required>
              </label>
              <label>
                <span>Email</span>
                <input name="email" type="email" autocomplete="email" placeholder="you@example.com" value="${knownEmail}" required>
              </label>
            </div>
            ${splitPaths ? `
            <p class="iron-landing__consent-note">This creates your free commander account — your call sign on the battlefield and on the ladder. Nothing to remember, nothing to sign in to.</p>` : ''}
            <label class="iron-landing__consent">
              <input name="release-updates" type="checkbox" value="yes">
              <span>Email me occasional development updates and news about the official release.</span>
            </label>
            <p class="iron-landing__error" role="alert" hidden></p>
            <button class="iron-landing__cta iron-landing__cta--submit" data-action="submit-signup" type="submit">${inviteRoom ? 'Enlist & join room' : splitPaths ? 'Enlist & deploy' : 'Enter battlefield'}</button>
          </div>`;
    const splitActions = `
        <div class="iron-landing__actions">
          <button class="iron-landing__cta" data-action="choose-primary" type="button">${inviteRoom ? 'Join room' : 'Play now'}</button>
          <button class="iron-landing__cta iron-landing__cta--ghost" data-action="choose-secondary" type="button">${inviteRoom ? 'Play single player' : 'Multiplayer'}</button>
        </div>
        <form class="iron-landing__form" name="${FORM_NAME}" method="POST" action="${BETA_SIGNUP_ENDPOINT}" novalidate>${signupFields}
        </form>
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
          <li>${DOCTRINE_ICONS.build}<strong>Build</strong><span>Your base</span></li>
          <li>${DOCTRINE_ICONS.deploy}<strong>Deploy</strong><span>Your army</span></li>
          <li>${DOCTRINE_ICONS.fight}<strong>Fight</strong><span>On the ground</span></li>
          <li>${DOCTRINE_ICONS.adapt}<strong>Adapt</strong><span>And conquer</span></li>
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
      const openEnlistForm = (): void => {
        const panel = root.querySelector<HTMLElement>('.iron-landing__signup-panel')!;
        panel.hidden = false;
        root.querySelector<HTMLFormElement>('.iron-landing__form')?.classList.add('is-open');
        const name = root.querySelector<HTMLInputElement>('input[name="name"]');
        const email = root.querySelector<HTMLInputElement>('input[name="email"]');
        (name?.value ? email ?? name : name)?.focus();
      };
      const choose = (intent: LandingIntent): void => {
        // Single player is never gated. Multiplayer needs a member account.
        if (intent === 'single' || enlistedCommander()) {
          primary.disabled = true;
          secondary.disabled = true;
          completeLanding(intent);
          return;
        }
        openEnlistForm();
      };
      primary.onclick = () => choose(primaryIntent);
      secondary.onclick = () => choose(primaryIntent === 'single' ? 'multiplayer' : 'single');
      bindSignupForm(root, 'multiplayer', inviteRoom, completeLanding);
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

/**
 * The one form on the page. In the split-path layout it enlists the player as a Wix
 * member for multiplayer; with identity switched off it falls back to the original
 * beta-clearance signup. Either way it collects a name and an email and nothing else.
 */
function bindSignupForm(
  root: HTMLElement,
  intent: LandingIntent,
  inviteRoom: string | undefined,
  completeLanding: (intent: LandingIntent) => void,
): void {
  const form = root.querySelector<HTMLFormElement>('.iron-landing__form')!;
  const submitSignup = root.querySelector<HTMLButtonElement>('[data-action="submit-signup"]')!;
  const error = root.querySelector<HTMLElement>('.iron-landing__error')!;
  const enlisting = intent === 'multiplayer';
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

      if (enlisting) {
        const outcome = await enlist({
          ...signup,
          source: inviteRoom ? `Multiplayer invitation · room ${inviteRoom}` : 'Iron Dominion multiplayer enlistment',
        });
        if (outcome.status === 'error') {
          error.textContent = outcome.message;
          error.hidden = false;
          submitSignup.disabled = false;
          return;
        }
        rememberBetaAccess({ name: signup.name, email: signup.email });
        completeLanding(intent);
        return;
      }

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
