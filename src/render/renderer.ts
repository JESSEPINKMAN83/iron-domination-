// Owns the WebGL renderer, scene, camera, day-lighting rig (hemisphere +
// cascaded-shadow-map sun) and the postprocessing chain (SSAO, SMAA, bloom,
// color-grading LUT, vignette).
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HalfFloatType,
  HemisphereLight,
  Material,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  LookupTexture,
  LUT3DEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export type VisualQualityTier = 0 | 1 | 2;

export function suggestedInitialVisualQuality(
  multiplayer: boolean,
  hardwareConcurrency?: number,
  deviceMemory?: number,
): VisualQualityTier {
  if (!multiplayer) return 0;
  const limitedCpu = Number.isFinite(hardwareConcurrency) && Number(hardwareConcurrency) <= 4;
  const limitedMemory = Number.isFinite(deviceMemory) && Number(deviceMemory) <= 4;
  return limitedCpu || limitedMemory ? 1 : 0;
}

export function degradedVisualQualityTier(current: VisualQualityTier, averageFrameSeconds: number): VisualQualityTier {
  if (averageFrameSeconds > 0.055) return 2;
  if (averageFrameSeconds > 0.03) return Math.min(2, current + 1) as VisualQualityTier;
  return current;
}

export function visualPixelRatioForTier(
  tier: VisualQualityTier,
  maxPixelRatio: number,
  multiplayer: boolean,
): number {
  if (tier === 0) return maxPixelRatio;
  // Keep text, terrain and unit silhouettes legible on old machines. The
  // performance tiers save most of their cost through batching and effects,
  // rather than reducing the entire scene to a very low-resolution image.
  if (tier === 1) return Math.min(maxPixelRatio, multiplayer ? 0.75 : 0.8);
  return Math.min(maxPixelRatio, multiplayer ? 0.68 : 0.7);
}

export function mobileSafePixelRatio(maxPixelRatio: number): number {
  return Math.min(maxPixelRatio, 0.85);
}

export class RenderContext {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly hemisphere: HemisphereLight;
  readonly csm?: CSM;
  /** direction light travels (from sun toward ground), normalized */
  readonly sunDirection = new Vector3(-0.5, -0.85, -0.32).normalize();

  private readonly composer?: EffectComposer;
  private readonly n8ao?: N8AOPostPass;
  private readonly maxPixelRatio: number;
  private readonly multiplayerMode: boolean;
  private readonly mobileSafeMode: boolean;
  private pixelRatio: number;
  private qualitySampleSeconds = 0;
  private qualityFrameCount = 0;
  // Map construction and the first shader compilation can briefly spike frame time.
  // Give those one-off costs time to settle before adapting persistent quality.
  private qualityCooldownSeconds: number;
  private adaptiveQualityTier: VisualQualityTier;
  private appliedQualityTier: VisualQualityTier | -1 = -1;
  private recoveryWindows = 0;
  private directRender = false;
  private fastMotionMode = false;

  constructor(container: HTMLElement, options: { multiplayer?: boolean; initialQualityTier?: VisualQualityTier; mobileSafeMode?: boolean } = {}) {
    this.multiplayerMode = options.multiplayer === true;
    this.mobileSafeMode = options.mobileSafeMode === true;
    const browserNavigator = typeof navigator === 'undefined'
      ? undefined
      : navigator as Navigator & { deviceMemory?: number };
    this.adaptiveQualityTier = options.initialQualityTier ?? suggestedInitialVisualQuality(
      this.multiplayerMode,
      browserNavigator?.hardwareConcurrency,
      browserNavigator?.deviceMemory,
    );
    this.renderer = new WebGLRenderer({
      antialias: false,
      stencil: false,
      powerPreference: this.mobileSafeMode ? 'default' : 'high-performance',
      precision: this.mobileSafeMode ? 'mediump' : 'highp',
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = !this.mobileSafeMode;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    // Multiplayer commonly runs beside voice chat and sometimes a second test
    // browser. Start slightly leaner there, then let adaptive quality recover.
    this.maxPixelRatio = Math.min(window.devicePixelRatio, this.mobileSafeMode ? 0.9 : this.multiplayerMode ? 0.9 : 1.25);
    this.pixelRatio = this.targetPixelRatio(this.adaptiveQualityTier);
    this.qualityCooldownSeconds = options.multiplayer ? 1.25 : 3;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);

    this.scene = new Scene();
    const skyColor = new Color('#8fb3d6');
    this.scene.background = skyColor;
    this.scene.fog = new Fog(skyColor, 650, 1900);

    this.camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 2, 3000);

    this.hemisphere = new HemisphereLight(0xcfe0f2, 0x8a795d, 0.75);
    this.scene.add(this.hemisphere);

    if (this.mobileSafeMode) {
      const sun = new DirectionalLight(0xfff3d2, 2.15);
      sun.position.copy(this.sunDirection).multiplyScalar(-420);
      sun.target.position.set(0, 0, 0);
      this.scene.add(sun, sun.target);
      this.directRender = true;
    } else {
      this.csm = new CSM({
        camera: this.camera,
        parent: this.scene,
        cascades: 2,
        maxFar: 620,
        mode: 'practical',
        shadowMapSize: 1024,
        shadowBias: -0.0002,
        lightDirection: this.sunDirection.clone(),
        lightIntensity: 2.4,
      });
      this.csm.fade = true;

      this.composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType });
      this.composer.addPass(new RenderPass(this.scene, this.camera));

      this.n8ao = new N8AOPostPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
      this.n8ao.configuration.aoRadius = 2.2;
      this.n8ao.configuration.intensity = 2.4;
      this.n8ao.configuration.distanceFalloff = 4;
      this.n8ao.setQualityMode('Low');
      if (this.multiplayerMode) this.n8ao.enabled = false;
      this.composer.addPass(this.n8ao);

