// GLB asset pipeline: GLTFLoader wired with Draco mesh decompression and
// KTX2/Basis texture transcoding. Decoder binaries are served from
// /public/libs (copied from three.js by scripts/copy-decoders.mjs).
import type { Group, WebGLRenderer } from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

export class AssetPipeline {
  private readonly gltf: GLTFLoader;
  private readonly draco = new DRACOLoader();
  private readonly ktx2 = new KTX2Loader();

  constructor(renderer: WebGLRenderer) {
    this.draco.setDecoderPath('/libs/draco/gltf/');
    this.ktx2.setTranscoderPath('/libs/basis/');
    this.ktx2.detectSupport(renderer);
    this.gltf = new GLTFLoader();
    this.gltf.setDRACOLoader(this.draco);
    this.gltf.setKTX2Loader(this.ktx2);
  }

  async loadModel(url: string): Promise<Group> {
    const gltf = await this.gltf.loadAsync(url);
    return gltf.scene;
  }

  dispose(): void {
    this.draco.dispose();
    this.ktx2.dispose();
  }
}
