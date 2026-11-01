import { loadImage } from './art';

export type ArtStatus = 'loading' | 'loaded' | 'failed';

/** A failed request is not a permanent decision to discard the artwork. */
export function watchArtImage(src: string, report: (status: ArtStatus) => void): () => void {
  const delays = [1000, 3000, 10000];
  let active = true, pending = false, loaded = false, retries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearRetry = () => { clearTimeout(timer); timer = undefined; };
  const attempt = () => {
    if (!active || pending || loaded) return;
    pending = true;
    void loadImage(src).then(() => {
      if (!active) return;
      pending = false;
      loaded = true;
      stopListening();
      report('loaded');
    }).catch(() => {
      if (!active) return;
      pending = false;
      report('failed');
      // Stop automatic retries for genuinely missing files. Returning to the
      // game or reconnecting starts another bounded attempt without losing UI state.
      if (retries < delays.length) timer = setTimeout(attempt, delays[retries++]);
    });
  };
  const recover = () => {
    if (loaded || pending) return;
    clearRetry();
    retries = 0;
    attempt();
  };
  const onVisible = () => { if (document.visibilityState === 'visible') recover(); };
  const stopListening = () => {
    window.removeEventListener('online', recover);
    window.removeEventListener('focus', recover);
    document.removeEventListener('visibilitychange', onVisible);
  };
  window.addEventListener('online', recover);
  window.addEventListener('focus', recover);
  document.addEventListener('visibilitychange', onVisible);
  attempt();
  return () => {
    active = false;
    clearRetry();
    stopListening();
  };
}
