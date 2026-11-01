import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createSculptVehicle, SCULPT_VEHICLE_PROFILE } from '../src/render/sculptVehicles';
import { SculptReviewLayer } from '../src/render/sculptReviewLayer';

function source(parts = 3) {
  const root = new THREE.Group();
  for (let i = 0; i < parts; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(.2, .3, .2), new THREE.MeshStandardMaterial());
    mesh.position.set(i * .35 - .35, .15, 0); root.add(mesh);
  }
  return root;
}
beforeEach(() => {
  // The shared layer also loads authored character clips. Serve the real local
  // assets so the vehicle tests exercise their intended load/disposal paths.
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (!['weapon-handling', 'combat-motions', 'burning-motions', 'daily-motions', 'close-motions'].some(name => url === `/art/city/sculpt/${name}.json`))
      throw new Error(`Unexpected asset request: ${url}`);
    return new Response(await readFile(new URL(`../public${url}`, import.meta.url), 'utf8'));
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('multi-material Sculpt vehicles', () => {
  it.each(['truck', 'speedster'] as const)('preserves every %s primitive, grounds the whole model and turns its nose to +X', kind => {
    const root = source(), old = root.children.map(child => (child as THREE.Mesh).geometry.getAttribute('position').array.slice());
    const materials = root.children.map(child => (child as THREE.Mesh).material);
    const built = createSculptVehicle(root, kind, 2);
    expect(built.parts).toHaveLength(3);
    const bounds = new THREE.Box3();
    for (const [i, part] of built.parts.entries()) {
      bounds.union(part.geometry.boundingBox!);
      expect(part.material).toBe(materials[i]);
      expect(part.geometry).not.toBe((root.children[i] as THREE.Mesh).geometry);
      expect((root.children[i] as THREE.Mesh).geometry.getAttribute('position').array).toEqual(old[i]);
    }
    const size = bounds.getSize(new THREE.Vector3()), profile = SCULPT_VEHICLE_PROFILE[kind];
    expect(size.x).toBeCloseTo(profile.length, 5); expect(size.y).toBeCloseTo(profile.height, 5);
    expect(size.z).toBeCloseTo(profile.width, 5); expect(bounds.min.y).toBeCloseTo(0, 6);
    expect(built.parts[0].geometry.boundingBox!.getCenter(new THREE.Vector3()).x).toBeGreaterThan(0);
    built.parts.forEach(part => { part.geometry.dispose(); part.dispose(); });
  });

  it('keeps all material parts together across capacity, visibility, reset and disposal', async () => {
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => ({
      scene: source(), animations: [new THREE.AnimationClip('walk', 1, [])],
    }) as unknown as GLTF);
    const scene = new THREE.Scene(), layer = new SculptReviewLayer(scene, 2, () => {});
    await layer.load(); expect(layer.error).toBeNull(); expect(layer.ready).toBe(true);
    const a = new THREE.Matrix4().makeTranslation(3, .008, 5), b = new THREE.Matrix4().makeTranslation(-2, .008, -7);
    for (const kind of ['coupe', 'truck', 'speedster'] as const) {
      expect(layer.pushVehicle(kind, a)).toBe(true); expect(layer.pushVehicle(kind, b)).toBe(true);
      expect(layer.pushVehicle(kind, a)).toBe(false);
    }
    layer.commitVehicles(); expect(layer.vehicleCount).toBe(6);
    const parts = scene.children.filter(child => child instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
    expect(parts).toHaveLength(9);
    for (const part of parts) {
      expect(part.count).toBe(2); const matrix = new THREE.Matrix4();
      part.getMatrixAt(0, matrix); matrix.elements.forEach((n, i) => expect(n).toBeCloseTo(a.elements[i], 6));
      part.getMatrixAt(1, matrix); matrix.elements.forEach((n, i) => expect(n).toBeCloseTo(b.elements[i], 6));
    }
    layer.setVisible(false); expect(parts.every(part => !part.visible)).toBe(true);
    expect(layer.pushVehicle('truck', a)).toBe(false);
    layer.setVisible(true); layer.resetVehicles(); layer.commitVehicles();
    expect(layer.vehicleCount).toBe(0); expect(parts.every(part => part.count === 0)).toBe(true);
    const disposals = parts.map(part => vi.spyOn(part.geometry, 'dispose'));
    layer.dispose(); layer.dispose();
    expect(scene.children).toHaveLength(0); expect(disposals.every(spy => spy.mock.calls.length === 1)).toBe(true);
  });

  it('keeps the procedural fallback available when a vehicle fails to load', async () => {
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockRejectedValue(Error('truck unavailable'));
    const callback = vi.fn(), layer = new SculptReviewLayer(new THREE.Scene(), 2, callback);
    await layer.load(); expect(layer.ready).toBe(false); expect(layer.error).toBe('truck unavailable');
    expect(layer.pushVehicle('speedster', new THREE.Matrix4())).toBe(false); expect(callback).toHaveBeenCalledOnce();
    layer.dispose();
  });
});
