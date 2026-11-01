export type CityViewMode = 'plan' | 'roof' | 'street';

// Street View frames people at about the original's size: ~5% of the screen's
// height (its 30–40 px figures on 600–768 px screens).
/** Street View keeps people at about 5% of the screen height, as in the
 * original; with people drawn 1.3× (CHARACTER_SCALE) the camera widens by the
 * same factor, so the city around them reads at the original's proportion. */
export const VIEW_ZOOM: Record<CityViewMode, number> = { plan: .55, roof: 1.5, street: 7 / 1.3 };

/** Wheel, keyboard and toolbar must agree about when Street View begins. */
export function viewForZoom(zoom: number): CityViewMode {
  return zoom >= 3 ? 'street' : zoom <= .8 ? 'plan' : 'roof';
}

/** New installations should expose the rooms without a trip to Options. */
export function automaticRoofsPreference(saved: string | null): boolean {
  return saved !== '0';
}

/** Keep a stable orientation when both sides are clear (or both obstructed). */
export function taggedViewSide(side: 1 | -1, blocked: boolean, oppositeBlocked: boolean): 1 | -1 {
  return blocked && !oppositeBlocked ? (side === 1 ? -1 : 1) : side;
}
