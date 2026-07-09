// Animated water plane with a lightweight custom shader: gentle vertex swell,
// procedural wave normals, Blinn specular from the sun, shore fade + foam
// driven by a heightfield texture, manual distance fog to match the scene.
import {
  Color,
  DataTexture,
  Fog,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  RedFormat,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { Heightfield } from '../sim/heightfield';

export interface WaterStyle {
  deepColor?: string;
  shallowColor?: string;
}

const HEIGHT_SCALE = 80;
const HEIGHT_OFFSET = -16;

const VERT = /* glsl */ `
uniform float uTime;
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.y += (sin(wp.x * 0.05 + uTime * 1.1) + sin(wp.z * 0.043 - uTime * 0.9)) * 0.08;
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir; // toward the sun
uniform sampler2D uHeightTex;
uniform float uWaterLevel;
uniform float uHalf;
uniform float uHeightScale;
uniform float uHeightOffset;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying vec3 vWorldPos;

float waveH(vec2 p, float t) {
  return sin(p.x * 0.33 + t * 1.4) + sin(p.y * 0.29 - t * 1.1) + sin((p.x + p.y) * 0.17 + t * 0.6);
}

void main() {
  float e = 0.7;
  float h0 = waveH(vWorldPos.xz, uTime);
  float hx = waveH(vWorldPos.xz + vec2(e, 0.0), uTime);
  float hz = waveH(vWorldPos.xz + vec2(0.0, e), uTime);
  vec3 n = normalize(vec3((h0 - hx) / e * 0.22, 1.0, (h0 - hz) / e * 0.22));
  vec3 viewDir = normalize(cameraPosition - vWorldPos);

  vec2 uv = (vWorldPos.xz + vec2(uHalf)) / (uHalf * 2.0);
  float terrainH = texture2D(uHeightTex, uv).r * uHeightScale + uHeightOffset;
  float depth = clamp(uWaterLevel - terrainH, 0.0, 12.0);
  float deepMix = smoothstep(0.0, 3.0, depth);

  vec3 col = mix(uShallowColor, uDeepColor, deepMix);
  float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
  vec3 hVec = normalize(uSunDir + viewDir);
  float spec = pow(max(dot(n, hVec), 0.0), 120.0);

  float foamBand = 1.0 - smoothstep(0.05, 0.6, depth);
  float foamWave = 0.6 + 0.4 * sin(uTime * 1.7 + (vWorldPos.x + vWorldPos.z) * 0.35);
  col += vec3(0.9) * foamBand * foamWave * 0.35;
  col += vec3(1.0, 0.97, 0.85) * spec * 0.8;

  float alpha = mix(0.42, 0.9, deepMix);
  alpha = clamp(alpha + fres * 0.08 + foamBand * 0.2, 0.0, 0.95);

  float dist = length(cameraPosition - vWorldPos);
  float fogF = smoothstep(uFogNear, uFogFar, dist);
  col = mix(col, uFogColor, fogF);
  gl_FragColor = vec4(col, alpha);
}
`;

export class WaterView {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor(hf: Heightfield, sunDirection: Vector3, fog: Fog, style: WaterStyle = {}) {
    const heightData = new Uint8Array(hf.samples * hf.samples);
    for (let i = 0; i < hf.heights.length; i++) {
      const h01 = (hf.heights[i] - HEIGHT_OFFSET) / HEIGHT_SCALE;
      heightData[i] = Math.max(0, Math.min(255, Math.round(h01 * 255)));
    }
    const heightTex = new DataTexture(heightData, hf.samples, hf.samples, RedFormat);
    heightTex.minFilter = LinearFilter;
    heightTex.magFilter = LinearFilter;
    heightTex.unpackAlignment = 1; // 513-wide single-channel rows are not 4-byte aligned
    heightTex.needsUpdate = true;

    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: sunDirection.clone().negate() },
        uHeightTex: { value: heightTex },
        uWaterLevel: { value: hf.waterLevel },
        uHalf: { value: hf.size / 2 },
        uHeightScale: { value: HEIGHT_SCALE },
        uHeightOffset: { value: HEIGHT_OFFSET },
        uDeepColor: { value: new Color(style.deepColor ?? '#061a24') },
        uShallowColor: { value: new Color(style.shallowColor ?? '#296b6b') },
        uFogColor: { value: fog.color.clone() },
        uFogNear: { value: fog.near },
        uFogFar: { value: fog.far },
      },
    });

    const geometry = new PlaneGeometry(hf.size, hf.size, 96, 96);
    geometry.rotateX(-Math.PI / 2);
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.position.y = hf.waterLevel;
    this.mesh.renderOrder = 5;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
  }

  update(timeSeconds: number): void {
    this.material.uniforms.uTime.value = timeSeconds;
  }

  setDebugOverlay(enabled: boolean): void {
    this.mesh.visible = !enabled;
  }
}