      const lut = LookupTexture.createNeutral(32);
      gradeLut(lut);
      this.composer.addPass(
        new EffectPass(
          this.camera,
          new SMAAEffect({ preset: SMAAPreset.MEDIUM }),
          new BloomEffect({ mipmapBlur: true, intensity: 0.4, luminanceThreshold: 0.8, luminanceSmoothing: 0.25 }),
          new LUT3DEffect(lut),
          new VignetteEffect({ offset: 0.26, darkness: 0.55 }),
        ),
      );
    }
    this.applyQualityTier();

    window.addEventListener('resize', () => this.onResize());
  }

  /** Patch a lit material for cascaded shadow maps. All lit scene materials must go through this. */
  setupLitMaterial<T extends Material>(material: T): T {
    this.csm?.setupMaterial(material);
    return material;
  }

  get maxAnisotropy(): number {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  get renderScale(): number {
    return this.pixelRatio;
  }

  get visualQuality(): VisualQualityTier {
    return Math.max(this.adaptiveQualityTier, this.fastMotionMode ? 1 : 0) as VisualQualityTier;
  }

  get visualQualityLabel(): string {
    return this.visualQuality === 0 ? 'FULL' : this.visualQuality === 1 ? 'BALANCED' : 'PERFORMANCE';
  }

  get visualUpdateDivisor(): number {
    return this.visualQuality === 0 ? 1 : this.visualQuality === 1 ? 2 : 3;
  }

  setFastMotionMode(active: boolean): void {
    if (this.fastMotionMode === active) return;
    this.fastMotionMode = active;
    this.qualitySampleSeconds = 0;
    this.qualityFrameCount = 0;
    this.recoveryWindows = 0;
    this.qualityCooldownSeconds = active ? 0.5 : 2;
    this.applyQualityTier();
  }

  render(dt: number): void {
    this.updateAdaptiveQuality(dt);
    this.renderer.info.reset();
    if (this.renderer.shadowMap.enabled) this.csm?.update();
    if (this.directRender || !this.composer) this.renderer.render(this.scene, this.camera);
    else this.composer.render(dt);
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.csm?.updateFrustums();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
  }

  /** Keep the full visual stack while it fits, then shed GPU and animation cost under sustained pressure. */
  private updateAdaptiveQuality(dt: number): void {
    if (this.mobileSafeMode) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Slow machines regularly exceed 100ms. Ignoring those frames prevents the
    // quality system from ever responding on the computers that need it most.
    const sampleDt = Math.min(dt, 0.25);
    if (this.qualityCooldownSeconds > 0) {
      this.qualityCooldownSeconds = Math.max(0, this.qualityCooldownSeconds - sampleDt);
      this.qualitySampleSeconds = 0;
      this.qualityFrameCount = 0;
      return;
    }
    this.qualitySampleSeconds += sampleDt;
    this.qualityFrameCount++;
    if (this.qualitySampleSeconds < 0.75) return;

    const averageFrameSeconds = this.qualitySampleSeconds / Math.max(1, this.qualityFrameCount);
    this.qualitySampleSeconds = 0;
    this.qualityFrameCount = 0;
    const degraded = degradedVisualQualityTier(this.adaptiveQualityTier, averageFrameSeconds);
    if (degraded !== this.adaptiveQualityTier) {
      this.adaptiveQualityTier = degraded;
      this.recoveryWindows = 0;
      this.applyQualityTier();
      this.qualityCooldownSeconds = 1;
      return;
    }
    if (averageFrameSeconds < 0.018 && this.adaptiveQualityTier > 0 && !this.fastMotionMode) {
      this.recoveryWindows++;
      if (this.recoveryWindows >= 6) {
        this.adaptiveQualityTier = Math.max(0, this.adaptiveQualityTier - 1) as VisualQualityTier;
        this.recoveryWindows = 0;
        this.applyQualityTier();
        this.qualityCooldownSeconds = 5;
      }
    } else {
      this.recoveryWindows = 0;
    }
  }

  private applyQualityTier(): void {
    const tier = this.visualQuality;
    if (this.appliedQualityTier === tier) return;
    this.appliedQualityTier = tier;
    this.directRender = this.mobileSafeMode || tier >= 2;
    const shadows = !this.mobileSafeMode && tier < 2;
    this.renderer.shadowMap.enabled = shadows;
    if (shadows) this.renderer.shadowMap.needsUpdate = true;
    if (this.n8ao) this.n8ao.enabled = !this.multiplayerMode && tier === 0;
    this.setPixelRatio(this.targetPixelRatio(tier));
  }

  private targetPixelRatio(tier: VisualQualityTier): number {
    if (this.mobileSafeMode) return mobileSafePixelRatio(this.maxPixelRatio);
    return visualPixelRatioForTier(tier, this.maxPixelRatio, this.multiplayerMode);
  }

  private setPixelRatio(value: number): void {
    this.pixelRatio = value;
    this.renderer.setPixelRatio(value);
    this.composer?.setSize(window.innerWidth, window.innerHeight);
  }
}

// Subtle warm filmic grade applied through the 3D LUT.
function gradeLut(lut: LookupTexture): void {
  const data = lut.image.data as unknown as Float32Array;
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp01(Math.pow(data[i], 1.04) * 1.06 + 0.012);
    data[i + 1] = clamp01(Math.pow(data[i + 1], 1.03) * 1.02 + 0.008);
    data[i + 2] = clamp01(data[i + 2] * 0.96 + 0.01);
  }
  lut.needsUpdate = true;
}
