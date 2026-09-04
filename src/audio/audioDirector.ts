import { PerspectiveCamera, Vector3 } from 'three';
import type { Entity } from '../sim/components';
import { unitKindForUpgrade } from '../sim/upgrades';
import type { CombatEvent } from '../sim/world';
import { impactForceFromEvent, possessionHitGain } from '../modes/vModeHitJuice';
import { ACTIVE_UI_GAME_CLICK, ACTIVE_UI_GAME_HOVER } from './uiMenuSounds';

type SoundProfile = {
  gain: number;
  near: number;
  far: number;
};

interface SoundBus {
  input: GainNode;
  nodes: AudioNode[];
}

interface StrategicFlightLoop {
  source: AudioBufferSourceNode;
  input: GainNode;
  pan?: StereoPannerNode;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  startedAt: number;
  duration: number;
  profile: SoundProfile;
  lastDistance: number;
  flybyPlayed: boolean;
}

interface ActivePositionalSample {
  source: AudioBufferSourceNode;
  input: GainNode;
  pan?: StereoPannerNode;
  x: number;
  z: number;
  profile: SoundProfile;
}

interface GunshipEngineLoop {
  source: AudioBufferSourceNode;
  input: GainNode;
  pan?: StereoPannerNode;
}

interface VehicleEngineLoop {
  baseSource: AudioBufferSourceNode;
  baseInput: GainNode;
  boostSource?: AudioBufferSourceNode;
  boostInput?: GainNode;
  output: GainNode;
  pan?: StereoPannerNode;
}

interface ShellFlybyTrack {
  id: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  startedAt: number;
  duration: number;
  variant: number;
  heavy: boolean;
  lastDistance: number;
  played: boolean;
}

const TMP_FORWARD = new Vector3();
const MAX_VOICES = 28;
const COMBAT_GAIN_SCALE = 0.7;
const STRATEGIC_MISSILE_LAUNCH_SAMPLE = '/assets/sfx/strategic-missile-launch-01.wav';
const STRATEGIC_MISSILE_FLIGHT_SAMPLE = '/assets/sfx/strategic-missile-flight-loop.wav';
const STRATEGIC_MISSILE_FLYBY_SAMPLE = '/assets/sfx/strategic-missile-flyby-01.wav';
const STRATEGIC_MISSILE_IMPACT_SAMPLE = '/assets/sfx/strategic-missile-impact-01.wav';
const STRATEGIC_MISSILE_INTERCEPTED_SAMPLE = '/assets/sfx/strategic-missile-intercepted-01.wav';
const UI_UPGRADE_SAMPLE = '/assets/sfx/ui-upgrade.wav';
const HEAVY_GUNSHIP_ENGINE_SAMPLES = [
  '/assets/sfx/heavy-gunship-engine-loop-01.wav',
  '/assets/sfx/heavy-gunship-engine-loop-02.wav',
  '/assets/sfx/heavy-gunship-engine-loop-03.wav',
  '/assets/sfx/heavy-gunship-engine-loop-04.wav',
] as const;
const LIGHT_AIRCRAFT_ENGINE_SAMPLES = [
  '/assets/sfx/aircraft-engine-candidate-01.wav',
  '/assets/sfx/aircraft-engine-candidate-02.wav',
] as const;
const TANK_ENGINE_TRACK_SAMPLES = [
  '/assets/sfx/tank-engine-tracks-loop-01.wav',
  '/assets/sfx/tank-engine-tracks-loop-02.wav',
  '/assets/sfx/tank-engine-tracks-loop-03.wav',
  '/assets/sfx/tank-engine-tracks-loop-04.wav',
] as const;
const VEHICLE_ENGINE_SAMPLES = [
  '/assets/sfx/vehicle-engine-candidate-01.wav',
  '/assets/sfx/vehicle-engine-candidate-02.wav',
  '/assets/sfx/vehicle-engine-candidate-03.wav',
  '/assets/sfx/vehicle-engine-candidate-04.wav',
] as const;
const AUTOCANNON_BURST_SAMPLES = [
  '/assets/sfx/aircraft-autocannon-01.wav',
  '/assets/sfx/aircraft-autocannon-02.wav',
  '/assets/sfx/aircraft-autocannon-03.wav',
  '/assets/sfx/aircraft-autocannon-04.wav',
] as const;
const ROCKET_LAUNCH_SAMPLES = [
  '/assets/sfx/rocket-launcher-fire-01.wav',
  '/assets/sfx/rocket-launcher-fire-02.wav',
  '/assets/sfx/rocket-launcher-fire-03.wav',
  '/assets/sfx/rocket-launcher-fire-04.wav',
] as const;
const HEAVY_MISSILE_LAUNCH_SAMPLES = [
  '/assets/sfx/missile-launch-heavy-01.wav',
  '/assets/sfx/missile-launch-heavy-02.wav',
  '/assets/sfx/missile-launch-heavy-03.wav',
  '/assets/sfx/missile-launch-heavy-04.wav',
] as const;
const HEAVY_MISSILE_LAUNCH_GAINS = [0.14, 0.135, 0.15, 0.155] as const;
const MEDIUM_MISSILE_LAUNCH_SAMPLES = [
  '/assets/sfx/missile-launch-medium-01.wav',
  '/assets/sfx/missile-launch-medium-02.wav',
] as const;
const MEDIUM_MISSILE_LAUNCH_GAINS = [0.13, 0.125] as const;
const SHELL_FLYBY_SAMPLES = [
  '/assets/sfx/shell-flyby-01.wav',
  '/assets/sfx/shell-flyby-02.wav',
  '/assets/sfx/shell-flyby-03.wav',
  '/assets/sfx/shell-flyby-04.wav',
] as const;
const BUILDING_IMPACT_SAMPLES = [
  '/assets/sfx/impact-building-01.wav',
  '/assets/sfx/impact-building-02.wav',
  '/assets/sfx/impact-building-03.wav',
  '/assets/sfx/impact-building-04.wav',
] as const;
const BUILDING_COLLAPSE_SAMPLES = [
  '/assets/sfx/building-collapse-candidate-01.wav',
  '/assets/sfx/building-collapse-candidate-02.wav',
  '/assets/sfx/building-collapse-candidate-03.wav',
  '/assets/sfx/building-collapse-candidate-04.wav',
] as const;
const SMALL_EXPLOSION_SAMPLES = [
  '/assets/sfx/small-explosion-01.wav',
  '/assets/sfx/small-explosion-02.wav',
  '/assets/sfx/small-explosion-03.wav',
  '/assets/sfx/small-explosion-04.wav',
] as const;
const MEDIUM_EXPLOSION_SAMPLES = [
  '/assets/sfx/medium-explosion-01.wav',
  '/assets/sfx/medium-explosion-02.wav',
  '/assets/sfx/medium-explosion-03.wav',
  '/assets/sfx/medium-explosion-04.wav',
] as const;
const HEAVY_IMPACT_SAMPLES = [
  '/assets/sfx/heavy-impact-candidate-01.wav',
  '/assets/sfx/heavy-impact-candidate-02.wav',
] as const;
const VEHICLE_DESTRUCTION_SAMPLES = [
  '/assets/sfx/vehicle-destruction-candidate-01.wav',
  '/assets/sfx/vehicle-destruction-candidate-02.wav',
  '/assets/sfx/vehicle-destruction-candidate-03.wav',
  '/assets/sfx/vehicle-destruction-candidate-04.wav',
] as const;
const STRATEGIC_FLYBY_DISTANCE = 190;
const HEAVY_GUNSHIP_ENGINE_PROFILE: SoundProfile = { gain: 0.105, near: 18, far: 220 };
const WASP_ENGINE_PROFILE: SoundProfile = { gain: 0.05, near: 10, far: 145 };
const VULTURE_ENGINE_PROFILE: SoundProfile = { gain: 0.07, near: 12, far: 175 };
const TANK_ENGINE_TRACK_PROFILE: SoundProfile = { gain: 0.035, near: 6, far: 90 };
const VEHICLE_ENGINE_PROFILE: SoundProfile = { gain: 0.055, near: 10, far: 150 };
const UNIT_VOICE_PROFILE: SoundProfile = { gain: 1, near: 24, far: 260 };

