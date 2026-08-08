import './landing.css';
import { isMobileTouchDevice, isStandaloneMobileExperience } from './mobile/platform';
import { submitToBackoffice } from './backoffice';

const FORM_NAME = 'iron-dominion-beta';
const BETA_SIGNUP_ENDPOINT = 'https://formspree.io/f/xjgnkega';
const ACCESS_STORAGE_KEY = 'iron-dominion.beta-access.v1';
const PROFILE_STORAGE_KEY = 'iron-dominion.beta-profile.v1';
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

/** Which door the player walked through. Multiplayer needs an account first. */
export type LandingIntent = 'single' | 'multiplayer';

interface BetaProfile {
  name: string;
  email: string;
}

/**
 * Line art rather than the in-game command icons: those are opaque dark
 * thumbnails and cannot sit on the light steel plates.
 */
const DOCTRINE_ICONS = {
  build: svgIcon(
    '<path d="M3 20h18"/><path d="M5 20V9l6-4 6 4v11"/><path d="M11 5V2"/>' +
    '<path d="M9 20v-5h4v5"/><path d="M8 11h2"/><path d="M14 11h2"/>',
  ),
  deploy: svgIcon(
    '<circle cx="10" cy="4.4" r="2"/><path d="M10 6.6v4.6l-2.4 3.4L6 21"/>' +
    '<path d="M10 11.2 13 14v7"/><path d="M9.4 8.4 16 5.6"/><path d="M14.6 4.2l2.6 3"/>',
  ),
  fight: svgIcon(
    '<circle cx="12" cy="12" r="6.4"/><path d="M12 1.6v5"/><path d="M12 17.4v5"/>' +
    '<path d="M1.6 12h5"/><path d="M17.4 12h5"/><circle cx="12" cy="12" r="1.3"/>',
  ),
  adapt: svgIcon(
    '<path d="M2.6 17.4h16.8"/><circle cx="5.2" cy="17.4" r="1.7"/><circle cx="10" cy="17.4" r="1.7"/>' +
    '<circle cx="14.8" cy="17.4" r="1.7"/><path d="M3.4 13.6h14.2v2.1H3.4z"/>' +
    '<path d="M7 10.4h7.4v3.2H7z"/><path d="M14.4 11.6h6.6"/>',
  ),
} as const;

function svgIcon(paths: string): string {
  return (
    '<svg class="iron-landing__doctrine-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    paths +
    '</svg>'
  );
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
    if (profile) window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Access still works for this visit when browser storage is unavailable.
  }
}

function forgetBetaAccess(): void {
  try {
    window.localStorage.removeItem(ACCESS_STORAGE_KEY);
    window.localStorage.removeItem(PROFILE_STORAGE_KEY);
  } catch {
    // Nothing to clear when browser storage is unavailable.
  }
}

export function betaPlayerName(): string | undefined {
  try {
    const profile = JSON.parse(window.localStorage.getItem(PROFILE_STORAGE_KEY) ?? 'null') as Partial<BetaProfile> | null;
    const name = typeof profile?.name === 'string' ? profile.name.trim() : '';
    return name ? name.slice(0, 28) : undefined;
  } catch {
    return undefined;
  }
}

