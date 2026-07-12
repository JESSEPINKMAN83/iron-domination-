import { PerspectiveCamera, Vector3 } from 'three';
import type { CombatEvent } from '../sim/world';

type SoundProfile = {
  gain: number;
  near: number;
  far: number;
};

interface SoundBus {
  input: GainNode;
  nodes: AudioNode[];
}

const TMP_FORWARD = new Vector3();
const MAX_VOICES = 28;

export class AudioDirector {
  private ctx?: AudioContext;
  private master?: GainNode;
  private compressor?: DynamicsCompressorNode;
  private voices = 0;
  private muted = false;
  private lastByBucket = new Map<string, number>();
  private readonly noiseBuffers = new Map<number, AudioBuffer>();

  constructor(private readonly camera: PerspectiveCamera) {}

  unlock(): void {
    const AudioCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioCtor) return;
    if (!this.ctx) {
      this.ctx = new AudioCtor();
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 8;
      this.compressor.attack.value = 0.006;
      this.compressor.release.value = 0.18;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.74;
      this.master.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.74, this.ctx.currentTime, 0.04);
    }
    return this.muted;
  }

  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.toggleMuted();
  }

  playUi(kind: 'select' | 'order' | 'build' | 'cancel' | 'error'): void {
    if (!this.ctx || !this.master || this.muted) return;
    if (this.voices >= MAX_VOICES) return;
    this.voices++;
    const now = this.ctx.currentTime;
    const base = kind === 'error' ? 130 : kind === 'cancel' ? 180 : kind === 'build' ? 420 : kind === 'order' ? 520 : 640;
    const duration = kind === 'error' ? 0.16 : 0.08;
    const gain = kind === 'error' ? 0.04 : kind === 'build' ? 0.035 : 0.025;
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(gain, now + 0.006);
    out.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    out.connect(this.master);
    const osc = this.ctx.createOscillator();
    osc.type = kind === 'error' ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(kind === 'error' ? base * 0.55 : base * 1.42, now + duration);
    osc.connect(out);
    osc.start(now);
    osc.stop(now + duration + 0.02);
    this.cleanup(out, duration + 0.05);
  }

  playConstruction(x: number, z: number, kind: 'structure' | 'wall' = 'structure'): void {
    if (!this.ctx || !this.master || this.muted) return;
    const profile: SoundProfile =
      kind === 'wall' ? { gain: 0.24, near: 22, far: 250 } : { gain: 0.34, near: 28, far: 330 };
    if (!this.allowSoundAt(`construction-${kind}`, x, z, profile, 0.16)) return;
    const bus = this.spatialBus(x, z, profile);
    if (!bus) return;
    const now = this.ctx.currentTime;
    const duration = kind === 'wall' ? 0.78 : 1.08;

    const motor = this.ctx.createOscillator();
    motor.type = 'sawtooth';
    motor.frequency.setValueAtTime(kind === 'wall' ? 86 : 72, now);
    motor.frequency.exponentialRampToValueAtTime(kind === 'wall' ? 54 : 42, now + duration * 0.55);
    const motorFilter = this.ctx.createBiquadFilter();
    motorFilter.type = 'lowpass';
    motorFilter.frequency.setValueAtTime(kind === 'wall' ? 330 : 260, now);
    motorFilter.Q.value = 0.9;
    const motorGain = this.ctx.createGain();
    motorGain.gain.setValueAtTime(0.0001, now);
    motorGain.gain.exponentialRampToValueAtTime(kind === 'wall' ? 0.085 : 0.12, now + 0.04);
    motorGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    motor.connect(motorFilter);
    motorFilter.connect(motorGain);
    motorGain.connect(bus.input);
    motor.start(now);
    motor.stop(now + duration + 0.04);

    this.noiseBurst(bus.input, duration * 0.82, kind === 'wall' ? 0.05 : 0.075, {
      type: 'bandpass',
      frequency: kind === 'wall' ? 520 : 420,
      q: 1.4,
      delay: 0.02,
    });

    const clanks = kind === 'wall' ? 4 : 6;
    for (let i = 0; i < clanks; i++) {
      const t = 0.045 + i * (kind === 'wall' ? 0.12 : 0.13) + seeded01(x, z, 30 + i) * 0.035;
      const freq = 520 + seeded01(z, x, 50 + i) * 1250;
      this.click(bus.input, t, freq, kind === 'wall' ? 0.035 : 0.045);
    }
    this.click(bus.input, kind === 'wall' ? 0.12 : 0.18, kind === 'wall' ? 170 : 130, kind === 'wall' ? 0.055 : 0.075);
    this.releaseBus(bus, duration + 0.18);
  }

  handleCombatEvents(events: CombatEvent[]): void {
    if (!this.ctx || !this.master || this.muted) return;
    for (const event of events) this.playCombatEvent(event);
  }

  private playCombatEvent(event: CombatEvent): void {
    if (!this.ctx || !this.master) return;
    if (event.kind.endsWith('-impact')) {
      this.playExplosion(event);
      return;
    }
    if (event.kind === 'crash') {
      this.playExplosion({ ...event, kind: 'bomb-impact', killed: true });
      this.playMetalCrash(event);
      return;
    }
    if (event.kind === 'hard-bounce') {
      this.playMetalCrash(event);
      return;
    }
    if (event.kind === 'bomb' || event.kind === 'tankBomb' || event.kind === 'grenade' || event.kind === 'agMissile' || event.kind === 'aaMissile' || event.kind === 'scoutMissile' || event.kind === 'tankMissile' || event.kind === 'siegeMissile') {
      this.playLaunch(event);
      return;
    }
    if (event.kind === 'rifle' || event.kind === 'sniperRifle') {
      this.playRifle(event);
      return;
    }
    if (event.kind === 'cannon' || event.kind === 'heavyCannon' || event.kind === 'autocannon' || event.kind === 'waspAutocannon') {
      this.playCannon(event);
      return;
    }
    if (event.kind === 'rocketLauncher' || event.kind === 'rocketPod') {
      this.playLaunch(event);
    }
  }

  private playExplosion(event: CombatEvent): void {
    const profile = explosionProfile(event.kind, event.killed);
    if (!this.allowSound(event, profile, 0.045)) return;
    const bus = this.spatialBus(event.toX, event.toZ, profile);
    if (!bus) return;
    const now = this.ctx!.currentTime;
    const heavy = event.kind === 'tankBomb-impact' || event.kind === 'bomb-impact' || event.kind === 'agMissile-impact';
    const duration = heavy ? 1.35 : 0.72;

    const boom = this.ctx!.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(heavy ? 74 : 105, now);
    boom.frequency.exponentialRampToValueAtTime(heavy ? 31 : 48, now + duration * 0.38);
    const boomGain = this.ctx!.createGain();
    boomGain.gain.setValueAtTime(0.0001, now);
    boomGain.gain.exponentialRampToValueAtTime(heavy ? 0.46 : 0.22, now + 0.012);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    boom.connect(boomGain);
    boomGain.connect(bus.input);
    boom.start(now);
    boom.stop(now + duration + 0.03);

    this.noiseBurst(bus.input, heavy ? 0.72 : 0.38, heavy ? 0.28 : 0.16, {
      type: 'lowpass',
      frequency: heavy ? 720 : 1100,
      q: 0.8,
      delay: 0.006,
    });
    this.noiseBurst(bus.input, heavy ? 0.22 : 0.14, heavy ? 0.13 : 0.08, {
      type: 'highpass',
      frequency: 1100,
      q: 0.4,
      delay: 0,
    });
    const debris = heavy ? 7 : 4;
    for (let i = 0; i < debris; i++) {
      this.click(bus.input, 0.06 + i * 0.035 + seeded01(event.toX, event.toZ, i) * 0.06, 950 + seeded01(event.toZ, event.toX, i) * 2300, heavy ? 0.025 : 0.016);
    }
    this.releaseBus(bus, duration + 0.25);
  }

  private playLaunch(event: CombatEvent): void {
    const kind = event.kind;
    const heavyArc = kind === 'tankBomb';
    const profile: SoundProfile = {
      gain: heavyArc ? 0.28 : kind === 'bomb' ? 0.2 : kind === 'grenade' ? 0.12 : 0.16,
      near: 22,
      far: heavyArc ? 340 : kind === 'bomb' ? 260 : 210,
    };
    if (!this.allowSoundAt(event.kind, event.fromX, event.fromZ, profile, kind === 'aaMissile' || kind === 'agMissile' ? 0.06 : 0.04, 'launch')) return;
    const bus = this.spatialBus(event.fromX, event.fromZ, profile);
    if (!bus) return;
    const now = this.ctx!.currentTime;
    const whistle = this.ctx!.createOscillator();
    whistle.type = kind === 'grenade' ? 'triangle' : 'sawtooth';
    whistle.frequency.setValueAtTime(heavyArc ? 92 : kind === 'bomb' ? 120 : kind === 'grenade' ? 270 : 390, now);
    whistle.frequency.exponentialRampToValueAtTime(heavyArc ? 54 : kind === 'bomb' ? 72 : kind === 'grenade' ? 210 : 850, now + 0.22);
    const gain = this.ctx!.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(kind === 'bomb' ? 0.08 : 0.04, now + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    whistle.connect(gain);
    gain.connect(bus.input);
    whistle.start(now);
    whistle.stop(now + 0.38);
    this.noiseBurst(bus.input, 0.24, kind === 'bomb' ? 0.08 : 0.045, { type: 'bandpass', frequency: kind === 'bomb' ? 360 : 920, q: 1.6 });
    this.releaseBus(bus, 0.5);
  }

  private playRifle(event: CombatEvent): void {
    const sniper = event.kind === 'sniperRifle';
    const profile: SoundProfile = { gain: sniper ? 0.22 : 0.07, near: 16, far: sniper ? 280 : 145 };
    if (!this.allowSoundAt(event.kind, event.fromX, event.fromZ, profile, sniper ? 0.18 : 0.026)) return;
    const bus = this.spatialBus(event.fromX, event.fromZ, profile);
    if (!bus) return;
    const now = this.ctx!.currentTime;
    const osc = this.ctx!.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(sniper ? 155 : 260, now);
    osc.frequency.exponentialRampToValueAtTime(sniper ? 72 : 120, now + (sniper ? 0.16 : 0.055));
    const gain = this.ctx!.createGain();
    gain.gain.setValueAtTime(sniper ? 0.12 : 0.035, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (sniper ? 0.24 : 0.075));
    osc.connect(gain);
    gain.connect(bus.input);
    osc.start(now);
    osc.stop(now + (sniper ? 0.26 : 0.09));
    this.noiseBurst(bus.input, sniper ? 0.12 : 0.045, sniper ? 0.04 : 0.018, { type: 'highpass', frequency: sniper ? 850 : 1200, q: 0.7 });
    this.releaseBus(bus, sniper ? 0.34 : 0.12);
  }

  private playCannon(event: CombatEvent): void {
    const heavy = event.kind === 'heavyCannon';
    const auto = event.kind === 'autocannon' || event.kind === 'waspAutocannon';
    const profile: SoundProfile = { gain: heavy ? 0.3 : auto ? 0.12 : 0.24, near: 24, far: heavy ? 330 : 260 };
    if (!this.allowSoundAt(event.kind, event.fromX, event.fromZ, profile, auto ? 0.042 : 0.1)) return;
    const bus = this.spatialBus(event.fromX, event.fromZ, profile);
    if (!bus) return;
    const now = this.ctx!.currentTime;
    const thump = this.ctx!.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(heavy ? 95 : auto ? 150 : 115, now);
    thump.frequency.exponentialRampToValueAtTime(heavy ? 42 : auto ? 90 : 55, now + 0.18);
    const gain = this.ctx!.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(heavy ? 0.21 : auto ? 0.07 : 0.16, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (auto ? 0.12 : 0.36));
    thump.connect(gain);
    gain.connect(bus.input);
    thump.start(now);
    thump.stop(now + 0.4);
    this.noiseBurst(bus.input, auto ? 0.07 : 0.16, auto ? 0.035 : 0.07, { type: 'bandpass', frequency: auto ? 1500 : 780, q: 1.1 });
    this.releaseBus(bus, auto ? 0.18 : 0.46);
  }

  private playMetalCrash(event: CombatEvent): void {
    const profile: SoundProfile = { gain: 0.18, near: 18, far: 210 };
    if (!this.allowSound(event, profile, 0.12, 'metal')) return;
    const bus = this.spatialBus(event.toX, event.toZ, profile);
    if (!bus) return;
    this.noiseBurst(bus.input, 0.42, 0.11, { type: 'bandpass', frequency: 640, q: 2.5 });
    for (let i = 0; i < 5; i++) this.click(bus.input, 0.02 + i * 0.045, 320 + i * 260, 0.035);
    this.releaseBus(bus, 0.62);
  }

  private noiseBurst(destination: AudioNode, duration: number, gainValue: number, filter: { type: BiquadFilterType; frequency: number; q: number; delay?: number }): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime + (filter.delay ?? 0);
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer(Math.max(0.12, duration));
    const biquad = this.ctx.createBiquadFilter();
    biquad.type = filter.type;
    biquad.frequency.setValueAtTime(filter.frequency, now);
    biquad.Q.value = filter.q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(biquad);
    biquad.connect(gain);
    gain.connect(destination);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  private click(destination: AudioNode, delay: number, frequency: number, gainValue: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(60, frequency * 0.45), now + 0.055);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    osc.connect(gain);
    gain.connect(destination);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  private spatialBus(x: number, z: number, profile: SoundProfile): SoundBus | undefined {
    if (!this.ctx || !this.master || this.voices >= MAX_VOICES) return undefined;
    const attenuation = this.attenuation(x, z, profile);
    if (attenuation.gain <= 0.002) return undefined;
    this.voices++;
    const input = this.ctx.createGain();
    input.gain.value = attenuation.gain;
    const nodes: AudioNode[] = [input];
    if ('StereoPannerNode' in globalThis) {
      const pan = new StereoPannerNode(this.ctx, { pan: attenuation.pan });
      input.connect(pan);
      pan.connect(this.master);
      nodes.push(pan);
    } else {
      input.connect(this.master);
    }
    return { input, nodes };
  }

  private releaseBus(bus: SoundBus, afterSeconds: number): void {
    this.cleanup(bus.nodes, afterSeconds);
  }

  private cleanup(nodes: AudioNode | AudioNode[], afterSeconds: number): void {
    const targets = Array.isArray(nodes) ? nodes : [nodes];
    window.setTimeout(() => {
      for (const node of targets) {
        try {
          node.disconnect();
        } catch {
          // already disconnected by the browser
        }
      }
      this.voices = Math.max(0, this.voices - 1);
    }, Math.max(40, afterSeconds * 1000));
  }

  private attenuation(x: number, z: number, profile: SoundProfile): { gain: number; pan: number } {
    const dx = x - this.camera.position.x;
    const dz = z - this.camera.position.z;
    const distance = Math.hypot(dx, dz);
    const t = clamp01((distance - profile.near) / Math.max(1, profile.far - profile.near));
    const gain = profile.gain * (1 - t) * (1 - t * 0.45);
    this.camera.getWorldDirection(TMP_FORWARD);
    const rightX = TMP_FORWARD.z;
    const rightZ = -TMP_FORWARD.x;
    const side = (dx * rightX + dz * rightZ) / Math.max(1, distance);
    return { gain, pan: clamp(side * 0.85, -0.85, 0.85) };
  }

  private allowSound(event: CombatEvent, profile: SoundProfile, minInterval: number, suffix = ''): boolean {
    return this.allowSoundAt(event.kind, event.toX, event.toZ, profile, minInterval, suffix);
  }

  private allowSoundAt(kind: string, x: number, z: number, profile: SoundProfile, minInterval: number, suffix = ''): boolean {
    const attenuation = this.attenuation(x, z, profile);
    if (attenuation.gain <= 0.002) return false;
    const bucketX = Math.round(x / 8);
    const bucketZ = Math.round(z / 8);
    const key = `${kind}:${bucketX}:${bucketZ}:${suffix}`;
    const now = performance.now() / 1000;
    const last = this.lastByBucket.get(key) ?? -999;
    if (now - last < minInterval) return false;
    this.lastByBucket.set(key, now);
    if (this.lastByBucket.size > 220) {
      for (const [candidate, at] of this.lastByBucket) {
        if (now - at > 2.5) this.lastByBucket.delete(candidate);
      }
    }
    return true;
  }

  private noiseBuffer(duration: number): AudioBuffer {
    if (!this.ctx) throw new Error('audio context unavailable');
    const key = Math.round(duration * 100);
    const existing = this.noiseBuffers.get(key);
    if (existing) return existing;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = key * 2654435761;
    for (let i = 0; i < data.length; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      data[i] = ((seed >>> 0) / 2147483648 - 1) * (1 - i / data.length);
    }
    this.noiseBuffers.set(key, buffer);
    return buffer;
  }
}

