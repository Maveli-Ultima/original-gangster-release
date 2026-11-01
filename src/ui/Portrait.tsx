import { useState } from 'react';
import { GANG_COLORS } from '../sim/constants';
import type { Gang, Person } from '../sim/types';
import { bossPortraitUrl, portraitUrl } from './art';
import { useArtStatus } from './useArtStatus';

/**
 * A studio portrait for everybody in the city. The painted library in
 * public/art/portraits is used when it is there — sixty-four men, thirty-two
 * women, keyed by the person's portrait number and bearing so the same hood
 * always has the same face — and the drawn portrait below stands in if a file
 * cannot be loaded. The gang strip along the bottom and the greyscale of the
 * dead are applied here, not baked into the paintings.
 */
export function Portrait({ person, gang, size = 30 }: { person: Person; gang?: Gang; size?: number }) {
  // A boss's own painting when it has been delivered; the pool face otherwise.
  const boss = bossPortraitUrl(person.face);
  const bossStatus = useArtStatus(boss);
  const pool = portraitUrl(person);
  const poolStatus = useArtStatus(pool);
  const useBoss = !!boss && bossStatus !== 'failed';
  const src = useBoss ? boss! : pool;
  const status = useBoss ? bossStatus : poolStatus;
  // Keep the last painting up while the next one loads. Even a cached file
  // reports 'loading' for one paint, and the drawn stand-in (keyed to the
  // name's number, not the face being chosen) flashed between every step.
  const [shown, setShown] = useState<string>();
  if (status === 'loaded' && shown !== src) setShown(src);
  const painting = status === 'loaded' ? src : status === 'loading' ? shown : undefined;
  const gone = person.status === 'dead';
  return (
    <span
      className="portrait painted"
      style={{ width: size, height: size, ...(gone ? { filter: 'grayscale(1)', opacity: 0.65 } : {}) }}
      role="img"
      aria-label={person.name}
    >
      {!painting && <PortraitDrawn person={person} gang={gang} size={size} />}
      {painting && <img src={painting} alt="" width={size} height={size} draggable={false}
        style={{ position: 'absolute', inset: 0 }} />}
      {gang && <i className="strip" style={{ background: GANG_COLORS[gang.color].light }} />}
    </span>
  );
}

