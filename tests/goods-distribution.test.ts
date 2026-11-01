import { MINUTES_PER_WEEK } from '../src/sim/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { Sim } from '../src/sim/sim';
import { tickGoods, previewGoodsDelivery, DELIVERY_SPEED, UNLOAD_MINUTES } from '../src/sim/goodsDelivery';
import { warehouseRoom } from '../src/sim/goodsStorage';
import { unloadCargo } from '../src/sim/cargo';
import { weeklyEconomy } from '../src/sim/systems/economy';
import { BUILDING_BY_ID } from '../src/sim/data/buildings';
import { buildingDoor, dist } from '../src/sim/world';
import { roadPosition, vehiclePathOnRoad } from '../src/sim/vehicleNavigation';
import * as traffic from '../src/sim/traffic';
import type { GoodsKind, WorldState } from '../src/sim/types';

afterEach(()=>vi.restoreAllMocks());
function fixture(){
 const sim=new Sim({...defaultGameOptions(),seed:404,citySize:10,startMoney:100000}),w=sim.world,g=sim.playerGang;
 w.orders={};for(const t of Object.values(w.teams)){t.orderIds=[];t.timeUsed=0;}
 for(const b of Object.values(w.buildings)){b.ownerGangId=null;b.stock={liquor:0,stolen:0,counterfeit:0};b.managerId=null;}
 for(const p of Object.values(w.people)){p.dest=null;p.path=[];}
 const sites=Object.values(w.buildings);
 const make=(type:string,index:number)=>{
  const b=sites[index];b.typeId=type;b.cls=BUILDING_BY_ID[type].cls;b.ownerGangId=g.id;b.state='trading';
  b.goodsProduction={week:1,day:4,remainder:0};return b;
 };
 const source=make('moonshineStill',0),shop=make('speakeasy',80),store=make('warehouse',160);
 w.phase='week';w.minute=0;
 vi.spyOn(traffic,'roadAheadBlocked').mockReturnValue(false);
 return {sim,w,g,source,shop,store,make};
}
type Fixture=ReturnType<typeof fixture>;
function tick(s:Fixture,n=1){for(let i=0;i<n;i++){s.w.minute++;tickGoods(s.w,1);}}
function until(s:Fixture,done:()=>boolean){for(let i=0;i<MINUTES_PER_WEEK*2&&!done();i++)tick(s);expect(done()).toBe(true);}
const total=(w:WorldState,kind:GoodsKind)=>Object.values(w.buildings).reduce((n,b)=>n+b.stock[kind],0)+Object.values(w.goodsDeliveries??{}).reduce((n,d)=>n+(d.kind===kind?d.amount:0),0);

