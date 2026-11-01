import * as THREE from 'three';
import { blockRect } from '../sim/cityLayout';
import { CELL } from '../sim/constants';
import { cityTramLines, tramsAt, TRAM_LENGTH } from '../sim/trams';
import type { WorldState } from '../sim/types';
import { KERB_H, paveWidth } from './util';
import { useDetailedModels } from './characterPresentation';
import { loadTramModel, type TramModel } from './sculptTram';

/**
 * Street trams on the city's tram lines (`sim/trams.ts`): a single-truck
 * city car in its line's colour, with a cream window band and a pale roof,
 * in the manner of the elevated trains. Where they are is the game clock
 * (minute and fraction) less the minutes each has stood for its riders
 * (`tramsAt`), so they stand still while the game is paused and while a
 * walker comes to board; riders are not drawn. In the original city they run
 * down the raised median of the avenues and cross the side streets at the
 * median's height, coming down to the deck on a bridge.
 *
 * With detailed models on (the `sculptModels` switch), each tram is the Sculpt
 * double-ended streetcar (`sculptTram.ts`), its red livery panels in the line's
 * colour. The boxes below are drawn until it has loaded, and if it cannot be.
 */
const WIDTH = 2.4, FLOOR = .55, BODY_H = 2.3;

export class StreetTrams {
  readonly group = new THREE.Group();
  private readonly parts: THREE.InstancedMesh[];
  /** The instanced meshes being drawn: the procedural boxes, or the model once it has loaded. */
  private drawn: THREE.InstancedMesh[];
  private model?: { meshes: THREE.InstancedMesh[]; source: TramModel };
  private minute = 0;
  private disposed = false;
  private readonly materials: THREE.MeshStandardMaterial[];
  private readonly matrix = new THREE.Matrix4();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly quat = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly count: number;

  constructor(private readonly w: WorldState) {
    this.group.name = 'street-trams';
    this.count = tramsAt(w, 0).length;
    // Body (tinted per line), running gear, cream window band, glazing, roof.
    this.materials = [0xffffff, 0x2a2c2b, 0xd9cfae, 0x1e2426, 0x8a8478].map((color, i) =>
      new THREE.MeshStandardMaterial({ color, roughness: i === 3 ? .35 : .8, metalness: i === 3 ? .2 : i === 1 ? .3 : .1 }));
    const shapes = [
      new THREE.BoxGeometry(WIDTH, BODY_H, TRAM_LENGTH).translate(0, FLOOR + BODY_H / 2, 0),
      new THREE.BoxGeometry(1.7, FLOOR, TRAM_LENGTH - 2.4).translate(0, FLOOR / 2, 0),
      new THREE.BoxGeometry(WIDTH + .04, .95, TRAM_LENGTH - 1.2).translate(0, FLOOR + 1.5, 0),
      new THREE.BoxGeometry(WIDTH + .08, .62, TRAM_LENGTH - 1.8).translate(0, FLOOR + 1.55, 0),
      new THREE.BoxGeometry(WIDTH - .2, .3, TRAM_LENGTH - .6).translate(0, FLOOR + BODY_H + .15, 0),
    ];
    const lines = cityTramLines(w), first = tramsAt(w, 0), tint = new THREE.Color();
    this.parts = shapes.map((g, i) => {
      const mesh = new THREE.InstancedMesh(g, this.materials[i], Math.max(1, this.count));
      mesh.castShadow = i === 0; mesh.frustumCulled = false; this.group.add(mesh);
      if (i === 0) first.forEach((t, k) => mesh.setColorAt(k, tint.set(lines[t.line]?.color ?? '#9b5143')));
      return mesh;
    });
    this.drawn = this.parts;
    this.update(0);
    if (typeof location !== 'undefined' && useDetailedModels(location.search)) void loadTramModel().then(model => this.useModel(model));
  }

  /** Swap the procedural boxes for the loaded model, in the same places and line colours. */
  private useModel(source: TramModel | null): void {
    if (!source) return;
    if (this.disposed) { source.release(); return; }
    const colour = this.parts[0].instanceColor;
    const meshes = source.parts.map(({ geometry, material }, i) => {
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, this.count));
      mesh.name = `street-tram-model${i ? `-${i}` : ''}`;
      mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.raycast = () => {};
      if (colour) mesh.instanceColor = new THREE.InstancedBufferAttribute(colour.array.slice(), 3);
      return mesh;
    });
    this.model = { meshes, source };
    for (const mesh of this.parts) mesh.visible = false;
    for (const mesh of meshes) this.group.add(mesh);
    this.drawn = meshes;
    this.update(this.minute);
  }

  /** Height of the track bed under a point: the median's top in the original city, the road elsewhere. */
  private base(x: number, y: number, alongX: boolean): number {
    const w = this.w;
    if (!w.cityLayout?.original) return 0;
    const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
    const level = (bx: number, by: number) => {
      const b = bx >= 0 && by >= 0 && bx < w.gridW && by < w.gridH ? w.blocks[by * w.gridW + bx] : undefined;
      if (!b) return null;
      return b.layout?.use === 'avenue' && b.original?.content !== 37 ? KERB_H : 0;
    };
    const here = level(gx, gy) ?? 0;
    const b = w.blocks[Math.min(w.gridH - 1, Math.max(0, gy)) * w.gridW + Math.min(w.gridW - 1, Math.max(0, gx))];
    const r = blockRect(b), half = (alongX ? r.w : r.h) / 2 + paveWidth(w), gap = Math.max(.01, CELL / 2 - half);
    const local = alongX ? x - gx * CELL : y - gy * CELL;
    const step = (dx: number, dy: number) => level(gx + dx, gy + dy) ?? here;
    if (local < gap) return THREE.MathUtils.lerp(alongX ? step(-1, 0) : step(0, -1), here, (local + gap) / (2 * gap));
    if (local > CELL - gap) return THREE.MathUtils.lerp(here, alongX ? step(1, 0) : step(0, 1), (local - CELL + gap) / (2 * gap));
    return here;
  }

  /** Place every tram at a moment of the working week (minutes, fractional). */
  update(minute: number): void {
    this.minute = minute;
    const trams = tramsAt(this.w, minute);
    for (let k = 0; k < this.count; k++) {
      const t = trams[k];
      if (!t?.visible) { for (const mesh of this.drawn) mesh.setMatrixAt(k, this.hidden); continue; }
      this.quat.setFromAxisAngle(this.up, Math.atan2(t.dx, t.dy));
      // Wheels on the rail heads, which stand about 6 cm proud of the bed.
      this.pos.set(t.x, this.base(t.x, t.y, Math.abs(t.dx) >= Math.abs(t.dy)) + .06, t.y);
      this.matrix.compose(this.pos, this.quat, this.one);
      for (const mesh of this.drawn) mesh.setMatrixAt(k, this.matrix);
    }
    for (const mesh of this.drawn) mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.disposed = true;
    this.group.removeFromParent();
    if (this.model) { for (const mesh of this.model.meshes) mesh.dispose(); this.model.source.release(); this.model = undefined; }
    for (const mesh of this.parts) { mesh.geometry.dispose(); mesh.dispose(); }
    this.materials.forEach(m => m.dispose());
  }
}
