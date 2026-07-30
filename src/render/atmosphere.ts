import {
  BackSide,
  type Camera,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Fog,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  ShaderMaterial,
  SphereGeometry,
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
  mesh: InstancedMesh;
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
      const angle = rng() * Math.PI * 2;
      const distance = central ? 0 : radiusX * lerp(0.18, 0.58, Math.sqrt(rng()));
      puffs.push({
        offsetX: Math.cos(angle) * distance,
        offsetY: (rng() * 2 - 1) * thickness * (central ? 0.08 : 0.28),
        offsetZ: Math.sin(angle) * distance * (radiusZ / radiusX),
        scaleX: radiusX * lerp(central ? 0.42 : 0.24, central ? 0.56 : 0.42, rng()),
        scaleY: thickness * lerp(central ? 0.72 : 0.5, central ? 1.02 : 0.9, rng()),
        scaleZ: radiusZ * lerp(central ? 0.38 : 0.22, central ? 0.52 : 0.4, rng()),
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
  private readonly dummy = new Object3D();
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
    this.group.add(this.highLayer.mesh, this.lowLayer.mesh);

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
    const geometry = this.style.cloudSoftness >= 0.75
      ? new SphereGeometry(1, 14, 10)
      : new IcosahedronGeometry(1, 2);
    const colour = new Color(this.style.cloudLight).lerp(new Color(this.style.cloudShade), speed > 0.8 ? 0.2 : 0.1);
    const material = new MeshLambertMaterial({
      color: colour,
      transparent: true,
      opacity,
      depthWrite: false,
      side: DoubleSide,
      flatShading: this.style.cloudSoftness < 0.6,
      fog: true,
    });
    const mesh = new InstancedMesh(geometry, material, Math.max(1, puffCount));
    mesh.count = puffCount;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = speed > 0.8 ? 3 : 2;
    return { mesh, clusters, puffCount, speed };
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
        this.dummy.position.set(center.x + puff.offsetX, cluster.y + puff.offsetY, center.z + puff.offsetZ);
        this.dummy.scale.set(puff.scaleX, puff.scaleY, puff.scaleZ);
        this.dummy.rotation.set(0, (instance * 1.618) % Math.PI, 0);
        this.dummy.updateMatrix();
        layer.mesh.setMatrixAt(instance++, this.dummy.matrix);
      }
    }
    if (layer.puffCount > 0) layer.mesh.instanceMatrix.needsUpdate = true;
  }

  private driftedCenter(cluster: CloudClusterLayout, timeSeconds: number, speed: number): { x: number; z: number } {
    return {
      x: wrap(cluster.x + this.style.cloudWindX * speed * timeSeconds, this.wrapExtent),
      z: wrap(cluster.z + this.style.cloudWindZ * speed * timeSeconds, this.wrapExtent),
    };
  }
}

function wrap(value: number, extent: number): number {
  const width = extent * 2;
  return ((((value + extent) % width) + width) % width) - extent;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
