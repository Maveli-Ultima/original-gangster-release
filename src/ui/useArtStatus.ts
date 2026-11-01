import { useEffect, useState } from 'react';
import { watchArtImage, type ArtStatus } from './artRecovery';

/** Key results to the requested URL so changing faces never shows a stale face. */
export function useArtStatus(src: string | undefined): ArtStatus {
  const [result, setResult] = useState<{ src: string; status: ArtStatus }>();
  useEffect(() => {
    if (src) return watchArtImage(src, status => setResult({ src, status }));
  }, [src]);
  return !src ? 'failed' : result?.src === src ? result.status : 'loading';
}
