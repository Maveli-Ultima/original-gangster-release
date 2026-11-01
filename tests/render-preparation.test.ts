import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Camera, Group, Mesh, MeshStandardMaterial, Scene, Texture } from 'three';
import { prepareScene } from '../src/render/prepareScene';

function fixture() {
  const scene = new Scene(), camera = new Camera();
  const first = new Texture(), second = new Texture(), hidden = new Texture();
  const a = new MeshStandardMaterial({ map: first, emissiveMap: first });
  const b = new MeshStandardMaterial({ map: second });
  scene.add(new Mesh(new BoxGeometry(), [a, b]));
  scene.add(new Mesh(new BoxGeometry(), a));
  const group = new Group(); group.visible = false;
  group.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: hidden })));
  scene.add(group);
  const renderer = { compile: vi.fn(() => new Set([a, b])), initTexture: vi.fn() };
  return { scene, camera, first, second, hidden, renderer };
}


describe('staged scene preparation', () => {
  it('allows input before compilation and between unique visible texture uploads', async () => {
    const f = fixture(), events: string[] = [];
    const input = (name: string) => { setTimeout(() => events.push(name), 0); };
    input('input before compilation');
    f.renderer.compile.mockImplementation(() => {
      events.push('compile'); input('input before uploads'); return new Set();
    });
    f.renderer.initTexture.mockImplementation(texture => {
      const name = texture === f.first ? 'first' : 'second';
      events.push(name); input('input after ' + name);
    });
    const result = prepareScene(f.renderer, f.scene, f.camera, () => true);
    expect(f.renderer.compile).not.toHaveBeenCalled();
    expect(await result).toBe(true);
    expect(events).toEqual(['input before compilation', 'compile', 'input before uploads',
      'first', 'input after first', 'second', 'input after second']);
    expect(f.renderer.initTexture.mock.calls).toEqual([[f.first], [f.second]]);
  });

  it('does no GPU work when cancelled before its first turn', async () => {
    const f = fixture();
    expect(await prepareScene(f.renderer, f.scene, f.camera, () => false)).toBe(false);
    expect(f.renderer.compile).not.toHaveBeenCalled();
    expect(f.renderer.initTexture).not.toHaveBeenCalled();
  });

  it('stops after shader submission when the scene is replaced', async () => {
    const f = fixture(); let current = true;
    f.renderer.compile.mockImplementation(() => { current = false; return new Set(); });
    expect(await prepareScene(f.renderer, f.scene, f.camera, () => current)).toBe(false);
    expect(f.renderer.initTexture).not.toHaveBeenCalled();
  });

  it('never uploads remaining captured wrappers after replacement or disposal', async () => {
    const f = fixture(); let current = true;
    f.renderer.initTexture.mockImplementation(() => { current = false; });
    expect(await prepareScene(f.renderer, f.scene, f.camera, () => current)).toBe(false);
    expect(f.renderer.initTexture.mock.calls).toEqual([[f.first]]);
  });

  it('checks cancellation after the last texture too', async () => {
    const f = fixture(); let current = true;
    f.renderer.initTexture.mockImplementation(texture => { if (texture === f.second) current = false; });
    expect(await prepareScene(f.renderer, f.scene, f.camera, () => current)).toBe(false);
    expect(f.renderer.initTexture).toHaveBeenCalledTimes(2);
  });

  it('reports upload failures to the caller without continuing', async () => {
    const f = fixture();
    f.renderer.initTexture.mockImplementation(() => { throw Error('upload rejected'); });
    await expect(prepareScene(f.renderer, f.scene, f.camera, () => true)).rejects.toThrow('upload rejected');
    expect(f.renderer.initTexture).toHaveBeenCalledTimes(1);
  });
});
