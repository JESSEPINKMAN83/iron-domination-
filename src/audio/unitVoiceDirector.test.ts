import { describe, expect, it, vi } from 'vitest';
import type { Entity } from '../sim/components';
import { dominantUnitVoiceCategory, UnitVoiceDirector } from './unitVoiceDirector';

function unit(kind: 'infantry' | 'tank' | 'aircraft' | 'future-ground', destroyed = false): Entity {
  if (kind === 'aircraft') return { selectable: { type: 'future-gunship' }, flight: {}, destroyed } as unknown as Entity;
  if (kind === 'future-ground') return { selectable: { type: 'future-rover' }, mover: {}, destroyed } as unknown as Entity;
  return kind === 'infantry'
    ? { selectable: { type: 'infantry' }, weapon: { kind: 'rifle' }, destroyed } as unknown as Entity
    : { selectable: { type: 'tank' }, weapon: { kind: 'tankMissile' }, destroyed } as unknown as Entity;
}

describe('unit voice acknowledgements', () => {
  it('uses the dominant category for a mixed selection', () => {
    expect(dominantUnitVoiceCategory([unit('infantry'), unit('infantry'), unit('tank')])).toBe('infantry');
    expect(dominantUnitVoiceCategory([unit('tank'), unit('tank'), unit('infantry')])).toBe('vehicle');
  });

  it('maps infantry commands to their dedicated voice clips', () => {
    const playVoice = vi.fn();
    let now = 1_000;
    const voices = new UnitVoiceDirector({ playVoice }, () => now);
    const infantry = [unit('infantry')];

    voices.acknowledge(infantry, 'selected');
    now += 1_000;
    voices.acknowledge(infantry, 'move');
    now += 1_000;
    voices.acknowledge(infantry, 'attack');
    now += 1_000;
    voices.acknowledge(infantry, 'tactic');

    expect(playVoice.mock.calls.map(([url]) => url)).toEqual([
      '/assets/voices/infantry/infantry-selected.mp3',
      '/assets/voices/infantry/infantry-move.mp3',
      '/assets/voices/infantry/infantry-attack.mp3',
      '/assets/voices/infantry/infantry-tactic.mp3',
    ]);
  });

  it('maps vehicles and aircraft to distinct voices', () => {
    const playVoice = vi.fn();
    const voices = new UnitVoiceDirector({ playVoice }, () => 1_000);
    voices.acknowledge([unit('tank')], 'selected');
    voices.acknowledge([unit('aircraft')], 'selected');
    expect(playVoice.mock.calls.map(([url]) => url)).toEqual([
      '/assets/voices/vehicle/vehicle-selected.mp3',
      '/assets/voices/aircraft/aircraft-selected.mp3',
    ]);
  });

  it('automatically treats an unknown controllable ground unit as a vehicle', () => {
    expect(dominantUnitVoiceCategory([unit('future-ground')])).toBe('vehicle');
  });

  it('does not spam repeated selection acknowledgements', () => {
    const playVoice = vi.fn();
    let now = 1_000;
    const voices = new UnitVoiceDirector({ playVoice }, () => now);
    voices.acknowledge([unit('infantry')], 'selected');
    now += 200;
    voices.acknowledge([unit('infantry')], 'selected');
    expect(playVoice).toHaveBeenCalledTimes(1);
  });
});
