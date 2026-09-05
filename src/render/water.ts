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
  /** Enables the calmer, layered reservoir treatment used by Highlands. */
  profile?: 'classic' | 'highlands-reservoir';
}

const HEIGHT_SCALE = 80;
const HEIGHT_OFFSET = -16;

const VERT = /* glsl */ `
uniform float uTime;
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
#ifdef HIGHLANDS_RESERVOIR
  wp.y += (sin(wp.x * 0.036 + wp.z * 0.018 + uTime * 0.42) + sin(wp.z * 0.041 - wp.x * 0.012 - uTime * 0.34)) * 0.035;
#else
  wp.y += (sin(wp.x * 0.05 + uTime * 1.1) + sin(wp.z * 0.043 - uTime * 0.9)) * 0.08;
#endif
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
uniform vec3 uSurfaceColor;
uniform vec3 uSedimentColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying vec3 vWorldPos;

float waveH(vec2 p, float t) {
  return sin(p.x * 0.33 + t * 1.4) + sin(p.y * 0.29 - t * 1.1) + sin((p.x + p.y) * 0.17 + t * 0.6);
}

void main() {
#ifdef HIGHLANDS_RESERVOIR
  // Two broad crossing wave trains give a calm inland-water surface while
  // providing the normal analytically. This is cheaper than sampling waveH
  // three times as the classic profile does below.
  vec2 p = vWorldPos.xz;
  vec2 dirA = normalize(vec2(0.84, 0.54));
  vec2 dirB = normalize(vec2(-0.43, 0.90));
  float phaseA = dot(p, dirA) * 0.082 + uTime * 0.48;
  float phaseB = dot(p, dirB) * 0.057 - uTime * 0.31;
  float phaseC = dot(p, vec2(0.71, -0.70)) * 0.19 + uTime * 0.72;
  float waveA = sin(phaseA);
  float waveB = sin(phaseB);
  float waveC = sin(phaseC);
  vec2 slope = dirA * cos(phaseA) * 0.055
    + dirB * cos(phaseB) * 0.038
    + vec2(0.71, -0.70) * cos(phaseC) * 0.018;
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
#else
  float e = 0.7;
  float h0 = waveH(vWorldPos.xz, uTime);
  float hx = waveH(vWorldPos.xz + vec2(e, 0.0), uTime);
  float hz = waveH(vWorldPos.xz + vec2(0.0, e), uTime);
  vec3 n = normalize(vec3((h0 - hx) / e * 0.22, 1.0, (h0 - hz) / e * 0.22));
#endif
  vec3 viewDir = normalize(cameraPosition - vWorldPos);

  vec2 uv = (vWorldPos.xz + vec2(uHalf)) / (uHalf * 2.0);
  float terrainH = texture2D(uHeightTex, uv).r * uHeightScale + uHeightOffset;
  float rawDepth = uWaterLevel - terrainH;
  // The water mesh spans the map for lakes and coastlines, but dry terrain
  // must not reveal it as a second floating sheet when viewed from the side.
  if (rawDepth <= 0.04) discard;
  float depth = clamp(rawDepth, 0.0, 12.0);

#ifdef HIGHLANDS_RESERVOIR
  float shoreBreakup = waveA * 0.13 + waveB * 0.09 + waveC * 0.035;
  float sedimentMix = 1.0 - smoothstep(0.06 + shoreBreakup, 0.42 + shoreBreakup, depth);
  float deepMix = smoothstep(0.12, 1.72, depth);
  vec3 col = mix(uShallowColor, uDeepColor, deepMix);
  col = mix(col, uSedimentColor, sedimentMix * 0.28);
  col *= 0.94 + waveA * 0.035 + waveB * 0.022 + waveC * 0.012;
#else
  float deepMix = smoothstep(0.0, 3.0, depth);
  vec3 col = mix(uShallowColor, uDeepColor, deepMix);
#endif

  float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
  vec3 hVec = normalize(uSunDir + viewDir);

#ifdef HIGHLANDS_RESERVOIR
  float broadSpec = pow(max(dot(n, hVec), 0.0), 28.0);
  float tightSpec = pow(max(dot(n, hVec), 0.0), 150.0);
  float brokenEdge = smoothstep(0.0, 0.55, depth + shoreBreakup);
  float wetEdge = (1.0 - smoothstep(0.05, 0.48, depth)) * brokenEdge;
  col = mix(col, uSurfaceColor, 0.055 + fres * 0.26);
  col += vec3(1.0, 0.91, 0.72) * (broadSpec * 0.14 + tightSpec * 0.38);
  col += uShallowColor * wetEdge * 0.10;

  // Deeper water remains opaque enough to read as a body of water while the
  // shallow shelf reveals some of the terrain colour underneath.
  float alpha = mix(0.70, 0.94, smoothstep(0.14, 2.8, depth));
  alpha = clamp(alpha + fres * 0.05, 0.0, 0.95);
#else
  float spec = pow(max(dot(n, hVec), 0.0), 120.0);

  float foamBand = 1.0 - smoothstep(0.05, 0.6, depth);
  float foamWave = 0.6 + 0.4 * sin(uTime * 1.7 + (vWorldPos.x + vWorldPos.z) * 0.35);
  col += vec3(0.9) * foamBand * foamWave * 0.35;
  col += vec3(1.0, 0.97, 0.85) * spec * 0.8;

  float alpha = mix(0.42, 0.9, deepMix);
  alpha = clamp(alpha + fres * 0.08 + foamBand * 0.2, 0.0, 0.95);
#endif

  float dist = length(cameraPosition - vWorldPos);
  float fogF = smoothstep(uFogNear, uFogFar, dist);
  col = mix(col, uFogColor, fogF);
  gl_FragColor = vec4(col, alpha);
#ifdef HIGHLANDS_RESERVOIR
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
#endif
}
`;

export class WaterView {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor(hf: Heightfield, sunDirection: Vector3, fog: Fog, style: WaterStyle = {}) {
    const reservoirProfile = style.profile === 'highlands-reservoir';
    // Keep this as an R8 texture. Three maps RedFormat + UnsignedShortType to
    // an unsized RED internal format, which is invalid with WebGL2 texStorage2D.
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
      ...(reservoirProfile ? { defines: { HIGHLANDS_RESERVOIR: 1 } } : {}),
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
        uSurfaceColor: { value: new Color('#4b7883') },
        uSedimentColor: { value: new Color('#77705a') },
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

  update(timeSeconds: number, fog?: Fog): void {
    this.material.uniforms.uTime.value = timeSeconds;
    if (fog) {
      this.material.uniforms.uFogColor.value.copy(fog.color);
      this.material.uniforms.uFogNear.value = fog.near;
      this.material.uniforms.uFogFar.value = fog.far;
    }
  }

  refreshAtmosphere(sunDirection: Vector3, fog?: Fog): void {
    this.material.uniforms.uSunDir.value.copy(sunDirection).negate();
    if (fog) {
      this.material.uniforms.uFogColor.value.copy(fog.color);
      this.material.uniforms.uFogNear.value = fog.near;
      this.material.uniforms.uFogFar.value = fog.far;
    }
  }

  setDebugOverlay(enabled: boolean): void {
    this.mesh.visible = !enabled;
  }
}
