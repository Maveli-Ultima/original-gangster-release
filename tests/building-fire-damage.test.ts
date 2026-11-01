import {describe,it,expect} from 'vitest';
import {Sim} from '../src/sim/sim';
import {defaultGameOptions} from '../src/app/newGame';
import {burnBuilding,damageBuilding} from '../src/sim/execution';
import {repairBuilding,shutdownBuilding} from '../src/sim/api';
import {fireDamageStage,finishBuildingRepairs} from '../src/sim/buildingDamage';

function fixture(){
 const sim=new Sim({...defaultGameOptions(),seed:404,citySize:10}),w=sim.world,g=sim.playerGang;
 const b=Object.values(w.buildings).find(b=>b.cls==='commercial'&&!b.isHQ&&b.ownerGangId==null&&!b.hidesId)!;
 b.ownerGangId=g.id;g.cash=100000;
 return {sim,w,g,b};
}
describe('lasting fire damage and explicit repairs',()=>{
 it('retains scorch damage through save/load and the following week without free repairs',()=>{
  const {w,b}=fixture();burnBuilding(w,b);
  expect(fireDamageStage(b,1)).toBe('scorched');
  const loaded=Sim.fromSave(JSON.parse(JSON.stringify(w)));
  const copy=loaded.world.buildings[b.id];expect(copy.fireWeek).toBe(1);
  loaded.world.week=2;finishBuildingRepairs(loaded.world);
  expect(copy.state).toBe('damaged');expect(fireDamageStage(copy,2)).toBe('awaiting-repair');
 });
 it('charges once, keeps the site closed for a repair week, and completes at real week settlement',()=>{
  const {sim,w,g,b}=fixture();burnBuilding(w,b);const cost=b.repairCost,cash=g.cash;
  expect(repairBuilding(w,g.id,b.id).ok).toBe(true);
  expect(g.cash).toBe(cash-cost);expect(b.repairCompleteWeek).toBe(3);
  expect(repairBuilding(w,g.id,b.id).ok).toBe(false);expect(g.cash).toBe(cash-cost);
  expect(fireDamageStage(b,1)).toBe('scorched');
  sim.launchWeek();sim.finishWeek();expect(w.week).toBe(2);
  expect(b.state).toBe('damaged');expect(fireDamageStage(b,2)).toBe('repairing');
  const loaded=Sim.fromSave(JSON.parse(JSON.stringify(w)));loaded.launchWeek();loaded.finishWeek();
  const repaired=loaded.world.buildings[b.id];expect(loaded.world.week).toBe(3);
  expect(repaired.state).toBe('trading');expect(repaired.fireWeek).toBeUndefined();expect(repaired.repairCompleteWeek).toBeUndefined();
 });
 it('cancels queued repairs when damaged again or closed down',()=>{
  const {w,g,b}=fixture();burnBuilding(w,b);repairBuilding(w,g.id,b.id);
  burnBuilding(w,b);expect(b.state).toBe('destroyed');expect(b.repairCompleteWeek).toBeUndefined();
  b.state='trading';burnBuilding(w,b);repairBuilding(w,g.id,b.id);
  expect(shutdownBuilding(w,g.id,b.id).ok).toBe(true);
  expect(b.fireWeek).toBeUndefined();expect(b.repairCompleteWeek).toBeUndefined();
  expect(()=>Sim.fromSave(JSON.parse(JSON.stringify(w)))).not.toThrow();
 });
 it('preserves ordinary immediate repairs and loads older saves without fire fields',()=>{
  const {w,g,b}=fixture();expect(()=>Sim.fromSave(structuredClone(w))).not.toThrow();
  damageBuilding(w,b,.3);expect(repairBuilding(w,g.id,b.id).ok).toBe(true);expect(b.state).toBe('trading');
  const civic=Object.values(w.buildings).find(b=>b.cls==='municipal')!;burnBuilding(w,civic);expect(civic.fireWeek).toBeUndefined();
 });
 it('rejects future burn dates and invalid repair schedules on load',()=>{
  const {w,g,b}=fixture();burnBuilding(w,b);repairBuilding(w,g.id,b.id);
  const saved=JSON.stringify(w);
  for(const patch of [{fireWeek:2},{repairCompleteWeek:1},{repairCompleteWeek:2.5},{state:'trading'}]){
   const copy=JSON.parse(saved);Object.assign(copy.buildings[b.id],patch);expect(()=>Sim.fromSave(copy)).toThrow();
  }
 });
});
