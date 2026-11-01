/**
 * Deterministic hashes, so that anything derived from an id — a car's street,
 * a building's trim, a citizen's coat — comes out the same every frame, in
 * every session, without touching the game's random stream.
 */

/** Fast integer avalanche hash. Returns an unsigned 32-bit value. */
export function hash32(n: number): number {
  let x = n >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
}

/** Hash an id with a salt so one id can drive many independent choices. */
export function h2(id: number, salt: number): number {
  return hash32((Math.imul(id, 2654435761) ^ Math.imul(salt + 1, 40503)) >>> 0);
}

/** 0..1 from an id and a salt. */
export function r01(id: number, salt: number): number {
  return h2(id, salt) / 4294967296;
}

/** Integer in [0, n) from an id and a salt. */
export function rint(id: number, salt: number, n: number): number {
  return h2(id, salt) % n;
}

/** Signed -1..1. */
export function rsig(id: number, salt: number): number {
  return r01(id, salt) * 2 - 1;
}
