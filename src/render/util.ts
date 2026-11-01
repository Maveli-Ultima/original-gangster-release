/**
 * Deterministic helpers for the renderer. Every visual variation is derived
 * from a stable id so a building looks the same on every frame, in every
 * session, and nothing here ever touches the simulation.
 */

import { h2 } from '../sim/hash';

export { hash32, h2, r01, rint, rsig } from '../sim/hash';

export function rpick<T>(arr: readonly T[], id: number, salt: number): T {
  return arr[h2(id, salt) % arr.length];
}

export function hashString(s: string): number {
  let x = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619) >>> 0;
  }
  return x >>> 0;
}

/** Small deterministic PRNG, used while painting canvas textures. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ------------------------------------------------------------------ scale

/** One storey, in metres. Matches the simulation's `storeys` height hint. */
export const STOREY_H = 4.2;
/** One window bay across a facade, in metres. */
export const BAY_W = 3.0;
/** Facade textures hold this many bays / storeys before repeating. */
export const TILE_BAYS = 4;
export const TILE_STOREYS = 4;
/** Height of the pavement above the roadway. */
export const KERB_H = 0.34;
/** Depth of the pavement strip around a block, in metres. */
export const PAVE_W = 3.2;
/** The original 40 x 32 city's footways: wide stone pavements either side of a
 * two-lane carriageway (about 7.6 m), as in the retail street view. Street
 * centre lines, lanes and walking lines are unchanged; only the kerb moves. */
export const ORIGINAL_PAVE_W = 6.2;
export function paveWidth(w?: { cityLayout?: { original?: unknown } }): number {
  return w?.cityLayout?.original ? ORIGINAL_PAVE_W : PAVE_W;
}
