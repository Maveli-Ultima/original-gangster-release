import type { OrthographicCamera } from 'three';

/** Default capacity for small model galleries; the city supplies its actor limit. */
export const MAX_DETAILED_CHARACTERS = 96;
export const MAX_SPARE_CHARACTERS = 96;
const MIN_CHARACTER_PIXELS = 8;
/**
 * Fully animated (skinned) figures in the city at once. Each costs its own
 * animation mixer and skeleton every frame: a busy afternoon street put 40+
 * of them in view and held the game near 40 fps where simple figures alone
 * held 60. The most important (burning, watched, fighting, the player's own
 * men, officials) and then the nearest get them; the rest are simple figures.
 */
export const MAX_DETAILED_STREET_CHARACTERS = 32;
/** A figure already detailed counts this much nearer, so one walking along the
 * edge of the detailed set does not flicker between the two models. */
export const DETAIL_KEEP_METRES = 6;

/** Screen size, not a fixed zoom: the same zoom covers different pixel heights
 * in the main city and the independent tagged viewport. */
export function characterPixelHeight(camera: OrthographicCamera, viewportHeight: number): number {
  return Math.abs(camera.projectionMatrix.elements[5] * camera.matrixWorldInverse.elements[5]) * 1.8 * viewportHeight / 2;
}

export function characterInView(projected: { x: number; y: number; z: number }): boolean {
  return Math.abs(projected.x) <= 1.08 && Math.abs(projected.y) <= 1.12 && Math.abs(projected.z) <= 1;
}

export function characterNeedsDetail(pixels: number, focused = false): boolean {
  // Keep selected people recognizable even in a distant overview. Ordinary
  // people only switch to simplified figures when their bodies are tiny.
  return focused || pixels >= MIN_CHARACTER_PIXELS;
}
