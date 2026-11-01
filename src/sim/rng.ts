/**
 * Deterministic PRNG. The entire simulation draws randomness from here and
 * nowhere else — no Math.random in src/sim. State is a single uint32 so it
 * serialises into saves trivially and replays exactly.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    // Avoid the degenerate zero state.
    this.s = (seed >>> 0) || 0x9e3779b9;
  }

  get state(): number {
    return this.s >>> 0;
  }

  set state(v: number) {
    this.s = (v >>> 0) || 0x9e3779b9;
  }

  /** mulberry32 — fast, good distribution, tiny state. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max < min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Weighted pick. Weights need not be normalised; non-positive weights are skipped. */
  weighted<T>(entries: readonly { item: T; weight: number }[]): T {
    let total = 0;
    for (const e of entries) if (e.weight > 0) total += e.weight;
    if (total <= 0) return entries[0].item;
    let roll = this.next() * total;
    for (const e of entries) {
      if (e.weight <= 0) continue;
      roll -= e.weight;
      if (roll <= 0) return e.item;
    }
    return entries[entries.length - 1].item;
  }

  /** In-place Fisher-Yates. Returns the same array for convenience. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /** Roughly normal via the mean of 3 uniforms, clamped to [min,max]. */
  bell(min: number, max: number): number {
    const t = (this.next() + this.next() + this.next()) / 3;
    return min + t * (max - min);
  }
}
