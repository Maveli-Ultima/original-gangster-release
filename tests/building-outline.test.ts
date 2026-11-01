import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { BuildingOutline } from '../src/render/buildingOutline';

function fixture() {
  const geometry = new THREE.ConeGeometry(3, 8, 4), material = new THREE.MeshBasicMaterial();
  const source = new THREE.InstancedMesh(geometry, material, 2);
  source.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-70, 4, 0));
  source.setMatrixAt(1, new THREE.Matrix4().makeTranslation(5, 4, 0));
  const outline = new BuildingOutline();
  outline.setInstances([{ mesh: source, start: 1, count: 1 }]); outline.visible = true;
  const camera = new THREE.OrthographicCamera(-20, 20, 12, -12, .1, 100);
  camera.position.set(20, 20, 20); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
  const renderer = {
    info: { autoReset: true }, autoClear: true, target: null as THREE.WebGLRenderTarget | null, scissor: true,
    color: new THREE.Color(0x234567), alpha: .7, size: new THREE.Vector2(1200, 720),
    getDrawingBufferSize(out: THREE.Vector2) { return out.copy(this.size); },
    getPixelRatio: () => 1.5,
    getRenderTarget() { return this.target; }, setRenderTarget(target: THREE.WebGLRenderTarget | null) { this.target = target; },
    getScissorTest() { return this.scissor; }, setScissorTest(value: boolean) { this.scissor = value; },
    getClearColor(out: THREE.Color) { return out.copy(this.color); }, getClearAlpha() { return this.alpha; },
    setClearColor(color: THREE.ColorRepresentation, alpha: number) { this.color.set(color); this.alpha = alpha; },
    render: vi.fn(),
  };
  const draw = () => outline.render(renderer as unknown as THREE.WebGLRenderer, camera);
  const close = () => { outline.dispose(); source.dispose(); geometry.dispose(); material.dispose(); };
  return { outline, source, geometry, material, camera, renderer, draw, close };
}

describe('building silhouette glow', () => {
  it('uses the selected instance geometry, including non-box roofs, and survives shared pool changes', () => {
    const f = fixture();
    try {
      expect(f.outline.partCount).toBe(1);
      const part = f.outline.shape.children[0] as THREE.Mesh;
      expect(part.geometry).toBe(f.geometry);
      expect(part.material).not.toBe(f.material);
      f.outline.shape.updateMatrixWorld(true);
      const before = new THREE.Box3().setFromObject(f.outline.shape);
      expect(before.min.x).toBeGreaterThan(0); expect(before.max.x).toBeLessThan(10);
      f.source.setMatrixAt(1, new THREE.Matrix4().makeTranslation(100, 100, 100));
      expect(new THREE.Box3().setFromObject(f.outline.shape)).toEqual(before);
    } finally { f.close(); }
  });

  it('caches a stationary mask, updates for camera/viewport changes, and keeps renderer state intact', () => {
    const f = fixture();
    try {
      f.draw(); f.draw();
      expect(f.renderer.render.mock.calls.filter(([scene]) => scene === f.outline.shape)).toHaveLength(1);
      expect(f.renderer.render).toHaveBeenCalledTimes(3);
      f.camera.position.x += 2; f.draw();
      expect(f.renderer.render.mock.calls.filter(([scene]) => scene === f.outline.shape)).toHaveLength(2);
      f.renderer.size.set(1500, 900); f.draw();
      expect(f.renderer.render.mock.calls.filter(([scene]) => scene === f.outline.shape)).toHaveLength(3);
      expect(f.renderer.target).toBeNull(); expect(f.renderer.scissor).toBe(true); expect(f.renderer.autoClear).toBe(true);
      expect(f.renderer.color.getHex()).toBe(0x234567); expect(f.renderer.alpha).toBe(.7); expect(f.renderer.info.autoReset).toBe(true);
      f.outline.visible = false; f.renderer.render.mockClear(); f.draw();
      expect(f.renderer.render).not.toHaveBeenCalled();
    } finally { f.close(); }
  });

  it('restores the scene state after a failed mask draw', () => {
    const f = fixture();
    try {
      f.renderer.render.mockImplementationOnce(() => { throw new Error('interrupted draw'); });
      expect(f.draw).toThrow('interrupted draw');
      expect(f.renderer.target).toBeNull(); expect(f.renderer.autoClear).toBe(true); expect(f.renderer.scissor).toBe(true);
      expect(f.renderer.color.getHex()).toBe(0x234567); expect(f.renderer.alpha).toBe(.7); expect(f.renderer.info.autoReset).toBe(true);
    } finally { f.close(); }
  });

  it('follows ornament visibility and never disposes the city geometry or materials', () => {
    const f = fixture();
    try {
      const geometryDispose = vi.spyOn(f.geometry, 'dispose'), materialDispose = vi.spyOn(f.material, 'dispose');
      f.draw(); f.source.visible = false; f.draw();
      expect(f.outline.shape.children[0].visible).toBe(false);
      f.outline.clear(); f.draw();
      expect(f.outline.partCount).toBe(0);
      f.outline.dispose(); f.outline.dispose();
      expect(geometryDispose).not.toHaveBeenCalled(); expect(materialDispose).not.toHaveBeenCalled();
    } finally { f.close(); }
  });
});
