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
  readonly csm: CSM;
  /** direction light travels (from sun toward ground), normalized */
  readonly sunDirection = new Vector3(-0.5, -0.85, -0.32).normalize();

  private readonly composer: EffectComposer;

  constructor(container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: false, stencil: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);

    this.scene = new Scene();
    const skyColor = new Color('#8fb3d6');
    this.scene.background = skyColor;
    this.scene.fog = new Fog(skyColor, 650, 1900);

    this.camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 2, 3000);

    this.scene.add(new HemisphereLight(0xcfe0f2, 0x8a795d, 0.75));

    this.csm = new CSM({
      camera: this.camera,
      parent: this.scene,
      cascades: 3,
      maxFar: 700,
      mode: 'practical',
      shadowMapSize: 2048,
      shadowBias: -0.0002,
      lightDirection: this.sunDirection.clone(),
      lightIntensity: 2.4,
    });
    this.csm.fade = true;

    this.composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    const n8ao = new N8AOPostPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
    n8ao.configuration.aoRadius = 2.2;
    n8ao.configuration.intensity = 2.4;
    n8ao.configuration.distanceFalloff = 4;
    n8ao.setQualityMode('Medium');
    this.composer.addPass(n8ao);

    const lut = LookupTexture.createNeutral(32);
    gradeLut(lut);
    this.composer.addPass(
      new EffectPass(
        this.camera,
        new SMAAEffect({ preset: SMAAPreset.HIGH }),
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

  render(dt: number): void {
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
