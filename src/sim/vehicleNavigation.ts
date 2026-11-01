import { CELL, LANE_OFFSET, PAVEMENT_OFFSET } from './constants';
import { cityStreetInset, streetEdgeOpen, streetGraph, streetRouteNodes } from './cityLayout';
import type { Vec2, WorldState } from './types';

type RoadAnchor = { a: Vec2; b: Vec2; centre: Vec2; pos: Vec2 };
const length = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Project onto an existing road, including the perimeter of a joined block.
 * The lane nearest the building is its stopping place, never the shop floor. */
function anchor(w: WorldState, p: Vec2): RoadAnchor {
  const graph = streetGraph(w);
  let best: RoadAnchor | undefined, distance = Infinity;
  for (let i = 0; i < graph.points.length; i++) for (const j of graph.neighbours[i]) {
    if (j < i) continue;
    const a = graph.points[i], b = graph.points[j], horizontal = a.y === b.y;
    const centre = { x: clamp(p.x, a.x, b.x), y: clamp(p.y, a.y, b.y) };
    const pos = horizontal
      ? { x: centre.x, y: centre.y + (Math.sign(p.y - centre.y) || 1) * LANE_OFFSET }
      : { x: centre.x + (Math.sign(p.x - centre.x) || 1) * LANE_OFFSET, y: centre.y };
    const d = length(p, pos);
    if (d < distance) { distance = d; best = { a, b, centre, pos }; }
  }
  if (!best) throw new Error('The city has no driveable streets');
  return best;
}

export function roadPosition(w: WorldState, p: Vec2): Vec2 {
  return anchor(w, p).pos;
}

/**
 * Where a car parks near `near`: in the lane by the kerb, at least 8 m from
 * either junction, and 6 m clear of the spots in `taken` — every car of a gang
 * parked on one point at its office, and cars stood in the middle of junctions.
 */
export function parkingSpot(w: WorldState, near: Vec2, taken: Vec2[]): Vec2 {
  const { a, b, centre, pos } = anchor(w, near), horizontal = a.y === b.y;
  const lo = Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y) + 8;
  const hi = Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y) - 8;
  const at = (s: number): Vec2 => horizontal ? { x: s, y: pos.y } : { x: pos.x, y: s };
  if (lo > hi) return at((lo + hi) / 2);
  const base = clamp(horizontal ? centre.x : centre.y, lo, hi);
  let first: Vec2 | null = null;
  for (const off of [0, 6, -6, 12, -12, 18, -18, 24, -24, 30, -30]) {
    const spot = at(clamp(base + off, lo, hi));
    first ??= spot;
    if (taken.every(t => length(t, spot) >= 5.5)) return spot;
  }
  return first!;
}

/** A standing car's centre from the street's centre line: in against the
 *  kerb (the carriageway runs 3.8 m either side of the line; a car is about
 *  1.9 m wide). Passing traffic edges out round it. */
export const PARKED_OFFSET = 2.8;

/** The footway beside the road at `p` (where a man taken out of a car stands). */
export function pavementBeside(w: WorldState, p: Vec2): Vec2 {
  const { a, b, centre } = anchor(w, p), off = PAVEMENT_OFFSET + cityStreetInset(w);
  return a.y === b.y ? { x: p.x, y: centre.y + (Math.sign(p.y - centre.y) || 1) * off }
    : { x: centre.x + (Math.sign(p.x - centre.x) || 1) * off, y: p.y };
}

/** Where a car standing at `p` is drawn: at the kerb on its own side of the street. */
export function kerbside(w: WorldState, p: Vec2, out: Vec2): Vec2 {
  const { a, b, centre } = anchor(w, p);
  if (a.y === b.y) { out.x = p.x; out.y = centre.y + (Math.sign(p.y - centre.y) || 1) * PARKED_OFFSET; }
  else { out.x = centre.x + (Math.sign(p.x - centre.x) || 1) * PARKED_OFFSET; out.y = p.y; }
  return out;
}

