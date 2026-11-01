import { DRIVE_SPEED, MINUTES_PER_WEEK, VEHICLES } from './constants';
import { BUILDING_BY_ID } from './data/buildings';
import { goodsRetailer, goodsRoom } from './goodsStorage';
import { roadAheadBlocked, roadAheadRoom, trafficContext } from './traffic';
import { noteDrive, previewVehicle } from './movement';
import { roadHeading, roadPosition, vehicleRoute } from './vehicleNavigation';
import { buildingDoor, dist } from './world';
import type { Building, GoodsDelivery, GoodsKind, Vec2, WorldState } from './types';
import { buildingList } from './entityLists';

const KINDS: GoodsKind[] = ['counterfeit', 'stolen', 'liquor'];
/** Game minutes a delivery truck stays at the shop while its cases go in (playtest, 1 October). */
export const UNLOAD_MINUTES = 8;
export const DELIVERY_SPEED = DRIVE_SPEED * VEHICLES.truck.speed;
const dayLength = MINUTES_PER_WEEK / 5;
const owns = (b: Building | undefined, gangId: number): b is Building => !!b && b.ownerGangId === gangId && b.state === 'trading';

/** Business employees automatically handle distribution. Their service trucks
 * are part of running the premises, not extra saleable crew inventory. This
 * staffing choice, daily batches and retail buffers are remake interpretations. */
function produce(w: WorldState, b: Building): void {
  const t = BUILDING_BY_ID[b.typeId];
  if (!t?.produces || b.state !== 'trading' || b.ownerGangId == null) return;
  const day = Math.min(4, Math.floor(Math.max(0, w.minute - 1) / dayLength));
  if (b.goodsProduction?.week === w.week && b.goodsProduction.day >= day) return;
  const mgr = b.managerId == null ? null : w.people[b.managerId];
  const rate = mgr?.status === 'active' ? .5 + mgr.skills.business * .14 : .6;
  const exact = t.produces.amount * rate / 5 + (b.goodsProduction?.remainder ?? 0);
  const made = Math.floor(exact + 1e-8), cap = t.produces.kind === 'counterfeit' ? 15 : 300;
  b.stock[t.produces.kind] += Math.min(made, Math.max(0, cap - b.stock[t.produces.kind]));
  b.goodsProduction = { week: w.week, day, remainder: Math.max(0, exact - made) };
}

function reservedRoom(w: WorldState, b: Building, kind: GoodsKind, except?: GoodsDelivery): number {
  let room = goodsRoom(b, kind);
  for (const d of Object.values(w.goodsDeliveries ?? {})) {
    if (d === except || d.targetId !== b.id) continue;
    const sameStore = kind === d.kind || b.typeId === 'warehouse' && kind !== 'counterfeit' && d.kind !== 'counterfeit';
    if (sameStore) room -= d.amount;
  }
  return Math.max(0, room);
}
function destination(w: WorldState, gangId: number, kind: GoodsKind, from: Vec2,
  allowWarehouse: boolean, except?: GoodsDelivery): Building | undefined {
  const sites = buildingList(w).filter(b => owns(b, gangId) && reservedRoom(w, b, kind, except) > 0);
  const retail = sites.filter(b => goodsRetailer(b, kind));
  retail.sort((a,b) => dist(from,buildingDoor(w,a))-dist(from,buildingDoor(w,b)) || a.id-b.id);
  if (retail.length) return retail[0];
  if (!allowWarehouse) return;
  const stores = sites.filter(b => b.typeId === 'warehouse');
  // Counterfeit goes to the first available warehouse; stolen goods to the
  // nearest. Liquor likewise uses the nearest available surplus store.
  stores.sort((a,b) => kind === 'counterfeit' ? a.id-b.id
    : dist(from,buildingDoor(w,a))-dist(from,buildingDoor(w,b)) || a.id-b.id);
  return stores[0];
}
function route(w: WorldState, d: GoodsDelivery, target: Building): void {
  const r = vehicleRoute(w, d.pos, buildingDoor(w,target), (d.sourceId & 1) === 0);
  d.pos = r.start; d.path = r.path; d.targetId = target.id;
}
function home(w: WorldState, d: GoodsDelivery): Building | undefined {
  const source = w.buildings[d.sourceId];
  if (source?.ownerGangId === d.gangId && source.state !== 'destroyed') return source;
  return buildingList(w).find(b => owns(b,d.gangId) && b.typeId === 'warehouse');
}
function schedule(w: WorldState, source: Building): void {
  if (source.ownerGangId == null || source.state !== 'trading' || w.gangs[source.ownerGangId]?.eliminated ||
    w.goodsDeliveries?.[source.id] || source.typeId !== 'warehouse' && !BUILDING_BY_ID[source.typeId]?.produces) return;
  for (const kind of KINDS) {
    if (source.stock[kind] <= 0) continue;
    const pos = roadPosition(w,buildingDoor(w,source));
    const target = destination(w,source.ownerGangId,kind,pos,source.typeId !== 'warehouse');
    if (!target || target.id === source.id) continue;
    const amount = Math.min(source.stock[kind], VEHICLES.truck.cargo, reservedRoom(w,target,kind));
    if (amount <= 0) continue;
    source.stock[kind] -= amount;
    const delivery: GoodsDelivery = {sourceId:source.id,gangId:source.ownerGangId,kind,amount,
      pos,path:[],targetId:null,returning:false,heading:roadHeading(w,pos),halted:false};
    (w.goodsDeliveries ??= {})[source.id] = delivery;
    route(w,delivery,target);
    return;
  }
}
function step(w: WorldState, d: GoodsDelivery, minutes: number): boolean {
  let budget = DELIVERY_SPEED * minutes;
  d.halted = false;
  const traffic = trafficContext(w);
  noteDrive(d, d.pos);
  while (budget > 0 && d.path.length) {
    const p = d.path[0], dx = p.x-d.pos.x, dy = p.y-d.pos.y, length = Math.hypot(dx,dy);
    if (length > .5 && roadAheadBlocked(traffic,d.pos,p)) { d.halted=true; return false; }
    if (length > .5) { budget = Math.min(budget, roadAheadRoom(traffic,d.pos,p,d,d.path[1])); if (budget <= 0) return false; }
    if (length > .01) d.heading=Math.atan2(dx,dy);
    if (length <= budget) { d.pos={...p}; d.path.shift(); budget-=length; noteDrive(d, d.pos, true); }
    else { d.pos.x+=dx/length*budget; d.pos.y+=dy/length*budget; budget=0; }
  }
  return d.path.length === 0;
}

