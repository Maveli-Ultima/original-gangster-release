import { afterEach, describe, expect, it, vi } from 'vitest';
import { Camera, Mesh, PlaneGeometry, Scene, Texture } from 'three';
import { RoadSurfaceMaterial } from '../src/render/roadSurface';
import { TextureOwner } from '../src/render/textureOwnership';
import { prepareScene } from '../src/render/prepareScene';

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const ctx = { scale:vi.fn(), beginPath:vi.fn(), moveTo:vi.fn(), lineTo:vi.fn(), stroke:vi.fn(),
    setLineDash:vi.fn(), fillRect:vi.fn(), clearRect:vi.fn(), fillText:vi.fn() };
  vi.stubGlobal('document', { createElement:()=>({ width:0, height:0, getContext:()=>ctx }) });
  const owner=new TextureOwner(), overlay=owner.own(new Texture());
  const fallback={width:256,height:256} as HTMLCanvasElement;
  const material=new RoadSurfaceMaterial(overlay,owner,fallback);
  return {owner,overlay,material};
}

describe('road detail texture lifetime', () => {
  it('prepares all detail textures before drawing, without adding meshes', async () => {
    const {material,overlay}=fixture(), scene=new Scene();
    scene.add(new Mesh(new PlaneGeometry(972,972),material));
    const renderer={compile:vi.fn(),initTexture:vi.fn()};
    expect(await prepareScene(renderer,scene,new Camera(),()=>true)).toBe(true);
    const uploaded=new Set(renderer.initTexture.mock.calls.map(call=>call[0]));
    expect(uploaded).toEqual(new Set([overlay,material.asphaltMap,material.markingMap,material.labelMap,material.roadBlocks,material.lineNames]));
    expect(scene.children).toHaveLength(1);
  });

  it('replaces asphalt and repaints late fonts without allocating more wrappers or altering overlays', () => {
    const {material,overlay}=fixture();
    const asphalt=material.asphaltMap, labels=material.labelMap, markings=material.markingMap;
    const versions=[asphalt.version,labels.version,markings.version,overlay.version];
    const image={width:512,height:512} as HTMLImageElement;
    const freed=vi.fn();asphalt.addEventListener('dispose',freed);
    material.setAsphalt(image); material.refreshLabels();
    // A new wrapper takes the photograph (an uploaded one cannot grow), in the
    // old one's place; the old is freed, never refilled and uploaded again.
    expect(material.asphaltMap).not.toBe(asphalt); expect(material.asphaltMap.image).toBe(image); expect(freed).toHaveBeenCalledTimes(1);
    expect(material.labelMap).toBe(labels); expect(material.markingMap).toBe(markings);
    expect([labels.version,markings.version,overlay.version]).toEqual([versions[1]+1,versions[2],versions[3]]);
  });

  it('releases GPU wrappers once and owned canvas backing, preserving the shared asphalt image', () => {
    const {material,owner,overlay}=fixture();
    const image={width:512,height:512} as HTMLImageElement; material.setAsphalt(image);
    const dispose=[overlay,material.asphaltMap,material.markingMap,material.labelMap].map(texture=>{
      const spy=vi.fn();texture.addEventListener('dispose',spy);return spy;
    });
    owner.dispose();owner.dispose();material.dispose();
    for(const spy of dispose) expect(spy).toHaveBeenCalledTimes(1);
    expect([material.markingMap.image.width,material.labelMap.image.width]).toEqual([0,0]);
    expect([image.width,image.height]).toEqual([512,512]);
  });
});
