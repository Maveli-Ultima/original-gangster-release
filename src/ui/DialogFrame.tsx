import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** A real modal: isolate the desk, contain focus, and restore its opener. */
export function DialogFrame({ title, onClose, children, width, className }: {
  title: string; onClose: () => void; children: ReactNode; width?: number; className?: string;
}) {
  const [host] = useState(() => document.createElement('div'));
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    document.body.appendChild(host);
    const isolated = [...document.body.children].filter(el => el !== host && el instanceof HTMLElement)
      .map(el => ({ el: el as HTMLElement, inert: (el as HTMLElement).inert }));
    for (const { el } of isolated) el.inert = true;
    const elements = () => [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? [])].filter(el => el.getClientRects().length);
    const focus = () => (ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? elements()[0] ?? ref.current)?.focus();
    focus();
    const keys = (e: KeyboardEvent) => {
      if (host.inert) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close.current(); }
      else if (e.key === 'Tab') {
        const items = elements(), first = items[0], last = items.at(-1);
        if (!first) { e.preventDefault(); ref.current?.focus(); }
        else if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    const focusIn = (e: FocusEvent) => { if (!host.inert && !host.contains(e.target as Node)) focus(); };
    document.addEventListener('keydown', keys, true);
    document.addEventListener('focusin', focusIn);
    return () => {
      document.removeEventListener('keydown', keys, true);
      document.removeEventListener('focusin', focusIn);
      for (const { el, inert } of isolated) el.inert = inert;
      host.remove();
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus();
    };
  }, [host]);
  return createPortal(<div className={`modal-back${className ? ` ${className}` : ''}`} onClick={onClose}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
      className="brass modal" style={{ width: `min(${width ?? 700}px, calc(100vw - 24px))` }} onClick={e => e.stopPropagation()}>
      {children}
    </div>
  </div>, host);
}
