/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { crestUrl, portraitUrl } from '../src/ui/art';

class ImageStub {
  static requests: ImageStub[] = [];
  src = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { ImageStub.requests.push(this); }
}
let watch: typeof import('../src/ui/artRecovery').watchArtImage;
let browser: EventTarget;
let page: EventTarget & { visibilityState: string };
let stops: (() => void)[];
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const start = (src: string, report = vi.fn()) => {
  stops.push(watch(src, report));
  return report;
};
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  ImageStub.requests = [];
  stops = [];
  browser = new EventTarget();
  page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', page);
  vi.stubGlobal('Image', ImageStub);
  watch = (await import('../src/ui/artRecovery')).watchArtImage;
});
afterEach(() => {
  stops.forEach(stop => stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('menu artwork recovery', () => {
  it('shares one successful request and leaves loaded art alone when focus returns', async () => {
    const first = start('/art/crests/red.png'), second = start('/art/crests/red.png');
    expect(ImageStub.requests).toHaveLength(1);
    ImageStub.requests[0].onload!(); await settle();
    expect(first).toHaveBeenLastCalledWith('loaded');
    expect(second).toHaveBeenLastCalledWith('loaded');
    browser.dispatchEvent(new Event('focus'));
    await vi.runAllTimersAsync();
    expect(ImageStub.requests).toHaveLength(1);
  });

  it('restores the same image URL after a temporary request failure', async () => {
    const report = start('/art/portraits/m/m-08.png');
    ImageStub.requests[0].onerror!(); await settle();
    expect(report).toHaveBeenLastCalledWith('failed');
    await vi.advanceTimersByTimeAsync(1000);
    expect(ImageStub.requests.map(i => i.src)).toEqual(['/art/portraits/m/m-08.png', '/art/portraits/m/m-08.png']);
    ImageStub.requests[1].onload!(); await settle();
    expect(report).toHaveBeenLastCalledWith('loaded');
    await vi.runAllTimersAsync();
    expect(ImageStub.requests).toHaveLength(2);
  });

  it.each(['online', 'focus', 'visibilitychange'])('can recover on %s after exhausting automatic retries', async event => {
    const report = start('/art/icons/misc/bearingFemale.png');
    for (let i = 0; i < 4; i++) {
      ImageStub.requests[i].onerror!(); await settle();
      await vi.runAllTimersAsync();
    }
    expect(ImageStub.requests).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(0);
    (event === 'visibilitychange' ? page : browser).dispatchEvent(new Event(event));
    expect(ImageStub.requests).toHaveLength(5);
    ImageStub.requests[4].onload!(); await settle();
    expect(report).toHaveBeenLastCalledWith('loaded');
  });

  it('does not duplicate pending requests or retry just because a tab becomes hidden', async () => {
    start('/art/crests/blue.png');
    browser.dispatchEvent(new Event('online'));
    browser.dispatchEvent(new Event('focus'));
    expect(ImageStub.requests).toHaveLength(1);
    ImageStub.requests[0].onerror!(); await settle();
    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    expect(ImageStub.requests).toHaveLength(1);
  });

  it('cleans up timers and listeners when a face changes or the menu closes', async () => {
    const old = start('/art/portraits/m/m-01.png');
    ImageStub.requests[0].onerror!(); await settle();
    stops[0]();
    const next = start('/art/portraits/f/f-01.png');
    await vi.runAllTimersAsync();
    browser.dispatchEvent(new Event('focus'));
    expect(ImageStub.requests).toHaveLength(2);
    ImageStub.requests[1].onload!(); await settle();
    expect(next).toHaveBeenLastCalledWith('loaded');
    expect(old).toHaveBeenCalledTimes(1);
  });

  it('ignores completion after unmount, including StrictMode effect cleanup', async () => {
    const old = start('/art/crests/green.png');
    stops[0]();
    const current = start('/art/crests/green.png');
    expect(ImageStub.requests).toHaveLength(1);
    ImageStub.requests[0].onload!(); await settle();
    expect(old).not.toHaveBeenCalled();
    expect(current).toHaveBeenLastCalledWith('loaded');
  });
});

it('ships all 96 painted portraits, four colour crests and both bearing icons at the requested paths', () => {
  const paths = [
    ...Array.from({ length: 64 }, (_, portrait) => portraitUrl({ portrait, female: false })),
    ...Array.from({ length: 32 }, (_, portrait) => portraitUrl({ portrait, female: true })),
    ...['red', 'green', 'blue', 'orange'].map(crestUrl),
    '/art/icons/misc/bearingMale.png', '/art/icons/misc/bearingFemale.png',
  ];
  expect(new Set(paths).size).toBe(102);
  for (const path of paths) {
    const png = readFileSync(`public${path}`);
    expect(png.subarray(0, 8).toString('hex'), path).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16), path).toBeGreaterThanOrEqual(64);
    expect(png.readUInt32BE(20), path).toBeGreaterThanOrEqual(64);
  }
});
