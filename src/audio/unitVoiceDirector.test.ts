import { describe, expect, it, vi } from 'vitest';
import type { Entity } from '../sim/components';
import { dominantUnitVoiceCategory, UnitVoiceDirector } from './unitVoiceDirector';

function unit(kind: 'infantry' | 'tank' | 'aircraft' | 'future-ground', destroyed = false): Entity {
  const transform = { x: 20, y: 0, z: 30, rot: 0 };
  if (kind === 'aircraft') return { selectable: { type: 'future-gunship' }, flight: {}, transform, destroyed } as unknown as Entity;
  if (kind === 'future-ground') return { selectable: { type: 'future-rover' }, mover: {}, transform, destroyed } as unknown as Entity;
  return kind === 'infantry'
    ? { selectable: { type: 'infantry' }, weapon: { kind: 'rifle' }, transform, destroyed } as unknown as Entity
    : { selectable: { type: 'tank' }, weapon: { kind: 'tankMissile' }, transform, destroyed } as unknown as Entity;
}

describe('unit voice acknowledgements', () => {
  it('uses the dominant category for a mixed selection', () => {
    expect(dominantUnitVoiceCategory([unit('infantry'), unit('infantry'), unit('tank')])).toBe('infantry');
    expect(dominantUnitVoiceCategory([unit('tank'), unit('tank'), unit('infantry')])).toBe('vehicle');
  });

  it('maps infantry commands to their dedicated voice clips', () => {
    const playVoiceAt = vi.fn();
    let now = 1_000;
    const voices = new UnitVoiceDirector({ playVoiceAt }, () => now);
    const infantry = [unit('infantry')];

    voices.acknowledge(infantry, 'selected');
    now += 1_000;
    voices.acknowledge(infantry, 'move');
    now += 1_000;
    voices.acknowledge(infantry, 'attack');
    now += 1_000;
    voices.acknowledge(infantry, 'tactic');

    expect(playVoiceAt.mock.calls.map(([url]) => url)).toEqual([
      '/assets/voices/infantry/infantry-selected.mp3',
      '/assets/voices/infantry/infantry-move.mp3',
      '/assets/voices/infantry/infantry-attack.mp3',
      '/assets/voices/infantry/infantry-tactic.mp3',
    ]);
  });

  it('maps vehicles and aircraft to distinct voices', () => {
    const playVoiceAt = vi.fn();
    const voices = new UnitVoiceDirector({ playVoiceAt }, () => 1_000);
    voices.acknowledge([unit('tank')], 'selected');
    voices.acknowledge([unit('aircraft')], 'selected');
    expect(playVoiceAt.mock.calls.map(([url]) => url)).toEqual([
      '/assets/voices/vehicle/vehicle-selected.mp3',
      '/assets/voices/aircraft/aircraft-selected.mp3',
    ]);
  });

  it('automatically treats an unknown controllable ground unit as a vehicle', () => {
    expect(dominantUnitVoiceCategory([unit('future-ground')])).toBe('vehicle');
  });

  it('does not spam repeated selection acknowledgements', () => {
    const playVoiceAt = vi.fn();
    let now = 1_000;
    const voices = new UnitVoiceDirector({ playVoiceAt }, () => now);
    voices.acknowledge([unit('infantry')], 'selected');
    now += 200;
    voices.acknowledge([unit('infantry')], 'selected');
    expect(playVoiceAt).toHaveBeenCalledTimes(1);
  });

  it('plays a group acknowledgement from the average unit position', () => {
    const playVoiceAt = vi.fn();
    const first = unit('tank');
    const second = unit('tank');
    first.transform.x = 10;
    first.transform.z = 20;
    second.transform.x = 30;
    second.transform.z = 60;
    const voices = new UnitVoiceDirector({ playVoiceAt }, () => 1_000);

    voices.acknowledge([first, second], 'move');

    expect(playVoiceAt).toHaveBeenCalledWith('/assets/voices/vehicle/vehicle-move.mp3', 20, 40, 0.58);
  });
});
