import * as THREE from 'three';

/**
 * Trains on the original city's elevated line (TODO §4; the original keeps its
 * trains running, rail.h: accelerate, run, brake, stop). Two tracks, trains in
 * opposite directions, a dwell at the station. Purely presentational: position
 * is a function of the scene's simulated clock, so they stop when the game is
 * paused and nothing is saved.
 */
const CAR = 13, GAP = .8, CARS = 3, SPEED = 11, DWELL = 12, TRACK = 1.4;
const TRAIN = CARS * CAR + (CARS - 1) * GAP;

export class ElevatedTrains {
  readonly group = new THREE.Group();
  private readonly parts: THREE.InstancedMesh[];
  private readonly materials: THREE.MeshStandardMaterial[];
  private readonly trains: { dir: 1 | -1; phase: number }[];
  private readonly matrix = new THREE.Matrix4();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(private readonly cx: number, private readonly deckY: number, private readonly length: number,
    private readonly stationZ: number | null) {
    this.group.name = 'elevated-trains';
    // Maroon cars with dark glazing and a pale roof, so they read against the
    // green-grey girders from the game camera.
    this.materials = [0x6e2b20, 0x1e2426, 0x8a8478].map((color, i) =>
      new THREE.MeshStandardMaterial({ color, roughness: i === 1 ? .35 : .8, metalness: i === 1 ? .2 : .1 }));
    const shapes = [new THREE.BoxGeometry(2.7, 2.9, CAR), new THREE.BoxGeometry(2.76, .7, CAR - 1.6),
      new THREE.BoxGeometry(2.5, .35, CAR - .4)];
    const period = this.period();
    this.trains = [0, 1].flatMap(k => ([1, -1] as const).map(dir => ({ dir, phase: k * period / 2 + (dir < 0 ? period / 4 : 0) })));
    this.parts = shapes.map((g, i) => {
      const mesh = new THREE.InstancedMesh(g, this.materials[i], this.trains.length * CARS);
      mesh.castShadow = i === 0; mesh.frustumCulled = false; this.group.add(mesh);
      return mesh;
    });
    this.update(0);
  }

  private period(): number {
    return (this.length + TRAIN) / SPEED + (this.stationZ == null ? 0 : DWELL);
  }

  /** The front of the train along its direction of travel: 0 as it enters the
   * map, length + TRAIN once the last car has left. Centred on the station
   * for the dwell. */
  private head(seconds: number, phase: number, stop: number | null): number {
    const period = this.period(), s = ((seconds + phase) % period + period) % period;
    if (stop == null) return s * SPEED;
    const reach = (stop + TRAIN / 2) / SPEED;
    if (s < reach) return s * SPEED;
    if (s < reach + DWELL) return stop + TRAIN / 2;
    return stop + TRAIN / 2 + (s - reach - DWELL) * SPEED;
  }

  update(seconds: number): void {
    const heights = [this.deckY + .9 + 1.45, this.deckY + .9 + 1.95, this.deckY + .9 + 3.05];
    this.trains.forEach((t, n) => {
      const stop = this.stationZ == null ? null : t.dir > 0 ? this.stationZ : this.length - this.stationZ;
      const head = this.head(seconds, t.phase, stop);
      for (let c = 0; c < CARS; c++) {
        const along = head - CAR / 2 - c * (CAR + GAP);
        const z = t.dir > 0 ? along : this.length - along;
        const visible = along > CAR / 2 && along < this.length - CAR / 2;
        const x = this.cx + t.dir * TRACK;
        this.parts.forEach((mesh, i) => {
          if (!visible) mesh.setMatrixAt(n * CARS + c, this.hidden);
          else mesh.setMatrixAt(n * CARS + c, this.matrix.makeTranslation(x, heights[i], z));
        });
      }
    });
    for (const mesh of this.parts) mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const mesh of this.parts) { mesh.geometry.dispose(); mesh.dispose(); }
    this.materials.forEach(m => m.dispose());
  }
}
