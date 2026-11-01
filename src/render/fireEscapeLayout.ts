import type { Mass, Profile } from './profile';
import { STOREY_H } from './util';

/** Shared physical dimensions for the landing and its descending open flight. */
export const FIRE_ESCAPE = {
  width: 4.6,
  landingDepth: 1.12,
  outerDepth: 2.02,
  railHeight: 1.0,
  railThickness: .065,
  flightRun: 3.9,
  flightWidth: .70,
  flightCentreZ: 1.58,
  steps: 14,
  rise: STOREY_H,
} as const;

/** Facade V starts at the mass base with no offset and four 4.2 m rows per
 * tile. Ground-floor storefront height does not shift that UV phase. Platforms
 * sit on those floor lines; a descending flight reaches the previous one. */
export function fireEscapeLevels(profile: Profile, mass: Mass): number[] {
  const levels: number[] = [];
  for (let storey = 1; storey <= profile.fireEscapes; storey++) {
    const y = mass.y + storey * STOREY_H;
    if (y + FIRE_ESCAPE.railHeight + FIRE_ESCAPE.railThickness / 2 > mass.y + mass.h - .10) break;
    levels.push(y);
  }
  return levels;
}
