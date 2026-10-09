export type SoundProfile = {
  gain: number;
  near: number;
  far: number;
  /** Hold a quiet level nearby; fade only at the boundary of the audible area. */
  flatArea?: boolean;
};

export function missileSoundProfile(
  original: SoundProfile,
  phase: 'launch' | 'impact' | 'flight' | 'flyby',
  strategic = false,
): SoundProfile {
  const far = phase === 'impact' ? (strategic ? 260 : 220) : 180;
  const cap = phase === 'flight' ? 0.018 : phase === 'flyby' ? 0.025 : phase === 'impact' ? 0.015 : 0.03;
  return {
    gain: Math.min(cap, original.gain * 0.25),
    near: far * 0.8,
    far,
    flatArea: true,
  };
}

/** A subdued local impact level shared by samples and synthesized fallbacks. */
export function explosionSoundProfile(original: SoundProfile): SoundProfile {
  const far = Math.min(original.far, 220);
  return { gain: Math.min(0.018, original.gain * 0.2), near: far * 0.8, far, flatArea: true };
}

export function positionalGain(distance: number, profile: SoundProfile): number {
  const t = Math.max(0, Math.min(1, (distance - profile.near) / Math.max(1, profile.far - profile.near)));
  return profile.gain * (profile.flatArea ? 1 - t : (1 - t) * (1 - t));
}
