import './missionBriefing.css';

export type MissionBriefingOptions = {
  enemyCount?: number;
  audioUrl?: string;
  backingAudioUrl?: string;
  backingVolume?: number;
  portraitUrl?: string;
  variant?: 'friendly' | 'hostile';
  speakerName?: string;
  title?: string;
  alertLabel?: string;
  message?: string;
  channelLabel?: string;
  channelSource?: string;
  ariaLabel?: string;
};

export type MissionBriefingController = {
  dismiss: () => void;
  audio: HTMLAudioElement;
  backingAudio?: HTMLAudioElement;
};

const DEFAULT_AUDIO_URL = '/assets/audio/intro-briefing.mp3';
const DEFAULT_PORTRAIT_URL = '/assets/briefing/commander-rhea-voss.webp';

export function enemyForceLabel(count: number): string {
  const safeCount = Math.max(1, Math.floor(count) || 1);
  return `${safeCount} ENEMY ${safeCount === 1 ? 'ARMY' : 'ARMIES'}`;
}

export function showMissionBriefing(options: MissionBriefingOptions): MissionBriefingController {
  document.getElementById('mission-briefing')?.dispatchEvent(new Event('mission-briefing-dismiss'));

  const hostile = options.variant === 'hostile';
  const speakerName = options.speakerName ?? 'COMMANDER RHEA VOSS';
  const title = options.title ?? 'Opening briefing';
  const alertLabel = options.alertLabel ?? `${enemyForceLabel(options.enemyCount ?? 1)} DETECTED`;
  const message = options.message ?? 'Find every hostile base. Destroy each Command Yard. Protect your own.';
  const channelLabel = options.channelLabel ?? 'LIVE COMMS';
  const channelSource = options.channelSource ?? 'FIELD COMMAND';

  const audio = new Audio(options.audioUrl ?? DEFAULT_AUDIO_URL);
  audio.preload = 'auto';
  audio.volume = 0.9;
  const backingAudio = options.backingAudioUrl ? new Audio(options.backingAudioUrl) : undefined;
  if (backingAudio) {
    backingAudio.preload = 'auto';
    backingAudio.loop = true;
    backingAudio.volume = clampAudioVolume(options.backingVolume ?? 0.5);
  }

  const card = document.createElement('aside');
  card.id = 'mission-briefing';
  card.className = hostile ? 'mission-briefing mission-briefing--hostile' : 'mission-briefing';
  card.setAttribute('aria-label', options.ariaLabel ?? 'Opening mission briefing');
  card.innerHTML = `
    <header class="mission-briefing__header">
      <div><i></i><span>${channelLabel}</span><b>${channelSource}</b></div>
      <button class="mission-briefing__close" type="button" aria-label="Dismiss briefing and stop narration">×</button>
    </header>
    <div class="mission-briefing__body">
      <div class="mission-briefing__portrait" role="img" aria-label="${hostile ? 'Enemy general' : 'Field commander'} portrait">
        <span>${hostile ? 'ENEMY GENERAL' : 'COMMANDER PORTRAIT'}</span>
      </div>
      <div class="mission-briefing__copy">
        <p>${speakerName}</p>
        <h2>${title}</h2>
        <strong>${alertLabel}</strong>
        <span>${message}</span>
        <button class="mission-briefing__play" type="button" hidden>Play transmission</button>
      </div>
    </div>
    <footer class="mission-briefing__footer">
      <span class="mission-briefing__status">TRANSMISSION CONNECTING</span>
      <div class="mission-briefing__track"><i></i></div>
      <time>0:00</time>
    </footer>
  `;

  const portrait = card.querySelector<HTMLElement>('.mission-briefing__portrait')!;
  const portraitUrl = options.portraitUrl ?? DEFAULT_PORTRAIT_URL;
  if (portraitUrl) {
    const portraitShade = hostile ? 'rgba(25, 3, 3, .78)' : 'rgba(4, 8, 8, .8)';
    portrait.style.backgroundImage = `linear-gradient(180deg, transparent 55%, ${portraitShade}), url("${portraitUrl}")`;
    portrait.classList.add('mission-briefing__portrait--ready');
  }

  const closeButton = card.querySelector<HTMLButtonElement>('.mission-briefing__close')!;
  const playButton = card.querySelector<HTMLButtonElement>('.mission-briefing__play')!;
  const status = card.querySelector<HTMLElement>('.mission-briefing__status')!;
  const progress = card.querySelector<HTMLElement>('.mission-briefing__track i')!;
  const time = card.querySelector<HTMLTimeElement>('time')!;
  let dismissed = false;

  const stopBackingAudio = (): void => {
    if (!backingAudio) return;
    backingAudio.pause();
    backingAudio.currentTime = 0;
  };
  const dismiss = (): void => {
    if (dismissed) return;
    dismissed = true;
    audio.pause();
    audio.currentTime = 0;
    stopBackingAudio();
    card.classList.add('mission-briefing--leaving');
    window.setTimeout(() => card.remove(), 220);
  };
  const startPlayback = async (): Promise<void> => {
    playButton.hidden = true;
    status.textContent = 'TRANSMISSION LIVE';
    card.classList.add('mission-briefing--playing');
    const narrationPlayback = audio.play();
    const backingPlayback = backingAudio?.play();
    try {
      await narrationPlayback;
      void backingPlayback?.catch(() => {
        // The narration remains useful if a browser cannot decode the music bed.
        stopBackingAudio();
      });
    } catch {
      void backingPlayback?.catch(() => undefined);
      stopBackingAudio();
      card.classList.remove('mission-briefing--playing');
      status.textContent = 'TAP TO START TRANSMISSION';
      playButton.hidden = false;
    }
  };

  closeButton.onclick = dismiss;
  playButton.onclick = () => void startPlayback();
  card.addEventListener('mission-briefing-dismiss', dismiss);
  audio.addEventListener('timeupdate', () => {
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const ratio = duration ? Math.min(1, audio.currentTime / duration) : 0;
    progress.style.width = `${ratio * 100}%`;
    time.textContent = formatBriefingTime(audio.currentTime);
  });
  audio.addEventListener('ended', () => {
    stopBackingAudio();
    card.classList.remove('mission-briefing--playing');
    status.textContent = 'TRANSMISSION COMPLETE';
    progress.style.width = '100%';
    window.setTimeout(dismiss, 1200);
  });
  audio.addEventListener('error', () => {
    stopBackingAudio();
    status.textContent = 'TRANSMISSION UNAVAILABLE';
    playButton.hidden = true;
  });

  document.body.appendChild(card);
  requestAnimationFrame(() => card.classList.add('mission-briefing--visible'));
  void startPlayback();
  return { dismiss, audio, backingAudio };
}

function clampAudioVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0.5;
  return Math.max(0, Math.min(1, volume));
}

function formatBriefingTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
}
