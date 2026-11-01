import type { ButtonHTMLAttributes } from 'react';
import { Icon } from './common';

type ControlProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string; icon?: string; glyph?: string; caption?: string; count?: number;
};

/** Engraved controls with a visible caption, full accessible name and tooltip. */
export function InterfaceButton({label, icon, glyph, caption, count, className='', ...props}:ControlProps) {
  return <button type="button" {...props} className={`interface-button ${className}`} aria-label={label} title={props.title ?? label}>
    {icon ? <Icon name={icon} size={22}/> : <span className="interface-glyph" aria-hidden>{glyph}</span>}
    {caption && <span className="interface-caption" aria-hidden>{caption}</span>}
    {!!count && <span className="interface-count" aria-hidden>{count}</span>}
  </button>;
}

export function WindowHeading({title,onClose}:{title:string;onClose:()=>void}) {
  return <header className="interface-window-heading">
    <button aria-label={`Close ${title}`} title={`Close ${title}`} onClick={onClose}>×</button>
    <h3>{title}</h3>
  </header>;
}
