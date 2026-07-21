import './landing.css';
import { isMobileTouchDevice, isStandaloneMobileExperience } from './mobile/platform';
import { submitToBackoffice } from './backoffice';

const FORM_NAME = 'iron-dominion-beta';
const BETA_SIGNUP_ENDPOINT = 'https://formspree.io/f/xjgnkega';
const ACCESS_STORAGE_KEY = 'iron-dominion.beta-access.v1';
const PROFILE_STORAGE_KEY = 'iron-dominion.beta-profile.v1';

export interface LandingOptions {
  inviteRoom?: string;
}

interface BetaProfile {
  name: string;
  email: string;
}

function encodeForm(data: Record<string, string>): string {
  return new URLSearchParams(data).toString();
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

export function betaPlayerName(): string | undefined {
  try {
    const profile = JSON.parse(window.localStorage.getItem(PROFILE_STORAGE_KEY) ?? 'null') as Partial<BetaProfile> | null;
    const name = typeof profile?.name === 'string' ? profile.name.trim() : '';
    return name ? name.slice(0, 28) : undefined;
  } catch {
    return undefined;
  }
}

export function showLandingScreen(options: LandingOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    const returningPlayer = hasBetaAccess();
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
      <section class="iron-landing__hero">
        <p class="iron-landing__eyebrow">${inviteRoom ? `Multiplayer invitation · Room ${inviteRoom}` : 'Beta access · Play free'}</p>
        <h1>Iron Domination</h1>
        <p class="iron-landing__copy">
          ${inviteRoom ? 'Your friend is waiting in the battle room.' : 'Command a war from above. Then drop into the fight yourself.'}
        </p>
        <p class="iron-landing__detail">
          ${inviteRoom
            ? 'Enter your details once. You will join the room automatically as soon as signup is complete.'
            : 'Iron Dominion is a hybrid strategy war game where you build your base, deploy armies, and switch into first-person mode to fight alongside your troops on the ground.'}
        </p>
        ${returningPlayer ? `
          <div class="iron-landing__returning">
            <button class="iron-landing__cta" type="button">${inviteRoom ? 'Join room' : 'Play game'}</button>
          </div>
        ` : `
        <form class="iron-landing__form" name="${FORM_NAME}" method="POST" action="${BETA_SIGNUP_ENDPOINT}" novalidate>
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
          <button class="iron-landing__cta" type="submit">${inviteRoom ? 'Sign up & join room' : 'Play game'}</button>
        </form>
        `}
        ${fullscreenHint}
      </section>
    `;

    const cta = root.querySelector<HTMLButtonElement>('.iron-landing__cta')!;
    if (returningPlayer) {
      cta.onclick = () => {
        cta.disabled = true;
        root.classList.add('is-setup-open');
        resolve();
      };
      document.body.appendChild(root);
      return;
    }

    const form = root.querySelector<HTMLFormElement>('.iron-landing__form')!;
    const error = root.querySelector<HTMLElement>('.iron-landing__error')!;
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      cta.disabled = true;
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
        root.classList.add('is-setup-open');
        resolve();
      } catch {
        error.textContent = 'We could not save your beta signup. Please check your connection and try again.';
        error.hidden = false;
        cta.disabled = false;
      }
    };

    document.body.appendChild(root);
  });
}
