import './sfxPreview.css';

interface MixProfile {
  gain: number;
  near: number;
  far: number;
}

interface PreviewSound {
  id: string;
  label: string;
  role: string;
  url: string;
  mix: MixProfile;
  loop?: boolean;
  spatial?: boolean;
}

interface PreviewGroup {
  title: string;
  description: string;
  sounds: PreviewSound[];
}

const GAME_MASTER_GAIN = 0.74;
const COMBAT_GAIN_SCALE = 0.7;
const COMBAT_SAMPLE_PATTERN = /^(?:strategic-missile-(?:launch|flyby|impact|intercepted)|missile-launch-(?:heavy|medium)|aircraft-autocannon|rocket-launcher-fire|shell-flyby|impact-building|building-collapse|small-explosion|medium-explosion|heavy-impact|vehicle-destruction)/;

const sound = (
  id: string,
  label: string,
  role: string,
  file: string,
  mix: MixProfile,
  loop = false,
  spatial = true,
): PreviewSound => ({
  id,
  label,
  role,
  url: `/assets/sfx/${file}`,
  mix: COMBAT_SAMPLE_PATTERN.test(file) ? { ...mix, gain: mix.gain * COMBAT_GAIN_SCALE } : mix,
  loop,
  spatial,
});

const SOUND_GROUPS: PreviewGroup[] = [
  {
    title: 'Strategic missile',
    description: 'The complete launch, flight, flyby, impact, and interception sequence.',
    sounds: [
      sound('missile-launch', 'Missile launch', 'Silo ignition and liftoff', 'strategic-missile-launch-01.wav', {
        gain: 0.26,
        near: 30,
        far: 420,
      }),
      sound(
        'missile-flight',
        'Flight motor',
        'Motor attached to the moving missile',
        'strategic-missile-flight-loop.wav',
        { gain: 0.25, near: 35, far: 360 },
        true,
      ),
      sound('missile-flyby', 'Close flyby', 'One proximity pass per missile', 'strategic-missile-flyby-01.wav', {
        gain: 0.48,
        near: 45,
        far: 280,
      }),
      sound('missile-impact', 'Ground impact', 'Successful strategic detonation', 'strategic-missile-impact-01.wav', {
        gain: 0.68,
        near: 65,
        far: 900,
      }),
      sound(
        'missile-intercepted',
        'Mid-air interception',
        'Missile destroyed by air defense',
        'strategic-missile-intercepted-01.wav',
        { gain: 0.5, near: 45, far: 600 },
      ),
    ],
  },
  {
    title: 'Interface',
    description: 'The active pair uses one consistent hover and click across the home page, setup, HUD, and match menus. Other supplied candidates remain available here for comparison.',
    sounds: [
      sound('ui-hover-active-2', 'Active interface hover', 'All enabled buttons across the game interface', 'ui-button-hover-active-02.wav', {
        gain: 0.06,
        near: 0,
        far: 1,
      }, false, false),
      sound('ui-click-active-2', 'Active interface click', 'All enabled buttons across the game interface', 'ui-button-click-active-02.wav', {
        gain: 0.5,
        near: 0,
        far: 1,
      }, false, false),
      sound('ui-hover-active', 'Previous interface hover', 'Inactive previous global hover', 'ui-button-hover-active.wav', {
        gain: 0.12,
        near: 0,
        far: 1,
      }, false, false),
      sound('ui-click-active', 'Previous interface click', 'Inactive previous global click', 'ui-button-click-active.wav', {
        gain: 0.2,
        near: 0,
        far: 1,
      }, false, false),
      sound('ui-menu-hover-1', 'Earlier hover A', 'Inactive earlier menu-hover candidate 1', 'ui-menu-hover-01.wav', {
        gain: 0.045,
        near: 0,
        far: 1,
      }, false, false),
      sound('ui-menu-hover-2', 'Earlier hover B', 'Inactive earlier menu-hover candidate 2', 'ui-menu-hover-02.wav', {
        gain: 0.085,
        near: 0,
        far: 1,
      }, false, false),
      sound('ui-menu-hover-3', 'Earlier hover C', 'Inactive earlier menu-hover candidate 3', 'ui-menu-hover-03.wav', {
        gain: 0.095,
        near: 0,
        far: 1,
      }, false, false),
      sound('ui-game-click-1', 'Earlier click A', 'Inactive earlier in-game click candidate 1', 'ui-game-click-01.wav', {
        gain: 0.14,
        near: 0,
        far: 1,
      }, false, false),
      sound('ui-game-click-2', 'Game command click B', 'Ordinary in-game command button click candidate 2', 'ui-game-click-02.wav', {
        gain: 0.12,
        near: 0,
        far: 1,
      }, false, false),
      sound('ui-game-hover-1', 'Rejected hover A', 'Inactive candidate retained for possible upgrade feedback', 'ui-game-hover-01.wav', {
        gain: 0.022,
        near: 0,
        far: 1,
      }, false, false),
      sound('ui-game-hover-2', 'Rejected hover B', 'Inactive candidate retained for possible upgrade feedback', 'ui-game-hover-02.wav', {
        gain: 0.036,
        near: 0,
        far: 1,
      }, false, false),
      sound('ui-game-hover-3', 'Earlier hover C', 'Inactive earlier in-game hover candidate 3', 'ui-game-hover-03.wav', {
        gain: 0.05,
        near: 0,
        far: 1,
      }, false, false),
      sound('ui-button-hover', 'Button hover', 'Pointer enters any enabled game button', 'ui-button-hover-01.wav', {
        gain: 0.14,
        near: 0,
        far: 1,
      }, false, false),
      sound('ui-button-click', 'Button click', 'Any enabled game button is pressed', 'ui-button-click-01.wav', {
        gain: 0.28,
        near: 0,
        far: 1,
      }, false, false),
      sound('ui-upgrade', 'Upgrade confirmed', 'Building or weapon upgrade feedback', 'ui-upgrade.wav', {
        gain: 0.38,
        near: 28,
        far: 340,
      }),
    ],
  },
  {
    title: 'Heavy gunship engines',
    description: 'Four engine identities assigned across aircraft and armies.',
    sounds: [1, 2, 3, 4].map((variant) =>
      sound(
        `gunship-engine-${variant}`,
        `Engine variant ${variant}`,
        `Heavy aircraft engine loop ${variant}`,
        `heavy-gunship-engine-loop-0${variant}.wav`,
        { gain: 0.068, near: 18, far: 220 },
        true,
      ),
    ),
  },
  {
    title: 'Light aircraft engines',
    description: 'The new Wasp and Vulture engine loops; gameplay varies their pitch and level for hover, flight, and Shift boost.',
    sounds: [
      sound('aircraft-engine-candidate-1', 'Wasp engine', 'Light interceptor hover and flight engine', 'aircraft-engine-candidate-01.wav', {
        gain: 0.033,
        near: 10,
        far: 145,
      }, true),
      sound('aircraft-engine-candidate-2', 'Vulture engine', 'Armored attack-gunship hover and flight engine', 'aircraft-engine-candidate-02.wav', {
        gain: 0.046,
        near: 12,
        far: 175,
      }, true),
    ],
  },
  {
    title: 'Tracked vehicle engines',
    description: 'Four movement loops assigned consistently across M-17 and Mauler vehicles.',
    sounds: [1, 2, 3, 4].map((variant) =>
      sound(
        `tank-engine-${variant}`,
        `Tank movement ${variant}`,
        `Engine and track variation ${variant}`,
        `tank-engine-tracks-loop-0${variant}.wav`,
        { gain: 0.035, near: 6, far: 90 },
        true,
      ),
    ),
  },
  {
    title: 'Vehicle engine states',
    description: 'New engine candidates: M-17 base, Mauler base, Jackal base, and the shared Shift-boost layer.',
    sounds: [
      sound('vehicle-engine-state-1', 'M-17 base engine', 'Idle-to-driving engine layer for the standard tank', 'vehicle-engine-candidate-01.wav', {
        gain: 0.036,
        near: 10,
        far: 150,
      }, true),
      sound('vehicle-engine-state-2', 'Mauler base engine', 'Idle-to-driving engine layer for the heavy siege tank', 'vehicle-engine-candidate-02.wav', {
        gain: 0.036,
        near: 10,
        far: 150,
      }, true),
      sound('vehicle-engine-state-3', 'Jackal base engine', 'Idle-to-driving engine layer for the fast scout vehicle', 'vehicle-engine-candidate-03.wav', {
        gain: 0.036,
        near: 10,
        far: 150,
      }, true),
      sound('vehicle-engine-state-4', 'Vehicle Shift boost', 'Extra engine-strain layer crossfaded in only during player boost', 'vehicle-engine-candidate-04.wav', {
        gain: 0.033,
        near: 10,
        far: 150,
      }, true),
    ],
  },
  {
    title: 'Automatic weapons',
    description: 'Short bursts selected per firing aircraft, vehicle, or defensive emplacement.',
    sounds: [1, 2, 3, 4].map((variant) =>
      sound(
        `autocannon-${variant}`,
        `Autocannon burst ${variant}`,
        `Automatic weapon variation ${variant}`,
        `aircraft-autocannon-0${variant}.wav`,
        { gain: 0.32, near: 22, far: 300 },
      ),
    ),
  },
  {
    title: 'Heavy missile launches',
    description: 'A coherent heavy-launch family assigned consistently by platform and missile class.',
    sounds: [
      sound('heavy-missile-aircraft', 'Heavy aircraft missile', 'Hammerhead and other heavy aircraft launchers', 'missile-launch-heavy-01.wav', {
        gain: 0.14,
        near: 28,
        far: 450,
      }),
      sound('heavy-missile-vehicle', 'Heavy vehicle missile', 'Mauler and other heavy vehicle launchers', 'missile-launch-heavy-02.wav', {
        gain: 0.135,
        near: 28,
        far: 390,
      }),
      sound('heavy-missile-emplacement', 'Heavy emplacement missile', 'Fortified tower and fixed heavy launchers', 'missile-launch-heavy-03.wav', {
        gain: 0.15,
        near: 28,
        far: 420,
      }),
      sound('heavy-missile-advanced', 'Advanced heavy missile', 'Annihilator and saturation-class launchers', 'missile-launch-heavy-04.wav', {
        gain: 0.155,
        near: 34,
        far: 520,
      }),
    ],
  },
  {
    title: 'Medium missile launches',
    description: 'The earlier compact launch pair now serves medium aircraft and vehicles, below the heavier one-second launch family.',
    sounds: [
      sound('medium-missile-aircraft', 'Medium aircraft missile', 'Vulture rocket-pod launch', 'missile-launch-medium-01.wav', {
        gain: 0.10,
        near: 22,
        far: 360,
      }),
      sound('medium-missile-vehicle', 'Medium vehicle missile', 'M-17 guided missile launch', 'missile-launch-medium-02.wav', {
        gain: 0.125,
        near: 22,
        far: 320,
      }),
    ],
  },
  {
    title: 'Rocket launchers',
    description: 'Launch signatures selected by the type of firing unit.',
    sounds: [
      sound('rocket-1', 'Infantry launcher', 'Shoulder-fired rocket', 'rocket-launcher-fire-01.wav', {
        gain: 0.36,
        near: 18,
        far: 285,
      }),
      sound('rocket-2', 'Armored launcher', 'Vehicle-mounted missile', 'rocket-launcher-fire-02.wav', {
        gain: 0.4,
        near: 24,
        far: 360,
      }),
      sound('rocket-3', 'Aircraft launcher', 'Air-launched missile', 'rocket-launcher-fire-03.wav', {
        gain: 0.38,
        near: 28,
        far: 400,
      }),
      sound('rocket-4', 'Defense launcher', 'Tower-launched interceptor', 'rocket-launcher-fire-04.wav', {
        gain: 0.42,
        near: 26,
        far: 430,
      }),
    ],
  },
  {
    title: 'Shell flybys',
    description: 'Projectile passes for standard and heavy ballistic weapons.',
    sounds: [
      sound('shell-1', 'Standard shell A', 'Light projectile flyby', 'shell-flyby-01.wav', {
        gain: 0.28,
        near: 18,
        far: 220,
      }),
      sound('shell-2', 'Standard shell B', 'Alternate light projectile flyby', 'shell-flyby-02.wav', {
        gain: 0.28,
        near: 18,
        far: 220,
      }),
      sound('shell-3', 'Heavy shell A', 'Heavy projectile flyby', 'shell-flyby-03.wav', {
        gain: 0.34,
        near: 22,
        far: 280,
      }),
      sound('shell-4', 'Heavy shell B', 'Alternate heavy projectile flyby', 'shell-flyby-04.wav', {
        gain: 0.34,
        near: 22,
        far: 280,
      }),
    ],
  },
  {
    title: 'Building impacts',
    description: 'Material-heavy strikes scaled to the structure being damaged.',
    sounds: [
      sound('building-impact-1', 'Light structure', 'Impact on a small building', 'impact-building-01.wav', {
        gain: 0.36,
        near: 24,
        far: 330,
      }),
      sound('building-impact-2', 'Industrial structure', 'Impact on a factory or refinery', 'impact-building-02.wav', {
        gain: 0.43,
        near: 30,
        far: 420,
      }),
      sound('building-impact-3', 'Defensive structure', 'Impact on a fortified tower', 'impact-building-03.wav', {
        gain: 0.4,
        near: 27,
        far: 380,
      }),
      sound('building-impact-4', 'Strategic structure', 'Impact on a command-scale building', 'impact-building-04.wav', {
        gain: 0.48,
        near: 38,
        far: 510,
      }),
    ],
  },
  {
    title: 'Building destruction',
    description: 'Dedicated structural-collapse sounds selected by building class; these replace ordinary hit audio on the killing blow.',
    sounds: [
      sound('building-collapse-light', 'Light building collapse', 'Candidate 2 · power plants, barracks, walls, and small structures', 'building-collapse-candidate-02.wav', {
        gain: 0.28,
        near: 20,
        far: 320,
      }),
      sound('building-collapse-industrial', 'Industrial collapse', 'Candidate 3 · factories, refineries, and helipads', 'building-collapse-candidate-03.wav', {
        gain: 0.36,
        near: 28,
        far: 440,
      }),
      sound('building-collapse-defense', 'Fortified collapse', 'Candidate 1 · towers, batteries, and defensive structures', 'building-collapse-candidate-01.wav', {
        gain: 0.34,
        near: 26,
        far: 400,
      }),
      sound('building-collapse-strategic', 'Strategic collapse', 'Candidate 4 · command, intelligence, and missile-silo structures', 'building-collapse-candidate-04.wav', {
        gain: 0.44,
        near: 38,
        far: 560,
      }),
    ],
  },
  {
    title: 'Small explosions',
    description: 'Compact detonations for grenades, light rockets, missiles, and smaller destroyed units.',
    sounds: [
      sound('small-explosion-1', 'Grenade', 'Compact battlefield detonation', 'small-explosion-01.wav', {
        gain: 0.26,
        near: 18,
        far: 285,
      }),
      sound('small-explosion-2', 'Light rocket', 'Light rocket detonation', 'small-explosion-02.wav', {
        gain: 0.26,
        near: 18,
        far: 285,
      }),
      sound('small-explosion-3', 'Missile', 'Standard missile detonation', 'small-explosion-03.wav', {
        gain: 0.3,
        near: 22,
        far: 340,
      }),
      sound('small-explosion-4', 'Unit destruction', 'Small vehicle or aircraft destroyed', 'small-explosion-04.wav', {
        gain: 0.34,
        near: 24,
        far: 390,
      }),
    ],
  },
  {
    title: 'Medium explosions',
    description: 'Heavier detonations for armor, artillery, bombs, and destroyed combat vehicles.',
    sounds: [
      sound('medium-explosion-1', 'Tank shell', 'Armored shell detonation', 'medium-explosion-01.wav', {
        gain: 0.34,
        near: 25,
        far: 365,
      }),
      sound('medium-explosion-2', 'Artillery', 'Siege projectile detonation', 'medium-explosion-02.wav', {
        gain: 0.42,
        near: 32,
        far: 490,
      }),
      sound('medium-explosion-3', 'Bomb', 'Aircraft bomb detonation', 'medium-explosion-03.wav', {
        gain: 0.45,
        near: 35,
        far: 520,
      }),
      sound('medium-explosion-4', 'Vehicle destruction', 'Tank or aircraft destroyed', 'medium-explosion-04.wav', {
        gain: 0.48,
        near: 40,
        far: 560,
      }),
    ],
  },
  {
    title: 'Heavy bomb and artillery impacts',
    description: 'New high-detail impacts reserved for siege/artillery rounds and heavy aircraft or tank bombs.',
    sounds: [
      sound('heavy-impact-artillery', 'Artillery impact', 'Candidate 1 · Mauler artillery and siege-missile impact', 'heavy-impact-candidate-01.wav', {
        gain: 0.32,
        near: 28,
        far: 460,
      }),
      sound('heavy-impact-bomb', 'Heavy bomb impact', 'Candidate 2 · aircraft and tank bomb impact', 'heavy-impact-candidate-02.wav', {
        gain: 0.42,
        near: 36,
        far: 560,
      }),
    ],
  },
  {
    title: 'Armored vehicle destruction',
    description: 'Dedicated catastrophic-destruction sounds selected by the destroyed ground vehicle class.',
    sounds: [
      sound('vehicle-destruction-jackal', 'Jackal destroyed', 'Candidate 4 · light scout armor', 'vehicle-destruction-candidate-04.wav', {
        gain: 0.27,
        near: 20,
        far: 340,
      }),
      sound('vehicle-destruction-m17', 'M-17 destroyed', 'Candidate 3 · main battle tank', 'vehicle-destruction-candidate-03.wav', {
        gain: 0.36,
        near: 28,
        far: 450,
      }),
      sound('vehicle-destruction-mauler', 'Mauler destroyed', 'Candidate 2 · heavy siege armor', 'vehicle-destruction-candidate-02.wav', {
        gain: 0.42,
        near: 32,
        far: 520,
      }),
      sound('vehicle-destruction-collector', 'Ore collector destroyed', 'Candidate 1 · industrial armored vehicle', 'vehicle-destruction-candidate-01.wav', {
        gain: 0.32,
        near: 24,
        far: 380,
      }),
    ],
  },
];

