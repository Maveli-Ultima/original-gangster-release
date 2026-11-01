import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, DataTexture, MeshBasicMaterial, Texture } from 'three';
import { TextureOwner } from '../src/render/textureOwnership';
import { InstancePool } from '../src/render/pool';

describe('renderer texture ownership', () => {
  it('shares decoded sources but isolates wrapper disposal between live renderers', () => {
    const source = new DataTexture(new Uint8Array(64), 4, 4);
    const sourceDisposed = vi.fn();
    source.addEventListener('dispose', sourceDisposed);
    const first = new TextureOwner(), second = new TextureOwner();
    const a = first.clone(source, 2, 3), b = second.clone(source);
    const aDisposed = vi.fn(), bDisposed = vi.fn();
    a.addEventListener('dispose', aDisposed);
    b.addEventListener('dispose', bDisposed);
    expect(a).not.toBe(source);
    expect(a).not.toBe(b);
    expect(a.source).toBe(source.source);
    expect(b.image).toBe(source.image);
    expect(source.repeat.toArray()).toEqual([1, 1]);
    first.dispose();
    first.dispose();
    expect(aDisposed).toHaveBeenCalledTimes(1);
    expect(bDisposed).not.toHaveBeenCalled();
    expect(sourceDisposed).not.toHaveBeenCalled();
    second.dispose();
    expect(bDisposed).toHaveBeenCalledTimes(1);
    expect(source.image.width).toBe(4);
    expect(source.image.height).toBe(4);
    expect(source.image.data).toHaveLength(64);
  });

  it('releases replaced fallbacks immediately and final replacements once', () => {
    const owner = new TextureOwner(), source = new Texture();
    const fallback = owner.clone(source), fallbackDisposed = vi.fn();
    fallback.addEventListener('dispose', fallbackDisposed);
    const delivered = owner.replace(fallback, source, 4, 5), deliveredDisposed = vi.fn();
    delivered.addEventListener('dispose', deliveredDisposed);
    expect(fallbackDisposed).toHaveBeenCalledTimes(1);
    expect(delivered.repeat.toArray()).toEqual([4, 5]);
    owner.dispose();
    expect(fallbackDisposed).toHaveBeenCalledTimes(1);
    expect(deliveredDisposed).toHaveBeenCalledTimes(1);
  });

  it('owns local textures without disposing borrowed templates', () => {
    const owner = new TextureOwner(), borrowed = new Texture(), local = new Texture();
    const borrowedDisposed = vi.fn(), localDisposed = vi.fn();
    borrowed.addEventListener('dispose', borrowedDisposed);
    local.addEventListener('dispose', localDisposed);
    expect(owner.own(local)).toBe(local);
    owner.replace(borrowed, borrowed);
    owner.dispose();
    expect(localDisposed).toHaveBeenCalledTimes(1);
    expect(borrowedDisposed).not.toHaveBeenCalled();
    expect(() => owner.clone(borrowed)).toThrow('Texture owner is disposed');
  });
});

it('disposes instance buffers as well as pool geometry and materials, once', () => {
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  const pool = new InstancePool(geometry, material, 2, { color: true });
  const meshDisposed = vi.fn(), geometryDisposed = vi.fn(), materialDisposed = vi.fn();
  pool.mesh.addEventListener('dispose', meshDisposed);
  geometry.addEventListener('dispose', geometryDisposed);
  material.addEventListener('dispose', materialDisposed);
  pool.dispose();
  pool.dispose();
  expect(meshDisposed).toHaveBeenCalledTimes(1);
  expect(geometryDisposed).toHaveBeenCalledTimes(1);
  expect(materialDisposed).toHaveBeenCalledTimes(1);
});
