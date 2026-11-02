/**
 * Interface scale. The desktop app zooms the whole page, as a browser's own
 * zoom does, so the layout, the 3D view's resolution and its mouse picking all
 * stay consistent. (CSS `zoom` would not: it widens 100vw past the window and
 * scales pixel offsets set from mouse positions.) A page cannot set a
 * browser's zoom, so in a browser the player uses Ctrl + and Ctrl −.
 */
export const UI_SCALES = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

const KEY = 'og.uiScale';
// The smallest window the layout is drawn for (electron/main.cjs minWidth/minHeight).
const MIN_WIDTH = 1024, MIN_HEIGHT = 640;

interface DesktopView { zoom(): number; setZoom(factor: number): void }
const desktopView = (): DesktopView | undefined =>
  (globalThis as { ogDesktop?: { view?: DesktopView } }).ogDesktop?.view;

/** Whether this build can scale the interface (the desktop app). */
export const uiScaleAvailable = (): boolean => !!desktopView();

export function readUiScale(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return (UI_SCALES as readonly number[]).includes(v) ? v : 1;
  } catch { return 1; }
}

export function writeUiScale(scale: number): void {
  try { localStorage.setItem(KEY, String(scale)); } catch { /* session only */ }
}

/** The scale a window of this size (unzoomed pixels) can take: enlarging never
 * leaves less room than the smallest window, so a small window caps it. */
export function fittedUiScale(scale: number, width: number, height: number): number {
  if (scale <= 1) return scale;
  const room = Math.floor(Math.min(width / MIN_WIDTH, height / MIN_HEIGHT) * 20) / 20;
  return Math.max(1, Math.min(scale, room));
}

/** The scale the page is drawn at now (1 in a browser). */
export const uiScaleInUse = (): number => desktopView()?.zoom() ?? 1;

/** The window's size before any zoom. */
function windowSize(view: DesktopView): { width: number; height: number } {
  const zoom = view.zoom();
  return { width: window.innerWidth * zoom, height: window.innerHeight * zoom };
}

/** Zooms the desktop page to `scale`, as far as the window allows; returns the
 * scale in use (always 1 in a browser). */
export function applyUiScale(scale: number): number {
  const view = desktopView();
  if (!view) return 1;
  const { width, height } = windowSize(view);
  const used = fittedUiScale(scale, width, height);
  if (Math.abs(used - view.zoom()) > 0.001) view.setZoom(used);
  return used;
}

/** Applies the saved scale now and again whenever the window is resized. */
export function installUiScale(current: () => number = readUiScale): void {
  if (!desktopView()) return;
  applyUiScale(current());
  window.addEventListener('resize', () => applyUiScale(current()));
}