const ALL_SOUNDS = SOUND_GROUPS.flatMap((group) => group.sounds);

export function showSfxPreview(): void {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app missing');
  document.documentElement.classList.add('strategic-sfx-preview-mode');
  app.replaceChildren();

  const root = document.createElement('main');
  root.className = 'strategic-sfx-preview';
  root.innerHTML = `
    <section class="strategic-sfx-preview__panel" aria-labelledby="strategic-sfx-title">
      <header class="strategic-sfx-preview__header">
        <div>
          <div class="strategic-sfx-preview__eyebrow">LOCAL AUDIO LAB · COMPLETE BATTLEFIELD MIX</div>
          <h1 id="strategic-sfx-title">All game sounds</h1>
          <p>Test every imported sample at its in-game mix level. Change distance and direction to hear the same spatial attenuation used on the battlefield.</p>
        </div>
        <button class="strategic-sfx-preview__stop" type="button">Stop all</button>
      </header>
      <div class="strategic-sfx-preview__controls">
        <label>
          <span>Master volume</span>
          <input id="strategic-sfx-volume" type="range" min="0" max="100" value="100" />
          <output for="strategic-sfx-volume">100%</output>
        </label>
        <label>
          <span>Camera distance</span>
          <input id="strategic-sfx-distance" type="range" min="0" max="1000" value="35" step="5" />
          <output for="strategic-sfx-distance">35m</output>
        </label>
        <label>
          <span>Sound direction</span>
          <input id="strategic-sfx-pan" type="range" min="-100" max="100" value="0" step="5" />
          <output for="strategic-sfx-pan">CENTER</output>
        </label>
      </div>
      <div class="strategic-sfx-preview__status" role="status">${ALL_SOUNDS.length} sounds ready. Choose one to begin.</div>
      <div class="strategic-sfx-preview__groups"></div>
      <footer>
        <span>One sound plays at a time.</span>
        <span>Engine and missile motors loop until stopped.</span>
      </footer>
    </section>
  `;
  app.appendChild(root);

  const groups = requiredElement<HTMLElement>(root, '.strategic-sfx-preview__groups');
  const status = requiredElement<HTMLElement>(root, '.strategic-sfx-preview__status');
  const stopButton = requiredElement<HTMLButtonElement>(root, '.strategic-sfx-preview__stop');
  const volume = requiredElement<HTMLInputElement>(root, '#strategic-sfx-volume');
  const distance = requiredElement<HTMLInputElement>(root, '#strategic-sfx-distance');
  const pan = requiredElement<HTMLInputElement>(root, '#strategic-sfx-pan');
  const volumeOutput = requiredElement<HTMLOutputElement>(root, 'output[for="strategic-sfx-volume"]');
  const distanceOutput = requiredElement<HTMLOutputElement>(root, 'output[for="strategic-sfx-distance"]');
  const panOutput = requiredElement<HTMLOutputElement>(root, 'output[for="strategic-sfx-pan"]');
  const buffers = new Map<string, AudioBuffer>();
  const buttons = new Map<string, HTMLButtonElement>();
  let audioContext: AudioContext | undefined;
  let activeSource: AudioBufferSourceNode | undefined;
  let activeGain: GainNode | undefined;
  let activePanner: StereoPannerNode | undefined;
  let activeSound: PreviewSound | undefined;
  let playbackToken = 0;

  const masterVolume = (): number => Number(volume.value) / 100;
  const cameraDistance = (): number => Number(distance.value);
  const stereoPan = (): number => Number(pan.value) / 100;
  const attenuation = (item: PreviewSound): number => {
    if (item.spatial === false) return 1;
    if (cameraDistance() <= item.mix.near) return 1;
    if (cameraDistance() >= item.mix.far) return 0;
    const progress = (cameraDistance() - item.mix.near) / (item.mix.far - item.mix.near);
    return (1 - progress) * (1 - progress);
  };
  const outputGain = (item: PreviewSound): number =>
    item.mix.gain * GAME_MASTER_GAIN * masterVolume() * attenuation(item);
  const updateMix = (): void => {
    if (activeSound && activeGain && audioContext) {
      activeGain.gain.setTargetAtTime(outputGain(activeSound), audioContext.currentTime, 0.015);
    }
    if (activePanner && audioContext) {
      activePanner.pan.setTargetAtTime(activeSound?.spatial === false ? 0 : stereoPan(), audioContext.currentTime, 0.015);
    }
  };
  const updateButtons = (): void => {
    for (const [id, button] of buttons) {
      button.classList.toggle('is-playing', id === activeSound?.id);
      button.textContent =
        id === activeSound?.id && activeSound.loop ? 'STOP LOOP' : id === activeSound?.id ? 'PLAYING' : 'PLAY';
    }
  };
  const stopAll = (message = 'Playback stopped.'): void => {
    playbackToken += 1;
    if (activeSource) {
      activeSource.onended = null;
      try {
        activeSource.stop();
      } catch {
        // The source may already have ended naturally.
      }
      activeSource.disconnect();
    }
    activeGain?.disconnect();
    activePanner?.disconnect();
    activeSource = undefined;
    activeGain = undefined;
    activePanner = undefined;
    activeSound = undefined;
    status.textContent = message;
    updateButtons();
  };
  const getAudioContext = async (): Promise<AudioContext> => {
    audioContext ??= new AudioContext();
    if (audioContext.state === 'suspended') await audioContext.resume();
    return audioContext;
  };
  const loadBuffer = async (item: PreviewSound, context: AudioContext): Promise<AudioBuffer> => {
    const cached = buffers.get(item.id);
    if (cached) return cached;
    const response = await fetch(item.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    buffers.set(item.id, buffer);
    return buffer;
  };
  const playSound = async (item: PreviewSound): Promise<void> => {
    if (activeSound?.id === item.id && item.loop) {
      stopAll();
      return;
    }
    stopAll(`Loading ${item.label}…`);
    const token = playbackToken;
    const button = buttons.get(item.id);
    if (button) button.textContent = 'LOADING';
    try {
      const context = await getAudioContext();
      const buffer = await loadBuffer(item, context);
      if (token !== playbackToken) return;
      const source = context.createBufferSource();
      const gainNode = context.createGain();
      const pannerNode = context.createStereoPanner();
      source.buffer = buffer;
      source.loop = Boolean(item.loop);
      gainNode.gain.value = outputGain(item);
      pannerNode.pan.value = item.spatial === false ? 0 : stereoPan();
      source.connect(gainNode).connect(pannerNode).connect(context.destination);
      activeSource = source;
      activeGain = gainNode;
      activePanner = pannerNode;
      activeSound = item;
      status.textContent = `Playing ${item.label}${item.loop ? ' · looping' : ''} · ${cameraDistance()}m from camera`;
      updateButtons();
      source.onended = () => {
        if (token !== playbackToken || activeSound?.id !== item.id) return;
        activeSource = undefined;
        activeGain?.disconnect();
        activePanner?.disconnect();
        activeGain = undefined;
        activePanner = undefined;
        activeSound = undefined;
        status.textContent = `${item.label} complete.`;
        updateButtons();
      };
      source.start();
    } catch (error: unknown) {
      if (token !== playbackToken) return;
      activeSound = undefined;
      status.textContent = `Could not play ${item.label}. Click again to unlock browser audio.`;
      updateButtons();
      console.warn(`[sfx-preview] Unable to play ${item.url}`, error);
    }
  };

  let soundNumber = 0;
  for (const group of SOUND_GROUPS) {
    const section = document.createElement('section');
    section.className = 'strategic-sfx-preview__group';
    section.innerHTML = `
      <header>
        <h2>${group.title}</h2>
        <p>${group.description}</p>
        <span>${group.sounds.length} ${group.sounds.length === 1 ? 'SOUND' : 'SOUNDS'}</span>
      </header>
      <div class="strategic-sfx-preview__grid"></div>
    `;
    const grid = requiredElement<HTMLElement>(section, '.strategic-sfx-preview__grid');
    for (const item of group.sounds) {
      soundNumber += 1;
      const card = document.createElement('article');
      card.className = 'strategic-sfx-preview__card';
      card.innerHTML = `
        <div class="strategic-sfx-preview__number">${String(soundNumber).padStart(2, '0')}</div>
        <div class="strategic-sfx-preview__copy">
          <h3>${item.label}</h3>
          <p>${item.role}</p>
          <span>${item.loop ? 'LOOP' : 'ONE-SHOT'} · ${item.spatial === false ? 'FIXED UI MIX' : `NEAR ${item.mix.near}M · SILENT ${item.mix.far}M`}</span>
        </div>
      `;
      const playButton = document.createElement('button');
      playButton.type = 'button';
      playButton.className = 'strategic-sfx-preview__play';
      playButton.textContent = 'PLAY';
      playButton.setAttribute('aria-label', `Play ${item.label}`);
      playButton.addEventListener('click', () => void playSound(item));
      buttons.set(item.id, playButton);
      card.appendChild(playButton);
      grid.appendChild(card);
    }
    groups.appendChild(section);
  }

  stopButton.addEventListener('click', () => stopAll());
  volume.addEventListener('input', () => {
    volumeOutput.value = `${Math.round(masterVolume() * 100)}%`;
    updateMix();
  });
  distance.addEventListener('input', () => {
    distanceOutput.value = `${cameraDistance()}m`;
    if (activeSound) {
      const audible = Math.round(attenuation(activeSound) * 100);
      status.textContent = `Playing ${activeSound.label}${activeSound.loop ? ' · looping' : ''} · ${cameraDistance()}m from camera · ${audible}% proximity`;
    }
    updateMix();
  });
  pan.addEventListener('input', () => {
    const value = Number(pan.value);
    panOutput.value = value === 0 ? 'CENTER' : `${Math.abs(value)}% ${value < 0 ? 'LEFT' : 'RIGHT'}`;
    updateMix();
  });
  window.addEventListener('pagehide', () => stopAll(), { once: true });
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing SFX preview element: ${selector}`);
  return element;
}
