import { afterEach, describe, expect, it, vi } from 'vitest';
import { Texture } from 'three';
import { CityRenderer } from '../src/render/scene';
import type { CityArt } from '../src/render/textures';
import type { WorldState } from '../src/sim/types';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const created: { width: number; height: number; getContext(): object }[] = [];
  vi.stubGlobal('document', { createElement: () => {
    const canvas = { width: 0, height: 0, getContext: () => ({}) };
    created.push(canvas); return canvas;
  } });
  const groundCtx = { clearRect: vi.fn(), drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
  const world = { gridW: 1, gridH: 1, blocks: [{ id: 0, gx: 0, gy: 0 }] } as WorldState;
  const drawGroundBase = vi.fn(), overlayColor = vi.fn(() => 'rgba(255,0,0,0.2)');
  const city = Object.assign(Object.create(CityRenderer.prototype), {
    groundMat: { setAsphalt: vi.fn() }, world, groundCanvas: { width: 108, height: 108 }, groundCtx, groundTexture: new Texture(), groundBase: null,
    overlays: [], overlayColor, drawGroundBase, actorMotion: { clear: vi.fn() }, refreshStreet: vi.fn(),
  }) as { drawGround(): void; setWorld(world: WorldState): void; applyArt(art: CityArt): void; clearGroundBase(): void;
    groundBase: HTMLCanvasElement | null; groundTexture: Texture };
  return { city, world, groundCtx, drawGroundBase, overlayColor, created };
}

describe('static road cache', () => {
  it('reuses static markings while painting each changed overlay and uploading the completed image', () => {
    const f = fixture();
    f.city.drawGround();
    f.overlayColor.mockReturnValue('rgba(0,0,255,0.2)'); f.city.drawGround();
    expect(f.drawGroundBase).toHaveBeenCalledTimes(1);
    expect(f.groundCtx.clearRect.mock.calls).toEqual([[0, 0, 108, 108], [0, 0, 108, 108]]);
    expect(f.groundCtx.clearRect.mock.invocationCallOrder[1]).toBeLessThan(f.groundCtx.drawImage.mock.invocationCallOrder[1]);
    expect(f.groundCtx.drawImage).toHaveBeenCalledTimes(2);
    expect(f.groundCtx.fillRect).toHaveBeenCalledTimes(2);
    expect(f.groundCtx.fillStyle).toBe('rgba(0,0,255,0.2)');
    expect(f.city.groundTexture.version).toBe(2);
  });

  it('keeps strategic paint when asphalt arrives and rebuilds after world replacement', () => {
    const f = fixture(); f.city.drawGround();
    const first = f.city.groundBase!;
    f.city.applyArt({ facades: [], road: { width: 512 } } as unknown as CityArt);
    expect(f.city.groundBase).toBe(first);
    expect(first.width).toBe(108); expect(first.height).toBe(108);
    f.city.drawGround();
    const second = f.city.groundBase!;
    f.city.setWorld(f.world);
    expect(second.width).toBe(0); expect(second.height).toBe(0);
    f.city.drawGround();
    expect(f.drawGroundBase).toHaveBeenCalledTimes(2);
    expect(f.created).toHaveLength(2);
  });

  it('releases its backing surface when invalidated, including repeated cleanup', () => {
    const f = fixture(); f.city.drawGround(); const base = f.city.groundBase!;
    f.city.clearGroundBase(); f.city.clearGroundBase();
    expect(f.city.groundBase).toBeNull();
    expect([base.width, base.height]).toEqual([0, 0]);
  });
});
