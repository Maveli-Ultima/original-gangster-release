import * as THREE from 'three';
import type { Person, WorldState } from '../sim/types';
import { KERB_H } from './util';
import { peopleList } from '../sim/entityLists';

/**
 * Where people died (reference video; the original keeps bodies 1–2 weeks,
 * 0x663A00): a white chalk outline on the road or pavement, or a black charred
 * silhouette for someone who burnt. Marks stay for the week of the death and
 * the next. Flat decals from world state only; nothing is saved.
 */
// The figure fills about four-fifths of the decal: a 1.8 m person.
const LENGTH = 2.3, WIDTH = 1.35;

function figure(ctx: CanvasRenderingContext2D, s: number): void {
  // Sprawled figure, head at the top: arms and legs flung out.
  ctx.beginPath();
  ctx.arc(s * .5, s * .13, s * .075, 0, Math.PI * 2);
  ctx.moveTo(s * .44, s * .21);
  ctx.lineTo(s * .2, s * .3); ctx.lineTo(s * .16, s * .36); ctx.lineTo(s * .42, s * .3);
  ctx.lineTo(s * .4, s * .58); ctx.lineTo(s * .24, s * .9); ctx.lineTo(s * .31, s * .92); ctx.lineTo(s * .49, s * .64);
  ctx.lineTo(s * .62, s * .92); ctx.lineTo(s * .69, s * .88); ctx.lineTo(s * .58, s * .58); ctx.lineTo(s * .58, s * .31);
  ctx.lineTo(s * .82, s * .44); ctx.lineTo(s * .85, s * .38); ctx.lineTo(s * .56, s * .21);
  ctx.closePath();
}

function texture(kind: 'chalk' | 'charred'): THREE.CanvasTexture {
  const s = 256, canvas = document.createElement('canvas');
  canvas.width = s; canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  figure(ctx, s);
  if (kind === 'chalk') {
    ctx.strokeStyle = 'rgba(250,248,240,1)'; ctx.lineWidth = 10; ctx.lineJoin = 'round'; ctx.stroke();
    // Chalk is dry and broken: knock small gaps out of the line.
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 120; i++) ctx.fillRect((i * 97) % s, (i * 53) % s, 2, 2);
  } else {
    ctx.fillStyle = 'rgba(14,12,11,.88)'; ctx.fill();
    ctx.strokeStyle = 'rgba(40,34,30,.5)'; ctx.lineWidth = 9; ctx.stroke();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

export class DeathMarks {
  readonly group = new THREE.Group();
  private readonly meshes: Record<'chalk' | 'charred', THREE.InstancedMesh>;
  private readonly geometry = new THREE.PlaneGeometry(WIDTH, LENGTH).rotateX(-Math.PI / 2);
  private signature = '';
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly capacity = 256) {
    this.group.name = 'death-marks';
    const make = (kind: 'chalk' | 'charred') => {
      const material = new THREE.MeshBasicMaterial({ map: texture(kind), transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new THREE.InstancedMesh(this.geometry, material, capacity);
      mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 1;
      this.group.add(mesh);
      return mesh;
    };
    this.meshes = { chalk: make('chalk'), charred: make('charred') };
  }

  /** Cheap to call often: rebuilds only when the set of marks changes. */
  update(w: WorldState, groundY: (x: number, y: number) => number = () => KERB_H, at: (p: Person) => { x: number; y: number } = p => p.pos): void {
    const dead = peopleList(w).filter(p => p.status === 'dead' && p.diedWeek >= w.week - 1 && !p.inVehicle)
      .sort((a, b) => b.diedWeek - a.diedWeek || b.id - a.id).slice(0, this.capacity);
    const signature = `${w.week}:${dead.map(p => p.id).join(',')}`;
    if (signature === this.signature) return;
    this.signature = signature;
    const counts = { chalk: 0, charred: 0 };
    for (const p of dead) {
      const kind = p.burningEscape?.fatal ? 'charred' : 'chalk';
      this.rotation.setFromAxisAngle(this.up, ((p.id * 2654435761) >>> 0) / 0x100000000 * Math.PI * 2);
      const pos = at(p);
      this.matrix.compose(new THREE.Vector3(pos.x, groundY(pos.x, pos.y) + .05, pos.y), this.rotation, new THREE.Vector3(1, 1, 1));
      this.meshes[kind].setMatrixAt(counts[kind]++, this.matrix);
    }
    for (const kind of ['chalk', 'charred'] as const) {
      this.meshes[kind].count = counts[kind];
      this.meshes[kind].instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const mesh of Object.values(this.meshes)) {
      (mesh.material as THREE.MeshBasicMaterial).map?.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    this.geometry.dispose();
  }
}
