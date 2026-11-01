import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { sawtoothGeometry } from '../src/render/geometry';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const material = () => new THREE.MeshStandardMaterial({ roughness: .9, vertexColors: true });
function expectVector(actual: THREE.Vector3, expected: THREE.Vector3, precision = 6): void {
  for (const axis of ['x', 'y', 'z'] as const) expect(actual[axis]).toBeCloseTo(expected[axis], precision);
}
function hit(mesh: THREE.Mesh, origin: THREE.Vector3, target: THREE.Vector3): THREE.Intersection {
  mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(origin, target.clone().sub(origin).normalize());
  const hits = ray.intersectObject(mesh, false);
  expect(hits.length, 'Expected an exterior-facing surface to be ray-visible with FrontSide material').toBeGreaterThan(0);
  return hits[0];
}

describe('sawtooth roof exterior winding', () => {
  it('retains the closed prism extent, face count and per-face colors', () => {
    const geometry = sawtoothGeometry();
    geometry.computeBoundingBox();
    expectVector(geometry.boundingBox!.min, v(-.5, .06, -.5));
    expectVector(geometry.boundingBox!.max, v(.5, 1, .5));
    expect(geometry.getAttribute('position').count).toBe(24);
    expect(geometry.getAttribute('normal').count).toBe(24);
    expect(geometry.getAttribute('uv').count).toBe(24);
    const colors = geometry.getAttribute('color');
    const counts = new Map<string, number>();
    for (let i = 0; i < colors.count; i++) {
      const key = [colors.getX(i), colors.getY(i), colors.getZ(i)].map(n => n.toFixed(2)).join(',');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({ '0.30,0.29,0.28': 6, '0.46,0.55,0.60': 6, '0.16,0.16,0.15': 12 });
    geometry.dispose();
  });

  it('gives every triangle a finite outward geometric and lighting normal', () => {
    const geometry = sawtoothGeometry();
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
    const interior = v(0, (.06 + .06 + 1) / 3, (-.5 + .5 + .5) / 3);
    for (let i = 0; i < positions.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(positions, i);
      const b = new THREE.Vector3().fromBufferAttribute(positions, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(positions, i + 2);
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      const centroid = a.clone().add(b).add(c).divideScalar(3);
      expect(normal.dot(centroid.sub(interior)), `Triangle ${i / 3} points into the prism`).toBeGreaterThan(.1);
      expect(normal.length()).toBeCloseTo(1, 7);
      for (let j = 0; j < 3; j++) expectVector(new THREE.Vector3().fromBufferAttribute(normals, i + j), normal);
    }
    geometry.dispose();
  });

  const faces = [
    { name: 'slate from above', origin: v(0, 2, 0), target: v(0, .53, 0), normal: v(0, 1, -.94).normalize() },
    { name: 'glazing from +Z', origin: v(0, .5, 2), target: v(0, .5, .5), normal: v(0, 0, 1) },
    { name: 'deck from below', origin: v(0, -1, 0), target: v(0, .06, 0), normal: v(0, -1, 0) },
    { name: 'left end from -X', origin: v(-2, .25, .25), target: v(-.5, .25, .25), normal: v(-1, 0, 0) },
    { name: 'right end from +X', origin: v(2, .25, .25), target: v(.5, .25, .25), normal: v(1, 0, 0) },
  ];
  it.each(faces)('exposes $name to a real FrontSide ray', ({ origin, target, normal }) => {
    const mesh = new THREE.Mesh(sawtoothGeometry(), material());
    expect(mesh.material.side).toBe(THREE.FrontSide);
    const result = hit(mesh, origin, target);
    expectVector(result.point, target);
    expectVector(result.face!.normal, normal);
    mesh.geometry.dispose(); mesh.material.dispose();
  });

  it('exposes the slate from both elevated city camera directions', () => {
    const mesh = new THREE.Mesh(sawtoothGeometry(), material());
    const target = v(0, .53, 0);
    for (const sign of [-1, 1]) {
      const result = hit(mesh, v(sign * 1.5, 3, sign * 1.5), target);
      expectVector(result.point, target);
      expect(result.face!.normal.y).toBeGreaterThan(.7);
    }
    mesh.geometry.dispose(); mesh.material.dispose();
  });

  it('preserves exterior visibility after nonuniform production-style instancing at all lot rotations', () => {
    const mesh = new THREE.InstancedMesh(sawtoothGeometry(), material(), 1);
    const placement = new THREE.Object3D();
    // A representative warehouse bay uses scene.ts's bay*.98, 2.1, depth*.96 scale.
    placement.position.set(837, 12.24, 741.45);
    placement.scale.set((18 / 3) * .98, 2.1, 15 * .96);
    for (let quarter = 0; quarter < 4; quarter++) {
      placement.rotation.y = quarter * Math.PI / 2;
      placement.updateMatrix();
      mesh.setMatrixAt(0, placement.matrix);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      for (const { origin, target } of faces) {
        const result = hit(mesh, origin.clone().applyMatrix4(placement.matrix), target.clone().applyMatrix4(placement.matrix));
        expect(result.instanceId).toBe(0);
        expectVector(result.point, target.clone().applyMatrix4(placement.matrix), 4);
      }
    }
    mesh.geometry.dispose(); mesh.material.dispose();
  });

  it('does not expose inward back faces from the sealed prism interior', () => {
    const mesh = new THREE.Mesh(sawtoothGeometry(), material());
    mesh.updateMatrixWorld(true);
    const interior = v(0, .3, .15);
    for (const direction of [v(1, 0, 0), v(-1, 0, 0), v(0, 1, 0), v(0, -1, 0), v(0, 0, 1)]) {
      expect(new THREE.Raycaster(interior, direction).intersectObject(mesh, false)).toHaveLength(0);
    }
    mesh.geometry.dispose(); mesh.material.dispose();
  });
});

