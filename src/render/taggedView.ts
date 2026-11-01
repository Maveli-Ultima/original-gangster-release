import * as THREE from 'three';
import type { ID } from '../sim/types';
import { taggedViewSide } from './viewModes';

export interface TaggedViewRect {
  personId: ID;
  mode: 'street' | 'roof';
  x: number;
  y: number;
  width: number;
  height: number;
  clipTop: number;
  clipBottom: number;
  clipLeft?: number;
  clipRight?: number;
}

/** Check the visible body, not only its centre: a wall can hide a car's edge. */
export function actorSightlineHits(ray: THREE.Raycaster, target: THREE.Vector3, direction: THREE.Vector3,
  radius: number, buildings: THREE.InstancedMesh): THREE.Intersection[] {
  const hits: THREE.Intersection[] = [];
  const origin = new THREE.Vector3();
  for (const [across, down] of [[0, 0], [-radius, 0], [radius, 0], [0, -.75]]) {
    origin.copy(target).add(new THREE.Vector3(across * Math.SQRT1_2, down, -across * Math.SQRT1_2));
    ray.set(origin, direction); ray.far = 100;
    ray.intersectObject(buildings, false, hits);
  }
  return hits;
}

/** Shares the scene and all GPU assets; only the camera is independent. */
export class TaggedView {
  readonly camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 1600);
  readonly target = new THREE.Vector3();
  rect: TaggedViewRect | null = null;
  side: 1 | -1 = 1;
  obscured = false;
  private ray = new THREE.Raycaster();
  private direction = new THREE.Vector3();
  private lastCheck = new THREE.Vector3(Infinity, Infinity, Infinity);
  private revision = -1;
  private radius = -1;

  set(rect: TaggedViewRect | null, mainFlipped: boolean): void {
    if (rect?.personId !== this.rect?.personId) {
      this.side = mainFlipped ? -1 : 1;
      this.lastCheck.set(Infinity, Infinity, Infinity);
    }
    this.rect = rect && rect.width > 0 && rect.height > 0 ? rect : null;
  }

  get visible(): boolean {
    const r = this.rect;
    return !!r && r.clipBottom > r.clipTop && (r.clipRight ?? r.x + r.width) > (r.clipLeft ?? r.x);
  }

  update(x: number, y: number, z: number, buildings: THREE.InstancedMesh, revision: number, radius = .35): void {
    if (!this.rect) return;
    this.target.set(x, y, z);
    // Check the body silhouette only after movement or a building/view change.
    if (this.lastCheck.distanceToSquared(this.target) > .25 || this.revision !== revision || this.radius !== radius) {
      buildings.updateMatrixWorld(true);
      const blocked = (side: 1 | -1) => {
        this.direction.set(side, Math.SQRT2 * Math.tan(Math.PI / 6), side).normalize();
        return actorSightlineHits(this.ray, this.target, this.direction, radius, buildings).length > 0;
      };
      const currentBlocked = blocked(this.side);
      const oppositeBlocked = currentBlocked && blocked(this.side === 1 ? -1 : 1);
      this.side = taggedViewSide(this.side, currentBlocked, oppositeBlocked);
      this.obscured = currentBlocked && oppositeBlocked;
      this.lastCheck.copy(this.target);
      this.revision = revision;
      this.radius = radius;
    }
    const h = this.rect.mode === 'street' ? 8 : 46;
    const w = h * this.rect.width / this.rect.height;
    this.camera.left = -w / 2; this.camera.right = w / 2;
    this.camera.top = h / 2; this.camera.bottom = -h / 2;
    this.direction.set(this.side, Math.SQRT2 * Math.tan(Math.PI / 6), this.side).normalize();
    this.camera.position.copy(this.target).addScaledVector(this.direction, 900);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }

  contains(x: number, z: number): boolean {
    if (!this.rect || !this.visible) return false;
    const radius = this.rect.mode === 'street' ? 25 : 80;
    return Math.abs(x - this.target.x) <= radius && Math.abs(z - this.target.z) <= radius;
  }
}

/** Each watch keeps its own camera/reversal, including while scrolled offscreen. */
export class TaggedViews {
  readonly views = new Map<ID, TaggedView>();

  set(rects: TaggedViewRect[], mainFlipped: boolean): void {
    const ids = new Set(rects.map(r => r.personId));
    for (const id of this.views.keys()) if (!ids.has(id)) this.views.delete(id);
    for (const rect of rects) {
      let view = this.views.get(rect.personId);
      if (!view) { view = new TaggedView(); this.views.set(rect.personId, view); }
      view.set(rect, mainFlipped);
    }
  }

  contains(x: number, z: number): boolean {
    for (const view of this.views.values()) if (view.contains(x, z)) return true;
    return false;
  }

  watchedIds(): Set<ID> {
    return new Set([...this.views].filter(([, view]) => view.visible).map(([id]) => id));
  }
}
