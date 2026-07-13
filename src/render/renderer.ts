// Owns the WebGL renderer, scene, camera, day-lighting rig (hemisphere +
// cascaded-shadow-map sun) and the postprocessing chain (SSAO, SMAA, bloom,
// color-grading LUT, vignette).
import {
  ACESFilmicToneMapping,
  Color,
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

export class RenderContext {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly hemisphere: HemisphereLight;
  readonly csm: CSM;
  /** direction light travels (from sun toward ground), normalized */
  readonly sunDirection = new Vector3(-0.5, -0.85, -0.32).normalize();

  private readonly composer: EffectComposer;
  private readonly n8ao: N8AOPostPass;
  private readonly maxPixelRatio: number;
  private readonly multiplayerMode: boolean;
  private pixelRatio: number;
  private qualitySampleSeconds = 0;
  private qualityFrameCount = 0;
  // Map construction and the first shader compilation can briefly spike frame time.
  // Give those one-off costs time to settle before adapting persistent quality.
  private qualityCooldownSeconds: number;
  private fastMotionMode = false;

  constructor(container: HTMLElement, options: { multiplayer?: boolean } = {}) {
    this.multiplayerMode = options.multiplayer === true;
    this.renderer = new WebGLRenderer({ antialias: false, stencil: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    // Multiplayer commonly runs beside voice chat and sometimes a second test
    // browser. Start slightly leaner there, then let adaptive quality recover.
    this.maxPixelRatio = Math.min(window.devicePixelRatio, this.multiplayerMode ? 0.9 : 1.25);
    this.pixelRatio = this.maxPixelRatio;
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

    window.addEventListener('resize', () => this.onResize());
  }

  /** Patch a lit material for cascaded shadow maps. All lit scene materials must go through this. */
  setupLitMaterial<T extends Material>(material: T): T {
    this.csm.setupMaterial(material);
    return material;
  }

  get maxAnisotropy(): number {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  get renderScale(): number {
    return this.pixelRatio;
  }

  setFastMotionMode(active: boolean): void {
    if (this.fastMotionMode === active) return;
    this.fastMotionMode = active;
    this.qualitySampleSeconds = 0;
    this.qualityFrameCount = 0;
    if (active) {
      this.n8ao.enabled = false;
      if (this.pixelRatio > 0.8) this.setPixelRatio(0.8);
      return;
    }
    this.qualityCooldownSeconds = 2;
  }

  render(dt: number): void {
    this.updateAdaptiveQuality(dt);
    this.renderer.info.reset();
    this.csm.update();
    this.composer.render(dt);
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.csm.updateFrustums();
    this.composer.setSize(w, h);
  }

  /** Keep the full visual stack while it fits, then reduce GPU fill-rate only under sustained pressure. */
  private updateAdaptiveQuality(dt: number): void {
    if (this.fastMotionMode) return;
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) return;
    if (this.qualityCooldownSeconds > 0) {
      this.qualityCooldownSeconds = Math.max(0, this.qualityCooldownSeconds - dt);
      this.qualitySampleSeconds = 0;
      this.qualityFrameCount = 0;
      return;
    }
    this.qualitySampleSeconds += dt;
    this.qualityFrameCount++;
    if (this.qualitySampleSeconds < 0.75) return;

    const averageFrameSeconds = this.qualitySampleSeconds / Math.max(1, this.qualityFrameCount);
    this.qualitySampleSeconds = 0;
    this.qualityFrameCount = 0;
    if (averageFrameSeconds > 0.025) {
      if (averageFrameSeconds > 0.04 && this.n8ao.enabled) this.n8ao.enabled = false;
      else if (this.pixelRatio > 0.71) this.setPixelRatio(Math.max(0.7, this.pixelRatio - 0.18));
      else if (this.n8ao.enabled) this.n8ao.enabled = false;
      else return;
      this.qualityCooldownSeconds = 1.5;
      return;
    }
    if (averageFrameSeconds < 0.019) {
      if (!this.n8ao.enabled && !this.multiplayerMode) this.n8ao.enabled = true;
      else if (this.pixelRatio < this.maxPixelRatio - 0.01) this.setPixelRatio(Math.min(this.maxPixelRatio, this.pixelRatio + 0.1));
      else return;
      this.qualityCooldownSeconds = 4;
    }
  }

  private setPixelRatio(value: number): void {
    this.pixelRatio = value;
    this.renderer.setPixelRatio(value);
    this.composer.setSize(window.innerWidth, window.innerHeight);
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
