import { Frustum, Matrix4, Sphere, type Camera, type Object3D } from 'three';

/** Coarse entity bounds avoid traversing hundreds of off-screen child meshes.
 * The generous margin retains nearby shadow casters and edge-of-screen FX.
 */
export class BattlefieldCulling {
  private readonly frustum = new Frustum();
  private readonly matrix = new Matrix4();
  private readonly sphere = new Sphere();

  update(camera: Camera): void {
    camera.updateMatrixWorld();
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix);
  }

  contains(x: number, y: number, z: number, radius: number): boolean {
    this.sphere.center.set(x, y, z);
    this.sphere.radius = radius + 48;
    return this.frustum.intersectsSphere(this.sphere);
  }
}

/** Detach culled model trees: Three updates matrices even for invisible roots. */
export function setEntityRenderActive(root: Object3D, parent: Object3D, active: boolean): void {
  root.visible = active;
  if (active) {
    if (root.parent !== parent) parent.add(root);
  } else if (root.parent === parent) {
    parent.remove(root);
  }
}
