import {
  BackSide,
  type Camera,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  Fog,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { CloudLayerPreset, MapAtmosphere } from '../content/maps';
import { mulberry32 } from '../sim/noise';
import type { Heightfield } from '../sim/heightfield';

export interface CloudPuffLayout {
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

export interface CloudClusterLayout {
  x: number;
  y: number;
  z: number;
  radiusX: number;
  radiusZ: number;
  thickness: number;
  puffs: CloudPuffLayout[];
}

interface CloudLayerView {
  group: Group;
  sprites: Sprite[];
  clusters: CloudClusterLayout[];
  puffCount: number;
  speed: number;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDirection;
uniform float uSunStrength;
varying vec3 vDirection;
void main() {
  vec3 direction = normalize(vDirection);
  float heightMix = pow(smoothstep(-0.08, 0.82, direction.y), 0.72);
  vec3 colour = mix(uHorizon, uZenith, heightMix);
  float facingSun = max(dot(direction, normalize(uSunDirection)), 0.0);
  float halo = pow(facingSun, 9.0) * 0.24 * uSunStrength;
  float disc = pow(facingSun, 320.0) * 1.4 * uSunStrength;
  colour += uSunColor * (halo + disc);
  gl_FragColor = vec4(colour, 1.0);
}
`;

/**
 * Produces stable cloud banks for a map seed. Layout is rendering-only and is
 * deliberately independent from the deterministic combat simulation.
 */
export function createCloudLayout(
  mapSize: number,
  seed: number,
  preset: CloudLayerPreset,
  salt: number,
  densityScale = 1,
): CloudClusterLayout[] {
  const clusterCount = Math.max(0, Math.round(preset.clusters * densityScale));
  const puffsPerCluster = Math.max(3, Math.round(preset.puffsPerCluster * Math.max(0.65, densityScale)));
  const half = mapSize / 2;
  const rng = mulberry32((seed ^ salt) >>> 0);
  const clusters: CloudClusterLayout[] = [];

  for (let clusterIndex = 0; clusterIndex < clusterCount; clusterIndex++) {
    const radiusX = lerp(preset.radiusMin, preset.radiusMax, rng());
    const radiusZ = radiusX * lerp(0.68, 1.08, rng());
    const thickness = lerp(preset.thicknessMin, preset.thicknessMax, rng());
    const puffs: CloudPuffLayout[] = [];
    for (let puffIndex = 0; puffIndex < puffsPerCluster; puffIndex++) {
      const central = puffIndex === 0;
      const inner = !central && puffIndex < Math.max(3, Math.ceil(puffsPerCluster * 0.42));
      const angle = rng() * Math.PI * 2;
      const distance = central
        ? 0
        : radiusX * lerp(inner ? 0.08 : 0.24, inner ? 0.32 : 0.64, Math.sqrt(rng()));
      puffs.push({
        offsetX: Math.cos(angle) * distance,
        offsetY: central
          ? thickness * lerp(0.12, 0.28, rng())
          : inner
            ? thickness * lerp(0.02, 0.3, rng())
            : thickness * lerp(-0.24, 0.08, rng()),
        offsetZ: Math.sin(angle) * distance * (radiusZ / radiusX),
        scaleX: radiusX * lerp(central ? 0.32 : inner ? 0.24 : 0.18, central ? 0.46 : inner ? 0.38 : 0.31, rng()),
        scaleY: thickness * lerp(central ? 1.15 : inner ? 0.88 : 0.58, central ? 1.62 : inner ? 1.38 : 1.02, rng()),
        scaleZ: radiusZ * lerp(central ? 0.3 : inner ? 0.22 : 0.17, central ? 0.44 : inner ? 0.36 : 0.3, rng()),
      });
    }
    clusters.push({
      x: (rng() * 2 - 1) * half,
      y: lerp(preset.altitudeMin, preset.altitudeMax, rng()),
      z: (rng() * 2 - 1) * half,
      radiusX,
      radiusZ,
      thickness,
      puffs,
    });
  }
  return clusters;
}

export class BattlefieldAtmosphere {
  readonly group = new Group();
  readonly lowClouds: CloudClusterLayout[];
  readonly highClouds: CloudClusterLayout[];

  private readonly sky: Mesh;
  private readonly haze: Mesh;
  private readonly hazeMaterial: MeshBasicMaterial;
  private readonly lowLayer: CloudLayerView;
  private readonly highLayer: CloudLayerView;
  private readonly wrapExtent: number;
  private readonly baseFogColor: Color;
  private readonly cloudFogColor: Color;
  private readonly baseFogNear: number;
  private readonly baseFogFar: number;
  private lastCloudUpdate = Number.NEGATIVE_INFINITY;

  constructor(
    hf: Heightfield,
    private readonly style: MapAtmosphere,
    seed: number,
    sunDirection: Vector3,
    densityScale = 1,
  ) {
    this.wrapExtent = hf.size / 2 + Math.max(style.highClouds.radiusMax, style.lowClouds.radiusMax) * 1.4;
    this.baseFogColor = new Color(style.sky);
    this.cloudFogColor = new Color(style.cloudLight).lerp(new Color(style.cloudShade), 0.42);
    this.baseFogNear = style.fogNear;
    this.baseFogFar = style.fogFar;

    const skyMaterial = new ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      uniforms: {
        uZenith: { value: new Color(style.skyZenith) },
        uHorizon: { value: new Color(style.skyHorizon) },
        uSunColor: { value: new Color(style.sunGlow) },
        uSunDirection: { value: sunDirection.clone().negate() },
        uSunStrength: { value: style.sunStrength },
      },
    });
    this.sky = new Mesh(new SphereGeometry(1800, 32, 20), skyMaterial);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.group.add(this.sky);

    this.lowClouds = createCloudLayout(hf.size, seed, style.lowClouds, 0x10c10d, densityScale);
    this.highClouds = createCloudLayout(hf.size, seed, style.highClouds, 0x71a9c1, densityScale);
    this.lowLayer = this.createLayer(this.lowClouds, style.lowClouds.opacity, 1);
    this.highLayer = this.createLayer(this.highClouds, style.highClouds.opacity, 0.56);
    this.group.add(this.highLayer.group, this.lowLayer.group);

    this.hazeMaterial = new MeshBasicMaterial({
      color: this.cloudFogColor,
      transparent: true,
      opacity: 0,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.haze = new Mesh(new SphereGeometry(18, 12, 8), this.hazeMaterial);
    this.haze.visible = false;
    this.haze.frustumCulled = false;
    this.haze.renderOrder = 1000;
    this.group.add(this.haze);

    this.updateCloudMatrices(0);
  }

  update(timeSeconds: number, camera: Camera, fog: Fog, immersiveFlight: boolean): void {
    this.sky.position.copy(camera.position);
    this.haze.position.copy(camera.position);
    if (timeSeconds - this.lastCloudUpdate >= 1 / 15 || timeSeconds < this.lastCloudUpdate) {
      this.updateCloudMatrices(timeSeconds);
      this.lastCloudUpdate = timeSeconds;
    }

    const density = immersiveFlight ? this.lowCloudDensityAt(camera.position, timeSeconds) : 0;
    const fogMix = Math.min(0.9, density * 0.95);
    fog.color.copy(this.baseFogColor).lerp(this.cloudFogColor, fogMix * 0.82);
    fog.near = lerp(this.baseFogNear, 3.5, fogMix);
    fog.far = lerp(this.baseFogFar, 72, fogMix);
    this.hazeMaterial.opacity = density * 0.15;
    this.haze.visible = this.hazeMaterial.opacity > 0.004;
  }

  lowCloudDensityAt(position: Vector3, timeSeconds: number): number {
    let density = 0;
    for (const cluster of this.lowClouds) {
      const center = this.driftedCenter(cluster, timeSeconds, this.lowLayer.speed);
      const dx = (position.x - center.x) / Math.max(1, cluster.radiusX * 0.72);
      const dy = (position.y - cluster.y) / Math.max(1, cluster.thickness * 1.1);
      const dz = (position.z - center.z) / Math.max(1, cluster.radiusZ * 0.72);
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance < 1) density = Math.max(density, (1 - distance) * this.style.lowClouds.opacity);
    }
    return Math.min(1, density);
  }

  private createLayer(clusters: CloudClusterLayout[], opacity: number, speed: number): CloudLayerView {
    const puffCount = clusters.reduce((total, cluster) => total + cluster.puffs.length, 0);
    const visualOpacity = Math.min(0.64, 0.16 + opacity * 0.72);
    const texture = createCloudTexture(
      new Color(this.style.cloudLight),
      new Color(this.style.cloudShade),
      this.style.cloudSoftness,
    );
    const tint = new Color('#ffffff').lerp(
      new Color(this.style.skyHorizon),
      speed > 0.8 ? 0.05 : 0.1,
    );
    const material = new SpriteMaterial({
      map: texture,
      color: tint,
      transparent: true,
      opacity: visualOpacity,
      depthWrite: false,
      fog: true,
      toneMapped: false,
      alphaTest: 0.008,
    });
    const group = new Group();
    const sprites: Sprite[] = [];
    for (const cluster of clusters) {
      for (const puff of cluster.puffs) {
        const sprite = new Sprite(material);
        sprite.scale.set(
          (puff.scaleX + puff.scaleZ) * 1.38,
          puff.scaleY * 2.05,
          1,
        );
        sprite.renderOrder = speed > 0.8 ? 3 : 2;
        sprite.frustumCulled = false;
        sprites.push(sprite);
        group.add(sprite);
      }
    }
    return { group, sprites, clusters, puffCount, speed };
  }

  private updateCloudMatrices(timeSeconds: number): void {
    this.updateLayerMatrices(this.highLayer, timeSeconds);
    this.updateLayerMatrices(this.lowLayer, timeSeconds);
  }

  private updateLayerMatrices(layer: CloudLayerView, timeSeconds: number): void {
    let instance = 0;
    for (const cluster of layer.clusters) {
      const center = this.driftedCenter(cluster, timeSeconds, layer.speed);
      for (const puff of cluster.puffs) {
        layer.sprites[instance++].position.set(
          center.x + puff.offsetX,
          cluster.y + puff.offsetY,
          center.z + puff.offsetZ,
        );
      }
    }
  }

  private driftedCenter(cluster: CloudClusterLayout, timeSeconds: number, speed: number): { x: number; z: number } {
    return {
      x: wrap(cluster.x + this.style.cloudWindX * speed * timeSeconds, this.wrapExtent),
      z: wrap(cluster.z + this.style.cloudWindZ * speed * timeSeconds, this.wrapExtent),
    };
  }
}

function createCloudTexture(light: Color, shade: Color, softness: number): CanvasTexture {
  const width = 256;
  const height = 128;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas is required for cloud rendering');
  const image = context.createImageData(width, height);
  const lightSrgb = light.clone().convertLinearToSRGB();
  const shadeSrgb = shade.clone().lerp(light, softness * 0.28).convertLinearToSRGB();
  const blobs = [
    { x: 0.5, y: 0.48, rx: 0.3, ry: 0.34, strength: 1 },
    { x: 0.3, y: 0.58, rx: 0.24, ry: 0.25, strength: 0.88 },
    { x: 0.7, y: 0.59, rx: 0.25, ry: 0.24, strength: 0.9 },
    { x: 0.42, y: 0.34, rx: 0.2, ry: 0.24, strength: 0.82 },
    { x: 0.62, y: 0.36, rx: 0.18, ry: 0.21, strength: 0.78 },
  ];

  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      let density = 0;
      for (const blob of blobs) {
        const dx = (u - blob.x) / blob.rx;
        const dy = (v - blob.y) / blob.ry;
        const contribution = Math.exp(-(dx * dx + dy * dy) * 2.15) * blob.strength;
        density = 1 - (1 - density) * (1 - Math.min(0.96, contribution));
      }
      const textureNoise =
        Math.sin(u * 71 + v * 37) * 0.035 +
        Math.sin(u * 131 - v * 83) * 0.022;
      const edge = smoothstep(0.08, 0.68, density + textureNoise);
      const verticalFade = smoothstep(0.98, 0.7, v) * smoothstep(0.02, 0.2, v);
      const alpha = Math.pow(edge * verticalFade, lerp(1.32, 0.92, softness));
      const sunMix = smoothstep(0.82, 0.12, v) * 0.78 + 0.18;
      const index = (y * width + x) * 4;
      image.data[index] = Math.round(lerp(shadeSrgb.r, lightSrgb.r, sunMix) * 255);
      image.data[index + 1] = Math.round(lerp(shadeSrgb.g, lightSrgb.g, sunMix) * 255);
      image.data[index + 2] = Math.round(lerp(shadeSrgb.b, lightSrgb.b, sunMix) * 255);
      image.data[index + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function wrap(value: number, extent: number): number {
  const width = extent * 2;
  return ((((value + extent) % width) + width) % width) - extent;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
