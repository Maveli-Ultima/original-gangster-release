import { useEffect, useRef, useState } from 'react';
import { money } from '../sim/world';

/** A cash figure that rolls to its new value, like the original's counter when
 * money is spent or taken (TODO §4). Honors reduced motion. */
export function MoneyRoll({ value, ms = 650 }: { value: number; ms?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value), frame = useRef(0);
  useEffect(() => {
    const start = from.current;
    if (start === value || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      from.current = value; setShown(value); return;
    }
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), eased = 1 - (1 - k) ** 3;
      const v = Math.round(start + (value - start) * eased);
      from.current = v; setShown(v);
      if (k < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    // A hidden tab pauses animation frames: never leave a stale figure behind.
    const settle = window.setTimeout(() => { cancelAnimationFrame(frame.current); from.current = value; setShown(value); }, ms + 50);
    return () => { cancelAnimationFrame(frame.current); window.clearTimeout(settle); };
  }, [value, ms]);
  return <span className={`money-roll${shown !== value ? (shown > value ? ' falling' : ' rising') : ''}`}>{money(shown)}</span>;
}
