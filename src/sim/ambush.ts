import { cityBlockAt } from './cityLayout';
import { CELL } from './constants';
import type { Order, Person, Vec2, WorldState } from './types';

/** Businesses and HQ occupants are not targets of a passing street encounter. */
export function isOnStreet(p: Person): boolean {
  return p.buildingId == null || p.dest != null || p.streetOrder != null || p.orderId != null ||
    p.role === 'police' || p.role === 'fbi';
}

/** A car in the far lane of a street bordering the area is just over the
 *  centre line, in the next block's cell: this much slack keeps it in. */
const LANE_SLACK = 3;

export function inAmbushArea(w: WorldState, order: Order, pos: Vec2): boolean {
  const root = (id: number) => w.blocks[id]?.layout?.mergedInto ?? id;
  const inside = (x: number, y: number) => {
    const block = cityBlockAt(w, Math.floor(x / CELL), Math.floor(y / CELL));
    return !!block && (order.targetBlockIds.some(id => root(id) === block.id) ||
      order.targetBuildingIds.some(id => w.buildings[id] && root(w.buildings[id].blockId) === block.id));
  };
  return inside(pos.x, pos.y) || inside(pos.x + LANE_SLACK, pos.y) || inside(pos.x - LANE_SLACK, pos.y) ||
    inside(pos.x, pos.y + LANE_SLACK) || inside(pos.x, pos.y - LANE_SLACK);
}

export function validAmbushTarget(w: WorldState, order: Order, p: Person | undefined): p is Person {
  return !!p && p.status === 'active' && p.burningEscape?.week !== w.week && isOnStreet(p) &&
    p.gangId != null && p.gangId !== order.gangId && inAmbushArea(w, order, p.pos);
}
