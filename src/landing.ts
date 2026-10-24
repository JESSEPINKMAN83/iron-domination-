import { performanceGraphics, readGraphicsPreference } from './render/graphicsPreference';
import { installLandingGuides } from './landingGuide';
import './landing.css';
import { isMobileTouchDevice, isStandaloneMobileExperience } from './mobile/platform';
import {
  commanderName,
  createCommanderChip,
  currentCommander,
} from './identity/commander';
import { MUSIC_ENABLED } from './experienceFlags';
import { installStandaloneButtonSounds } from './audio/uiMenuSounds';


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

/** Which path the player chose on the landing page. */
export type LandingIntent = 'single' | 'multiplayer';

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
  if (!MUSIC_ENABLED) {
    fadeOutLandingMusic(0);
    return;
  }
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
  if (!MUSIC_ENABLED) {
    root.querySelector('[data-action="toggle-music"]')?.remove();
    return;
  }
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

export function betaPlayerName(): string | undefined {
  return commanderName();
}

export function showLandingScreen(options: LandingOptions = {}): Promise<LandingIntent> {
  return new Promise((resolve) => {
    const inviteRoom = options.inviteRoom;
    const fullscreenHint = isMobileTouchDevice() && !isStandaloneMobileExperience()
      ? '<p class="iron-landing__fullscreen-hint">For true fullscreen on iPhone: tap Share → Add to Home Screen, then launch the game from its icon.</p>'
      : '';
    const primaryIntent: LandingIntent = inviteRoom ? 'multiplayer' : 'single';
    const splitActions = `
        <div class="iron-landing__actions">
          <button class="iron-landing__cta" data-action="choose-primary" type="button">${inviteRoom ? 'Join room' : 'Single Player'}</button>
          <button class="iron-landing__cta iron-landing__cta--ghost" data-action="choose-secondary" type="button">${inviteRoom ? 'Play single player' : 'Multiplayer'}</button>
        </div>
        <p class="iron-landing__paths-note">Play solo or online · no signup required</p>`;
    const root = document.createElement('main');
    root.id = 'iron-landing';
    root.className = 'iron-landing';
    root.innerHTML = `
      <div class="iron-landing__background" aria-hidden="true">
        <video autoplay muted loop playsinline preload="metadata" poster="/assets/landing/current-gameplay-poster.jpg">
          <source src="/assets/landing/current-gameplay-loop.mp4" type="video/mp4">
        </video>
      </div>
      ${MUSIC_ENABLED ? `
        <button class="iron-landing__music-toggle" data-action="toggle-music" type="button" aria-label="Play landing page music" aria-pressed="false">
          <span class="iron-landing__music-meter" aria-hidden="true"><i></i><i></i><i></i></span>
          <span data-music-label>Play music</span>
        </button>
      ` : ''}
      <section class="iron-landing__hero">
        <p class="iron-landing__eyebrow">${inviteRoom ? `Multiplayer invitation · Room ${inviteRoom}` : 'Middle East Warfare'}</p>
        <h1 aria-label="Code Red">
          <span data-text="Code">Code</span>
          <span data-text="Red">Red</span>
        </h1>
        <p class="iron-landing__copy">
          ${inviteRoom ? 'Your friend is waiting in the battle room.' : 'Israel vs Iran. Command from above, then drop into the fight.'}
        </p>
        <p class="iron-landing__detail">
          ${inviteRoom
            ? 'Open the room, choose your army, and play. No account needed.'
            : 'Lead Israel’s air force behind Iron Dome and Arrow 3, or Iran’s Fattah missiles and Shahed swarms. Build your base, deploy armies, and switch into first-person to fight alongside your troops.'}
        </p>
        ${splitActions}
        ${fullscreenHint}
        <ul class="iron-landing__doctrine" aria-label="Core game features">
          <li><button type="button" data-guide="build" aria-haspopup="dialog" aria-label="Build: open field guide">${DOCTRINE_ICONS.build}<strong>Build</strong><span>Your base</span></button></li>
          <li><button type="button" data-guide="deploy" aria-haspopup="dialog" aria-label="Deploy: open field guide">${DOCTRINE_ICONS.deploy}<strong>Deploy</strong><span>Your army</span></button></li>
          <li><button type="button" data-guide="fight" aria-haspopup="dialog" aria-label="Fight: open field guide">${DOCTRINE_ICONS.fight}<strong>Fight</strong><span>On the ground</span></button></li>
          <li><button type="button" data-guide="adapt" aria-haspopup="dialog" aria-label="Adapt: open field guide">${DOCTRINE_ICONS.adapt}<strong>Adapt</strong><span>And conquer</span></button></li>
        </ul>
      </section>
    `;
    const backgroundVideo=root.querySelector<HTMLVideoElement>('.iron-landing__background video');
    const hardware = navigator as Navigator & { deviceMemory?: number };
    if(backgroundVideo&&(window.matchMedia('(prefers-reduced-motion: reduce)').matches || performanceGraphics(readGraphicsPreference(), isMobileTouchDevice(), hardware.hardwareConcurrency, hardware.deviceMemory))){
      backgroundVideo.autoplay=false;backgroundVideo.removeAttribute('autoplay');backgroundVideo.preload='none';
    }
    document.body.appendChild(root);
    installLandingGuides(root);
    installStandaloneButtonSounds(root);
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
    showCommanderChip();
    const completeLanding = (intent: LandingIntent): void => {
      root.querySelector<HTMLVideoElement>('video')?.pause();
      root.classList.add('is-setup-open');
      resolve(intent);
    };

    const primary = root.querySelector<HTMLButtonElement>('[data-action="choose-primary"]')!;
    const secondary = root.querySelector<HTMLButtonElement>('[data-action="choose-secondary"]')!;
    const choose = (intent: LandingIntent): void => {
      primary.disabled = true;
      secondary.disabled = true;
      completeLanding(intent);
    };
    primary.onclick = () => choose(primaryIntent);
    secondary.onclick = () => choose(primaryIntent === 'single' ? 'multiplayer' : 'single');
  });
}
