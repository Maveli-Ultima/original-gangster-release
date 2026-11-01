import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SculptTrees, prepareTreeGeometry } from '../src/render/sculptTrees';

function source() {
  const scene = new THREE.Group(); scene.position.set(4, 2, -3);
  const map = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map, normalMap: map, roughnessMap: map, emissive:0xffffff });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 10, 2), material); mesh.position.y = 5; scene.add(mesh);
  return { scene, animations:[], mesh, map, material };
}
afterEach(() => vi.restoreAllMocks());

describe('generated tree rendering', () => {
  it('normalizes height and ground pivot without changing the source proportions', () => {
    const model = source(), original = model.mesh.geometry.getAttribute('position').array.slice();
    const parts = prepareTreeGeometry(model.scene), bounds = parts[0].geometry.boundingBox!;
    expect(bounds.min.y).toBeCloseTo(0); expect(bounds.max.y).toBeCloseTo(1);
    expect(bounds.min.x).toBeCloseTo(-.1); expect(bounds.max.x).toBeCloseTo(.1);
    expect(bounds.min.z).toBeCloseTo(-.1); expect(bounds.max.z).toBeCloseTo(.1);
    expect(model.mesh.geometry.getAttribute('position').array).toEqual(original);
    parts.forEach(part => part.geometry.dispose());
  });

  it('shares tree assets across cullable batches, preserves planting heights and disables extra maps/mips', async () => {
    const sources = [source(),source(),source()]; let next = 0;
    vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async () => sources[next++] as unknown as GLTF);
    const trees = new SculptTrees(); await trees.load(); expect(trees.ready).toBe(true);
    trees.setPlacements([
      {kind:'elm',x:10,y:.2,z:10,height:8,angle:0}, {kind:'elm',x:12,y:.2,z:15,height:9,angle:1},
      {kind:'elm',x:240,y:.2,z:10,height:8,angle:0}, {kind:'oak',x:10,y:.2,z:10,height:7,angle:0},
    ]);
    const batches = trees.group.children as THREE.InstancedMesh[];
    expect(batches.map(mesh => mesh.count)).toEqual([2,1,1]);
    expect(batches[0].geometry).toBe(batches[1].geometry);
    expect(batches.every(mesh => mesh.frustumCulled && mesh.boundingSphere && mesh.castShadow && mesh.receiveShadow)).toBe(true);
    const matrix = new THREE.Matrix4(); batches[0].getMatrixAt(0,matrix);
    const box = batches[0].geometry.boundingBox!.clone().applyMatrix4(matrix);
    expect(box.min.y).toBeCloseTo(.2); expect(box.max.y).toBeCloseTo(8.2);
    for (const model of sources) {
      expect(model.map.generateMipmaps).toBe(false); expect(model.map.minFilter).toBe(THREE.LinearFilter);
      expect(model.material.normalMap).toBeNull(); expect(model.material.roughnessMap).toBeNull();
      expect(model.material.emissive.getHex()).toBe(0);
    }
    const dispose = vi.spyOn(batches[0].geometry,'dispose'), textureDispose = vi.spyOn(sources[0].map,'dispose');
    trees.setPlacements([]); expect(dispose).not.toHaveBeenCalled();
    trees.dispose(); trees.dispose(); expect(dispose).toHaveBeenCalledOnce(); expect(textureDispose).toHaveBeenCalledOnce();
  });

  it('releases successful siblings when a download fails and leaves fallback rendering available', async () => {
    const model = source(), disposed = vi.spyOn(model.map,'dispose'); let calls = 0;
    vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async () => {
      if (++calls === 2) throw Error('Unavailable'); return model as unknown as GLTF;
    });
    const trees = new SculptTrees(); await trees.load();
    expect(trees.ready).toBe(false); expect(trees.error).toContain('fallback');
    expect(disposed).toHaveBeenCalledOnce(); trees.dispose(); expect(disposed).toHaveBeenCalledOnce();
  });

  it('releases models that finish loading after navigation disposes the renderer', async () => {
    const model = source(), disposed = vi.spyOn(model.map,'dispose');
    let release!: (model: GLTF) => void;
    const pending = new Promise<GLTF>(resolve => { release = resolve; });
    vi.spyOn(GLTFLoader.prototype,'loadAsync').mockReturnValue(pending);
    const trees = new SculptTrees(), loading = trees.load(); trees.dispose();
    release(model as unknown as GLTF); await loading;
    expect(trees.ready).toBe(false); expect(trees.group.children).toHaveLength(0); expect(disposed).toHaveBeenCalledOnce();
  });
});
