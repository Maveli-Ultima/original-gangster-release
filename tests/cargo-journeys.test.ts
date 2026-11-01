import { describe, expect, it, vi, afterEach } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { cancelOrder, issueOrder, previewOrder, sellVehicle, transferVehicle, leaveVehicle, setWaiting } from '../src/sim/api';
import { disbandTeam, tickOrders } from '../src/sim/execution';
import { goodsTotal } from '../src/sim/cargo';
import { plannedTravelSpeed, RETURN_UNLOAD_MINUTES, transportPlan, vehicleOf } from '../src/sim/transport';
import { personSpeed, stepPerson } from '../src/sim/movement';
import { Sim, MINUTES_PER_SECOND } from '../src/sim/sim';
import { buildingDoor, dist, typeOf } from '../src/sim/world';
import { DRIVE_MIN_DISTANCE, MINUTES_PER_WEEK, WALK_SPEED } from '../src/sim/constants';
import { staffFirstCrew } from './helpers/crew';

afterEach(()=>vi.restoreAllMocks());
function fixture(){
 const sim=new Sim({...defaultGameOptions(),seed:404,citySize:10,startHoods:8,startMoney:100000});
 staffFirstCrew(sim);
 const w=sim.world,g=sim.playerGang,t=w.teams[g.teamIds[0]];
 w.orders={};for(const team of Object.values(w.teams)){team.orderIds=[];team.timeUsed=0;}
 t.vehicles={coupe:0,truck:1,speedster:0};
 const warehouses=Object.values(w.buildings).filter(b=>b.typeId==='warehouse'),store=warehouses[0];
 for(const b of warehouses)b.ownerGangId=null;
 store.ownerGangId=g.id;store.stock={liquor:50,stolen:0,counterfeit:0};
 for(const id of [t.lieutenantId,...t.memberIds])for(const key of Object.keys(w.people[id].skills) as (keyof typeof w.people[number]['skills'])[])w.people[id].skills[key]=5;
 return {sim,w,g,t,store,warehouses};
}
type Fixture=ReturnType<typeof fixture>;
function until(s:Fixture,test:()=>boolean,max=1300){for(let i=0;i<max&&!test();i++)s.sim.advance(1/MINUTES_PER_SECOND,1);expect(test()).toBe(true);}
function loaded(){const s=fixture();expect(issueOrder(s.w,s.g.id,{teamId:s.t.id,type:'export',buildingIds:[s.store.id],opts:{manpower:1}}).ok).toBe(true);
 const order=s.w.orders[s.t.orderIds.at(-1)!];s.sim.launchWeek();until(s,()=>!!order.exportDelivery);
 const car=vehicleOf(s.w,s.w.people[order.assignedIds[0]])!;
 until(s,()=>dist(car.pos,buildingDoor(s.w,s.store))>35);
 return {...s,order,car};
}
const remaining=(s:Fixture)=>Object.values(s.w.vehicleFleet??{}).reduce((n,v)=>n+(v.cargo?goodsTotal(v.cargo.goods):0),0);

