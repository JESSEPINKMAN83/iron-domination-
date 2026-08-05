import type { Entity } from '../sim/components';
import { unitKindForUpgrade } from '../sim/upgrades';

export type UnitVoiceEvent = 'selected' | 'move' | 'attack' | 'tactic';
export type UnitVoiceCategory = 'infantry' | 'vehicle' | 'aircraft';

interface VoicePlayer {
  playVoice(url: string, volume?: number): void;
}

const INFANTRY_KINDS = new Set(['infantry', 'sniper', 'grenadier', 'rocket-infantry']);
const VEHICLE_KINDS = new Set(['scout-tank', 'tank', 'siege-tank']);
const AIRCRAFT_KINDS = new Set(['wasp', 'vulture', 'hammerhead']);
const INFANTRY_VOICES: Record<UnitVoiceEvent, string> = {
  selected: '/assets/voices/infantry/infantry-selected.mp3',
  move: '/assets/voices/infantry/infantry-move.mp3',
  attack: '/assets/voices/infantry/infantry-attack.mp3',
  tactic: '/assets/voices/infantry/infantry-tactic.mp3',
};
const VEHICLE_VOICES: Record<UnitVoiceEvent, string> = {
  selected: '/assets/voices/vehicle/vehicle-selected.mp3',
  move: '/assets/voices/vehicle/vehicle-move.mp3',
  attack: '/assets/voices/vehicle/vehicle-attack.mp3',
  tactic: '/assets/voices/vehicle/vehicle-tactic.mp3',
};
const AIRCRAFT_VOICES: Record<UnitVoiceEvent, string> = {
  selected: '/assets/voices/aircraft/aircraft-selected.mp3',
  move: '/assets/voices/aircraft/aircraft-move.mp3',
  attack: '/assets/voices/aircraft/aircraft-attack.mp3',
  tactic: '/assets/voices/aircraft/aircraft-tactic.mp3',
};
const VOICES: Record<UnitVoiceCategory, Record<UnitVoiceEvent, string>> = {
  infantry: INFANTRY_VOICES,
  vehicle: VEHICLE_VOICES,
  aircraft: AIRCRAFT_VOICES,
};

export function unitVoiceCategory(entity: Entity): UnitVoiceCategory | undefined {
  // Capability fallbacks make newly added units inherit a voice without
  // requiring an audio-system update for every new roster entry.
  if (entity.flight) return 'aircraft';
  if (entity.selectable?.type === 'infantry') return 'infantry';
  const kind = unitKindForUpgrade(entity);
  if (kind && INFANTRY_KINDS.has(kind)) return 'infantry';
  if (kind && VEHICLE_KINDS.has(kind)) return 'vehicle';
  if (kind && AIRCRAFT_KINDS.has(kind)) return 'aircraft';
  if (!entity.building && (entity.mover || entity.harvester || entity.possessable)) return 'vehicle';
  return undefined;
}

export function dominantUnitVoiceCategory(entities: Entity[]): UnitVoiceCategory | undefined {
  const counts: Record<UnitVoiceCategory, number> = { infantry: 0, vehicle: 0, aircraft: 0 };
  let first: UnitVoiceCategory | undefined;
  for (const entity of entities) {
    if (entity.destroyed) continue;
    const category = unitVoiceCategory(entity);
    if (!category) continue;
    first ??= category;
    counts[category]++;
  }
  if (!first) return undefined;
  return (Object.keys(counts) as UnitVoiceCategory[]).reduce(
    (winner, category) => counts[category] > counts[winner] ? category : winner,
    first,
  );
}

export class UnitVoiceDirector {
  private readonly lastAt = new Map<string, number>();

  constructor(
    private readonly player: VoicePlayer,
    private readonly now: () => number = () => performance.now(),
  ) {}

  acknowledge(entities: Entity[], event: UnitVoiceEvent): void {
    const category = dominantUnitVoiceCategory(entities);
    if (!category) return;
    const now = this.now();
    const cooldown = event === 'selected' ? 900 : 360;
    const key = `${category}:${event}`;
    if (now - (this.lastAt.get(key) ?? -Infinity) < cooldown) return;
    this.lastAt.set(key, now);
    this.player.playVoice(VOICES[category][event], 0.58);
  }
}
