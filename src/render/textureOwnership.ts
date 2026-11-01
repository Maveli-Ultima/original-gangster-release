import { RepeatWrapping, Texture } from 'three';

/** A renderer owns wrappers/GPU allocations, while the cache owns decoded sources. */
export class TextureOwner {
  private textures = new Set<Texture>();
  private disposed = false;

  own<T extends Texture>(texture: T): T {
    if (this.disposed) throw new Error('Texture owner is disposed');
    this.textures.add(texture);
    return texture;
  }

  clone(source: Texture, repeatX?: number, repeatY?: number): Texture {
    if (this.disposed) throw new Error('Texture owner is disposed');
    // Three copies the wrapper and shares source/image; no image decode or copy.
    const texture = source.clone();
    if (repeatX != null && repeatY != null) {
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.repeat.set(repeatX, repeatY);
    }
    return this.own(texture);
  }

  replace(previous: Texture | null, source: Texture, repeatX?: number, repeatY?: number): Texture {
    const replacement = this.clone(source, repeatX, repeatY);
    if (previous && this.textures.delete(previous)) previous.dispose();
    return replacement;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const texture of this.textures) texture.dispose();
    this.textures.clear();
  }
}