/** A parked car follows its lane instead of inheriting a pedestrian's random yaw. */
export function roadHeading(w: WorldState, p: Vec2): number {
  const road = anchor(w, p);
  return road.a.y === road.b.y ? (p.y < road.centre.y ? -Math.PI / 2 : Math.PI / 2)
    : p.x > road.centre.x ? Math.PI : 0;
}

/** Car centres must stay within the carriageway, with room for the body before
 * the pavement. Intersection corners use the same small lane envelope. */
export function onRoad(w: WorldState, p: Vec2): boolean {
  const margin = LANE_OFFSET + .35;
  const gx = Math.floor(p.x / CELL), gy = Math.floor(p.y / CELL);
  const nx = Math.round(p.x / CELL), ny = Math.round(p.y / CELL);
  for (const x of [gx - 1, gx, gx + 1]) {
    if (Math.abs(p.y - ny * CELL) <= margin && p.x >= x * CELL - margin && p.x <= (x + 1) * CELL + margin &&
        streetEdgeOpen(w, x, ny, x + 1, ny)) return true;
  }
  for (const y of [gy - 1, gy, gy + 1]) {
    if (Math.abs(p.x - nx * CELL) <= margin && p.y >= y * CELL - margin && p.y <= (y + 1) * CELL + margin &&
        streetEdgeOpen(w, nx, y, nx, y + 1)) return true;
  }
  return false;
}

export function vehiclePathOnRoad(w: WorldState, from: Vec2, path: Vec2[]): boolean {
  if (!onRoad(w, from)) return false;
  let previous = from;
  for (const next of path) {
    const samples = Math.max(1, Math.ceil(length(previous, next) / 2));
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      if (!onRoad(w, { x: previous.x + (next.x - previous.x) * t, y: previous.y + (next.y - previous.y) * t })) return false;
    }
    previous = next;
  }
  return true;
}

/** East, south, west, north: clockwise, so a car's right turn is the next one round. */
const HEADINGS: readonly Vec2[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
/**
 * A car's way through the streets, under the original's rules for its traffic
 * (pathfinding_spec �2): it carries on the way its lane goes and turns right
 * or left at a junction, never straight back (Route_bfsSearch 0x5F6880's
 * first-step gate); and reaching the destination's street from either end is
 * arriving (Route_arrivalOrOppositeLane 0x5F5BE0). Away from the river the
 * original's tracer (0x5F4E70) heads for the destination, so the route is the
 * shortest such way; among equals, the fewest turns, right before left (the
 * order the original's flood tries them). Flooding for the fewest turns
 * everywhere, as it does only by the river, sent cars up to 11 blocks round.
 * `reverse` lets a car turn back at a dead end (1) or at any junction (2): the
 * original gave up on such a car and re-seeded it, which a crew's car cannot do.
 */
function turnRoute(w: WorldState, start: number, heading: number, setOff: number, ends: readonly [number, number],
  arrive: (node: number) => number, reverse: 1 | 2): number[] | null {
  const g = streetGraph(w), width = w.gridW + 1;
  const step = (node: number, d: number) => node + HEADINGS[d].y * width + HEADINGS[d].x;
  const open = (node: number, d: number) => g.neighbours[node].includes(step(node, d));
  const cost = new Float64Array(g.points.length * 4).fill(Infinity);
  const pred = new Int32Array(g.points.length * 4).fill(-1);
  // A small binary heap of [cost, state]; ties keep their push order.
  const heap: [number, number, number][] = [];
  let pushed = 0;
  const less = (i: number, j: number) => heap[i][0] < heap[j][0] || (heap[i][0] === heap[j][0] && heap[i][2] < heap[j][2]);
  const push = (c: number, s: number) => {
    heap.push([c, s, pushed++]);
    for (let i = heap.length - 1; i > 0;) { const up = (i - 1) >> 1; if (!less(i, up)) break; [heap[i], heap[up]] = [heap[up], heap[i]]; i = up; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < heap.length && less(l, m)) m = l;
        if (r < heap.length && less(r, m)) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]]; i = m;
      }
    }
    return top;
  };
  const TURN = [0, 0.01, 0.02, 0.0101];
  const first = start * 4 + heading;
  cost[first] = setOff; pred[first] = first; push(setOff, first);
  let best = Infinity, arrival = -1;
  while (heap.length) {
    const [c, s] = pop();
    if (c > cost[s] || c >= best) { if (c >= best) break; continue; }
    const node = s >> 2, d = s & 3;
    const moves = [d, (d + 1) & 3, (d + 3) & 3];
    if (reverse === 2 || !moves.some(t => open(node, t))) moves.push((d + 2) & 3);
    for (const t of moves) {
      if (!open(node, t)) continue;
      const next = step(node, t), turn = TURN[(t - d + 4) & 3];
      if ((node === ends[0] && next === ends[1]) || (node === ends[1] && next === ends[0])) {
        const total = c + turn + arrive(node);
        if (total < best) { best = total; arrival = s; }
        continue;
      }
      const ns = next * 4 + t, nc = c + turn + CELL;
      if (nc < cost[ns]) { cost[ns] = nc; pred[ns] = s; push(nc, ns); }
    }
  }
  if (arrival < 0) return null;
  const nodes: number[] = [];
  for (let s = arrival; ; s = pred[s]) {
    if (nodes[nodes.length - 1] !== s >> 2) nodes.push(s >> 2);
    if (pred[s] === s) break;
  }
  return nodes.reverse();
}

