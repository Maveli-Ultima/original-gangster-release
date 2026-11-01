import type { ImgHTMLAttributes } from 'react';
import { useArtStatus } from './useArtStatus';

/** Text identity survives failed brand/masthead images; decoration may disappear. */
export function ArtImage({ src, alt = '', ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const status = useArtStatus(src);
  if (status === 'failed') return alt ? <span className={`art-text-fallback ${props.className ?? ''}`} role="img" aria-label={alt}>{alt}</span> : null;
  return <img {...props} src={src} alt={alt} />;
}
