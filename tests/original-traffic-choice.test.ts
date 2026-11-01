import { describe, expect, it } from 'vitest';
import { defaultGameOptions, newCampaignOptions } from '../src/app/newGame';
import { createWorld } from '../src/sim/citygen';
import { cityBlockAt, streetGraph } from '../src/sim/cityLayout';
import { TRIP_THRESHOLDS, carsAt, drawTripGoal, originalTrip, tripRoute } from '../src/sim/traffic';
import type { WorldState } from '../src/sim/types';

// The original's background cars drive trips (0x6121F0): a destination drawn
// by land value (0x606AF0), a street beside it (0x60C0D0), a planned route
// (0x618360). Their junction choices are the route's; nothing draws a way at
// a junction (0x465C20, once taken for that, applies a close-combat blow).
// docs/audit/2026-10-28/traffic-choice/review.md.

const original = createWorld({ ...newCampaignOptions(), seed: 404 }).world;
const HX = [1, 0, -1, 0], HY = [0, 1, 0, -1];

function junctions(w: WorldState): number[] {
  const g = streetGraph(w);
  return g.points.map((_, i) => i).filter(i => g.neighbours[i].length >= 3);
}

/** Follow the ways from `node` heading `d`; the last street driven, and whether each step was open and never straight back past a way on. */
function follow(w: WorldState, node: number, d: number, ways: number[]) {
  const g = streetGraph(w), width = w.gridW + 1;
  let ok = true, from = node, at = node, h = d;
  for (const t of ways) {
    const onward = [h, (h + 1) & 3, (h + 3) & 3].some(u => g.neighbours[at].includes(at + HY[u] * width + HX[u]));
    if (t === ((h + 2) & 3) && onward) ok = false;
    const next = at + HY[t] * width + HX[t];
    if (!g.neighbours[at].includes(next)) ok = false;
    from = at; at = next; h = t;
  }
  return { ok, from, at };
}

describe("the original city's background cars", () => {
  it('reads the ladder of 0x606AF0', () => {
    // rand % 10 = 0..9 (the switch's fall-through sums).
    expect(TRIP_THRESHOLDS).toEqual([10, 30, 140, 140, 110, 90, 70, 50, 30, 20]);
  });

  it('draws destinations two blocks off or more, on buildings, weighted by land value', () => {
    const w = original, width = w.gridW + 1, starts = junctions(w);
    const value = (gx: number, gy: number) => cityBlockAt(w, gx, gy)?.original?.landValue ?? 0;
    let sum = 0, n = 0;
    for (const b of w.blocks) {
      const use = b.layout?.use;
      if ((use === 'urban' || use === 'civic') && b.gx > 0 && b.gy > 0 && b.gx < w.gridW - 1 && b.gy < w.gridH - 1) { sum += value(b.gx, b.gy); n++; }
    }
    const fieldMean = sum / n;
    let drawn = 0, drawnSum = 0;
    for (let k = 0; k < 60; k++) for (let s = 0; s < 10; s++) {
      const node = starts[(k * 37 + s * 11) % starts.length], nx = node % width, ny = Math.floor(node / width);
      const goal = drawTripGoal(w, k, s, node);
      expect(goal).not.toBeNull();
      const { gx, gy, a, b } = goal!;
      const use = cityBlockAt(w, gx, gy)?.layout?.use;
      expect(use === 'urban' || use === 'civic').toBe(true);
      expect(gx > 0 && gy > 0 && gx < w.gridW - 1 && gy < w.gridH - 1).toBe(true);
      // At least 10 of the original's cells (five to a block) along x or y.
      const cx = Math.max(Math.abs(gx * 5 + 2 - nx * 5), Math.abs(gy * 5 + 2 - ny * 5));
      expect(cx).toBeGreaterThanOrEqual(8);
      // The street beside the block.
      expect(streetGraph(w).neighbours[a]).toContain(b);
      drawn++; drawnSum += value(gx, gy);
    }
    // The ladder sends cars to the dearer blocks.
    expect(drawnSum / drawn).toBeGreaterThan(fieldMean + 15);
  });

  it('plans the shortest way to the street, never turning back with a way on', () => {
    const w = original, starts = junctions(w);
    let routed = 0;
    for (let k = 0; k < 40; k++) {
      const node = starts[(k * 53) % starts.length], d = k & 3;
      const ways = originalTrip(w, k, 1, node, d);
      expect(ways).not.toBeNull();
      const { ok, from, at } = follow(w, node, d, ways!);
      expect(ok).toBe(true);
      // The last street driven is the goal's: originalTrip's first fit draw.
      const width = w.gridW + 1;
      const goal = [0, 1, 2, 3, 4, 5, 6, 7].map(i => drawTripGoal(w, k, 8 + i, node)).find(g => {
        if (!g) return false;
        const inLine = g.a % width === g.b % width ? g.a % width === node % width
          : Math.floor(g.a / width) === Math.floor(node / width);
        return !inLine && tripRoute(w, node, d, g.a, g.b) !== null;
      });
      expect(goal).toBeDefined();
      expect([from, at].sort()).toEqual([goal!.a, goal!.b].sort());
      routed++;
    }
    expect(routed).toBe(40);
  });

  it('keeps the timetable a pure function of the clock, and cheap to rebuild', () => {
    const a = createWorld({ ...newCampaignOptions(), seed: 404 }).world;
    const b = createWorld({ ...newCampaignOptions(), seed: 404 }).world;
    const t0 = performance.now();
    const late = carsAt(a, 600);
    a.week = 8;
    // (carsAt caches the last world and minute asked for.)
    const week8 = carsAt(a, 600.5);
    const took = performance.now() - t0;
    b.week = 8;
    expect(carsAt(b, 600.5).map(c => [c.x, c.y])).toEqual(week8.map(c => [c.x, c.y]));
    for (const c of [...late, ...week8]) expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
    expect(took).toBeLessThan(4000);
  });

  it('leaves the other cities on the junction lot', () => {
    const w = createWorld({ ...defaultGameOptions(), seed: 404 }).world;
    expect(w.cityLayout?.original).toBeUndefined();
    const cars = carsAt(w, 900);
    expect(cars.length).toBeGreaterThan(0);
  });
});
