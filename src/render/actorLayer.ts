import * as THREE from 'three';
import type { Person } from '../sim/types';
import { characterStyle } from './characterPresentation';
import type {CharacterAction} from './characterActions';
import { ACTOR_STYLES, ACTOR_STRIDE_METRES, actorGeometry, createActorMaterial, createActorDepthMaterial, type ActorStyle } from './actors';

interface Batch {
  mesh: THREE.InstancedMesh;
  walk: THREE.InstancedBufferAttribute;
  skin: THREE.InstancedBufferAttribute;
  count: number;
}

const SKIN = [0xe7b38f, 0xca956f, 0xb67b55, 0x966244, 0x72472e, 0xd6a07c, 0xbb8868, 0xe1bda1];

export function actorStyleFor(person: Pick<Person, 'female' | 'role' | 'gangId' | 'id'>): ActorStyle {
  return characterStyle(person);
}

/** Rendering-only gait history. Monotone travelled distance avoids reversing the gait on west/north routes. */
export class ActorMotion {
  private samples = new Map<number, { x: number; z: number; phase: number; facing: number }>();

  clear(): void { this.samples.clear(); }

  sample(id: number, x: number, z: number, moving: boolean, facing: number): { phase: number; facing: number } {
    let previous = this.samples.get(id);
    if (!previous) {
      previous = { x, z, phase: ((id * 1.37) % (Math.PI * 2)), facing };
      this.samples.set(id, previous);
    } else {
      const travelled = Math.hypot(x - previous.x, z - previous.z);
      // Camera culling, save restore or teleport must not animate a long unseen journey.
      if (moving && travelled < 12) previous.phase = (previous.phase + travelled * Math.PI * 2 / ACTOR_STRIDE_METRES) % (Math.PI * 2);
      if (moving) previous.facing = facing;
      previous.x = x;
      previous.z = z;
    }
    return previous;
  }

  retain(ids: Set<number>): void {
    for (const id of this.samples.keys()) if (!ids.has(id)) this.samples.delete(id);
  }
}

/** Four geometry batches retain small draw-call counts while clothing and role silhouettes differ. */
export class ActorLayer {
  readonly meshes: THREE.InstancedMesh[] = [];
  private batches = new Map<ActorStyle, Batch>();
  private skinColor = new THREE.Color();
  private actionMatrix = new THREE.Matrix4();
  private fallRotation = new THREE.Matrix4();
  private disposed = false;

  constructor(scene: THREE.Scene, capacity: number) {
    for (const style of ACTOR_STYLES) {
      const geometry = actorGeometry(style);
      const walk = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
      const skin = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      walk.setUsage(THREE.DynamicDrawUsage);
      skin.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aWalk', walk);
      geometry.setAttribute('aSkinColor', skin);
      const mesh = new THREE.InstancedMesh(geometry, createActorMaterial(), capacity);
      mesh.name = `actor-${style}`;
      mesh.userData.actorStyle = style;
      mesh.userData.actorSkinColor = new THREE.Color(SKIN[0]).toArray();
      mesh.customDepthMaterial = createActorDepthMaterial();
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.raycast = () => {};
      this.meshes.push(mesh);
      this.batches.set(style, { mesh, walk, skin, count: 0 });
      scene.add(mesh);
    }
  }

  reset(): void { for (const batch of this.batches.values()) batch.count = 0; }

  push(person: Person, matrix: THREE.Matrix4, coat: THREE.Color, phase: number, amplitude: number, action?:CharacterAction): void {
    const batch = this.batches.get(actorStyleFor(person))!;
    if (batch.count >= batch.mesh.instanceMatrix.count) return;
    const i = batch.count++;
    if(action?.kind==='death'||action?.kind==='burnDeath'){
      // The distant instanced body must also fall, including before HD loads.
      const amount=THREE.MathUtils.smoothstep(action.time,.22,action.kind==='burnDeath'?3:1.2);
      this.fallRotation.makeRotationX(-Math.PI/2*amount);
      this.fallRotation.setPosition(0,.19*amount,0);
      this.actionMatrix.copy(matrix).multiply(this.fallRotation);
      batch.mesh.setMatrixAt(i,this.actionMatrix);amplitude=0;
    }else batch.mesh.setMatrixAt(i, matrix);
    batch.mesh.setColorAt(i, coat);
    batch.walk.setXY(i, phase, amplitude);
    this.skinColor.setHex(SKIN[Math.abs(person.portrait | 0) % SKIN.length]);
    if(action?.kind==='burnDeath')this.skinColor.setHex(0x24211d);
    batch.skin.setXYZ(i, this.skinColor.r, this.skinColor.g, this.skinColor.b);
  }

  commit(): void {
    for (const batch of this.batches.values()) {
      batch.mesh.count = batch.count;
      if (!batch.count) continue;
      batch.mesh.instanceMatrix.needsUpdate = true;
      batch.mesh.instanceColor!.needsUpdate = true;
      batch.walk.needsUpdate = true;
      batch.skin.needsUpdate = true;
    }
  }

  setVisible(visible: boolean): void {
    for (const mesh of this.meshes) mesh.visible = visible;
    if (!visible) { this.reset(); this.commit(); }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.dispose();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.customDepthMaterial?.dispose();
    }
    this.batches.clear();
  }
}
