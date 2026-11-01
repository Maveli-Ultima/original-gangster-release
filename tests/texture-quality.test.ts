import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { limitTextureSize, readTextureQuality, STANDARD_TEXTURE_SIZE, textureLimit } from '../src/render/textureQuality';

describe('model texture quality (A20)', () => {
  it('keeps the approved full-size textures unless Standard is chosen', () => {
    expect(readTextureQuality()).toBe('high');
    expect(textureLimit('high')).toBeNull();
    expect(textureLimit('standard')).toBe(STANDARD_TEXTURE_SIZE);
  });

  it('leaves a texture alone when there is no limit or it already fits', () => {
    const texture = new THREE.Texture({ width: 2048, height: 2048 } as never);
    expect(limitTextureSize(texture, null)).toBe(false);
    const small = new THREE.Texture({ width: 512, height: 512 } as never);
    expect(limitTextureSize(small, 1024)).toBe(false);
  });
});