describe('physical cargo returns and raids',()=>{
 it('cancelled export remains on its truck until a saved physical return arrives, exactly once',()=>{
  const s=loaded(),cash=s.g.cash;expect(cancelOrder(s.w,s.order.id).ok).toBe(true);
  expect(s.store.stock.liquor).toBe(0);expect(remaining(s)).toBe(50);expect(s.car.cargo?.purpose).toBe('return');
  expect(sellVehicle(s.w,s.g.id,'truck',s.t.id).ok).toBe(false);
  const restored=Sim.fromSave(structuredClone(s.w));
  for(let i=0;i<800&&remaining(s);i++){s.sim.advance(1/MINUTES_PER_SECOND,1);restored.advance(1/MINUTES_PER_SECOND,1);}
  expect(remaining(s)).toBe(0);expect(s.store.stock.liquor).toBe(50);expect(s.g.cash).toBe(cash);
  expect(restored.world.vehicleFleet).toEqual(s.w.vehicleFleet);expect(restored.world.buildings[s.store.id].stock).toEqual(s.store.stock);
  for(let i=0;i<20;i++)s.sim.advance(1/MINUTES_PER_SECOND,1);expect(s.store.stock.liquor).toBe(50);
 });
 it('a returned load parks at the warehouse while it goes in, then the truck heads home',()=>{
  const s=loaded();expect(cancelOrder(s.w,s.order.id).ok).toBe(true);
  until(s,()=>!!s.car.unloading,1500);
  expect(s.car.cargo).toBeUndefined();expect(s.store.stock.liquor).toBe(50);expect(s.car.unloading!.buildingId).toBe(s.store.id);
  const at={...s.car.pos};
  for(let i=0;i<RETURN_UNLOAD_MINUTES-1;i++)s.sim.advance(1/MINUTES_PER_SECOND,1);
  expect(s.car.unloading).toBeDefined();expect(s.car.pos).toEqual(at);
  for(let i=0;i<4;i++)s.sim.advance(1/MINUTES_PER_SECOND,1);
  expect(s.car.unloading).toBeUndefined();expect(s.car.returning).toBe(true);
 });
 it('keeps goods aboard when storage is full, then resumes when space opens',()=>{
  const s=loaded();s.store.stock={liquor:300,stolen:0,counterfeit:15};cancelOrder(s.w,s.order.id);
  const pos={...s.car.pos};for(let i=0;i<4;i++)s.sim.advance(1/MINUTES_PER_SECOND,1);
  expect(s.car.pos).toEqual(pos);expect(remaining(s)).toBe(50);expect(s.store.stock.liquor).toBe(300);
  s.store.stock.liquor=250;until(s,()=>!remaining(s));expect(s.store.stock.liquor).toBe(300);
 });
 it('unloads available room and physically delivers the remainder elsewhere',()=>{
  const s=loaded(),other=s.warehouses[1];other.ownerGangId=s.g.id;other.stock={liquor:0,stolen:0,counterfeit:0};
  s.store.stock.liquor=280;cancelOrder(s.w,s.order.id);until(s,()=>!remaining(s));
  expect(s.store.stock.liquor+other.stock.liquor).toBe(330);expect(s.store.stock.liquor).toBeLessThanOrEqual(300);
  expect(s.g.cash).toBe(100000);
 });
 it('reroutes after the destination is destroyed without crediting it remotely',()=>{
  const s=loaded(),other=s.warehouses[1];cancelOrder(s.w,s.order.id);
  s.store.state='destroyed';other.ownerGangId=s.g.id;other.stock={liquor:0,stolen:0,counterfeit:0};
  expect(other.stock.liquor).toBe(0);until(s,()=>!remaining(s));expect(other.stock.liquor).toBe(50);expect(s.store.stock.liquor).toBe(0);
 });
 it('preserves an unfinished return across the weekend and delivers it on Monday',()=>{
  const s=loaded();cancelOrder(s.w,s.order.id);const pos={...s.car.pos};
  s.w.minute=MINUTES_PER_WEEK;s.w.settlementStage=0;s.sim.finishWeek();
  expect(s.w.phase).toBe('planning');expect(remaining(s)).toBe(50);expect(s.store.stock.liquor).toBe(0);expect(s.car.pos).toEqual(pos);
  const saved=Sim.fromSave(structuredClone(s.w));saved.launchWeek();
  for(let i=0;i<800&&Object.values(saved.world.vehicleFleet??{}).some(v=>v.cargo);i++)saved.advance(1/MINUTES_PER_SECOND,1);
  expect(saved.world.buildings[s.store.id].stock.liquor).toBe(50);expect(Object.values(saved.world.vehicleFleet??{}).some(v=>v.cargo)).toBe(false);
 });
 it('disbanding a crew keeps its loaded cache truck in transit and prevents selling it',()=>{
  const s=loaded();disbandTeam(s.w,s.g,s.t.id,true);
  expect(s.w.teams[s.t.id]).toBeUndefined();expect(s.store.stock.liquor).toBe(0);expect(remaining(s)).toBe(50);
  expect(sellVehicle(s.w,s.g.id,'truck').ok).toBe(false);
  expect(()=>Sim.fromSave(structuredClone(s.w))).not.toThrow();until(s,()=>!remaining(s));expect(s.store.stock.liquor).toBe(50);
 });
 it('an abandoned truck loses its load, as a crew killed would (playtest, 14 October)',()=>{
  const s=loaded(),driver=s.w.people[s.car.driverId!],pos={...s.car.pos};
  expect(leaveVehicle(s.w,s.g.id,driver.id).ok).toBe(true);s.sim.advance(1/MINUTES_PER_SECOND,1);
  expect(s.order.state).toBe('failed');expect(s.store.stock.liquor).toBe(0);expect(s.car.pos).toEqual(pos);expect(remaining(s)).toBe(0);
  for(let i=0;i<300;i++)s.sim.advance(1/MINUTES_PER_SECOND,1);
  expect(s.store.stock.liquor).toBe(0);expect(s.g.cash).toBe(100000);
 });
 it('does not duplicate a load when a free inventory slot is removed ahead of a busy truck',()=>{
  const s=loaded();s.t.vehicles.truck=2;
  const old=s.w.people[s.car.driverId!].vehicleKey!,next=`team:${s.t.id}:truck:1`;
  delete s.w.vehicleFleet![old];s.w.vehicleFleet![next]=s.car;s.car.slot=1;
  for(const id of s.car.occupantIds)s.w.people[id].vehicleKey=next;s.order.exportDelivery!.vehicleKeys=[next];
  expect(transferVehicle(s.w,s.g.id,'truck',s.t.id,false).ok).toBe(true);
  expect(s.order.exportDelivery!.vehicleKeys).toEqual([old]);expect(()=>Sim.fromSave(structuredClone(s.w))).not.toThrow();
  until(s,()=>s.order.state==='done');expect(s.g.cash).toBe(101300);
 });
 it('raids actual warehouse stock, then delivers before crediting its own warehouse',()=>{
  const s=fixture(),target=s.warehouses[1];target.stock={liquor:60,stolen:0,counterfeit:0};s.store.stock.liquor=0;
  vi.spyOn(s.sim.rng,'chance').mockReturnValue(true);vi.spyOn(s.sim.rng,'pick').mockImplementation((items)=>items.includes('liquor')?'liquor':items[0]);
  expect(issueOrder(s.w,s.g.id,{teamId:s.t.id,type:'raid',buildingIds:[target.id],opts:{manpower:1}}).ok).toBe(true);
  const o=s.w.orders[s.t.orderIds.at(-1)!];s.sim.launchWeek();until(s,()=>!!o.raidDelivery);
  expect(s.store.stock.liquor).toBe(0);expect(remaining(s)).toBeGreaterThan(0);expect(target.stock.liquor+remaining(s)).toBe(60);
  const stolen=remaining(s),cash=s.g.cash;s.sim=Sim.fromSave(structuredClone(s.w));s.w=s.sim.world;s.store=s.w.buildings[s.store.id];s.g=s.sim.playerGang;
  until(s,()=>s.w.orders[o.id].state==='done');expect(s.store.stock.liquor).toBe(stolen);expect(s.g.cash).toBe(cash);expect(s.w.orders[o.id].completedTargets).toBe(1);
 });
 it('a raid delivery can wait without resolving the raid or its cash twice',()=>{
  const s=fixture(),target=Object.values(s.w.buildings).find(b=>b.ownerGangId==null&&b.typeId!=='warehouse'&&typeOf(b)?.stores?.length)!;s.store.stock.liquor=0;
  vi.spyOn(s.sim.rng,'chance').mockReturnValue(true);
  issueOrder(s.w,s.g.id,{teamId:s.t.id,type:'raid',buildingIds:[target.id],opts:{manpower:1}});
  const o=s.w.orders[s.t.orderIds.at(-1)!];s.sim.launchWeek();until(s,()=>!!o.raidDelivery);
  const cash=s.g.cash,p=s.w.people[o.assignedIds[0]],pos={...p.pos};setWaiting(s.w,o.id,true);
  for(let i=0;i<4;i++)s.sim.advance(1/MINUTES_PER_SECOND,1);expect(p.pos).toEqual(pos);expect(s.g.cash).toBe(cash);
  setWaiting(s.w,o.id,false);until(s,()=>o.state==='done');expect(s.g.cash).toBe(cash);expect(o.results.filter(x=>x.startsWith('Raided '))).toHaveLength(1);
 });
 it('rejects duplicated, missing and inconsistent truck-load snapshots',()=>{
  const s=loaded();for(const damage of [(w:typeof s.w)=>w.orders[s.order.id].exportDelivery!.vehicleKeys!.push(s.order.exportDelivery!.vehicleKeys![0]),
    (w:typeof s.w)=>{w.vehicleFleet![s.order.exportDelivery!.vehicleKeys![0]].cargo!.goods.liquor++;},
    (w:typeof s.w)=>{w.vehicleFleet![s.order.exportDelivery!.vehicleKeys![0]].cargo!.goods.liquor=-1;}]){
    const copy=structuredClone(s.w);damage(copy);expect(()=>Sim.fromSave(copy)).toThrow(/cargo|truck/i);
  }
 });
 it('migrates old boolean-only export trucks without losing an oversized saved load',()=>{
  const s=loaded(),snapshot=structuredClone(s.w);snapshot.teams[s.t.id].vehicles.coupe=1;
  delete snapshot.vehicleFleet;for(const p of Object.values(snapshot.people))delete p.vehicleKey;
  const shipment=snapshot.orders[s.order.id].exportDelivery!;delete shipment.vehicleKeys;
  shipment.goods={liquor:500,stolen:100,counterfeit:15};
  const restored=Sim.fromSave(snapshot),o=restored.world.orders[s.order.id];
  expect(vehicleOf(restored.world,restored.world.people[o.assignedIds[0]])?.kind).toBe('truck');
  restored.advance(1/MINUTES_PER_SECOND,1);
  const load=Object.values(restored.world.vehicleFleet!).find(v=>v.cargo)!.cargo!;
  expect(load.goods).toEqual(shipment.goods);expect(goodsTotal(load.goods)).toBe(615);
  expect(()=>Sim.fromSave(structuredClone(restored.world))).not.toThrow();
  for(let i=0;i<1000&&o.state!=='done';i++)restored.advance(1/MINUTES_PER_SECOND,1);
  expect(o.state).toBe('done');expect(restored.playerGang.cash).toBe(100000+500*26+100*34+15*900);
 });
});