function explosionProfile(kind: string, killed: boolean): SoundProfile {
  if (kind === 'tankBomb-impact') return { gain: killed ? 0.76 : 0.62, near: 34, far: killed ? 620 : 540 };
  if (kind === 'bomb-impact') return { gain: killed ? 0.62 : 0.48, near: 28, far: killed ? 520 : 430 };
  if (kind === 'agMissile-impact') return { gain: killed ? 0.5 : 0.38, near: 24, far: 390 };
  if (kind === 'grenade-impact') return { gain: killed ? 0.34 : 0.24, near: 18, far: 260 };
  if (kind === 'atRocket-impact' || kind === 'aaMissile-impact') return { gain: killed ? 0.34 : 0.24, near: 18, far: 280 };
  if (kind === 'scoutMissile-impact') return { gain: killed ? 0.32 : 0.22, near: 18, far: 270 };
  if (kind === 'tankMissile-impact') return { gain: killed ? 0.42 : 0.31, near: 22, far: 340 };
  if (kind === 'siegeMissile-impact') return { gain: killed ? 0.54 : 0.42, near: 26, far: 420 };
  return { gain: 0.24, near: 18, far: 260 };
}

function seeded01(x: number, z: number, salt: number): number {
  const a = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
  return a - Math.floor(a);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }

  // Safari exposes webkitAudioContext on globalThis/window in older builds.
  // The DOM lib does not type the global alias consistently.
  // eslint-disable-next-line no-var
  var webkitAudioContext: typeof AudioContext | undefined;
}
