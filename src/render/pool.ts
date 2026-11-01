/**
 * A thin wrapper over InstancedMesh that makes rebuilding the city each frame
 * a matter of `reset()`, a run of `push()` calls and `commit()`. Every visual
 * layer in the renderer is one of these, which is what keeps the draw call
 * count in the low tens for a city of two thousand buildings.
 */

import * as THREE from 'three';

export interface PoolOptions {
  /** Allocate a per-instance colour attribute. */
  color?: boolean;
  /** Allocate a per-instance UV transform (scale.xy, offset.xy). */
  uv?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Instances move every frame. */
  dynamic?: boolean;
  /** Allocate a per-instance walk phase and amplitude for the stride shader. */
  walk?: boolean;
}

export interface PoolSnapshot {
  count: number;
  matrices: Float32Array;
  colors: Float32Array | null;
  uv: Float32Array | null;
  walk: Float32Array | null;
}

/** A retained GPU variant. Geometry/instance attributes are owned; materials stay
 * with the source pool so lighting, clipping and texture ownership stay shared. */
export class PoolView {
  readonly mesh: THREE.InstancedMesh;
  private disposed = false;
  constructor(source: THREE.InstancedMesh, snapshot: PoolSnapshot) {
    const geometry = source.geometry.clone();
    this.mesh = new THREE.InstancedMesh(geometry, source.material, Math.max(1, snapshot.count));
    this.mesh.instanceMatrix.array.set(snapshot.matrices);
    if (snapshot.colors) this.mesh.instanceColor = new THREE.InstancedBufferAttribute(snapshot.colors.slice(), 3);
    if (snapshot.uv) geometry.setAttribute('aUvXform', new THREE.InstancedBufferAttribute(snapshot.uv.slice(), 4));
    if (snapshot.walk) geometry.setAttribute('aWalk', new THREE.InstancedBufferAttribute(snapshot.walk.slice(), 2));
    this.mesh.count = snapshot.count;
    this.mesh.castShadow = source.castShadow;
    this.mesh.receiveShadow = source.receiveShadow;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.raycast = () => {};
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.mesh.geometry.dispose();
  }
}

export class InstancePool {
  readonly mesh: THREE.InstancedMesh;
  readonly capacity: number;
  private uvAttr: THREE.InstancedBufferAttribute | null = null;
  private walkAttr: THREE.InstancedBufferAttribute | null = null;
  private n = 0;
  private disposed = false;
  private white = new THREE.Color(1, 1, 1);
  private tint = new THREE.Color();

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    capacity: number,
    opts: PoolOptions = {},
  ) {
    this.capacity = Math.max(1, capacity);
    const geo = opts.uv || opts.walk ? geometry.clone() : geometry;
    if (opts.uv) {
      this.uvAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4);
      this.uvAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aUvXform', this.uvAttr);
    }
    if (opts.walk) {
      this.walkAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 2), 2);
      this.walkAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aWalk', this.walkAttr);
    }
    this.mesh = new THREE.InstancedMesh(geo, material, this.capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = opts.castShadow ?? false;
    this.mesh.receiveShadow = opts.receiveShadow ?? false;
    this.mesh.instanceMatrix.setUsage(opts.dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
    if (opts.color) {
      // Force the colour buffer into existence so the shader never recompiles
      // half way through a session.
      this.mesh.setColorAt(0, this.white);
      this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    }
    // Decoration never takes part in picking; the renderer keeps a dedicated
    // proxy for that so clicking a spire still selects the church.
    this.mesh.raycast = () => {};
  }

  get count(): number {
    return this.n;
  }

  reset(): void {
    this.n = 0;
  }

  /** Returns the index used, or -1 when the pool is full. */
  push(matrix: THREE.Matrix4, color?: THREE.Color, uv?: THREE.Vector4, walk?: THREE.Vector2): number {
    if (this.n >= this.capacity) return -1;
    const i = this.n++;
    this.mesh.setMatrixAt(i, matrix);
    if (this.mesh.instanceColor) this.mesh.setColorAt(i, color ?? this.white);
    if (this.uvAttr && uv) this.uvAttr.setXYZW(i, uv.x, uv.y, uv.z, uv.w);
    if (this.walkAttr && walk) this.walkAttr.setXY(i, walk.x, walk.y);
    return i;
  }

  commit(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.uvAttr) this.uvAttr.needsUpdate = true;
    if (this.walkAttr) this.walkAttr.needsUpdate = true;
  }

  /** Tint an already-built site's instances without allocating another draw layer. */
  tintFrom(start: number, color: THREE.Color, amount: number): void {
    if (!this.mesh.instanceColor) return;
    for (let i = start; i < this.n; i++) {
      this.mesh.getColorAt(i, this.tint);
      this.mesh.setColorAt(i, this.tint.lerp(color, amount));
    }
  }

  /** CPU-only view variants share this mesh, its geometry and its materials. */
  snapshot(): PoolSnapshot {
    return {
      count: this.n,
      matrices: new Float32Array(this.mesh.instanceMatrix.array.slice(0, this.n * 16)),
      colors: this.mesh.instanceColor ? new Float32Array(this.mesh.instanceColor.array.slice(0, this.n * 3)) : null,
      uv: this.uvAttr ? new Float32Array(this.uvAttr.array.slice(0, this.n * 4)) : null,
      walk: this.walkAttr ? new Float32Array(this.walkAttr.array.slice(0, this.n * 2)) : null,
    };
  }

  restore(snapshot: PoolSnapshot): void {
    this.n = snapshot.count;
    this.mesh.instanceMatrix.array.set(snapshot.matrices);
    if (snapshot.colors && this.mesh.instanceColor) this.mesh.instanceColor.array.set(snapshot.colors);
    if (snapshot.uv && this.uvAttr) this.uvAttr.array.set(snapshot.uv);
    if (snapshot.walk && this.walkAttr) this.walkAttr.array.set(snapshot.walk);
    this.mesh.boundingSphere = null;
    this.mesh.boundingBox = null;
    this.commit();
  }

  /** Re-enable raycasting; used only by the picking proxy. */
  makePickable(): void {
    this.mesh.raycast = THREE.InstancedMesh.prototype.raycast;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Instanced attributes belong to the mesh, not its BufferGeometry.
    this.mesh.dispose();
    this.mesh.geometry.dispose();
    const m = this.mesh.material;
    if (Array.isArray(m)) for (const mm of m) mm.dispose();
    else m.dispose();
  }
}