describe('transport previews use the dispatched people and vehicles',()=>{
 it('uses the explicitly selected lieutenant as driver rather than an ordinary hood',()=>{
  const s=fixture();s.t.vehicles={coupe:1,truck:0,speedster:0};const lt=s.w.people[s.t.lieutenantId];lt.skills.driving=0;
  const target=Object.values(s.w.buildings).find(b=>b.ownerGangId==null&&b.cls==='commercial'&&!typeOf(b)?.special)!;
  const input={teamId:s.t.id,type:'extort' as const,buildingIds:[target.id],opts:{manpower:1,preferredHoodId:lt.id}};
  const slow=previewOrder(s.w,s.g.id,input)!.estimatedMinutes;lt.skills.driving=5;const fast=previewOrder(s.w,s.g.id,input)!.estimatedMinutes;
  expect(slow).toBeGreaterThan(fast);issueOrder(s.w,s.g.id,input);s.sim.launchWeek();expect(s.w.orders[s.t.orderIds.at(-1)!].assignedIds).toEqual([lt.id]);
 });
 it('splits export drivers between trucks identically in preview and dispatch',()=>{
  const s=fixture();s.t.vehicles.truck=2;const people=s.t.memberIds.slice(0,2).map(id=>s.w.people[id]);people[0].skills.driving=5;people[1].skills.driving=1;
  people.reverse(); // Explicitly select the slow driver, then the best remaining hood.
  const plan=transportPlan(s.w,s.t,people,'export');expect(plan.cars.map(c=>c.riders.length)).toEqual([1,1]);
  const speed=plannedTravelSpeed(s.w,s.t,people,'export');
  issueOrder(s.w,s.g.id,{teamId:s.t.id,type:'export',buildingIds:[s.store.id],opts:{manpower:2,preferredHoodId:people[0].id}});s.sim.launchWeek();
  expect(Math.min(...people.map(p=>personSpeed(p,s.w)))).toBe(speed);
 });
 it('does not promise an occupied car to another job or silently replace a busy named hood',()=>{
  const s=fixture();s.t.vehicles={coupe:1,truck:0,speedster:0};const hq=Object.values(s.w.buildings).find(b=>b.isHQ&&b.ownerGangId===s.g.id)!,target=Object.values(s.w.buildings).find(b=>b.ownerGangId==null&&b.cls==='commercial'&&!typeOf(b)?.special&&dist(buildingDoor(s.w,b),buildingDoor(s.w,hq))>DRIVE_MIN_DISTANCE+10)!;
  const p=s.w.people[s.t.memberIds[0]];issueOrder(s.w,s.g.id,{teamId:s.t.id,type:'extort',buildingIds:[target.id],opts:{manpower:1,preferredHoodId:p.id}});s.sim.launchWeek();
  const other=s.w.people[s.t.memberIds[1]];expect(plannedTravelSpeed(s.w,s.t,[other],'extort')).toBe(WALK_SPEED);
  issueOrder(s.w,s.g.id,{teamId:s.t.id,type:'extort',buildingIds:[target.id],opts:{manpower:1,preferredHoodId:p.id}});
  const queued=s.w.orders[s.t.orderIds.at(-1)!];tickOrders(s.w,s.sim.rng,1);expect(queued.state).toBe('queued');expect(queued.assignedIds).toEqual([]);
  // This stepping check also exercises the ordinary car API on the same world.
  stepPerson(p,.01,undefined,s.w);expect(personSpeed(p,s.w)).toBeGreaterThan(WALK_SPEED);
 });
});
