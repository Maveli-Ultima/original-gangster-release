import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyUiScale, fittedUiScale, readUiScale, uiScaleAvailable, writeUiScale } from '../src/app/uiScale';

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { values.set(k, v); },
  });
  return values;
}

/** A desktop window of this unzoomed size, with the preload's zoom bridge. */
function desktop(width: number, height: number) {
  let zoom = 1;
  const setZoom = vi.fn((f: number) => { zoom = f; });
  vi.stubGlobal('ogDesktop', { view: { zoom: () => zoom, setZoom } });
  vi.stubGlobal('window', { get innerWidth() { return width / zoom; }, get innerHeight() { return height / zoom; } });
  return setZoom;
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('interface scale', () => {
  it('is kept between sessions, and ignores values it does not offer', () => {
    const values = storage();
    expect(readUiScale()).toBe(1);
    writeUiScale(1.25);
    expect(values.get('og.uiScale')).toBe('1.25');
    expect(readUiScale()).toBe(1.25);
    storage({ 'og.uiScale': '1.3' });
    expect(readUiScale()).toBe(1);
    storage({ 'og.uiScale': 'huge' });
    expect(readUiScale()).toBe(1);
  });

  it('never enlarges past the room of the smallest window the layout is drawn for', () => {
    expect(fittedUiScale(2, 3840, 2160)).toBe(2);
    expect(fittedUiScale(2, 1920, 1080)).toBe(1.65);
    expect(fittedUiScale(1.25, 1280, 800)).toBe(1.25);
    expect(fittedUiScale(1.5, 1024, 640)).toBe(1);
    expect(fittedUiScale(0.75, 1024, 640)).toBe(0.75);
  });

  it('zooms the desktop page, and does nothing in a browser', () => {
    expect(uiScaleAvailable()).toBe(false);
    expect(applyUiScale(1.5)).toBe(1);
    const setZoom = desktop(1920, 1080);
    expect(uiScaleAvailable()).toBe(true);
    expect(applyUiScale(1.5)).toBe(1.5);
    expect(setZoom).toHaveBeenLastCalledWith(1.5);
    // Measured in unzoomed pixels, so applying it again changes nothing.
    expect(applyUiScale(1.5)).toBe(1.5);
    expect(setZoom).toHaveBeenCalledTimes(1);
    expect(applyUiScale(2)).toBe(1.65);
    expect(applyUiScale(0.9)).toBe(0.9);
  });
});
