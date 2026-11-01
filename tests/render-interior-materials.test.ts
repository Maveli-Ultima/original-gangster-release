import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { entryDoorGeometry, interiorGeometry } from '../src/render/architecture';
import baseline from './fixtures/render-interior-baseline.json';
import { CONCRETE_FLOOR, TIMBER_FLOOR, INTERIOR_PALETTE, createFloorSurface, createInteriorMaterials,
  floorRepeatMetres, floorSurfaceMetres, interiorLinearRgb } from '../src/render/interiorMaterials';
import { TextureOwner } from '../src/render/textureOwnership';
import { InstancePool } from '../src/render/pool';

const attribute = (g: THREE.BufferGeometry, name: string, start = 0) => Array.from(g.getAttribute(name).array).slice(start * g.getAttribute(name).itemSize);
const geometryHash = async (values: number[]) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(JSON.stringify(values))))).map(byte => byte.toString(16).padStart(2, '0')).join('');
const srgb = (channel: number) => channel <= .04045 ? channel / 12.92 : Math.pow((channel + .055) / 1.055, 2.4);

describe('cutaway floor candidate', () => {
  it('preserves the slab and floor while removing the unused room partitions', async () => {
    for (const industrial of [false, true]) {
      const before = baseline.interior.find(value => value.industrial === industrial)!, after = interiorGeometry(industrial);
      // Old geometry: slab36 + 128 floor triangles; candidate: floor6 + slab36.
      for (const name of ['position', 'normal'] as const) {
        expect(await geometryHash(attribute(after, name).slice(6 * 3, 42 * 3))).toBe(before.slab[name]);
        expect(attribute(after, name, 42)).toEqual([]);
      }
      expect(after.boundingBox!.min.toArray()).toEqual(before.bounds.min);
      expect(after.boundingBox!.max.x).toBe(before.bounds.max[0]);
      expect(after.boundingBox!.max.z).toBe(before.bounds.max[2]);
      expect(after.boundingBox!.max.y).toBeCloseTo(.071);
      const mat = new THREE.MeshBasicMaterial(), mesh = new THREE.Mesh(after, [mat, mat]);
      const downward = new THREE.Raycaster(new THREE.Vector3(.36, 2, .24), new THREE.Vector3(0, -1, 0));
      expect(downward.intersectObject(mesh)[0].point.y).toBeCloseTo(.071, 5);
      const doorway = new THREE.Raycaster(new THREE.Vector3(-.45, .65, 0), new THREE.Vector3(1, 0, 0), 0, .9);
      expect(doorway.intersectObject(mesh)).toHaveLength(0);
      const throughPartition = new THREE.Raycaster(new THREE.Vector3(-.45, .65, .28), new THREE.Vector3(1, 0, 0), 0, .9);
      expect(throughPartition.intersectObject(mesh)).toHaveLength(0);
      const count = after.getAttribute('position').count;
      expect(after.groups).toEqual([{ start: 0, count: 6, materialIndex: 0 }, { start: 6, count: count - 6, materialIndex: 1 }]);
      expect(count / 3).toBe(14);
      expect(after.userData.partitions).toBe(false);
      after.dispose(); mat.dispose();
    }
  });

  it('leaves full and cutaway entry-door geometry and colours byte-for-byte unchanged', async () => {
    for (const cutaway of [false, true]) {
      const before = baseline.doors.find(value => value.cutaway === cutaway)!, after = entryDoorGeometry(cutaway);
      for (const [name, expected] of Object.entries(before.attributes)) expect(await geometryHash(attribute(after, name))).toBe(expected);
      expect(after.boundingBox!.min.toArray()).toEqual(before.bounds.min);
      expect(after.boundingBox!.max.toArray()).toEqual(before.bounds.max);
      expect(after.userData).toEqual(before.userData);
      after.dispose();
    }
  });

  it('keeps the slab edge linear and the textured floor white', () => {
    for (const industrial of [false, true]) {
      const palette = INTERIOR_PALETTE.slabEdge;
      const channels = [(palette >> 16) & 255, (palette >> 8) & 255, palette & 255];
      const expected = channels.map(v => srgb(v / 255));
      const geometry = interiorGeometry(industrial), colors = geometry.getAttribute('color');
      const actual = [colors.getX(6), colors.getY(6), colors.getZ(6)];
      for (let i = 0; i < 3; i++) {
        expect(actual[i]).toBeCloseTo(expected[i], 6);
        expect(interiorLinearRgb(palette)[i]).toBeCloseTo(expected[i], 6);
      }
      expect(actual[0]).toBeLessThan(channels[0] / 255);
      expect([colors.getX(0), colors.getY(0), colors.getZ(0)]).toEqual([1, 1, 1]);
      geometry.dispose();
    }
  });

  it('holds authored 18 cm board width, 1.6 m length and 1.2 m concrete slabs across sizes and rotations', () => {
    for (const size of [new THREE.Vector3(7.6, 1, 6.58), new THREE.Vector3(12.67, 1, 14.43), new THREE.Vector3(25, 1, 30)]) {
      for (let quarter = 0; quarter < 4; quarter++) {
        const matrix = new THREE.Matrix4().compose(new THREE.Vector3(404, .27, -83),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), quarter * Math.PI / 2), size);
        const measured = new THREE.Vector3(new THREE.Vector3().setFromMatrixColumn(matrix, 0).length(), 1,
          new THREE.Vector3().setFromMatrixColumn(matrix, 2).length());
        const point = new THREE.Vector3(-.3, .071, -.2), origin = floorSurfaceMetres(point, measured);
        for (const [dx, dz] of [[TIMBER_FLOOR.boardWidth, TIMBER_FLOOR.boardLength], [CONCRETE_FLOOR.slabSize, CONCRETE_FLOOR.slabSize]]) {
          const next = floorSurfaceMetres(point.clone().add(new THREE.Vector3(dx / size.x, 0, dz / size.z)), measured);
          expect(next.x - origin.x).toBeCloseTo(dx, 8); expect(next.y - origin.y).toBeCloseTo(dz, 8);
        }
      }
    }
    expect(floorRepeatMetres('timber')).toEqual([1.44, 3.2]);
    expect(floorRepeatMetres('concrete')).toEqual([2.4, 2.4]);
  });

  it('makes repeatable opaque warm boards with staggered joints and a distinct neutral industrial surface', () => {
    const timber = createFloorSurface('timber'), repeated = createFloorSurface('timber'), concrete = createFloorSurface('concrete');
    expect(timber.albedo.image.data).toEqual(repeated.albedo.image.data);
    expect(timber.height.image.data).toEqual(repeated.height.image.data);
    const t = timber.albedo.image.data as Uint8Array, c = concrete.albedo.image.data as Uint8Array;
    const pixel = (x: number, y: number, channel = 0) => t[(y * TIMBER_FLOOR.pixelsX + x) * 4 + channel];
    expect(pixel(0, 20)).toBeLessThan(pixel(16, 20) - 15); // parallel edge joint
    expect(pixel(16, 0)).toBeLessThan(pixel(16, 20) - 15); // board0 end
    expect(pixel(48, 192)).toBeLessThan(pixel(48, 172) - 15); // board1 offset end
    expect(pixel(48, 0)).toBeGreaterThan(pixel(16, 0) + 15);
    let nonOpaque = 0; const meanT = [0, 0, 0], meanC = [0, 0, 0];
    for (const bytes of [t, c, timber.height.image.data as Uint8Array, concrete.height.image.data as Uint8Array])
      for (let i = 3; i < bytes.length; i += 4) if (bytes[i] !== 255) nonOpaque++;
    for (let i = 0; i < t.length; i += 4) for (let channel = 0; channel < 3; channel++) meanT[channel] += t[i + channel] / (t.length / 4);
    for (let i = 0; i < c.length; i += 4) for (let channel = 0; channel < 3; channel++) meanC[channel] += c[i + channel] / (c.length / 4);
    expect(nonOpaque).toBe(0);
    expect(meanT[0] - meanT[1]).toBeGreaterThan(30); expect(meanT[1] - meanT[2]).toBeGreaterThan(30);
    expect(meanT[0]).toBeLessThan(115); expect(Math.abs(meanC[0] - meanC[2])).toBeLessThan(15);
    for (const surface of [timber, repeated, concrete]) {
      expect(surface.albedo.colorSpace).toBe(THREE.SRGBColorSpace); expect(surface.height.colorSpace).toBe(THREE.NoColorSpace);
      expect(surface.albedo.generateMipmaps).toBe(true); expect(surface.albedo.minFilter).toBe(THREE.LinearMipmapLinearFilter);
      expect(surface.albedo.wrapS).toBe(THREE.RepeatWrapping); expect(surface.albedo.wrapT).toBe(THREE.RepeatWrapping);
      surface.albedo.dispose(); surface.height.dispose();
    }
  });

  it('owns exactly four textures per renderer and releases textures/materials once without affecting another owner', () => {
    const owner = new TextureOwner(), otherOwner = new TextureOwner();
    const materials = createInteriorMaterials(owner), other = createInteriorMaterials(otherOwner);
    const arrays = [materials.rooms, materials.works];
    const textures = arrays.flatMap(pair => [pair[0].map!, pair[0].bumpMap!]);
    const otherTextures = [other.rooms, other.works].flatMap(pair => [pair[0].map!, pair[0].bumpMap!]);
    expect(new Set(textures).size).toBe(4); expect(new Set([...textures, ...otherTextures]).size).toBe(8);
    const all = [...textures, ...arrays.flat()], counts = new Map(all.map(x => [x, 0]));
    for (const resource of all) resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource)! + 1));
    let otherDisposed = 0; for (const texture of otherTextures) texture.addEventListener('dispose', () => otherDisposed++);
    const pools = arrays.map((pair, i) => new InstancePool(interiorGeometry(i === 1), pair, 1));
    for (const [floor, partition] of arrays) {
      expect(floor.vertexColors).toBe(false); expect(partition.vertexColors).toBe(true);
      expect(partition.map).toBeNull(); expect(partition.bumpMap).toBeNull();
      expect(floor.color.getHex()).toBe(0xffffff);
    }
    owner.dispose(); owner.dispose(); for (const pool of pools) { pool.dispose(); pool.dispose(); }
    expect([...counts.values()]).toEqual(all.map(() => 1)); expect(otherDisposed).toBe(0);
    otherOwner.dispose(); for (const material of [...other.rooms, ...other.works]) material.dispose();
    expect(otherDisposed).toBe(4);
  });
});