/** A stable 0..1 from a portrait number and a salt. */
function r(seed: number, salt: number): number {
  let h = (seed * 2654435761 + salt * 40503) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

const pick = <T,>(list: readonly T[], seed: number, salt: number): T =>
  list[Math.floor(r(seed, salt) * list.length) % list.length];

const SKIN = ['#e9c6a0', '#dcb188', '#c99b72', '#ac7e56', '#8b6140', '#6f4b31'] as const;
const HAIR = ['#241b14', '#3f2c1d', '#5d4026', '#7d5c30', '#171514', '#8d8279', '#5b3520'] as const;
const HAT = ['#37301f', '#2a2621', '#453a2d', '#524634', '#20232a'] as const;
const COAT = ['#2e2a25', '#38312a', '#25282d', '#3e362e', '#332b2b'] as const;
const CARD = ['#cfc3a4', '#c8bb9c', '#d4c8aa', '#c2b696'] as const;

/**
 * The drawn mugshot: face, hair, hat and collar all out of the portrait
 * number, built from large shapes so it still reads at thirty pixels.
 */
export function PortraitDrawn({ person, gang, size = 30 }: { person: Person; gang?: Gang; size?: number }) {
  const p = person.portrait;
  const skin = pick(SKIN, p, 1);
  const hair = pick(HAIR, p, 2);
  const coat = pick(COAT, p, 3);
  const card = pick(CARD, p, 4);
  const jaw = person.female ? 8.6 : 9.2 + r(p, 5) * 0.9;
  const wide = person.female ? 7.6 : 7.9 + r(p, 6) * 0.8;

  // Hats were near-universal out of doors, but a portrait is taken indoors, so
  // rather more than half the city is bare-headed here.
  const hatRoll = r(p, 7);
  const hatKind = hatRoll < 0.42 ? (person.female ? 'cloche' : hatRoll < 0.24 ? 'fedora' : 'cap') : 'none';
  const hatColor = pick(HAT, p, 8);
  const balding = !person.female && r(p, 9) > 0.86;
  const moustache = !person.female && r(p, 10) > 0.72;
  const glasses = r(p, 11) > 0.85;
  const eyeY = 19.4;
  const smile = (r(p, 12) - 0.5) * 2.4;
  const gone = person.status === 'dead';

  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className="portrait"
      style={gone ? { filter: 'grayscale(1)', opacity: 0.65 } : undefined}
      role="img"
      aria-label={person.name}
    >
      <rect width="40" height="40" fill={card} />
      <rect width="40" height="18" fill="#000" opacity="0.05" />

      {/* Shoulders and overcoat. */}
      <path d={`M 1 40 L 1 34 Q 8 29 14 28 L 26 28 Q 32 29 39 34 L 39 40 Z`} fill={coat} />
      {/* Shirt front and necktie. */}
      <path d="M 15.6 28.4 L 20 34 L 24.4 28.4 L 22.6 27.6 L 17.4 27.6 Z" fill="#ddd6c4" />
      <path d="M 20 31 L 22.2 33.4 L 21 40 L 19 40 L 17.8 33.4 Z" fill={pick(['#7a2f2a', '#2f3f5e', '#4a4030', '#3d2f42'], p, 13)} />

      {/* Neck and head. */}
      <rect x="16.6" y="23" width="6.8" height="7" rx="2.4" fill={skin} />
      <rect x="16.6" y="23" width="6.8" height="4" fill="#000" opacity="0.14" />
      <ellipse cx="11.9" cy="20.6" rx="1.5" ry="2" fill={skin} />
      <ellipse cx="28.1" cy="20.6" rx="1.5" ry="2" fill={skin} />
      <path
        d={`M 20 8.6 C ${20 - wide} 8.6 ${20 - wide} 14 ${20 - wide} 17.6 C ${20 - wide} 23.4 ${20 - wide * 0.62} ${jaw + 17} 20 ${jaw + 17} C ${20 + wide * 0.62} ${jaw + 17} ${20 + wide} 23.4 ${20 + wide} 17.6 C ${20 + wide} 14 ${20 + wide} 8.6 20 8.6 Z`}
        fill={skin}
      />

      {/* Hair. */}
      {person.female ? (
        <path
          d={`M 20 7.4 C ${20 - wide - 1} 7.4 ${20 - wide - 1.4} 14 ${20 - wide - 0.8} 24.6 L ${20 - wide + 1.2} 24.2 C ${20 - wide + 0.6} 17 ${20 - wide + 1.6} 13.4 20 13.4 C ${20 + wide - 1.6} 13.4 ${20 + wide - 0.6} 17 ${20 + wide - 1.2} 24.2 L ${20 + wide + 0.8} 24.6 C ${20 + wide + 1.4} 14 ${20 + wide + 1} 7.4 20 7.4 Z`}
          fill={hair}
        />
      ) : balding ? (
        <path
          d={`M ${20 - wide} 16.4 C ${20 - wide} 12.6 ${20 - wide + 1.4} 11.4 ${20 - wide + 2.6} 11.6 C ${20 - wide + 1.6} 13 ${20 - wide + 1.2} 14.6 ${20 - wide + 1.2} 16.6 Z M ${20 + wide} 16.4 C ${20 + wide} 12.6 ${20 + wide - 1.4} 11.4 ${20 + wide - 2.6} 11.6 C ${20 + wide - 1.6} 13 ${20 + wide - 1.2} 14.6 ${20 + wide - 1.2} 16.6 Z`}
          fill={hair}
        />
      ) : (
        <path
          d={`M 20 7.6 C ${20 - wide - 0.4} 7.6 ${20 - wide - 0.4} 12.6 ${20 - wide - 0.2} 15.6 L ${20 - wide + 1.6} 14.2 C ${20 - wide + 2.2} 12.2 ${20 - 2} 11.4 ${20 + wide - 1} 12.8 L ${20 + wide + 0.2} 14.6 C ${20 + wide + 0.4} 11.4 ${20 + wide - 1.4} 7.6 20 7.6 Z`}
          fill={hair}
        />
      )}

      {/* Brows and eyes. */}
      <rect x="14.3" y={eyeY - 2.4} width="4" height="0.9" rx="0.45" fill={hair} />
      <rect x="21.7" y={eyeY - 2.4} width="4" height="0.9" rx="0.45" fill={hair} />
      <ellipse cx="16.3" cy={eyeY} rx="1.15" ry="1.05" fill="#f2ece0" />
      <ellipse cx="23.7" cy={eyeY} rx="1.15" ry="1.05" fill="#f2ece0" />
      <circle cx="16.4" cy={eyeY} r="0.62" fill="#241c14" />
      <circle cx="23.8" cy={eyeY} r="0.62" fill="#241c14" />
      {glasses && (
        <g stroke="#2b2620" strokeWidth="0.55" fill="none" opacity="0.85">
          <circle cx="16.3" cy={eyeY} r="2.4" />
          <circle cx="23.7" cy={eyeY} r="2.4" />
          <path d={`M 18.7 ${eyeY} L 21.3 ${eyeY}`} />
        </g>
      )}

      {/* Nose and mouth. */}
      <path d="M 20 20.2 L 19.1 23.2 L 20.9 23.2 Z" fill="#000" opacity="0.16" />
      {moustache ? (
        <rect x="17.2" y="24.1" width="5.6" height="1.5" rx="0.75" fill={hair} />
      ) : (
        <path
          d={`M 17.5 25.4 Q 20 ${25.4 + smile} 22.5 25.4`}
          stroke={person.female ? '#9d4b46' : '#7a4b3c'}
          strokeWidth={person.female ? 1.3 : 0.9}
          strokeLinecap="round"
          fill="none"
        />
      )}

      {/* Hat, last so it sits over the hair. */}
      {hatKind === 'fedora' && (
        <g fill={hatColor}>
          <ellipse cx="20" cy="11.6" rx="12.4" ry="2.6" />
          <path d="M 12.6 11.6 C 12.6 4.6 27.4 4.6 27.4 11.6 Z" />
          <rect x="12.6" y="9.6" width="14.8" height="1.9" fill="#000" opacity="0.32" />
        </g>
      )}
      {hatKind === 'cap' && (
        <g fill={hatColor}>
          <path d="M 11.8 11.4 C 11.8 5.2 28.2 5.2 28.2 11.4 Z" />
          <path d="M 10.4 11.2 L 29.2 11.2 L 29.2 12.8 Q 20 14.2 10.4 12.6 Z" />
        </g>
      )}
      {hatKind === 'cloche' && (
        <g fill={hatColor}>
          <path d="M 12 13.4 C 12 5.4 28 5.4 28 13.4 Z" />
          <ellipse cx="20" cy="13.4" rx="8.6" ry="2" />
          <rect x="12.4" y="11" width="15.2" height="1.6" fill="#000" opacity="0.28" />
        </g>
      )}

      {/* Whose man he is, along the bottom edge. */}
      {gang && <rect y="37.4" width="40" height="2.6" fill={GANG_COLORS[gang.color].light} />}
    </svg>
  );
}