export class AudioDirector {
  private ctx?: AudioContext;
  private master?: GainNode;
  private compressor?: DynamicsCompressorNode;
  private voices = 0;
  private muted = false;
  private activeVoice?: HTMLAudioElement;
  private lastByBucket = new Map<string, number>();
  private readonly noiseBuffers = new Map<number, AudioBuffer>();
  private readonly sampleBuffers = new Map<string, AudioBuffer>();
  private readonly sampleLoads = new Map<string, Promise<void>>();
  private readonly strategicFlightLoops = new Map<number, StrategicFlightLoop>();
  private readonly pendingStrategicFlights = new Set<number>();
  private readonly positionalSamples = new Set<ActivePositionalSample>();
  private readonly gunshipEngineLoops = new Map<number, GunshipEngineLoop>();
  private readonly pendingGunshipEngines = new Set<number>();
  private readonly vehicleEngineLoops = new Map<number, VehicleEngineLoop>();
  private readonly pendingVehicleEngines = new Set<number>();
  private readonly tankEngineLoops = new Map<number, GunshipEngineLoop>();
  private readonly pendingTankEngines = new Set<number>();
  private autocannonSequence = 0;
  private readonly shellFlybyTracks = new Map<number, ShellFlybyTrack>();
  private nextShellFlybyId = 1;
  private shellFlybySequence = 0;
  private buildingImpactSequence = 0;
  private buildingCollapseSequence = 0;
  private smallExplosionSequence = 0;
  private mediumExplosionSequence = 0;
  private heavyImpactSequence = 0;
  private vehicleDestructionSequence = 0;
  private buttonSoundsInstalled = false;

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
    void this.preloadSample(STRATEGIC_MISSILE_LAUNCH_SAMPLE);
    void this.preloadSample(STRATEGIC_MISSILE_FLIGHT_SAMPLE);
    void this.preloadSample(STRATEGIC_MISSILE_FLYBY_SAMPLE);
    void this.preloadSample(STRATEGIC_MISSILE_IMPACT_SAMPLE);
    void this.preloadSample(STRATEGIC_MISSILE_INTERCEPTED_SAMPLE);
    void this.preloadSample(UI_UPGRADE_SAMPLE);
    void this.preloadSample(ACTIVE_UI_GAME_HOVER.url);
    void this.preloadSample(ACTIVE_UI_GAME_CLICK.url);
    for (const sample of HEAVY_GUNSHIP_ENGINE_SAMPLES) void this.preloadSample(sample);
    for (const sample of LIGHT_AIRCRAFT_ENGINE_SAMPLES) void this.preloadSample(sample);
    for (const sample of TANK_ENGINE_TRACK_SAMPLES) void this.preloadSample(sample);
    for (const sample of VEHICLE_ENGINE_SAMPLES) void this.preloadSample(sample);
    for (const sample of AUTOCANNON_BURST_SAMPLES) void this.preloadSample(sample);
    for (const sample of ROCKET_LAUNCH_SAMPLES) void this.preloadSample(sample);
    for (const sample of HEAVY_MISSILE_LAUNCH_SAMPLES) void this.preloadSample(sample);
    for (const sample of MEDIUM_MISSILE_LAUNCH_SAMPLES) void this.preloadSample(sample);
    for (const sample of SHELL_FLYBY_SAMPLES) void this.preloadSample(sample);
    for (const sample of BUILDING_IMPACT_SAMPLES) void this.preloadSample(sample);
    for (const sample of BUILDING_COLLAPSE_SAMPLES) void this.preloadSample(sample);
    for (const sample of SMALL_EXPLOSION_SAMPLES) void this.preloadSample(sample);
    for (const sample of MEDIUM_EXPLOSION_SAMPLES) void this.preloadSample(sample);
    for (const sample of HEAVY_IMPACT_SAMPLES) void this.preloadSample(sample);
    for (const sample of VEHICLE_DESTRUCTION_SAMPLES) void this.preloadSample(sample);
  }

  update(entities?: Iterable<Entity>): void {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    if (entities) {
      this.updateGunshipEngines(entities, now);
      this.updateVehicleEngines(entities, now);
      this.updateTankEngines(entities, now);
    }
    this.updateShellFlybys(now);
    for (const sample of this.positionalSamples) {
      const attenuation = this.attenuation(sample.x, sample.z, sample.profile);
      sample.input.gain.setTargetAtTime(attenuation.gain, now, 0.045);
      sample.pan?.pan.setTargetAtTime(attenuation.pan, now, 0.045);
    }
    for (const [strategicId, flight] of this.strategicFlightLoops) {
      const elapsed = now - flight.startedAt;
      const progress = clamp01(elapsed / flight.duration);
      if (progress >= 1) {
        this.stopStrategicFlight(strategicId);
        continue;
      }
      const x = flight.fromX + (flight.toX - flight.fromX) * progress;
      const z = flight.fromZ + (flight.toZ - flight.fromZ) * progress;
      const attenuation = this.attenuation(x, z, flight.profile);
      const distance = Math.hypot(x - this.camera.position.x, z - this.camera.position.z);
      if (
        !flight.flybyPlayed
        && elapsed > 0.45
        && progress < 0.94
        && distance <= STRATEGIC_FLYBY_DISTANCE
        && (distance < 80 || distance < flight.lastDistance - 0.1)
      ) {
        flight.flybyPlayed = this.playStrategicMissileFlyby(x, z, strategicId);
      }
      flight.lastDistance = distance;
      const fade = Math.min(1, elapsed / 0.3, (flight.duration - elapsed) / 0.2);
      flight.input.gain.setTargetAtTime(attenuation.gain * Math.max(0, fade), now, 0.045);
      flight.pan?.pan.setTargetAtTime(attenuation.pan, now, 0.045);
    }
  }

  private updateGunshipEngines(entities: Iterable<Entity>, now: number): void {
    const active = new Map<number, Entity>();
    for (const entity of entities) {
      const kind = unitKindForUpgrade(entity);
      if (!entity.destroyed && entity.flight && (kind === 'wasp' || kind === 'vulture' || kind === 'hammerhead')) {
        active.set(entity.id, entity);
      }
    }
    const crowdScale = this.engineCrowdScale(active.values(), aircraftEngineProfile);

    for (const [entityId, loop] of this.gunshipEngineLoops) {
      const entity = active.get(entityId);
      if (!entity) {
        this.stopGunshipEngine(entityId);
        continue;
      }
      const profile = aircraftEngineProfile(entity);
      const attenuation = this.attenuation(entity.transform.x, entity.transform.z, profile);
      if (attenuation.gain <= 0.002) {
        this.stopGunshipEngine(entityId);
        continue;
      }
      const speed = entity.velocity ? Math.hypot(entity.velocity.x, entity.velocity.z) : 0;
      const movement = clamp01(speed / Math.max(1, entity.mover?.speed ?? 30));
      const boosting = entity.playerControlled?.boost && movement > 0.08 ? 1 : 0;
      const throttle = 0.2 + movement * 0.45 + boosting * 0.15;
      loop.input.gain.setTargetAtTime(attenuation.gain * throttle * crowdScale, now, 0.12);
      loop.pan?.pan.setTargetAtTime(attenuation.pan, now, 0.08);
      loop.source.playbackRate.setTargetAtTime(0.8 + movement * 0.22 + boosting * 0.12, now, 0.16);
    }

    for (const entity of active.values()) {
      if (this.gunshipEngineLoops.has(entity.id) || this.pendingGunshipEngines.has(entity.id)) continue;
      const attenuation = this.attenuation(entity.transform.x, entity.transform.z, aircraftEngineProfile(entity));
      if (attenuation.gain <= 0.002) continue;
      this.queueGunshipEngine(entity);
    }
  }

  private queueGunshipEngine(entity: Entity): void {
    const kind = unitKindForUpgrade(entity);
    const variant = Math.abs(entity.id + (entity.team?.id ?? 0) * 3) % HEAVY_GUNSHIP_ENGINE_SAMPLES.length;
    const url = kind === 'wasp'
      ? LIGHT_AIRCRAFT_ENGINE_SAMPLES[0]
      : kind === 'vulture'
        ? LIGHT_AIRCRAFT_ENGINE_SAMPLES[1]
        : HEAVY_GUNSHIP_ENGINE_SAMPLES[variant];
    this.pendingGunshipEngines.add(entity.id);
    void this.preloadSample(url).then(() => {
      if (!this.pendingGunshipEngines.delete(entity.id) || entity.destroyed || !entity.flight) return;
      const attenuation = this.attenuation(entity.transform.x, entity.transform.z, aircraftEngineProfile(entity));
      if (attenuation.gain <= 0.002) return;
      this.startGunshipEngine(entity, url, attenuation);
    });
  }

  private startGunshipEngine(
    entity: Entity,
    url: string,
    attenuation: { gain: number; pan: number },
  ): void {
    if (!this.ctx || !this.master || this.voices >= MAX_VOICES || this.gunshipEngineLoops.has(entity.id)) return;
    const buffer = this.sampleBuffers.get(url);
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const speed = entity.velocity ? Math.hypot(entity.velocity.x, entity.velocity.z) : 0;
    const movement = clamp01(speed / Math.max(1, entity.mover?.speed ?? 30));
    const boosting = entity.playerControlled?.boost && movement > 0.08 ? 1 : 0;
    const throttle = 0.2 + movement * 0.45 + boosting * 0.15;
    source.playbackRate.value = 0.8 + movement * 0.22 + boosting * 0.12;
    const input = this.ctx.createGain();
    input.gain.value = 0.0001;
    input.gain.setTargetAtTime(attenuation.gain * throttle, this.ctx.currentTime, 0.16);
    let pan: StereoPannerNode | undefined;
    if ('StereoPannerNode' in globalThis) {
      pan = new StereoPannerNode(this.ctx, { pan: attenuation.pan });
      source.connect(input);
      input.connect(pan);
      pan.connect(this.master);
    } else {
      source.connect(input);
      input.connect(this.master);
    }
    this.gunshipEngineLoops.set(entity.id, { source, input, pan });
    this.voices++;
    source.start(0, seeded01(entity.id, entity.team?.id ?? 0, 93) * buffer.duration);
  }

  private stopGunshipEngine(entityId: number): void {
    this.pendingGunshipEngines.delete(entityId);
    const loop = this.gunshipEngineLoops.get(entityId);
    if (!loop) return;
    this.gunshipEngineLoops.delete(entityId);
    try {
      loop.source.stop();
      loop.source.disconnect();
      loop.input.disconnect();
      loop.pan?.disconnect();
    } catch {
      // The browser may already have released the loop during page teardown.
    }
    this.voices = Math.max(0, this.voices - 1);
  }

  private updateVehicleEngines(entities: Iterable<Entity>, now: number): void {
    const active = new Map<number, Entity>();
    for (const entity of entities) {
      const kind = unitKindForUpgrade(entity);
      if (
        !entity.destroyed
        && entity.mover
        && entity.velocity
        && (kind === 'scout-tank' || kind === 'tank' || kind === 'siege-tank')
      ) {
        active.set(entity.id, entity);
      }
    }
    const crowdScale = this.engineCrowdScale(active.values(), () => VEHICLE_ENGINE_PROFILE);

    for (const [entityId, loop] of this.vehicleEngineLoops) {
      const entity = active.get(entityId);
      if (!entity?.mover || !entity.velocity) {
        this.stopVehicleEngine(entityId);
        continue;
      }
      const attenuation = this.attenuation(entity.transform.x, entity.transform.z, VEHICLE_ENGINE_PROFILE);
      if (attenuation.gain <= 0.002) {
        this.stopVehicleEngine(entityId);
        continue;
      }
      const speed = Math.hypot(entity.velocity.x, entity.velocity.z);
      const movement = clamp01(speed / Math.max(1, entity.mover.speed * 0.9));
      const boosting = entity.playerControlled?.boost && movement > 0.08 ? 1 : 0;
      if (entity.playerControlled && !loop.boostSource) this.startVehicleBoost(loop, entity, movement);
      if (!entity.playerControlled && loop.boostSource) this.stopVehicleBoost(loop);
      loop.output.gain.setTargetAtTime(attenuation.gain * crowdScale, now, 0.1);
      loop.pan?.pan.setTargetAtTime(attenuation.pan, now, 0.08);
      loop.baseInput.gain.setTargetAtTime(0.18 + movement * 0.48 - boosting * 0.04, now, 0.14);
      loop.baseSource.playbackRate.setTargetAtTime(0.78 + movement * 0.24 + boosting * 0.07, now, 0.16);
      loop.boostInput?.gain.setTargetAtTime(Math.max(0.0001, boosting * (0.42 + movement * 0.18)), now, 0.12);
      loop.boostSource?.playbackRate.setTargetAtTime(0.94 + movement * 0.16, now, 0.12);
    }

    for (const entity of active.values()) {
      if (this.vehicleEngineLoops.has(entity.id) || this.pendingVehicleEngines.has(entity.id)) continue;
      const attenuation = this.attenuation(entity.transform.x, entity.transform.z, VEHICLE_ENGINE_PROFILE);
      if (attenuation.gain <= 0.002) continue;
      this.queueVehicleEngine(entity);
    }
  }

  private queueVehicleEngine(entity: Entity): void {
    const kind = unitKindForUpgrade(entity);
    const baseUrl = kind === 'siege-tank'
      ? VEHICLE_ENGINE_SAMPLES[1]
      : kind === 'scout-tank'
        ? VEHICLE_ENGINE_SAMPLES[2]
        : VEHICLE_ENGINE_SAMPLES[0];
    this.pendingVehicleEngines.add(entity.id);
    void this.preloadSample(baseUrl).then(() => {
      if (!this.pendingVehicleEngines.delete(entity.id) || entity.destroyed || !entity.mover || !entity.velocity) return;
      const currentKind = unitKindForUpgrade(entity);
      if (currentKind !== 'scout-tank' && currentKind !== 'tank' && currentKind !== 'siege-tank') return;
      const attenuation = this.attenuation(entity.transform.x, entity.transform.z, VEHICLE_ENGINE_PROFILE);
      if (attenuation.gain <= 0.002) return;
      this.startVehicleEngine(entity, baseUrl, attenuation);
    });
  }

  private startVehicleEngine(
    entity: Entity,
    baseUrl: string,
    attenuation: { gain: number; pan: number },
  ): void {
    if (!this.ctx || !this.master || !entity.mover || this.voices >= MAX_VOICES || this.vehicleEngineLoops.has(entity.id)) return;
    const baseBuffer = this.sampleBuffers.get(baseUrl);
    if (!baseBuffer) return;
    const speed = entity.velocity ? Math.hypot(entity.velocity.x, entity.velocity.z) : 0;
    const movement = clamp01(speed / Math.max(1, entity.mover.speed * 0.9));
    const baseSource = this.ctx.createBufferSource();
    baseSource.buffer = baseBuffer;
    baseSource.loop = true;
    const boosting = entity.playerControlled?.boost && movement > 0.08 ? 1 : 0;
    baseSource.playbackRate.value = 0.78 + movement * 0.24 + boosting * 0.07;
    const baseInput = this.ctx.createGain();
    baseInput.gain.value = 0.18 + movement * 0.48 - boosting * 0.04;
    const output = this.ctx.createGain();
    output.gain.value = 0.0001;
    output.gain.setTargetAtTime(attenuation.gain, this.ctx.currentTime, 0.12);
    baseSource.connect(baseInput).connect(output);
    let pan: StereoPannerNode | undefined;
    if ('StereoPannerNode' in globalThis) {
      pan = new StereoPannerNode(this.ctx, { pan: attenuation.pan });
      output.connect(pan);
      pan.connect(this.master);
    } else {
      output.connect(this.master);
    }
    const loop: VehicleEngineLoop = { baseSource, baseInput, output, pan };
    this.vehicleEngineLoops.set(entity.id, loop);
    this.voices++;
    baseSource.start(0, seeded01(entity.id, entity.team?.id ?? 0, 151) * baseBuffer.duration);
    if (entity.playerControlled) this.startVehicleBoost(loop, entity, movement);
  }

  private startVehicleBoost(loop: VehicleEngineLoop, entity: Entity, movement: number): void {
    if (!this.ctx || this.voices >= MAX_VOICES || loop.boostSource) return;
    const boostBuffer = this.sampleBuffers.get(VEHICLE_ENGINE_SAMPLES[3]);
    if (!boostBuffer) return;
    const boosting = entity.playerControlled?.boost && movement > 0.08 ? 1 : 0;
    const boostSource = this.ctx.createBufferSource();
    boostSource.buffer = boostBuffer;
    boostSource.loop = true;
    boostSource.playbackRate.value = 0.94 + movement * 0.16;
    const boostInput = this.ctx.createGain();
    boostInput.gain.value = Math.max(0.0001, boosting * (0.42 + movement * 0.18));
    boostSource.connect(boostInput).connect(loop.output);
    loop.boostSource = boostSource;
    loop.boostInput = boostInput;
    this.voices++;
    boostSource.start(0, seeded01(entity.id, entity.team?.id ?? 0, 173) * boostBuffer.duration);
  }

  private stopVehicleBoost(loop: VehicleEngineLoop): void {
    if (!loop.boostSource || !loop.boostInput) return;
    try {
      loop.boostSource.stop();
      loop.boostSource.disconnect();
      loop.boostInput.disconnect();
    } catch {
      // The browser may already have released the boost loop during page teardown.
    }
    loop.boostSource = undefined;
    loop.boostInput = undefined;
    this.voices = Math.max(0, this.voices - 1);
  }

  private stopVehicleEngine(entityId: number): void {
    this.pendingVehicleEngines.delete(entityId);
    const loop = this.vehicleEngineLoops.get(entityId);
    if (!loop) return;
    this.vehicleEngineLoops.delete(entityId);
    try {
      loop.baseSource.stop();
      loop.boostSource?.stop();
      loop.baseSource.disconnect();
      loop.boostSource?.disconnect();
      loop.baseInput.disconnect();
      loop.boostInput?.disconnect();
      loop.output.disconnect();
      loop.pan?.disconnect();
    } catch {
      // The browser may already have released the loops during page teardown.
    }
    this.voices = Math.max(0, this.voices - (loop.boostSource ? 2 : 1));
  }

  private updateTankEngines(entities: Iterable<Entity>, now: number): void {
    const active = new Map<number, Entity>();
    for (const entity of entities) {
      const kind = unitKindForUpgrade(entity);
      if (!entity.destroyed && entity.mover && entity.velocity && (kind === 'tank' || kind === 'siege-tank')) {
        active.set(entity.id, entity);
      }
    }
    const crowdScale = this.engineCrowdScale(active.values(), () => TANK_ENGINE_TRACK_PROFILE);

    for (const [entityId, loop] of this.tankEngineLoops) {
      const entity = active.get(entityId);
      if (!entity?.mover || !entity.velocity) {
        this.stopTankEngine(entityId);
        continue;
      }
      const attenuation = this.attenuation(entity.transform.x, entity.transform.z, TANK_ENGINE_TRACK_PROFILE);
      if (attenuation.gain <= 0.002) {
        this.stopTankEngine(entityId);
        continue;
      }
      const speed = Math.hypot(entity.velocity.x, entity.velocity.z);
      const movement = clamp01((speed - 0.25) / Math.max(1, entity.mover.speed * 0.62));
      const trackPresence = Math.pow(movement, 1.35);
      loop.input.gain.setTargetAtTime(Math.max(0.0001, attenuation.gain * trackPresence * crowdScale), now, 0.14);
      loop.pan?.pan.setTargetAtTime(attenuation.pan, now, 0.08);
      loop.source.playbackRate.setTargetAtTime(0.84 + movement * 0.24, now, 0.12);
    }

    for (const entity of active.values()) {
      if (this.tankEngineLoops.has(entity.id) || this.pendingTankEngines.has(entity.id)) continue;
      const speed = entity.velocity ? Math.hypot(entity.velocity.x, entity.velocity.z) : 0;
      if (speed < 0.35) continue;
      const attenuation = this.attenuation(entity.transform.x, entity.transform.z, TANK_ENGINE_TRACK_PROFILE);
      if (attenuation.gain <= 0.002) continue;
      this.queueTankEngine(entity);
    }
  }

  private queueTankEngine(entity: Entity): void {
    const kindOffset = unitKindForUpgrade(entity) === 'siege-tank' ? 2 : 0;
    const variant = Math.abs(entity.id + (entity.team?.id ?? 0) * 5 + kindOffset) % TANK_ENGINE_TRACK_SAMPLES.length;
    const url = TANK_ENGINE_TRACK_SAMPLES[variant];
    this.pendingTankEngines.add(entity.id);
    void this.preloadSample(url).then(() => {
      if (!this.pendingTankEngines.delete(entity.id) || entity.destroyed || !entity.mover || !entity.velocity) return;
      const kind = unitKindForUpgrade(entity);
      if (kind !== 'tank' && kind !== 'siege-tank') return;
      const speed = Math.hypot(entity.velocity.x, entity.velocity.z);
      if (speed < 0.25) return;
      const attenuation = this.attenuation(entity.transform.x, entity.transform.z, TANK_ENGINE_TRACK_PROFILE);
      if (attenuation.gain <= 0.002) return;
      this.startTankEngine(entity, url, attenuation, speed);
    });
  }

  private startTankEngine(
    entity: Entity,
    url: string,
    attenuation: { gain: number; pan: number },
    speed: number,
  ): void {
    if (!this.ctx || !this.master || !entity.mover || this.voices >= MAX_VOICES || this.tankEngineLoops.has(entity.id)) return;
    const buffer = this.sampleBuffers.get(url);
    if (!buffer) return;
    const movement = clamp01((speed - 0.25) / Math.max(1, entity.mover.speed * 0.62));
    const trackPresence = Math.pow(movement, 1.35);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = 0.84 + movement * 0.24;
    const input = this.ctx.createGain();
    input.gain.value = 0.0001;
    input.gain.setTargetAtTime(Math.max(0.0001, attenuation.gain * trackPresence), this.ctx.currentTime, 0.16);
    let pan: StereoPannerNode | undefined;
    if ('StereoPannerNode' in globalThis) {
      pan = new StereoPannerNode(this.ctx, { pan: attenuation.pan });
      source.connect(input);
      input.connect(pan);
      pan.connect(this.master);
    } else {
      source.connect(input);
      input.connect(this.master);
    }
    this.tankEngineLoops.set(entity.id, { source, input, pan });
    this.voices++;
    source.start(0, seeded01(entity.id, entity.team?.id ?? 0, 127) * buffer.duration);
  }

  private stopTankEngine(entityId: number): void {
    this.pendingTankEngines.delete(entityId);
    const loop = this.tankEngineLoops.get(entityId);
    if (!loop) return;
    this.tankEngineLoops.delete(entityId);
    try {
      loop.source.stop();
      loop.source.disconnect();
      loop.input.disconnect();
      loop.pan?.disconnect();
    } catch {
      // The browser may already have released the loop during page teardown.
    }
    this.voices = Math.max(0, this.voices - 1);
  }

  private updateShellFlybys(now: number): void {
    for (const [trackId, track] of this.shellFlybyTracks) {
      const elapsed = now - track.startedAt;
      const progress = clamp01(elapsed / track.duration);
      if (progress >= 1) {
        this.shellFlybyTracks.delete(trackId);
        continue;
      }
      const x = track.fromX + (track.toX - track.fromX) * progress;
      const z = track.fromZ + (track.toZ - track.fromZ) * progress;
      const distance = Math.hypot(x - this.camera.position.x, z - this.camera.position.z);
      const triggerDistance = track.heavy ? 140 : 115;
      if (
        !track.played
        && elapsed > 0.06
        && progress < 0.98
        && distance <= triggerDistance
        && (distance < 55 || distance < track.lastDistance - 0.1)
      ) {
        track.played = this.playShellFlyby(x, z, track);
      }
      track.lastDistance = distance;
    }
  }

  private queueShellFlyby(event: CombatEvent): void {
    if (!this.ctx || event.duration === undefined || event.duration <= 0.08) return;
    const heavy = event.kind === 'artilleryShell' || event.weaponKind === 'heavyCannon';
    const sequence = this.shellFlybySequence++;
    const variant = heavy ? 2 + sequence % 2 : sequence % 2;
    const id = this.nextShellFlybyId++;
    this.shellFlybyTracks.set(id, {
      id,
      fromX: event.fromX,
      fromZ: event.fromZ,
      toX: event.toX,
      toZ: event.toZ,
      startedAt: this.ctx.currentTime,
      duration: event.duration,
      variant,
      heavy,
      lastDistance: Number.POSITIVE_INFINITY,
      played: false,
    });
  }

  private playShellFlyby(x: number, z: number, track: ShellFlybyTrack): boolean {
    const sample = SHELL_FLYBY_SAMPLES[track.variant];
    if (!this.sampleBuffers.has(sample)) {
      void this.preloadSample(sample);
      return false;
    }
    return this.playSampleAt(
      sample,
      x,
      z,
      combatProfile(track.heavy ? { gain: 0.34, near: 22, far: 280 } : { gain: 0.28, near: 18, far: 220 }),
      'shell-flyby',
      0.08,
      String(track.id),
      track.id + track.variant * 29,
    );
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    if (this.muted && this.activeVoice) {
      this.activeVoice.pause();
      this.activeVoice.currentTime = 0;
      this.activeVoice = undefined;
    }
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

  playVoice(url: string, volume = 0.58): void {
    if (this.muted || typeof Audio === 'undefined') return;
    if (this.activeVoice) {
      this.activeVoice.pause();
      this.activeVoice.currentTime = 0;
    }
    const voice = new Audio(url);
    voice.preload = 'auto';
    voice.volume = clamp(volume, 0, 1);
    this.activeVoice = voice;
    const clear = (): void => {
      if (this.activeVoice === voice) this.activeVoice = undefined;
    };
    voice.addEventListener('ended', clear, { once: true });
    voice.addEventListener('error', clear, { once: true });
    void voice.play().catch(clear);
  }

  playVoiceAt(url: string, x: number, z: number, volume = 0.58): void {
    const proximity = this.attenuation(x, z, UNIT_VOICE_PROFILE).gain;
    const contextualVolume = volume * proximity;
    if (contextualVolume < 0.012) return;
    this.playVoice(url, contextualVolume);
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

  installButtonSounds(root: Window = window): void {
    if (this.buttonSoundsInstalled) return;
    this.buttonSoundsInstalled = true;
    const enabledButton = (target: EventTarget | null): HTMLButtonElement | undefined => {
      const button = target instanceof Element ? target.closest('button') : undefined;
      return button instanceof HTMLButtonElement && !button.disabled && button.getAttribute('aria-disabled') !== 'true'
        ? button
        : undefined;
    };
    root.addEventListener('pointerover', (event) => {
      if (!(event instanceof PointerEvent) || event.pointerType === 'touch') return;
      const button = enabledButton(event.target);
      if (!button) return;
      if (event.relatedTarget instanceof Node && button.contains(event.relatedTarget)) return;
      this.playUiRecordedSample(
        ACTIVE_UI_GAME_HOVER.url,
        ACTIVE_UI_GAME_HOVER.gain,
        'ui-game-hover',
        0.075,
        ACTIVE_UI_GAME_HOVER.maxDuration,
      );
    });
    root.addEventListener('pointerdown', (event) => {
      if (!(event instanceof PointerEvent) || event.button !== 0) return;
      const button = enabledButton(event.target);
      if (!button) return;
      this.playUiRecordedSample(
        ACTIVE_UI_GAME_CLICK.url,
        ACTIVE_UI_GAME_CLICK.gain,
        'ui-game-click',
        0.055,
        ACTIVE_UI_GAME_CLICK.maxDuration,
      );
    }, { capture: true });
    root.addEventListener('keydown', (event) => {
      if (!(event instanceof KeyboardEvent) || (event.code !== 'Enter' && event.code !== 'Space')) return;
      const button = enabledButton(event.target);
      if (!button || event.repeat) return;
      this.playUiRecordedSample(
        ACTIVE_UI_GAME_CLICK.url,
        ACTIVE_UI_GAME_CLICK.gain,
        'ui-game-click',
        0.055,
        ACTIVE_UI_GAME_CLICK.maxDuration,
      );
    });
  }

  private playUiRecordedSample(url: string, gainValue: number, bucket: string, minInterval: number, maxDuration?: number): void {
    if (!this.ctx || !this.master || this.muted || this.voices >= MAX_VOICES) return;
    const buffer = this.sampleBuffers.get(url);
    if (!buffer) {
      void this.preloadSample(url).then(() => {
        if (this.sampleBuffers.has(url)) this.playUiRecordedSample(url, gainValue, bucket, minInterval, maxDuration);
      });
      return;
    }
    const now = performance.now() / 1000;
    const last = this.lastByBucket.get(bucket) ?? -999;
    if (now - last < minInterval) return;
    this.lastByBucket.set(bucket, now);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = gainValue;
    source.connect(gain);
    gain.connect(this.master);
    this.voices++;
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.voices = Math.max(0, this.voices - 1);
    };
    source.start();
    if (maxDuration !== undefined) source.stop(this.ctx.currentTime + Math.min(maxDuration, buffer.duration));
  }

  playUpgrade(x: number, z: number, seed = 0): void {
    if (!this.sampleBuffers.has(UI_UPGRADE_SAMPLE)) {
      void this.preloadSample(UI_UPGRADE_SAMPLE);
      return;
    }
    this.playSampleAt(
      UI_UPGRADE_SAMPLE,
      x,
      z,
      { gain: 0.38, near: 28, far: 340 },
      'ui-upgrade',
      0.08,
      String(seed),
      seed,
    );
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

  handleCombatEvents(events: CombatEvent[], possessedId?: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    for (const event of events) this.playCombatEvent(event, possessedId);
  }

  private playCombatEvent(event: CombatEvent, possessedId?: number): void {
    if (!this.ctx || !this.master) return;
    if (event.kind === 'impact-reaction' && possessedId !== undefined && event.targetId === possessedId) {
      this.playPossessionHit(event);
      return;
    }
    if (event.kind.endsWith('-impact')) {
      if (event.weaponKind === 'strategicMissile' && event.strategicId !== undefined) {
        this.stopStrategicFlight(event.strategicId);
      }
      if (event.weaponKind === 'strategicMissile' && this.sampleBuffers.has(STRATEGIC_MISSILE_IMPACT_SAMPLE)) {
        this.playStrategicMissileImpact(event);
        if (event.targetType === 'building' && event.killed) this.playBuildingDestruction(event, true);
        return;
      }
      if (event.weaponKind === 'strategicMissile') void this.preloadSample(STRATEGIC_MISSILE_IMPACT_SAMPLE);
      if (event.targetType === 'building' && event.killed && isHeavyOrdnanceImpact(event)) {
        const impactPlayed = this.playHeavyImpact(event);
        const collapsePlayed = this.playBuildingDestruction(event, impactPlayed);
        if (impactPlayed || collapsePlayed) return;
      }
      if (event.killed && isArmoredGroundTarget(event) && this.playVehicleDestruction(event)) return;
      if (isHeavyOrdnanceImpact(event) && this.playHeavyImpact(event)) return;
      if (event.targetType === 'building' && event.killed && this.playBuildingDestruction(event)) return;
      if (event.targetType === 'building' && this.playBuildingImpact(event)) return;
      if (isMediumExplosionImpact(event) && this.playMediumExplosion(event)) return;
      if (isSmallExplosionImpact(event.kind) && this.playSmallExplosion(event)) return;
      this.playExplosion(event);
      return;
    }
    if (event.kind === 'strategic-missile-intercepted' && event.strategicId !== undefined) {
      this.stopStrategicFlight(event.strategicId);
      if (event.weaponKind === 'strategicMissile' && this.sampleBuffers.has(STRATEGIC_MISSILE_INTERCEPTED_SAMPLE)) {
        this.playStrategicMissileIntercepted(event);
        return;
      }
      if (event.weaponKind === 'strategicMissile') {
        void this.preloadSample(STRATEGIC_MISSILE_INTERCEPTED_SAMPLE);
        this.playExplosion({ ...event, kind: 'bomb-impact', killed: true });
        return;
      }
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
    if (
      event.targetType === 'building'
      && event.damage > 0
      && (event.kind === 'cannon' || event.kind === 'heavyCannon' || event.kind === 'railShot')
    ) {
      this.playBuildingImpact(event);
    }
    if (event.weaponKind === 'strategicMissile' && event.kind === 'siegeMissile') {
      this.queueStrategicMissileFlight(event);
      if (this.sampleBuffers.has(STRATEGIC_MISSILE_LAUNCH_SAMPLE)) {
        this.playStrategicMissileLaunch(event);
        return;
      }
      void this.preloadSample(STRATEGIC_MISSILE_LAUNCH_SAMPLE);
    }
    if (event.kind === 'kineticShell' || event.kind === 'artilleryShell') this.queueShellFlyby(event);
    if (isHeavyMissileWeapon(event.weaponKind) && this.playHeavyMissileLaunchSample(event)) return;
    if (isMediumMissileWeapon(event.weaponKind) && this.playMediumMissileLaunchSample(event)) return;
    if (isRocketWeapon(event.weaponKind) && this.playRocketLaunchSample(event)) return;
    if (event.kind === 'bomb' || event.kind === 'tankBomb' || event.kind === 'grenade' || event.kind === 'kineticShell' || event.kind === 'artilleryShell' || event.kind === 'atRocket' || event.kind === 'agMissile' || event.kind === 'aaMissile' || event.kind === 'scoutMissile' || event.kind === 'tankMissile' || event.kind === 'siegeMissile') {
      this.playLaunch(event);
      return;
    }
    if (event.kind === 'rifle' || event.kind === 'sniperRifle' || event.kind === 'overchargeRifle' || event.kind === 'railShot') {
      this.playRifle(event);
      return;
    }
    if (event.kind === 'autocannon' || event.kind === 'waspAutocannon' || event.kind === 'skylanceGun') {
      if (this.playAutocannonBurst(event)) return;
      this.playCannon(event);
      return;
    }
    if (event.kind === 'cannon' || event.kind === 'heavyCannon') {
      this.playCannon(event);
      return;
    }
    if (event.kind === 'rocketLauncher' || event.kind === 'rocketPod') {
      this.playLaunch(event);
    }
  }

  private playStrategicMissileLaunch(event: CombatEvent): void {
    this.playSampleAt(
      STRATEGIC_MISSILE_LAUNCH_SAMPLE,
      event.fromX,
      event.fromZ,
      combatProfile({ gain: 0.42, near: 30, far: 420 }),
      'strategic-missile-launch',
      0.25,
      'sample',
      event.strategicId ?? 0,
    );
  }

  private playStrategicMissileImpact(event: CombatEvent): void {
    this.playSampleAt(
      STRATEGIC_MISSILE_IMPACT_SAMPLE,
      event.toX,
      event.toZ,
      combatProfile({ gain: 0.68, near: 65, far: 900 }),
      'strategic-missile-impact',
      0.35,
      String(event.strategicId ?? 'area'),
      event.strategicId ?? 0,
    );
  }

  private playStrategicMissileIntercepted(event: CombatEvent): void {
    this.playSampleAt(
      STRATEGIC_MISSILE_INTERCEPTED_SAMPLE,
      event.toX,
      event.toZ,
      combatProfile({ gain: 0.5, near: 45, far: 600 }),
      'strategic-missile-intercepted',
      0.3,
      String(event.strategicId ?? 'air'),
      event.strategicId ?? 0,
    );
  }

  private playStrategicMissileFlyby(x: number, z: number, strategicId: number): boolean {
    if (!this.ctx) return false;
    const buffer = this.sampleBuffers.get(STRATEGIC_MISSILE_FLYBY_SAMPLE);
    if (!buffer) {
      void this.preloadSample(STRATEGIC_MISSILE_FLYBY_SAMPLE);
      return false;
    }
    return this.playSampleAt(
      STRATEGIC_MISSILE_FLYBY_SAMPLE,
      x,
      z,
      combatProfile({ gain: 0.48, near: 45, far: 280 }),
      'strategic-missile-flyby',
      0.2,
      String(strategicId),
      strategicId,
    );
  }

  private queueStrategicMissileFlight(event: CombatEvent): void {
    if (!this.ctx || event.strategicId === undefined || event.duration === undefined || event.duration <= 0) return;
    const strategicId = event.strategicId;
    this.pendingStrategicFlights.add(strategicId);
    const queuedAt = this.ctx.currentTime;
    void this.preloadSample(STRATEGIC_MISSILE_FLIGHT_SAMPLE).then(() => {
      if (!this.ctx || !this.pendingStrategicFlights.delete(strategicId)) return;
      const elapsed = this.ctx.currentTime - queuedAt;
      if (elapsed >= event.duration!) return;
      this.startStrategicMissileFlight(event, elapsed);
    });
  }

  private startStrategicMissileFlight(event: CombatEvent, elapsed: number): void {
    if (!this.ctx || !this.master || event.strategicId === undefined || event.duration === undefined || this.voices >= MAX_VOICES) return;
    const buffer = this.sampleBuffers.get(STRATEGIC_MISSILE_FLIGHT_SAMPLE);
    if (!buffer) return;
    this.stopStrategicFlight(event.strategicId);
    const profile: SoundProfile = { gain: 0.25, near: 35, far: 360 };
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = 0.98 + seeded01(event.fromX, event.fromZ, event.strategicId) * 0.04;
    const input = this.ctx.createGain();
    input.gain.value = 0.0001;
    let pan: StereoPannerNode | undefined;
    if ('StereoPannerNode' in globalThis) {
      pan = new StereoPannerNode(this.ctx, { pan: 0 });
      source.connect(input);
      input.connect(pan);
      pan.connect(this.master);
    } else {
      source.connect(input);
      input.connect(this.master);
    }
    this.voices++;
    this.strategicFlightLoops.set(event.strategicId, {
      source,
      input,
      pan,
      fromX: event.fromX,
      fromZ: event.fromZ,
      toX: event.toX,
      toZ: event.toZ,
      startedAt: this.ctx.currentTime - elapsed,
      duration: event.duration,
      profile,
      lastDistance: Number.POSITIVE_INFINITY,
      flybyPlayed: false,
    });
    source.start(0, elapsed % buffer.duration);
    this.update();
  }

  private stopStrategicFlight(strategicId: number): void {
    this.pendingStrategicFlights.delete(strategicId);
    const flight = this.strategicFlightLoops.get(strategicId);
    if (!flight) return;
    this.strategicFlightLoops.delete(strategicId);
    try {
      flight.source.stop();
    } catch {
      // The browser may already have stopped the source during page teardown.
    }
    flight.source.disconnect();
    flight.input.disconnect();
    flight.pan?.disconnect();
    this.voices = Math.max(0, this.voices - 1);
  }

  private playSampleAt(
    url: string,
    x: number,
    z: number,
    profile: SoundProfile,
    bucket: string,
    minInterval: number,
    suffix: string,
    seed: number,
  ): boolean {
    if (!this.ctx || !this.master || this.voices >= MAX_VOICES) return false;
    const buffer = this.sampleBuffers.get(url);
    if (!buffer || !this.allowSoundAt(bucket, x, z, profile, minInterval, suffix, true)) return false;

    const attenuation = this.attenuation(x, z, profile);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.985 + seeded01(x, z, seed) * 0.03;
    const input = this.ctx.createGain();
    input.gain.value = attenuation.gain;
    let pan: StereoPannerNode | undefined;
    if ('StereoPannerNode' in globalThis) {
      pan = new StereoPannerNode(this.ctx, { pan: attenuation.pan });
      source.connect(input);
      input.connect(pan);
      pan.connect(this.master);
    } else {
      source.connect(input);
      input.connect(this.master);
    }

    const sample: ActivePositionalSample = { source, input, pan, x, z, profile };
    this.positionalSamples.add(sample);
    this.voices++;
    source.onended = () => this.cleanupPositionalSample(sample);
    source.start();
    return true;
  }

  private cleanupPositionalSample(sample: ActivePositionalSample): void {
    if (!this.positionalSamples.delete(sample)) return;
    try {
      sample.source.disconnect();
      sample.input.disconnect();
      sample.pan?.disconnect();
    } catch {
      // The browser may already have disconnected nodes during page teardown.
    }
    this.voices = Math.max(0, this.voices - 1);
  }

  private playPossessionHit(event: CombatEvent): void {
    if (!this.ctx || !this.master || this.voices >= MAX_VOICES) return;
    const force = impactForceFromEvent(event);
    const now = performance.now() / 1000;
    const last = this.lastByBucket.get('possession-hit') ?? -999;
    if (now - last < 0.05) return;
    this.lastByBucket.set('possession-hit', now);

    this.voices++;
    const t = this.ctx.currentTime;
    const gain = possessionHitGain(force);
    const duration = 0.22 + force * 0.28;
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    out.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    out.connect(this.master);

    const thud = this.ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(92 + force * 38, t);
    thud.frequency.exponentialRampToValueAtTime(36, t + duration * 0.55);
    thud.connect(out);
    thud.start(t);
    thud.stop(t + duration + 0.02);

    const clang = this.ctx.createOscillator();
    clang.type = 'triangle';
    clang.frequency.setValueAtTime(420 + force * 260, t);
    clang.frequency.exponentialRampToValueAtTime(140, t + 0.12);
    const clangGain = this.ctx.createGain();
    clangGain.gain.setValueAtTime(0.0001, t);
    clangGain.gain.exponentialRampToValueAtTime(0.12 + force * 0.18, t + 0.004);
    clangGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    clang.connect(clangGain);
    clangGain.connect(out);
    clang.start(t);
    clang.stop(t + 0.16);

    this.noiseBurst(out, 0.18 + force * 0.22, 0.09 + force * 0.06, {
      type: 'bandpass',
      frequency: 650 + force * 400,
      q: 0.7,
      delay: 0,
    });

    window.setTimeout(() => {
      this.voices = Math.max(0, this.voices - 1);
    }, (duration + 0.05) * 1000);
  }

  private playExplosion(event: CombatEvent): void {
    const strategic = event.weaponKind === 'strategicMissile';
    const profile = combatProfile(explosionProfile(event.kind, event.killed, event.weaponKind));
    if (!this.allowSound(event, profile, 0.045)) return;
    const bus = this.spatialBus(event.toX, event.toZ, profile);
    if (!bus) return;
    const now = this.ctx!.currentTime;
    const heavy = strategic || event.kind === 'tankBomb-impact' || event.kind === 'bomb-impact' || event.kind === 'agMissile-impact';
    const duration = strategic ? 2.35 : heavy ? 1.35 : 0.72;

    const boom = this.ctx!.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(strategic ? 48 : heavy ? 74 : 105, now);
    boom.frequency.exponentialRampToValueAtTime(strategic ? 18 : heavy ? 31 : 48, now + duration * 0.38);
    const boomGain = this.ctx!.createGain();
    boomGain.gain.setValueAtTime(0.0001, now);
    boomGain.gain.exponentialRampToValueAtTime(strategic ? 0.72 : heavy ? 0.46 : 0.22, now + 0.012);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    boom.connect(boomGain);
    boomGain.connect(bus.input);
    boom.start(now);
    boom.stop(now + duration + 0.03);

    this.noiseBurst(bus.input, strategic ? 1.25 : heavy ? 0.72 : 0.38, strategic ? 0.42 : heavy ? 0.28 : 0.16, {
      type: 'lowpass',
      frequency: strategic ? 520 : heavy ? 720 : 1100,
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
    const heavyArc = kind === 'tankBomb' || kind === 'artilleryShell';
    const kinetic = kind === 'kineticShell';
    const profile = combatProfile({
      gain: kinetic ? 0.3 : heavyArc ? 0.28 : kind === 'bomb' ? 0.2 : kind === 'grenade' ? 0.12 : 0.16,
      near: 22,
      far: heavyArc ? 340 : kind === 'bomb' ? 260 : 210,
    });
    if (!this.allowSoundAt(event.kind, event.fromX, event.fromZ, profile, kind === 'aaMissile' || kind === 'agMissile' ? 0.06 : 0.04, 'launch')) return;
    const bus = this.spatialBus(event.fromX, event.fromZ, profile);
    if (!bus) return;
    const now = this.ctx!.currentTime;
    const whistle = this.ctx!.createOscillator();
    whistle.type = kind === 'grenade' ? 'triangle' : 'sawtooth';
    whistle.frequency.setValueAtTime(kinetic ? 72 : heavyArc ? 92 : kind === 'bomb' ? 120 : kind === 'grenade' ? 270 : 390, now);
    whistle.frequency.exponentialRampToValueAtTime(kinetic ? 42 : heavyArc ? 54 : kind === 'bomb' ? 72 : kind === 'grenade' ? 210 : 850, now + 0.22);
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
    const profile = combatProfile({ gain: sniper ? 0.31 : 0.07, near: 16, far: sniper ? 360 : 145 });
    if (!this.allowSoundAt(event.kind, event.fromX, event.fromZ, profile, sniper ? 0.14 : 0.026)) return;
    const bus = this.spatialBus(event.fromX, event.fromZ, profile);
    if (!bus) return;
    const now = this.ctx!.currentTime;
    const osc = this.ctx!.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(sniper ? 155 : 260, now);
    osc.frequency.exponentialRampToValueAtTime(sniper ? 72 : 120, now + (sniper ? 0.16 : 0.055));
    const gain = this.ctx!.createGain();
    gain.gain.setValueAtTime(sniper ? 0.2 : 0.035, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (sniper ? 0.24 : 0.075));
    osc.connect(gain);
    gain.connect(bus.input);
    osc.start(now);
    osc.stop(now + (sniper ? 0.26 : 0.09));
    this.noiseBurst(bus.input, sniper ? 0.2 : 0.045, sniper ? 0.065 : 0.018, { type: 'highpass', frequency: sniper ? 850 : 1200, q: 0.7 });
    this.releaseBus(bus, sniper ? 0.34 : 0.12);
  }

  private playCannon(event: CombatEvent): void {
    const heavy = event.kind === 'heavyCannon';
    const auto = event.kind === 'autocannon' || event.kind === 'waspAutocannon' || event.kind === 'skylanceGun';
    const profile = combatProfile({ gain: heavy ? 0.3 : auto ? 0.12 : 0.24, near: 24, far: heavy ? 330 : 260 });
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

  private playAutocannonBurst(event: CombatEvent): boolean {
    const sequence = this.autocannonSequence++;
    const seed = sequence + (event.sourceTeamId ?? 0) * 17 + event.kind.length * 31;
    const variant = Math.floor(seeded01(event.fromX, event.fromZ, seed) * AUTOCANNON_BURST_SAMPLES.length);
    const sample = AUTOCANNON_BURST_SAMPLES[Math.min(AUTOCANNON_BURST_SAMPLES.length - 1, variant)];
    if (!this.sampleBuffers.has(sample)) {
      void this.preloadSample(sample);
      return false;
    }
    const profile = combatProfile(event.kind === 'waspAutocannon'
      ? { gain: 0.34, near: 24, far: 320 }
      : event.kind === 'skylanceGun'
        ? { gain: 0.3, near: 22, far: 270 }
        : { gain: 0.31, near: 22, far: 285 });
    const minInterval = event.kind === 'skylanceGun' ? 0.58 : event.kind === 'waspAutocannon' ? 0.68 : 0.75;
    return this.playSampleAt(
      sample,
      event.fromX,
      event.fromZ,
      profile,
      `autocannon-${event.kind}`,
      minInterval,
      String(event.sourceTeamId ?? 0),
      seed,
    );
  }

  private playRocketLaunchSample(event: CombatEvent): boolean {
    const sourceClass = event.sourceClass ?? fallbackRocketSourceClass(event.weaponKind);
    const variant = sourceClass === 'infantry' ? 0 : sourceClass === 'vehicle' ? 1 : sourceClass === 'aircraft' ? 2 : 3;
    const sample = ROCKET_LAUNCH_SAMPLES[variant];
    if (!this.sampleBuffers.has(sample)) {
      void this.preloadSample(sample);
      return false;
    }
    const profile = combatProfile(sourceClass === 'infantry'
      ? { gain: 0.36, near: 18, far: 285 }
      : sourceClass === 'vehicle'
        ? { gain: 0.4, near: 24, far: 360 }
        : sourceClass === 'aircraft'
          ? { gain: 0.38, near: 28, far: 400 }
          : { gain: 0.42, near: 26, far: 430 });
    const minInterval = event.weaponKind === 'rocketPod' ? 0.48 : 0.1;
    const seed = Math.round(event.fromX * 3 + event.fromZ * 5) + (event.sourceTeamId ?? 0) * 19 + variant * 41;
    return this.playSampleAt(
      sample,
      event.fromX,
      event.fromZ,
      profile,
      `rocket-launch-${sourceClass}`,
      minInterval,
      String(event.sourceTeamId ?? 0),
      seed,
    );
  }

  private playHeavyMissileLaunchSample(event: CombatEvent): boolean {
    const variant = heavyMissileLaunchVariant(event);
    const sample = HEAVY_MISSILE_LAUNCH_SAMPLES[variant];
    if (!this.sampleBuffers.has(sample)) {
      void this.preloadSample(sample);
      return false;
    }
    const profile = combatProfile({
      gain: HEAVY_MISSILE_LAUNCH_GAINS[variant],
      near: variant === 3 ? 34 : 28,
      far: variant === 3 ? 520 : event.sourceClass === 'aircraft' ? 450 : event.sourceClass === 'tower' ? 420 : 390,
    });
    const seed = Math.round(event.fromX * 7 + event.fromZ * 11) + (event.sourceTeamId ?? 0) * 23 + variant * 67;
    return this.playSampleAt(
      sample,
      event.fromX,
      event.fromZ,
      profile,
      `heavy-missile-launch-${variant}`,
      event.weaponKind === 'swarmRocket' ? 0.28 : 0.1,
      String(event.sourceTeamId ?? 0),
      seed,
    );
  }

  private playMediumMissileLaunchSample(event: CombatEvent): boolean {
    const variant = event.sourceClass === 'aircraft' ? 0 : 1;
    const sample = MEDIUM_MISSILE_LAUNCH_SAMPLES[variant];
    if (!this.sampleBuffers.has(sample)) {
      void this.preloadSample(sample);
      return false;
    }
    const profile = combatProfile({
      gain: MEDIUM_MISSILE_LAUNCH_GAINS[variant],
      near: 22,
      far: variant === 0 ? 360 : 320,
    });
    const seed = Math.round(event.fromX * 5 + event.fromZ * 13) + (event.sourceTeamId ?? 0) * 29 + variant * 71;
    return this.playSampleAt(
      sample,
      event.fromX,
      event.fromZ,
      profile,
      `medium-missile-launch-${variant}`,
      event.weaponKind === 'rocketPod' ? 0.48 : 0.1,
      String(event.sourceTeamId ?? 0),
      seed,
    );
  }

  private playBuildingImpact(event: CombatEvent): boolean {
    const variant = buildingImpactVariant(event.targetBuildingKind, event.targetLabel);
    const sample = BUILDING_IMPACT_SAMPLES[variant];
    if (!this.sampleBuffers.has(sample)) {
      void this.preloadSample(sample);
      return false;
    }
    const profile = combatProfile(variant === 0
      ? { gain: 0.36, near: 24, far: 330 }
      : variant === 1
        ? { gain: 0.43, near: 30, far: 420 }
        : variant === 2
          ? { gain: 0.4, near: 27, far: 380 }
          : { gain: 0.48, near: 38, far: 510 });
    const sequence = this.buildingImpactSequence++;
    return this.playSampleAt(
      sample,
      event.toX,
      event.toZ,
      profile,
      `building-impact-${variant}`,
      0.09,
      String(event.targetId ?? 'area'),
      sequence + variant * 37,
    );
  }

  private playBuildingDestruction(event: CombatEvent, layeredWithStrategicImpact = false): boolean {
    const buildingClass = buildingImpactVariant(event.targetBuildingKind, event.targetLabel);
    const sampleVariant = [1, 2, 0, 3][buildingClass] ?? 1;
    const sample = BUILDING_COLLAPSE_SAMPLES[sampleVariant];
    if (!this.sampleBuffers.has(sample)) {
      void this.preloadSample(sample);
      return false;
    }
    const baseProfile: SoundProfile = buildingClass === 0
      ? { gain: 0.28, near: 20, far: 320 }
      : buildingClass === 1
        ? { gain: 0.36, near: 28, far: 440 }
        : buildingClass === 2
          ? { gain: 0.34, near: 26, far: 400 }
          : { gain: 0.44, near: 38, far: 560 };
    const contextualProfile = layeredWithStrategicImpact
      ? { ...baseProfile, gain: baseProfile.gain * 0.5, far: baseProfile.far * 0.82 }
      : baseProfile;
    const profile = combatProfile(contextualProfile);
    return this.playSampleAt(
      sample,
      event.toX,
      event.toZ,
      profile,
      `building-collapse-${buildingClass}`,
      0.2,
      String(event.targetId ?? 'area'),
      this.buildingCollapseSequence++ + sampleVariant * 53,
    );
  }

  private playSmallExplosion(event: CombatEvent): boolean {
    const variant = smallExplosionVariant(event);
    const sample = SMALL_EXPLOSION_SAMPLES[variant];
    if (!this.sampleBuffers.has(sample)) {
      void this.preloadSample(sample);
      return false;
    }
    const profile = combatProfile(event.killed
      ? { gain: 0.34, near: 24, far: 390 }
      : event.kind === 'agMissile-impact' || event.kind === 'aaMissile-impact' || event.kind === 'tankMissile-impact'
        ? { gain: 0.3, near: 22, far: 340 }
        : { gain: 0.26, near: 18, far: 285 });
    return this.playSampleAt(
      sample,
      event.toX,
      event.toZ,
      profile,
      'small-explosion',
      0.14,
      'area',
      this.smallExplosionSequence++ + variant * 43,
    );
  }

  private playMediumExplosion(event: CombatEvent): boolean {
    const variant = mediumExplosionVariant(event);
    const sample = MEDIUM_EXPLOSION_SAMPLES[variant];
    if (!this.sampleBuffers.has(sample)) {
      void this.preloadSample(sample);
      return false;
    }
    const profile = combatProfile(variant === 0
      ? { gain: 0.34, near: 25, far: 365 }
      : variant === 1
        ? { gain: 0.42, near: 32, far: 490 }
        : variant === 2
          ? { gain: 0.45, near: 35, far: 520 }
          : { gain: 0.48, near: 40, far: 560 });
    return this.playSampleAt(
      sample,
      event.toX,
      event.toZ,
      profile,
      'medium-explosion',
      0.11,
      'area',
      this.mediumExplosionSequence++ + variant * 47,
    );
  }

  private playHeavyImpact(event: CombatEvent): boolean {
    const bomb = event.kind === 'bomb-impact' || event.kind === 'tankBomb-impact';
    const variant = bomb ? 1 : 0;
    const sample = HEAVY_IMPACT_SAMPLES[variant];
    if (!this.sampleBuffers.has(sample)) {
      void this.preloadSample(sample);
      return false;
    }
    const profile = combatProfile(bomb
      ? { gain: 0.42, near: 36, far: 560 }
      : { gain: 0.32, near: 28, far: 460 });
    return this.playSampleAt(
      sample,
      event.toX,
      event.toZ,
      profile,
      `heavy-impact-${variant}`,
      0.16,
      'area',
      this.heavyImpactSequence++ + variant * 59,
    );
  }

  private playVehicleDestruction(event: CombatEvent): boolean {
    const variant = vehicleDestructionVariant(event);
    const sample = VEHICLE_DESTRUCTION_SAMPLES[variant];
    if (!this.sampleBuffers.has(sample)) {
      void this.preloadSample(sample);
      return false;
    }
    const profile = combatProfile(variant === 3
      ? { gain: 0.27, near: 20, far: 340 }
      : variant === 2
        ? { gain: 0.36, near: 28, far: 450 }
        : variant === 1
          ? { gain: 0.42, near: 32, far: 520 }
          : { gain: 0.32, near: 24, far: 380 });
    return this.playSampleAt(
      sample,
      event.toX,
      event.toZ,
      profile,
      `vehicle-destruction-${variant}`,
      0.2,
      String(event.targetId ?? 'area'),
      this.vehicleDestructionSequence++ + variant * 61,
    );
  }

  private playMetalCrash(event: CombatEvent): void {
    const profile = combatProfile({ gain: 0.18, near: 18, far: 210 });
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
    const gain = profile.gain * (1 - t) * (1 - t);
    this.camera.getWorldDirection(TMP_FORWARD);
    const rightX = TMP_FORWARD.z;
    const rightZ = -TMP_FORWARD.x;
    const side = (dx * rightX + dz * rightZ) / Math.max(1, distance);
    return { gain, pan: clamp(side * 0.85, -0.85, 0.85) };
  }

  private engineCrowdScale(
    entities: Iterable<Entity>,
    profileFor: (entity: Entity) => SoundProfile,
  ): number {
    let audibleWeight = 0;
    for (const entity of entities) {
      const profile = profileFor(entity);
      const distance = Math.hypot(
        entity.transform.x - this.camera.position.x,
        entity.transform.z - this.camera.position.z,
      );
      const t = clamp01((distance - profile.near) / Math.max(1, profile.far - profile.near));
      audibleWeight += (1 - t) * (1 - t);
    }
    return 1 / Math.sqrt(Math.max(1, audibleWeight));
  }

  private allowSound(event: CombatEvent, profile: SoundProfile, minInterval: number, suffix = ''): boolean {
    return this.allowSoundAt(event.kind, event.toX, event.toZ, profile, minInterval, suffix);
  }

  private allowSoundAt(
    kind: string,
    x: number,
    z: number,
    profile: SoundProfile,
    minInterval: number,
    suffix = '',
    allowSilentStart = false,
  ): boolean {
    const attenuation = this.attenuation(x, z, profile);
    if (!allowSilentStart && attenuation.gain <= 0.002) return false;
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
      // A single three-army salvo can touch hundreds of fresh spatial buckets,
      // so age-based cleanup alone is not a hard bound. Evict the oldest
      // remaining throttle records rather than letting an FX storm grow this
      // map until the browser is under memory pressure.
      while (this.lastByBucket.size > 220) {
        const oldest = this.lastByBucket.keys().next().value;
        if (oldest === undefined) break;
        this.lastByBucket.delete(oldest);
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

  private preloadSample(url: string): Promise<void> {
    if (!this.ctx || this.sampleBuffers.has(url)) return Promise.resolve();
    const existing = this.sampleLoads.get(url);
    if (existing) return existing;
    const context = this.ctx;
    const load = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => context.decodeAudioData(data))
      .then((buffer) => {
        if (this.ctx === context) this.sampleBuffers.set(url, buffer);
      })
      .catch((error: unknown) => {
        console.warn(`[audio] Unable to load ${url}`, error);
      })
      .finally(() => {
        this.sampleLoads.delete(url);
      });
    this.sampleLoads.set(url, load);
    return load;
  }
}

function explosionProfile(kind: string, killed: boolean, weaponKind?: string): SoundProfile {
  if (weaponKind === 'strategicMissile') return { gain: killed ? 0.96 : 0.88, near: 70, far: 1200 };
  if (kind === 'artilleryShell-impact') return { gain: killed ? 0.72 : 0.58, near: 32, far: killed ? 590 : 510 };
  if (kind === 'kineticShell-impact') return { gain: killed ? 0.38 : 0.29, near: 20, far: 310 };
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

function combatProfile(profile: SoundProfile): SoundProfile {
  return { ...profile, gain: profile.gain * COMBAT_GAIN_SCALE };
}

function isRocketWeapon(kind: string | undefined): boolean {
  return kind === 'rocketLauncher'
    || kind === 'scoutMissile'
    || kind === 'tankMissile'
    || kind === 'siegeMissile'
    || kind === 'rocketPod'
    || kind === 'agMissile'
    || kind === 'aaMissile'
    || kind === 'swarmRocket'
    || kind === 'annihilatorMissile';
}

function isHeavyMissileWeapon(kind: string | undefined): boolean {
  return kind === 'agMissile'
    || kind === 'siegeMissile'
    || kind === 'swarmRocket'
    || kind === 'annihilatorMissile';
}

function isMediumMissileWeapon(kind: string | undefined): boolean {
  return kind === 'tankMissile' || kind === 'rocketPod';
}

function heavyMissileLaunchVariant(event: CombatEvent): number {
  if (event.weaponKind === 'swarmRocket' || event.weaponKind === 'annihilatorMissile') return 3;
  if (event.sourceClass === 'aircraft') return 0;
  if (event.sourceClass === 'vehicle') return 1;
  return 2;
}

function fallbackRocketSourceClass(kind: string | undefined): NonNullable<CombatEvent['sourceClass']> {
  if (kind === 'rocketLauncher') return 'infantry';
  if (kind === 'rocketPod' || kind === 'agMissile') return 'aircraft';
  if (kind === 'aaMissile') return 'tower';
  return 'vehicle';
}

function buildingImpactVariant(kind: string | undefined, label: string | undefined): number {
  if (kind === 'refinery' || kind === 'factory' || kind === 'helipad') return 1;
  if (kind === 'guard-tower' || kind === 'aa-tower' || kind === 'missile-defense' || kind === 'skylance-ciws') return 2;
  if (kind === 'command-yard' || kind === 'intelligence-center' || kind === 'strategic-silo') return 3;
  const normalized = label?.toLowerCase() ?? '';
  if (/refinery|factory|helipad/.test(normalized)) return 1;
  if (/tower|defense|skylance/.test(normalized)) return 2;
  if (/command|intelligence|silo/.test(normalized)) return 3;
  return 0;
}

function isSmallExplosionImpact(kind: string): boolean {
  return kind === 'grenade-impact'
    || kind === 'atRocket-impact'
    || kind === 'scoutMissile-impact'
    || kind === 'tankMissile-impact'
    || kind === 'agMissile-impact'
    || kind === 'aaMissile-impact';
}

function smallExplosionVariant(event: CombatEvent): number {
  if (event.killed) return 3;
  if (event.kind === 'grenade-impact') return 0;
  if (event.kind === 'atRocket-impact' || event.kind === 'scoutMissile-impact') return 1;
  return 2;
}

function isMediumExplosionImpact(event: CombatEvent): boolean {
  if (event.killed && (event.targetType === 'tank' || event.targetType === 'aircraft')) return true;
  return event.kind === 'kineticShell-impact'
    || event.kind === 'artilleryShell-impact'
    || event.kind === 'siegeMissile-impact'
    || event.kind === 'bomb-impact'
    || event.kind === 'tankBomb-impact';
}

function isHeavyOrdnanceImpact(event: CombatEvent): boolean {
  return event.kind === 'artilleryShell-impact'
    || event.kind === 'siegeMissile-impact'
    || event.kind === 'bomb-impact'
    || event.kind === 'tankBomb-impact';
}

function isArmoredGroundTarget(event: CombatEvent): boolean {
  return event.targetType === 'tank' || event.targetType === 'harvester';
}

function vehicleDestructionVariant(event: CombatEvent): number {
  const label = event.targetLabel?.toLowerCase() ?? '';
  if (event.targetType === 'harvester' || /harvester|collector/.test(label)) return 0;
  if (/mauler|siege/.test(label)) return 1;
  if (/jackal|scout/.test(label)) return 3;
  return 2;
}

function mediumExplosionVariant(event: CombatEvent): number {
  if (event.killed && (event.targetType === 'tank' || event.targetType === 'aircraft')) return 3;
  if (event.kind === 'kineticShell-impact') return 0;
  if (event.kind === 'artilleryShell-impact' || event.kind === 'siegeMissile-impact') return 1;
  return 2;
}

function seeded01(x: number, z: number, salt: number): number {
  const a = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
  return a - Math.floor(a);
}

function aircraftEngineProfile(entity: Entity): SoundProfile {
  const kind = unitKindForUpgrade(entity);
  if (kind === 'wasp') return WASP_ENGINE_PROFILE;
  if (kind === 'vulture') return VULTURE_ENGINE_PROFILE;
  return HEAVY_GUNSHIP_ENGINE_PROFILE;
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
