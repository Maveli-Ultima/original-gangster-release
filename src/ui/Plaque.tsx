import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { audio } from '../audio/audio';

/**
 * The menus' one control: a bakelite plaque set into the scene, as the
 * original's stone tiles were. It clacks when pressed and ticks under the
 * fingertip; a detail line sits engraved beneath the label.
 */
export function Plaque({ children, detail, className = '', size = 'md', onClick, onMouseEnter, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  detail?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <button
      type="button"
      {...rest}
      className={`plaque plaque-${size} ${className}`.trim()}
      onMouseEnter={(e) => {
        if (!rest.disabled) audio.hover();
        onMouseEnter?.(e);
      }}
      onClick={(e) => {
        audio.plaque();
        onClick?.(e);
      }}
    >
      <span className="plaque-label">{children}</span>
      {detail != null && <span className="plaque-detail sub">{detail}</span>}
    </button>
  );
}
