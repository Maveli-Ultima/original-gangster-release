import { afterEach, describe, expect, it, vi } from 'vitest';

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { values.set(k, v); },
    removeItem: (k: string) => { values.delete(k); },
  });
  return values;
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('sound settings', () => {
  it('are kept between sessions, with the music switches', async () => {
    const values = storage();
    const first = (await import('../src/audio/audio')).audio;
    expect([first.musicVolume, first.sfxVolume, first.menuMusic, first.gameMusic]).toEqual([0.35, 0.5, true, true]);
    first.setMusicVolume(0.8); first.setSfxVolume(0.1); first.setMusicPlaces({ menuMusic: false });
    vi.resetModules();
    const next = (await import('../src/audio/audio')).audio;
    expect([next.musicVolume, next.sfxVolume, next.menuMusic, next.gameMusic]).toEqual([0.8, 0.1, false, true]);
    expect(values.has('og.audio')).toBe(true);
  });

  it('ignore damaged or out-of-range values', async () => {
    storage({ 'og.audio': '{"music":7,"sfx":"loud","menuMusic":1}' });
    const a = (await import('../src/audio/audio')).audio;
    expect([a.musicVolume, a.sfxVolume, a.menuMusic]).toEqual([0.35, 0.5, true]);
  });
});
