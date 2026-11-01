import { describe, expect, it, vi } from 'vitest';
import { Material, Mesh, MeshDepthMaterial, Scene, type Object3D } from 'three';
import { releaseAttachedShaders, ShadowMaterialOwner } from '../src/render/shadowMaterialOwnership';

function sceneWithMesh() {
  const scene = new Scene(), mesh = new Mesh();
  mesh.castShadow = true; scene.add(mesh);
  return { scene, mesh };
}
function shadow(object: Object3D, material: Material) {
  const args = [null, null, null, null, null, material, null] as unknown as Parameters<Object3D['onBeforeShadow']>;
  object.onBeforeShadow(...args);
}

describe('shadow material ownership', () => {
  it('releases one engine-owned depth material shared by multiple meshes exactly once', () => {
    const { scene, mesh } = sceneWithMesh(), other = new Mesh();
    other.castShadow = true; scene.add(other);
    const owner = new ShadowMaterialOwner(), depth = new MeshDepthMaterial(), released = vi.fn();
    depth.addEventListener('dispose', released);
    owner.watch(scene); shadow(mesh, depth); shadow(other, depth); shadow(mesh, depth);
    owner.dispose(); owner.dispose();
    expect(released).toHaveBeenCalledTimes(1);
  });

  it('preserves custom walking and point-light depth ownership', () => {
    const { scene, mesh } = sceneWithMesh(), owner = new ShadowMaterialOwner();
    const customDepth = new MeshDepthMaterial(), customDistance = new Material();
    mesh.customDepthMaterial = customDepth; mesh.customDistanceMaterial = customDistance;
    const depthDisposed = vi.fn(), distanceDisposed = vi.fn();
    customDepth.addEventListener('dispose', depthDisposed); customDistance.addEventListener('dispose', distanceDisposed);
    owner.watch(scene); shadow(mesh, customDepth); shadow(mesh, customDistance); owner.dispose();
    expect(depthDisposed).not.toHaveBeenCalled();
    expect(distanceDisposed).not.toHaveBeenCalled();
    expect(mesh.customDepthMaterial).toBe(customDepth);
  });

  it('does not dispose cached clones twice when their source material already released them', () => {
    const { scene, mesh } = sceneWithMesh(), owner = new ShadowMaterialOwner(), depth = new MeshDepthMaterial();
    const released = vi.fn(); depth.addEventListener('dispose', released);
    owner.watch(scene); shadow(mesh, depth); depth.dispose(); owner.dispose();
    expect(released).toHaveBeenCalledTimes(1);
  });

  it('chains the original shadow callback with its arguments and restores it', () => {
    const { scene, mesh } = sceneWithMesh(), owner = new ShadowMaterialOwner();
    const before = vi.fn(function(this: Object3D, ..._args: Parameters<Object3D['onBeforeShadow']>) { expect(this).toBe(mesh); });
    mesh.onBeforeShadow = before; owner.watch(scene);
    const installed = mesh.onBeforeShadow; owner.watch(scene);
    expect(mesh.onBeforeShadow).toBe(installed);
    const depth = new MeshDepthMaterial(); shadow(mesh, depth);
    expect(before).toHaveBeenCalledTimes(1);
    expect(before.mock.calls[0][5]).toBe(depth);
    owner.dispose(); expect(mesh.onBeforeShadow).toBe(before);
  });

  it('discovers late-loaded casters without retaining hooks after disposal', () => {
    const scene = new Scene(), owner = new ShadowMaterialOwner(); owner.watch(scene);
    const mesh = new Mesh(); mesh.castShadow = true; const before = mesh.onBeforeShadow; scene.add(mesh);
    owner.watch(scene); const depth = new MeshDepthMaterial(), released = vi.fn();
    depth.addEventListener('dispose', released); shadow(mesh, depth);
    owner.dispose(); expect(mesh.onBeforeShadow).toBe(before); expect(released).toHaveBeenCalledOnce();
    owner.watch(scene); expect(mesh.onBeforeShadow).toBe(before);
  });

  it('does not overwrite a later callback installed by another owner', () => {
    const { scene, mesh } = sceneWithMesh(), owner = new ShadowMaterialOwner(); owner.watch(scene);
    const later = vi.fn(); mesh.onBeforeShadow = later; owner.dispose();
    expect(mesh.onBeforeShadow).toBe(later);
  });
});

describe('unvisited compiled shader cleanup', () => {
  it('marks every unique attached shader for deletion before its program disappears', () => {
    const a = {} as WebGLShader, b = {} as WebGLShader, c = {} as WebGLShader;
    const p = {} as WebGLProgram, q = {} as WebGLProgram;
    const gl = { getAttachedShaders: vi.fn(program => program === p ? [a, b] : [b, c]), deleteShader: vi.fn() };
    releaseAttachedShaders(gl, [{ program: p }, { program: q }]);
    expect(gl.deleteShader.mock.calls).toEqual([[a], [b], [c]]);
  });

  it('handles a lost context with no attached shader results', () => {
    const gl = { getAttachedShaders: vi.fn(() => null), deleteShader: vi.fn() };
    releaseAttachedShaders(gl, [{ program: {} as WebGLProgram }]);
    expect(gl.deleteShader).not.toHaveBeenCalled();
  });

  it('ignores already-released program records', () => {
    const gl = { getAttachedShaders: vi.fn(() => []), deleteShader: vi.fn() };
    releaseAttachedShaders(gl, [{}]);
    expect(gl.getAttachedShaders).not.toHaveBeenCalled();
    expect(gl.deleteShader).not.toHaveBeenCalled();
  });
});

it('restores hooks for casters removed with an entire group during play', () => {
  const scene = new Scene(), group = new Scene(), mesh = new Mesh(), owner = new ShadowMaterialOwner();
  mesh.castShadow = true; group.add(mesh); scene.add(group);
  const original = mesh.onBeforeShadow;
  owner.watch(scene); expect(mesh.onBeforeShadow).not.toBe(original);
  group.removeFromParent(); owner.watch(scene);
  expect(mesh.onBeforeShadow).toBe(original);
  scene.add(group); owner.watch(scene);
  expect(mesh.onBeforeShadow).not.toBe(original);
  owner.dispose(); expect(mesh.onBeforeShadow).toBe(original);
});
