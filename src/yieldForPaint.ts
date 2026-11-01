import { yieldForInput } from './yieldForInput';

/** Let React commit and the browser paint a loading screen before heavy work. */
export async function yieldForPaint(): Promise<void> {
  if (typeof requestAnimationFrame === 'undefined' || document.visibilityState === 'hidden') {
    await yieldForInput();
    return;
  }
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
