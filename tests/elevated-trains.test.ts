import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ElevatedTrains } from '../src/render/elevatedTrains';

const positions = (t: ElevatedTrains) => {
  const mesh = t.group.children[0] as THREE.InstancedMesh, m = new THREE.Matrix4(), out: { x: number; z: number; shown: boolean }[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    out.push({ x: m.elements[12], z: m.elements[14], shown: m.elements[0] !== 0 });
  }
  return out;
};

describe('trains on the elevated line', () => {
  const station = 405, length = 1728;
  const trains = new ElevatedTrains(513, 9, length, station);

  it('run on two tracks either side of the deck centre', () => {
    trains.update(200);
    const xs = new Set(positions(trains).filter(p => p.shown).map(p => Math.round((p.x - 513) * 10) / 10));
    expect([...xs].sort()).toEqual([-1.4, 1.4]);
  });

  it('dwell at the station, then move on, and stay on the deck', () => {
    trains.update(40);
    const first = positions(trains).slice(0, 3);
    expect(first.every(p => p.shown)).toBe(true);
    expect(Math.abs((first[0].z + first[2].z) / 2 - station)).toBeLessThan(1);   // centred on the platform
    trains.update(48);
    expect(positions(trains)[1].z).toBeCloseTo(first[1].z, 5);                   // still dwelling
    trains.update(60);
    expect(positions(trains)[1].z).toBeGreaterThan(first[1].z + 50);
    for (let t = 0; t < 400; t += 7) {
      trains.update(t);
      for (const p of positions(trains).filter(p => p.shown)) {
        expect(p.z).toBeGreaterThan(0);
        expect(p.z).toBeLessThan(length);
      }
    }
  });
});
