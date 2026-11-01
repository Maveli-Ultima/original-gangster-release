import type { GoodsDelivery, Person, WorldState } from '../sim/types';
import { runningCivilian, vehicleOf } from '../sim/transport';
import { buildingDoor } from '../sim/world';

/** Animation clips for ordinary work. */
export type DailyGait = 'run' | 'carry';
export type DailyGesture = 'talk' | 'offer' | 'scheme' | 'lookAround';
export type DailyMotionName = DailyGait | DailyGesture;

/**
 * Which gait a walking character uses, and which gesture a standing one makes,
 * read from the simulation: a hood sent after someone hurries; a lawyer or
 * accountant at a meeting talks (and the person visited answers); an FBI
 * agent searching premises looks about.
 */
export function dailyMotion(w: WorldState, p: Person): { gait?: DailyGait; gesture?: DailyGesture } {
  if (p.inVehicle) return {};
  if (p.streetOrder?.type === 'assault' || p.streetOrder?.type === 'kill' || runningCivilian(p)) return { gait: 'run' };
  if (p.fbiAssignment?.kind === 'search' && p.fbiAssignment.phase === 'working') return { gesture: 'lookAround' };
  for (const j of Object.values(w.specialistJobs ?? {})) {
    if (j.week !== w.week || j.state !== 'working' || j.paused || j.targetPersonId == null) continue;
    if (j.actorId === p.id) return { gesture: j.type === 'bribeOfficials' ? 'offer' : j.type === 'employPolice' ? 'scheme' : 'talk' };
    if (j.targetPersonId === p.id) return { gesture: 'talk' };
  }
  return {};
}

/**
 * Crates between truck and premises while an Export or Raid is being worked,
 * loading at the source and unloading at the destination. The simulation keeps
 * the crew seated for those spells (their timing is unchanged); the view walks
 * each of them between door and truck with a crate, on the scene clock, so it
 * stops when the game is paused.
 */
export function loadingShuttle(w: WorldState, p: Person, clock: number):
  { pos: { x: number; y: number }; facing: number; walking: boolean; carrying: boolean } | null {
  if (!p.inVehicle) return null;
  // Goods returned from a cancelled order going into the warehouse.
  const car = vehicleOf(w, p), returned = car?.unloading && w.buildings[car.unloading.buildingId];
  if (car && returned) return shuttleWalk(car.pos, buildingDoor(w, returned), p.id, clock, true);
  if (p.orderId == null) return null;
  const order = w.orders[p.orderId];
  if (!order || order.state !== 'executing' || (order.type !== 'export' && order.type !== 'raid')) return null;
  // At the destination (the export terminal, or the warehouse taking raided
  // goods) the same working spell unloads: crates go from the truck to the door.
  const unloading = !!(order.exportDelivery || order.raidDelivery);
  const siteId = order.exportDelivery?.terminalId ?? order.raidDelivery?.warehouseId ?? order.targetBuildingIds[0];
  const truck = vehicleOf(w, p), site = w.buildings[siteId];
  if (truck?.kind !== 'truck' || !site) return null;
  return shuttleWalk(truck.pos, buildingDoor(w, site), p.id, clock, unloading);
}

export interface Shuttle { pos: { x: number; y: number }; facing: number; walking: boolean; carrying: boolean }

/** Walk cases between a parked truck and a door, side by side and staggered by
 * id. Loading carries door → truck; unloading carries truck → door. */
export function shuttleWalk(from: { x: number; y: number }, door: { x: number; y: number }, id: number, clock: number, unloading: boolean): Shuttle | null {
  const d = Math.hypot(door.x - from.x, door.y - from.y);
  if (d < 1 || d > 15) return null;
  const ux = (door.x - from.x) / d, uy = (door.y - from.y) / d, side = (((id % 3) + 3) % 3 - 1) * .7;
  const leg = d / 1.3, pause = 1, period = 2 * leg + 2 * pause;
  const t = ((clock + (((id % 7) + 7) % 7) * 1.3) % period + period) % period;
  // Out: door to truck; a moment at the tailboard; back: truck to door.
  const out = t < leg, back = t >= leg + pause && t < 2 * leg + pause;
  const along = out ? 1 - t / leg : t < leg + pause ? 0 : back ? (t - leg - pause) / leg : 1;
  return {
    pos: { x: from.x + ux * d * along - uy * side, y: from.y + uy * d * along + ux * side },
    facing: out ? Math.atan2(-ux, -uy) : Math.atan2(ux, uy),
    walking: out || back, carrying: unloading ? back : out,
  };
}

/** Synthetic character ids for delivery drivers, clear of every person id. */
export const DELIVERY_DRIVER_ID = -1_000_000;

/** A business delivery truck at the shop door: its driver carries the cases in
 * for the few minutes it stays (UNLOAD_MINUTES, src/sim/goodsDelivery.ts). */
export function deliveryDriver(w: WorldState, d: GoodsDelivery, clock: number): (Shuttle & { id: number }) | null {
  if (!d.unloadLeft || d.targetId == null) return null;
  const shop = w.buildings[d.targetId];
  if (!shop) return null;
  const id = DELIVERY_DRIVER_ID - d.sourceId, walk = shuttleWalk(d.pos, buildingDoor(w, shop), id, clock, true);
  return walk && { ...walk, id };
}
