import { recoverOrderCargo } from './cargo';
import type { Building, Order, Vec2, WorldState } from './types';
import { allBuildings, buildingDoor, dist } from './world';

export function isExportTerminal(b: Building | undefined): b is Building {
  return !!b && b.state === 'trading' && (b.typeId === 'docks' || b.typeId === 'railroad');
}

export function nearestExportTerminal(w: WorldState, from: Vec2): Building | null {
  let closest: Building | null = null, distance = Infinity;
  for (const b of allBuildings(w)) {
    if (!isExportTerminal(b)) continue;
    const d = dist(from, buildingDoor(w, b));
    if (d < distance) { closest = b; distance = d; }
  }
  return closest;
}

/** Cancellation starts a physical return; only arrival credits warehouse stock. */
export function recoverExportGoods(w: WorldState, order: Order, lost = !order.assignedIds.some(id =>
  w.people[id]?.status === 'active' && w.people[id].burningEscape?.week !== w.week)): void {
  recoverOrderCargo(w,order,lost);
}
