import { type Material, type Mesh, type Object3D } from 'three';

type ShadowHook = Object3D['onBeforeShadow'];

/**
 * Three r169's shared shadow depth material is outside the scene and is not
 * disposed by WebGLRenderer.dispose(). Capture it through the public shadow
 * callback, without changing shader selection or replacing custom actor depth.
 */
export class ShadowMaterialOwner {
  private hooks = new Map<Object3D, { before: ShadowHook; installed: ShadowHook; seen: number }>();
  private materials = new Set<Material>();
  private disposed = false;
  private revision = 0;
  private released = (event: { target: Material }) => {
    this.materials.delete(event.target);
    event.target.removeEventListener('dispose', this.released);
  };

  /** Also discovers meshes added later by optional, asynchronous model loaders. */
  watch(scene: Object3D): void {
    if (this.disposed) return;
    const seen = ++this.revision;
    scene.traverse(object => {
      if (!object.castShadow) return;
      const known = this.hooks.get(object);
      if (known) { known.seen = seen; return; }
      const before = object.onBeforeShadow;
      const owner = this;
      // Named parameters, not a rest array: this runs for every caster in
      // every shadow pass, and an array per call was a steady stream of garbage.
      const installed: ShadowHook = function (this: Object3D, renderer, scene, camera, shadowCamera, geometry, material, group) {
        const mesh = this as Mesh;
        // Custom walking/skinning depth materials retain their existing owner.
        if (!owner.disposed && material !== mesh.customDepthMaterial && material !== mesh.customDistanceMaterial &&
          !owner.materials.has(material)) {
          owner.materials.add(material);
          material.addEventListener('dispose', owner.released);
        }
        before.call(this, renderer, scene, camera, shadowCamera, geometry, material, group);
      };
      this.hooks.set(object, { before, installed, seen });
      object.onBeforeShadow = installed;
    });
    // A model loader can remove whole groups, without dispatching "removed" on
    // each descendant mesh. Drop our references to those casters next frame.
    this.hooks.forEach((hook, object) => {
      if (hook.seen === seen) return;
      if (object.onBeforeShadow === hook.installed) object.onBeforeShadow = hook.before;
      this.hooks.delete(object);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [object, hook] of this.hooks) {
      if (object.onBeforeShadow === hook.installed) object.onBeforeShadow = hook.before;
    }
    this.hooks.clear();
    // Cached depth clones may already have been released with their source
    // materials. Their dispose listener removes them from this set.
    for (const material of this.materials) {
      material.removeEventListener('dispose', this.released);
      material.dispose();
    }
    this.materials.clear();
  }
}

type ShaderContext = Pick<WebGLRenderingContext, 'getAttachedShaders' | 'deleteShader'>;

/**
 * On final teardown, release shaders compiled but never drawn. Three r169
 * normally marks shaders for deletion on first use, so an unvisited material
 * variant or cancelled preparation otherwise depends on browser GC.
 */
export function releaseAttachedShaders(gl: ShaderContext, programs: Iterable<{ program?: WebGLProgram }>): void {
  const shaders = new Set<WebGLShader>();
  for (const entry of programs) {
    if (!entry.program) continue;
    for (const shader of gl.getAttachedShaders(entry.program) ?? []) shaders.add(shader);
  }
  // WebGL deletion is deferred while attached and is safe when already marked.
  // Call before materials dispose their programs; never before another draw.
  for (const shader of shaders) gl.deleteShader(shader);
}
