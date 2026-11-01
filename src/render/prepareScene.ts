import { Mesh, Texture, type Camera, type Scene, type WebGLRenderer } from 'three';
import { yieldForInput } from '../yieldForInput';

/** Submit shaders first, then upload one texture per input turn before drawing. */
export async function prepareScene(
  renderer: Pick<WebGLRenderer, 'compile' | 'initTexture'>,
  scene: Scene,
  camera: Camera,
  isCurrent: () => boolean,
): Promise<boolean> {
  await yieldForInput();
  if (!isCurrent()) return false;
  // compile submits work without Three's asynchronous polling retaining this
  // renderer after disposal. Shader diagnostics remain enabled on first use.
  renderer.compile(scene, camera);
  await yieldForInput();
  if (!isCurrent()) return false;
  const textures = new Set<Texture>();
  scene.traverseVisible(object => {
    const materials = (object as Mesh).material;
    for (const material of materials ? (Array.isArray(materials) ? materials : [materials]) : []) {
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
  });
  for (const texture of textures) {
    if (!isCurrent()) return false;
    renderer.initTexture(texture);
    await yieldForInput();
  }
  return isCurrent();
}
