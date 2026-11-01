import * as THREE from 'three';

/** Retain the existing padded body proxy, expanding only for real ornament
 * geometry. Local bounds preserve the rear clearance reserved for centre lots. */
export class BuildingPickBounds {
  private bounds = new THREE.Box3();
  private part = new THREE.Box3();
  private frame = new THREE.Matrix4();
  private inverseFrame = new THREE.Matrix4();
  private localPlacement = new THREE.Matrix4();
  private position = new THREE.Vector3();
  private size = new THREE.Vector3();
  private rotation = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);

  reset(x: number, z: number, yaw: number): void {
    this.bounds.makeEmpty();
    this.rotation.setFromAxisAngle(this.up, yaw);
    this.frame.compose(this.position.set(x, 0, z), this.rotation, this.size.set(1, 1, 1));
    this.inverseFrame.copy(this.frame).invert();
  }

  include(geometry: THREE.BufferGeometry, worldPlacement: THREE.Matrix4): void {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    this.localPlacement.multiplyMatrices(this.inverseFrame, worldPlacement);
    this.part.copy(geometry.boundingBox!).applyMatrix4(this.localPlacement);
    this.bounds.union(this.part);
  }

  includeBody(width: number, depth: number, extension: number, height: number): void {
    this.part.min.set(-width / 2, 0, -depth / 2 - extension);
    this.part.max.set(width / 2, height, depth / 2);
    this.bounds.union(this.part);
  }

  writeTransform(target: THREE.Object3D): void {
    this.bounds.getSize(this.size);
    this.bounds.getCenter(this.position);
    // slabGeometry is based at y=0, rather than vertically centred.
    this.position.y = this.bounds.min.y;
    this.position.applyMatrix4(this.frame);
    target.position.copy(this.position);
    target.quaternion.copy(this.rotation);
    target.scale.copy(this.size);
    target.updateMatrix();
  }
}
