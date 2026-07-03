declare module 'n8ao' {
  import type { Camera, Color, Scene } from 'three';
  import { Pass } from 'postprocessing';

  export type N8AOQualityMode = 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra';
  export type N8AODisplayMode = 'Combined' | 'AO' | 'No AO' | 'Split' | 'Split AO';

  export interface N8AOConfiguration {
    aoSamples: number;
    aoRadius: number;
    aoTones: number;
    denoiseSamples: number;
    denoiseRadius: number;
    distanceFalloff: number;
    intensity: number;
    denoiseIterations: number;
    renderMode: number;
    biasOffset: number;
    biasMultiplier: number;
    color: Color;
    gammaCorrection: boolean;
    depthBufferType: number;
    screenSpaceRadius: boolean;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    colorMultiply: boolean;
    transparencyAware: boolean;
    accumulate: boolean;
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width: number, height: number);

    configuration: N8AOConfiguration;
    setQualityMode(mode: N8AOQualityMode): void;
    setDisplayMode(mode: N8AODisplayMode): void;
    enableDebugMode(): void;
    disableDebugMode(): void;
  }
}
