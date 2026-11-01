import { describe, expect, it } from 'vitest';
import { crossingOf, roadAheadBlocked, type TrafficContext } from '../src/sim/traffic';
import { CELL } from '../src/sim/constants';

const context = (crossings: TrafficContext['crossings']): TrafficContext =>
  ({ cars: [], carsByStreet: new Map(), drivers: [], crossings }) as unknown as TrafficContext;

describe('drivers and pedestrian crossings', () => {
  // A car driving east along the street at y = CELL, in its lane.
  const at = { x: CELL - 20, y: CELL + 3 }, next = { x: CELL + 30, y: CELL + 3 };

  it('stops for a walker crossing the street it is driving along, once they are in its lane', () => {
    // Walking north across that street, 6 m ahead of the car, now in its lane.
    const walker = crossingOf({ x: CELL - 14, y: CELL + 2.5 }, { x: CELL - 14, y: CELL + 7 });
    expect(roadAheadBlocked(context([walker]), at, next)).toBe(true);
  });

  it('drives on while the walker is still across the road, short of its lane', () => {
    // Just off the far kerb: the car is by long before they reach its lane.
    const walker = crossingOf({ x: CELL - 14, y: CELL - 6 }, { x: CELL - 14, y: CELL + 7 });
    expect(roadAheadBlocked(context([walker]), at, next)).toBe(false);
  });

  it('drives on past a walker crossing the side street beside it at the junction', () => {
    // Walking east across the side street (x = CELL), on the pavement edge just
    // beside the car's lane: never in its path.
    const walker = crossingOf({ x: CELL - 7, y: CELL + 7.5 }, { x: CELL + 7, y: CELL + 7.5 });
    expect(walker.axisX).toBe(false);
    // 10 m short of the junction: within braking distance and 4.5 m to the side.
    const near = { x: CELL - 10, y: CELL + 3 };
    expect(roadAheadBlocked(context([walker]), near, next)).toBe(false);
  });
});
