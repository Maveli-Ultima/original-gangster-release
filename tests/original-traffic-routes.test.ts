import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { activeBlocks, blockPavement, streetGraph } from '../src/sim/cityLayout';
import { CELL, LANE_OFFSET } from '../src/sim/constants';
import { Sim } from '../src/sim/sim';
import { vehicleRoute } from '../src/sim/vehicleNavigation';
import type { Vec2, WorldState } from '../src/sim/types';

// The original's traffic route planner (Route_bfsSearch 0x5F6880 and its
// arrival test 0x5F5BE0; docs/re/p4/pathfinding_spec.md in the recode).
const world = () => new Sim({ ...defaultGameOptions(), citySize: 10, seed: 404 }).world;

/** The route's long legs (a block's worth of driving), as unit directions. */
function legs(start: Vec2, path: Vec2[]): (Vec2 & { end: Vec2 })[] {
  const out: (Vec2 & { end: Vec2 })[] = [];
  let from = start;
  for (const p of path) {
    const dx = p.x - from.x, dy = p.y - from.y, d = Math.hypot(dx, dy);
    if (d > 6) out.push({ x: Math.round(dx / d), y: Math.round(dy / d), end: p });
    from = p;
  }
  return out;
}
function open(w: WorldState, a: Vec2, b: Vec2): boolean {
  const g = streetGraph(w), width = w.gridW + 1;
  return g.neighbours[a.y * width + a.x].includes(b.y * width + b.x);
}
/** Every node of degree one: where a car has no way on but back. */
function deadEnds(w: WorldState): Vec2[] {
  const g = streetGraph(w);
  return g.points.filter((_, i) => g.neighbours[i].length === 1);
}

describe("the original's car routes", () => {
  it('a car sets off the way the lane it stands in runs', () => {
    const w = world(), blocks = activeBlocks(w);
    let routes = 0;
    for (let i = 0; i < blocks.length; i += 3) {
      const to = blockPavement(blocks[(i * 7 + 5) % blocks.length], 3);
      for (const g of [0, 1]) for (const side of [1, -1]) {
        // In a lane of the street along the block's top edge (y) or left edge (x).
        const b = blocks[i];
        const from = g ? { x: b.gx * CELL + 20, y: b.gy * CELL + side * LANE_OFFSET } : { x: b.gx * CELL + side * LANE_OFFSET, y: b.gy * CELL + 20 };
        const { start, path } = vehicleRoute(w, from, to, false);
        const first = path.find(p => Math.hypot(p.x - start.x, p.y - start.y) > 1);
        if (!first) continue;
        // Right-hand traffic: south of an east-west line runs east, west of a north-south line runs south.
        if (g) expect(Math.sign(first.x - start.x), JSON.stringify({ from, first })).toBe(side);
        else expect(Math.sign(first.y - start.y), JSON.stringify({ from, first })).toBe(-side);
        routes++;
      }
    }
    expect(routes).toBeGreaterThan(40);
  });

  it('goes round a block rather than turn back at a junction', () => {
    const w = world(), blocks = activeBlocks(w), ends = deadEnds(w);
    let routes = 0, rounds = 0;
    for (let i = 0; i < blocks.length; i++) for (let k = 0; k < 4; k++) {
      const from = blockPavement(blocks[i], k), to = blockPavement(blocks[(i + 1 + k * 3) % blocks.length], k + 2);
      const { start, path } = vehicleRoute(w, from, to, false);
      const l = legs(start, path);
      for (let j = 1; j < l.length; j++) {
        if (l[j].x * l[j - 1].x + l[j].y * l[j - 1].y >= 0) continue;
        // Back the way it came: only where the street ends.
        const at = l[j - 1].end;
        expect(Math.min(...ends.map(e => Math.hypot(e.x - at.x, e.y - at.y))), JSON.stringify({ from, to, at })).toBeLessThan(5);
      }
      if (l.length >= 4) rounds++;
      routes++;
    }
    expect(routes).toBeGreaterThan(100);
    expect(rounds).toBeGreaterThan(0);
  });

  it('stops in its own lane by a destination across the road, and never crosses to it', () => {
    const w = world();
    let checked = 0;
    for (let y = 1; y < w.gridH && checked < 6; y++) for (let x = 0; x < w.gridW && checked < 6; x++) {
      if (!open(w, { x, y }, { x: x + 1, y })) continue;
      const line = y * CELL;
      // Eastbound, south of the line; the door is on the north side, further along.
      const from = { x: x * CELL + 10, y: line + LANE_OFFSET }, to = { x: x * CELL + 40, y: line - 9 };
      const { dest, path } = vehicleRoute(w, from, to, false);
      expect(dest.x).toBeCloseTo(to.x, 6);
      expect(dest.y).toBeCloseTo(line + LANE_OFFSET, 6);
      for (const p of path) expect(p.y).toBeGreaterThan(line);
      checked++;
    }
    expect(checked).toBe(6);
  });

  it('stops along the kerb from a car already standing there, not on top of it', () => {
    const w = world();
    for (let y = 1; y < w.gridH; y++) for (let x = 0; x < w.gridW; x++) {
      if (!open(w, { x, y }, { x: x + 1, y })) continue;
      const line = y * CELL, from = { x: x * CELL + 10, y: line + LANE_OFFSET }, to = { x: x * CELL + 27, y: line - 9 };
      const parked = { x: x * CELL + 27, y: line + LANE_OFFSET };
      const { dest, path } = vehicleRoute(w, from, to, false, [parked]);
      expect(Math.hypot(dest.x - parked.x, dest.y - parked.y)).toBeGreaterThanOrEqual(5.5);
      expect(dest.y).toBeCloseTo(line + LANE_OFFSET, 6);
      expect(path.at(-1)).toEqual(dest);
      return;
    }
    throw new Error('no open street');
  });

  it('takes the fewest turns: straight on, then one turn, when that reaches it', () => {
    const w = world();
    let checked = 0;
    for (let y = 1; y + 3 <= w.gridH && checked < 5; y++) for (let x = 0; x + 4 <= w.gridW && checked < 5; x++) {
      // East along row y to column x+3, then south down it to the third block.
      const row = [0, 1, 2].every(i => open(w, { x: x + i, y }, { x: x + i + 1, y }));
      const col = [0, 1, 2].every(i => open(w, { x: x + 3, y: y + i }, { x: x + 3, y: y + i + 1 }));
      if (!row || !col) continue;
      const from = { x: x * CELL + 10, y: y * CELL + LANE_OFFSET }, to = { x: (x + 3) * CELL + 9, y: (y + 2) * CELL + 30 };
      const { start, path } = vehicleRoute(w, from, to, false);
      const l = legs(start, path).map(({ x, y }) => ({ x, y })).filter((d, i, all) => !i || d.x !== all[i - 1].x || d.y !== all[i - 1].y);
      expect(l, JSON.stringify({ from, to, path })).toEqual([{ x: 1, y: 0 }, { x: 0, y: 1 }]);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