describe('automatic business deliveries',()=>{
 it('stops at the shop door for the drop-off, then turns for home',()=>{
  const s=fixture();s.source.stock.liquor=50;tick(s);
  const d=s.w.goodsDeliveries![s.source.id];
  until(s,()=>!!d.unloadLeft);
  const at={...d.pos};expect(d.returning).toBe(true);expect(s.shop.stock.liquor).toBe(50);
  expect(dist(d.pos,roadPosition(s.w,buildingDoor(s.w,s.shop)))).toBeLessThan(3);
  tick(s,UNLOAD_MINUTES-1);expect(d.pos).toEqual(at);expect(d.unloadLeft).toBeGreaterThan(0);
  tick(s,3);expect(d.unloadLeft).toBeUndefined();expect(dist(d.pos,at)).toBeGreaterThan(0);
 });

 it('loads a real road journey and credits stock only after arrival, including a mid-trip save',()=>{
  const s=fixture();s.source.stock.liquor=50;tick(s);
  const d=s.w.goodsDeliveries![s.source.id];expect(d.amount).toBe(50);expect(s.source.stock.liquor).toBe(0);expect(s.shop.stock.liquor).toBe(0);
  expect(vehiclePathOnRoad(s.w,d.pos,d.path)).toBe(true);expect(total(s.w,'liquor')).toBe(50);
  tick(s,2);const restored=Sim.fromSave(structuredClone(s.w));const cargo=structuredClone(d);
  until(s,()=>s.shop.stock.liquor===50);
  while(restored.world.minute<s.w.minute){restored.world.minute++;tickGoods(restored.world,1);}
  expect(restored.world.goodsDeliveries).toEqual(s.w.goodsDeliveries);expect(restored.world.buildings[s.shop.id].stock).toEqual(s.shop.stock);
  expect(dist(cargo.pos,d.pos)).toBeGreaterThan(0);tick(s,40);expect(total(s.w,'liquor')).toBe(50);
 });
 it('retrieves stored liquor for a dry speakeasy without a working still',()=>{
  const s=fixture();s.source.state='ceased';s.store.stock.liquor=90;tick(s);
  expect(s.w.goodsDeliveries![s.store.id].targetId).toBe(s.shop.id);expect(s.store.stock.liquor).toBe(0);
  until(s,()=>s.shop.stock.liquor===90);expect(total(s.w,'liquor')).toBe(90);
 });
 it('reserves incoming retail space across producers instead of overfilling',()=>{
  const s=fixture(),other=s.make('moonshineStill',20);s.source.stock.liquor=100;other.stock.liquor=100;s.shop.stock.liquor=100;
  tick(s);expect(Object.values(s.w.goodsDeliveries!).filter(d=>d.targetId===s.shop.id).reduce((n,d)=>n+d.amount,0)).toBe(20);
  until(s,()=>s.shop.stock.liquor===120&&s.store.stock.liquor===180);expect(total(s.w,'liquor')).toBe(300);
 });
 it('keeps production at its source when storage is full, then resumes after room opens',()=>{
  const s=fixture();s.source.stock.liquor=30;s.shop.state='ceased';s.store.stock={liquor:180,stolen:120,counterfeit:15};
  tick(s,31);expect(s.w.goodsDeliveries?.[s.source.id]).toBeUndefined();expect(s.source.stock.liquor).toBe(30);
  s.store.stock.stolen=100;until(s,()=>s.store.stock.liquor===200);expect(s.source.stock.liquor).toBe(10);expect(warehouseRoom(s.store,'liquor')).toBe(0);
 });
 it('reroutes a truck whose destination closes without crediting the closed shop',()=>{
  const s=fixture();s.source.stock.liquor=40;tick(s,2);s.shop.state='ceased';
  until(s,()=>s.store.stock.liquor===40);expect(s.shop.stock.liquor).toBe(0);expect(total(s.w,'liquor')).toBe(40);
 });
 it('keeps an orphaned load through source sale and lost destinations, then uses new owned storage',()=>{
  const s=fixture();s.source.stock.liquor=40;tick(s,2);s.source.ownerGangId=null;s.shop.state='destroyed';s.store.state='ceased';
  tick(s,30);const d=s.w.goodsDeliveries![s.source.id];expect(d.amount).toBe(40);expect(d.targetId).toBeNull();expect(d.path).toEqual([]);
  const saved=Sim.fromSave(structuredClone(s.w));expect(saved.world.goodsDeliveries).toEqual(s.w.goodsDeliveries);
  s.store.state='trading';until(s,()=>s.store.stock.liquor===40);expect(s.source.stock.liquor).toBe(0);
 });
 it('fences stolen goods only at eligible retailers, never a warehouse',()=>{
  const s=fixture(),fence=s.make('jewellers',100);s.source.state='ceased';s.store.stock.stolen=22;
  tick(s);expect(s.w.goodsDeliveries![s.store.id].targetId).toBe(fence.id);
  until(s,()=>fence.stock.stolen===22);const before=s.g.cash;weeklyEconomy(s.w,s.sim.rng);
  expect(fence.stock.stolen).toBe(10);expect(s.g.cash).not.toBe(before);expect(s.store.stock.stolen).toBe(0);
 });
 it('distributes counterfeit to legal shops and preserves surplus warehouse reserves at settlement',()=>{
  const s=fixture(),retail=s.make('bakers',100);s.source.state='ceased';s.store.stock.counterfeit=10;
  tick(s);expect(s.w.goodsDeliveries![s.store.id].amount).toBe(6);expect(s.store.stock.counterfeit).toBe(4);
  until(s,()=>retail.stock.counterfeit===6);weeklyEconomy(s.w,s.sim.rng);
  expect(retail.stock.counterfeit).toBe(4);expect(s.store.stock.counterfeit).toBe(4);
 });
 it('does not sell warehouse inventory or counterfeit/stolen stock at unsupported businesses',()=>{
  const s=fixture();s.store.stock={liquor:70,stolen:20,counterfeit:15};s.shop.stock.stolen=5;
  const before=structuredClone(s.store.stock);weeklyEconomy(s.w,s.sim.rng);
  expect(s.store.stock).toEqual(before);expect(s.store.lastProfit).toBe(0);expect(s.shop.stock.stolen).toBe(5);
 });
 it('uses the combined warehouse cap for player cargo and retains old overfull stock',()=>{
  const s=fixture();s.store.stock={liquor:200,stolen:90,counterfeit:14};
  expect(warehouseRoom(s.store,'stolen')).toBe(10);expect(warehouseRoom(s.store,'counterfeit')).toBe(1);
  const car={kind:'truck' as const,gangId:s.g.id,teamId:null,staffId:null,slot:0,pos:roadPosition(s.w,buildingDoor(s.w,s.store)),driverId:null,occupantIds:[],orderId:null,destination:null,boarding:false,returning:false,
   cargo:{sourceId:s.source.id,orderId:null,purpose:'return' as const,destinationId:s.store.id,goods:{liquor:15,stolen:15,counterfeit:3}}};
  expect(unloadCargo(s.w,car,s.store)).toBe(11);expect(s.store.stock.liquor+s.store.stock.stolen).toBe(300);expect(s.store.stock.counterfeit).toBe(15);
  s.store.stock.liquor=500;expect(warehouseRoom(s.store,'stolen')).toBe(0);expect(()=>Sim.fromSave(structuredClone(s.w))).not.toThrow();expect(s.store.stock.liquor).toBe(500);
 });
 it('books daily production once and preserves fractional batches and closed-day gaps',()=>{
  const s=fixture();delete s.source.goodsProduction;s.shop.state='ceased';s.store.state='ceased';
  tick(s);expect(s.source.stock.liquor).toBe(10);tick(s,10);expect(s.source.stock.liquor).toBe(10);
  s.w.minute=480;tick(s);expect(s.source.stock.liquor).toBe(21);
  s.source.state='ceased';s.w.minute=960;tick(s);expect(s.source.stock.liquor).toBe(21);
  s.source.state='trading';s.w.minute=1440;tick(s);expect(s.source.stock.liquor).toBe(32);
  const restored=Sim.fromSave(structuredClone(s.w));restored.world.minute=1451;tickGoods(restored.world,1);expect(restored.world.buildings[s.source.id].stock.liquor).toBe(32);
 });
 it('produces the established weekly quantity in daily batches without a settlement bonus',()=>{
  const s=fixture(),press=s.make('counterfeitPress',30);delete s.source.goodsProduction;delete press.goodsProduction;
  s.shop.state='ceased';s.store.state='ceased';
  for(let day=0;day<5;day++){s.w.minute=day*480;tick(s);}
  expect(s.source.stock.liquor).toBe(54);expect(press.stock.counterfeit).toBe(3);
  weeklyEconomy(s.w,s.sim.rng);expect(s.source.stock.liquor).toBe(54);expect(press.stock.counterfeit).toBe(3);
 });
 it('keeps a full factory bounded and does not manufacture overflow goods',()=>{
  const s=fixture();delete s.source.goodsProduction;s.source.stock.liquor=300;s.shop.state='ceased';s.store.state='ceased';
  tick(s);expect(s.source.stock.liquor).toBe(300);expect(s.w.goodsDeliveries?.[s.source.id]).toBeUndefined();
 });
 it('sends counterfeit surplus to the first available warehouse and does not exceed its separate cap',()=>{
  const s=fixture(),other=s.make('warehouse',20);s.source.typeId='counterfeitPress';s.source.stock.counterfeit=12;
  s.store.stock.counterfeit=14;other.stock.counterfeit=15;s.shop.state='ceased';
  tick(s);expect(s.w.goodsDeliveries![s.source.id].targetId).toBe(s.store.id);expect(s.w.goodsDeliveries![s.source.id].amount).toBe(1);
  until(s,()=>s.store.stock.counterfeit===15);expect(s.source.stock.counterfeit).toBe(11);expect(other.stock.counterfeit).toBe(15);
 });
 it('carries a live load through Friday settlement without duplicating production or delivery',()=>{
  const s=fixture();s.source.stock.liquor=50;tick(s,2);const load=structuredClone(s.w.goodsDeliveries);
  s.w.minute=2400;s.w.settlementStage=0;s.sim.finishWeek();expect(s.w.phase).toBe('planning');expect(s.w.goodsDeliveries).toEqual(load);
  const restored=Sim.fromSave(structuredClone(s.w));restored.launchWeek();
  const world=restored.world;world.buildings[s.source.id].state='ceased';
  for(let i=0;i<MINUTES_PER_WEEK&&world.buildings[s.shop.id].stock.liquor<50;i++){world.minute++;tickGoods(world,1);}
  expect(world.buildings[s.shop.id].stock.liquor).toBe(50);
 });
 it('stops for a crossing and previews only the actual next road segment',()=>{
  const s=fixture();s.source.stock.liquor=20;tick(s);const d=s.w.goodsDeliveries![s.source.id],before={...d.pos};
  vi.mocked(traffic.roadAheadBlocked).mockReturnValue(true);tick(s);expect(d.pos).toEqual(before);expect(d.halted).toBe(true);expect(previewGoodsDelivery(d,.5)).toEqual(d.pos);
  vi.mocked(traffic.roadAheadBlocked).mockReturnValue(false);tick(s);expect(d.halted).toBe(false);expect(dist(before,d.pos)).toBeLessThanOrEqual(DELIVERY_SPEED+.001);
  expect(dist(d.pos,previewGoodsDelivery(d,.5))).toBeLessThanOrEqual(DELIVERY_SPEED*.5+.001);
 });
 it('rejects invalid delivery snapshots and repeated production stamps',()=>{
  const s=fixture();s.source.stock.liquor=20;tick(s);
  for(const damage of [(w:WorldState)=>{w.goodsDeliveries![s.source.id].amount=-1;},(w:WorldState)=>{w.goodsDeliveries![s.source.id].sourceId=-4;},
    (w:WorldState)=>{w.goodsDeliveries![s.source.id].targetId=-4;},(w:WorldState)=>{w.goodsDeliveries![s.source.id].returning=true;},
    (w:WorldState)=>{w.buildings[s.source.id].goodsProduction!.day=7;}]){
   const snapshot=structuredClone(s.w);damage(snapshot);expect(()=>Sim.fromSave(snapshot)).toThrow(/delivery|production/);
  }
 });
});