export function tickGoods(w: WorldState, minutes: number): void {
  if (w.phase !== 'week' || w.settlementStage != null) return;
  for (const [key,d] of Object.entries(w.goodsDeliveries ?? {})) {
    if (w.gangs[d.gangId]?.eliminated) { delete w.goodsDeliveries![Number(key)]; continue; }
    if(d.targetId==null&&d.halted&&w.minute%10!==1)continue;
    // A short drop-off at the shop door before the truck turns for home.
    if(d.unloadLeft){d.unloadLeft=Math.max(0,d.unloadLeft-minutes);if(d.unloadLeft>0)continue;delete d.unloadLeft;
      const back=home(w,d);if(back)route(w,d,back);else delete w.goodsDeliveries![Number(key)];continue;}
    let target = d.targetId == null ? undefined : w.buildings[d.targetId];
    const usable = d.returning ? target?.ownerGangId===d.gangId && target.state!=='destroyed'
      : owns(target,d.gangId) && goodsRoom(target,d.kind)>0;
    if (!usable) {
      target = d.returning ? home(w,d) : destination(w,d.gangId,d.kind,d.pos,true,d);
      if (!target) {
        d.targetId=null; d.path=[]; d.halted=true;
        if (!d.amount) delete w.goodsDeliveries![Number(key)];
        continue;
      }
      route(w,d,target);
    }
    if (!step(w,d,minutes)) continue;
    if (d.returning) { delete w.goodsDeliveries![Number(key)]; continue; }
    if (target && owns(target,d.gangId) && dist(d.pos,roadPosition(w,buildingDoor(w,target)))<3) {
      const amount=Math.min(d.amount,goodsRoom(target,d.kind));
      target.stock[d.kind]+=amount;d.amount-=amount;
    }
    if (d.amount > 0) { d.targetId=null; continue; }
    d.returning=true;d.unloadLeft=UNLOAD_MINUTES;
  }
  // Reconcile inventories at a bounded cadence. Existing trucks keep moving
  // every tick, and no scan/routing work is done by the renderer.
  if (w.minute % 10 === 1) {
    for (const b of buildingList(w)) produce(w,b);
    for (const b of buildingList(w)) schedule(w,b);
  }
}

/** Where a delivery lorry is drawn: between where the last tick found it and where it left it. */
export function previewGoodsDelivery(d: GoodsDelivery, fraction: number): Vec2 {
  return previewVehicle(d, d.pos, fraction, { x: 0, y: 0 });
}

export function goodsDeliverySummary(w: WorldState, b: Building): string | null {
  const outbound = w.goodsDeliveries?.[b.id];
  const inbound = Object.values(w.goodsDeliveries ?? {}).filter(d=>d.targetId===b.id&&!d.returning).reduce((sum,d)=>sum+d.amount,0);
  const parts:string[]=[];
  if(outbound)parts.push(outbound.returning?'Delivery truck returning':`${outbound.amount} ${outbound.kind} cases ${outbound.targetId==null?'waiting for a destination':'on delivery'}`);
  if(inbound)parts.push(`${inbound} cases arriving`);
  return parts.length?parts.join(' · '):null;
}