export function showLandingScreen(options: LandingOptions = {}): Promise<LandingIntent> {
  return new Promise((resolve) => {
    const inviteRoom = options.inviteRoom;
    const fullscreenHint = isMobileTouchDevice() && !isStandaloneMobileExperience()
      ? '<p class="iron-landing__fullscreen-hint">For true fullscreen on iPhone: tap Share → Add to Home Screen, then launch the game from its icon.</p>'
      : '';
    const root = document.createElement('main');
    root.id = 'iron-landing';
    root.className = 'iron-landing';
    root.innerHTML = `
      <div class="iron-landing__background" aria-hidden="true">
        <video autoplay muted loop playsinline preload="auto" poster="/assets/landing/home-page-bg-38.jpg">
          <source src="/assets/landing/home-page-bg-38.mp4" type="video/mp4">
        </video>
      </div>
      <div class="iron-landing__commander" data-commander hidden>
        <span class="iron-landing__commander-avatar" data-commander-initial aria-hidden="true"></span>
        <span class="iron-landing__commander-id">
          <small>Commander</small>
          <strong data-commander-name></strong>
        </span>
        <button class="iron-landing__signout" data-action="sign-out" type="button">Sign out</button>
      </div>
      <button class="iron-landing__music-toggle" data-action="toggle-music" type="button" aria-label="Play landing page music" aria-pressed="false">
        <span class="iron-landing__music-meter" aria-hidden="true"><i></i><i></i><i></i></span>
        <span data-music-label>Play music</span>
      </button>
      <section class="iron-landing__hero">
        <div class="iron-landing__hero-inner">
          <p class="iron-landing__eyebrow">${inviteRoom ? `Multiplayer invitation • Room ${inviteRoom}` : 'Beta access • Play free'}</p>
          <h1 aria-label="Iron Domination">
            <span data-text="Iron">Iron</span>
            <span data-text="Domination">Domination</span>
          </h1>
          <p class="iron-landing__copy">
            ${inviteRoom ? 'Your friend is waiting in the battle room.' : 'Command a war from above. Then drop into the fight yourself.'}
          </p>
          <p class="iron-landing__detail">
            ${inviteRoom
              ? 'Multiplayer needs a free commander account. Create one and you will join the room automatically.'
              : 'Iron Dominion is a hybrid strategy war game where you build your base, deploy armies, and switch into first-person mode to fight alongside your troops on the ground.'}
          </p>
          <div class="iron-landing__actions">
            <button class="iron-landing__cta iron-landing__cta--play" data-action="${inviteRoom ? 'play-multiplayer' : 'play-single'}" type="button">
              ${inviteRoom ? 'Join room' : 'Play now'}
            </button>
            <button class="iron-landing__cta iron-landing__cta--multiplayer" data-action="${inviteRoom ? 'play-single' : 'play-multiplayer'}" type="button">
              ${inviteRoom ? 'Play solo' : 'Multiplayer'}
            </button>
          </div>
          <p class="iron-landing__actions-note">Single player starts instantly • Multiplayer needs a free account</p>
          <form class="iron-landing__form" name="${FORM_NAME}" method="POST" action="${BETA_SIGNUP_ENDPOINT}" novalidate>
            <div class="iron-landing__signup-panel" hidden>
              <p class="iron-landing__signup-title">Create your commander account</p>
              <div class="iron-landing__fields">
                <label>
                  <span>Commander name</span>
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
          ${fullscreenHint}
        </div>
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
    const completeLanding = (intent: LandingIntent): void => {
      root.classList.add('is-setup-open');
      resolve(intent);
    };

    const commander = root.querySelector<HTMLElement>('[data-commander]')!;
    const commanderName = root.querySelector<HTMLElement>('[data-commander-name]')!;
    const commanderInitial = root.querySelector<HTMLElement>('[data-commander-initial]')!;
    const form = root.querySelector<HTMLFormElement>('.iron-landing__form')!;
    const signupPanel = root.querySelector<HTMLElement>('.iron-landing__signup-panel')!;
    const submitSignup = root.querySelector<HTMLButtonElement>('[data-action="submit-signup"]')!;
    const error = root.querySelector<HTMLElement>('.iron-landing__error')!;
    const playSingle = root.querySelector<HTMLButtonElement>('[data-action="play-single"]')!;
    const playMultiplayer = root.querySelector<HTMLButtonElement>('[data-action="play-multiplayer"]')!;

    const syncCommander = (): void => {
      const name = betaPlayerName();
      commander.hidden = !name;
      commanderName.textContent = name ?? '';
      commanderInitial.textContent = name?.charAt(0).toUpperCase() ?? '';
    };
    syncCommander();

    root.querySelector<HTMLButtonElement>('[data-action="sign-out"]')!.onclick = () => {
      forgetBetaAccess();
      syncCommander();
      closeAccountPanel();
    };

    function closeAccountPanel(): void {
      signupPanel.hidden = true;
      form.classList.remove('is-open');
      playMultiplayer.setAttribute('aria-expanded', 'false');
    }

    // Single player is free: no account, no form, straight into the setup screen.
    playSingle.onclick = () => {
      playSingle.disabled = true;
      completeLanding('single');
    };

    playMultiplayer.onclick = () => {
      if (hasBetaAccess()) {
        playMultiplayer.disabled = true;
        completeLanding('multiplayer');
        return;
      }
      signupPanel.hidden = false;
      form.classList.add('is-open');
      playMultiplayer.setAttribute('aria-expanded', 'true');
      root.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
    };
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
        syncCommander();
        completeLanding('multiplayer');
      } catch {
        error.textContent = 'We could not save your beta signup. Please check your connection and try again.';
        error.hidden = false;
        submitSignup.disabled = false;
      }
    };
  });
}
