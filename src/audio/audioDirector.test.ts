import { PerspectiveCamera } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { CombatEvent } from '../sim/world';
import { AudioDirector } from './audioDirector';
import type { SoundProfile } from './positionalMix';

// Inspect the sound boundary without a real browser audio device or asset downloads.
type AudioHarness = {
  ctx: AudioContext;
  master: GainNode;
  sampleBuffers: Map<string, AudioBuffer>;
  playSampleAt: (url: string, x: number, z: number, profile: SoundProfile) => boolean;
  preloadSample: () => Promise<void>;
  allowSound: () => boolean;
  allowSoundAt: () => boolean;
  spatialBus: (x: number, z: number, profile: SoundProfile) => undefined;
};

function harness(samples: boolean) {
  const director = new AudioDirector(new PerspectiveCamera());
  const audio = director as unknown as AudioHarness;
  audio.ctx = {} as AudioContext;
  audio.master = {} as GainNode;
  vi.spyOn(audio.sampleBuffers, 'has').mockReturnValue(samples);
  const play = vi.spyOn(audio, 'playSampleAt').mockReturnValue(true);
  vi.spyOn(audio, 'preloadSample').mockResolvedValue();
  const bus = vi.spyOn(audio, 'spatialBus').mockReturnValue(undefined);
  return { director, audio, play, bus };
}

function event(weaponKind: CombatEvent['weaponKind'], impact: boolean): CombatEvent {
  const kind = weaponKind === 'strategicMissile' ? 'siegeMissile' : weaponKind!;
  return { kind: impact ? `${kind}-impact` : kind, weaponKind,
    fromX: 0, fromZ: 0, toX: 40, toZ: 40, damage: 10, killed: false };
}

describe('missile sound routing', () => {
  it.each(['rocketLauncher', 'rocketPod', 'scoutMissile', 'tankMissile', 'siegeMissile', 'agMissile', 'aaMissile', 'swarmRocket', 'annihilatorMissile', 'strategicMissile'] as const)(
    'quiets %s launches and impacts, including destruction layers', (weapon) => {
      const { director, play, bus } = harness(true);
      for (const impact of [false, true]) {
        for (const targetType of ['unit', 'building']) {
          director.handleCombatEvents([{ ...event(weapon, impact), killed: impact, targetType }]);
        }
      }
      expect(play).toHaveBeenCalled();
      const profiles = [...play.mock.calls.map((call) => call[3]), ...bus.mock.calls.map((call) => call[2])];
      for (const profile of profiles) {
        expect(profile.flatArea).toBe(true);
        expect(profile.gain).toBeLessThanOrEqual(0.045);
        expect(profile.far).toBeLessThanOrEqual(260);
      }
    },
  );

  it('also quiets synthesized missile fallback when samples are unavailable', () => {
    const { director, audio } = harness(false);
    // No context decoding: missing assets are deliberately left unavailable.
    vi.spyOn(audio.sampleBuffers, 'get').mockReturnValue({} as AudioBuffer);
    vi.spyOn(audio, 'allowSound').mockReturnValue(true);
    vi.spyOn(audio, 'allowSoundAt').mockReturnValue(true);
    const bus = vi.spyOn(audio, 'spatialBus').mockReturnValue(undefined);
    director.handleCombatEvents([event('tankMissile', false), event('tankMissile', true)]);
    expect(bus).toHaveBeenCalledTimes(2);
    for (const call of bus.mock.calls) expect(call[2].flatArea).toBe(true);
  });

  it('leaves cannon impacts on the original mix', () => {
    const { director, play } = harness(true);
    director.handleCombatEvents([{ ...event('cannon', true), targetType: 'building' }]);
    expect(play).toHaveBeenCalled();
    expect(play.mock.calls[0][3].flatArea).toBeUndefined();
    expect(play.mock.calls[0][3].gain).toBeGreaterThan(0.045);
  });
});