/**
 * A car's route, as the original planned one. It sets off the way the lane
 * it stands in runs (right-hand traffic), never pulling across the road; it
 * goes round a block rather than turn back; and it stops in its own lane by
 * the destination, across the road from it if it came that way, and the
 * crew walk over (the original's arrival rule) — it slid diagonally across.
 */
export function vehicleRoute(w: WorldState, from: Vec2, to: Vec2, zig: boolean, taken: Vec2[] = []): { start: Vec2; dest: Vec2; path: Vec2[] } {
  const a = anchor(w, from), b = anchor(w, to);
  // Each leg keeps to its lane (on the right of its direction).
  const lane = (s: Vec2, e: Vec2) => ({ ox: -Math.sign(e.y - s.y) * LANE_OFFSET, oy: Math.sign(e.x - s.x) * LANE_OFFSET });
  const opposite = (p: Vec2, c: Vec2) => ({ x: 2 * c.x - p.x, y: 2 * c.y - p.y });
  const g = streetGraph(w), width = w.gridW + 1;
  const id = (p: Vec2) => Math.round(p.y / CELL) * width + Math.round(p.x / CELL);
  const horizontal = a.a.y === a.b.y;
  // The lane the car stands in says which way it faces: south of an
  // east-west street's centre line runs east, west of a north-south one south.
  const side = onRoad(w, from) ? from : a.pos;
  const heading = horizontal ? (side.y >= a.centre.y ? 0 : 2) : (side.x <= a.centre.x ? 1 : 3);
  const forward = heading < 2 ? 1 : -1;
  const [lo, hi] = (horizontal ? a.a.x < a.b.x : a.a.y < a.b.y) ? [a.a, a.b] : [a.b, a.a];
  const ahead = forward > 0 ? hi : lo;
  const sameStreet = id(a.a) === id(b.a) && id(a.b) === id(b.b);
  let centres: Vec2[];
  if (sameStreet && (horizontal ? b.centre.x - a.centre.x : b.centre.y - a.centre.y) * forward >= -0.5) {
    centres = [a.centre, b.centre];
  } else {
    const ends = [id(b.a), id(b.b)] as const;
    const arrive = (n: number) => length(g.points[n], b.centre);
    const nodes = turnRoute(w, id(ahead), heading, length(a.centre, ahead), ends, arrive, 1)
      ?? turnRoute(w, id(ahead), heading, length(a.centre, ahead), ends, arrive, 2);
    centres = [a.centre, ...(nodes ? nodes.map(n => g.points[n]) : [ahead, ...streetRouteNodes(w, ahead, b.a, zig)]), b.centre];
  }
  centres = centres.filter((p, i) => !i || length(p, centres[i - 1]) > 1e-6);
  const path: Vec2[] = [];
  const push = (p: Vec2) => { if (!path.length || length(p, path[path.length - 1]) > 1e-6) path.push(p); };
  // At a turn the car takes the corner where the two lanes cross; ending one
  // lane at the junction and starting the next from it ran the car past the
  // corner and back (diagonally) on every turn.
  for (let i = 1; i < centres.length; i++) {
    const start = centres[i - 1], end = centres[i], here = lane(start, end);
    if (i === 1) push({ x: start.x + here.ox, y: start.y + here.oy });
    if (i + 1 < centres.length) {
      const next = lane(end, centres[i + 1]);
      const alongX = here.ox === 0, nextAlongX = next.ox === 0;
      if (alongX !== nextAlongX) {
        push(alongX ? { x: end.x + next.ox, y: end.y + here.oy } : { x: end.x + here.ox, y: end.y + next.oy });
        continue;
      }
      push({ x: end.x + here.ox, y: end.y + here.oy });
      // Turning back (only where the road ends, or the streets offer no way
      // round): round through the junction's middle, not a hop across the road.
      const fx = Math.sign(end.x - start.x), fy = Math.sign(end.y - start.y);
      if (fx * Math.sign(centres[i + 1].x - end.x) < 0 || fy * Math.sign(centres[i + 1].y - end.y) < 0) {
        // Through the middle of the junction, bulging past it only where the
        // road goes on (not off the city's edge or into a T-junction's wall).
        const bulge = { x: end.x + fx * LANE_OFFSET * 1.2, y: end.y + fy * LANE_OFFSET * 1.2 };
        push(onRoad(w, bulge) ? bulge : { x: end.x, y: end.y });
      }
      push({ x: end.x + next.ox, y: end.y + next.oy });
      continue;
    }
    push({ x: end.x + here.ox, y: end.y + here.oy });
  }
  // Stop in the car's own lane by the destination: on the building's side
  // if it came that way, otherwise across the road from it.
  const last = path[path.length - 1];
  let dest = !last || length(last, b.pos) <= length(opposite(last, b.centre), b.pos) ? b.pos : last;
  // Not on top of a car already standing there (one for a building across
  // the road stops in the same lane): on along the kerb, or back short of it.
  if (taken.some(t => length(t, dest) < 5.5)) {
    const along = b.a.y === b.b.y, before = path.length > 1 ? path[path.length - 2] : (path[0] ?? dest);
    const dir = Math.sign(along ? dest.x - before.x : dest.y - before.y) || 1;
    const lo = Math.min(along ? b.a.x : b.a.y, along ? b.b.x : b.b.y) + 8, hi = Math.max(along ? b.a.x : b.a.y, along ? b.b.x : b.b.y) - 8;
    const back = along ? before.x : before.y;
    for (const off of [6, 12, 18, -6, -12, -18]) {
      const s = (along ? dest.x : dest.y) + off * dir;
      if (s < lo || s > hi || (off < 0 && (s - back) * dir < 1)) continue;
      const spot = along ? { x: s, y: dest.y } : { x: dest.x, y: s };
      if (taken.every(t => length(t, spot) >= 5.5)) { dest = spot; break; }
    }
  }
  push(dest);
  return { start: onRoad(w, from) ? { ...from } : { ...(centres.length > 1 ? path[0] : a.pos) }, dest: { ...dest }, path };
}
