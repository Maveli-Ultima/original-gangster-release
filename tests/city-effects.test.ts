import * as THREE from 'three';
import {describe,it,expect} from 'vitest';
import {CityEffects,MAX_SMOLDER_SITES,SMOLDER_PARTICLES} from '../src/render/cityEffects';
import {presentAttack,presentBuildingEffect} from '../src/sim/presentationEvents';
import {CharacterActions} from '../src/render/characterActions';
import type {Building,Lot,Person,WorldState} from '../src/sim/types';
const world=()=>({week:1,minute:10,buildings:{},lots:{},blocks:[],people:{},rngState:987}) as unknown as WorldState;
describe('transient fire and explosion presentation',()=>{
 it('restores bounded, nearby smouldering from saved damage and ends it the following week',()=>{
  const w=world();
  for(let i=1;i<=30;i++){
   w.buildings[i]={id:i,lotId:i,typeId:'poolHall',cls:'commercial',state:'damaged',fireWeek:1} as Building;
   w.lots[i]={id:i,center:{x:i*100,y:10},facing:'south'} as Lot;
  }
  const saved=JSON.stringify(w),fx=new CityEffects(w,new THREE.Scene());fx.syncSmolderSites(w);fx.update(w,1);
  expect(fx.smolderCount).toBe(MAX_SMOLDER_SITES);expect(fx.geometry.instanceCount).toBe(MAX_SMOLDER_SITES*SMOLDER_PARTICLES);
  const positions=fx.geometry.getAttribute('effectCenter');expect(positions.getX(0)).toBeLessThan(110);
  fx.setFocusPoints([{x:3000,z:10}]);fx.update(w,0);expect(positions.getX(0)).toBeGreaterThan(2990);
  const frozen=Array.from(positions.array);fx.update(w,0);expect(Array.from(positions.array)).toEqual(frozen);
  expect(JSON.stringify(w)).toBe(saved);
  w.week=2;fx.update(w,0);fx.syncSmolderSites(w);fx.update(w,0);
  expect(fx.smolderCount).toBe(0);expect(fx.mesh.visible).toBe(false);fx.dispose();
 });
 it('hands an expired fire over to small smouldering puffs and clears them after repair',()=>{
  const w=world();w.buildings[1]={id:1,lotId:1,typeId:'poolHall',cls:'commercial',state:'damaged',fireWeek:1} as Building;
  w.lots[1]={id:1,center:{x:10,y:10},facing:'south'} as Lot;
  const fx=new CityEffects(w,new THREE.Scene());fx.syncSmolderSites(w);
  presentBuildingEffect(w,'fire',{x:10,y:10},1);fx.update(w,0);fx.update(w,5);
  expect(fx.geometry.instanceCount).toBe(24);fx.update(w,14);
  expect(fx.count).toBe(0);expect(fx.geometry.instanceCount).toBe(4);
  expect(fx.geometry.getAttribute('effectData').getZ(0)).toBe(4);
  fx.clear();fx.update(w,0);expect(fx.geometry.instanceCount).toBe(4);
  w.buildings[1].state='trading';delete w.buildings[1].fireWeek;fx.syncSmolderSites(w);fx.update(w,0);
  expect(fx.geometry.instanceCount).toBe(0);fx.dispose();
 });
 it('tags upper-storey smoke for cutaway cameras without moving or restarting the particles',()=>{
  const w=world();w.buildings[1]={id:1,lotId:1,typeId:'poolHall',cls:'commercial',state:'damaged'} as Building;
  w.lots[1]={id:1,center:{x:10,y:10},facing:'south'} as Lot;
  const fx=new CityEffects(w,new THREE.Scene());presentBuildingEffect(w,'fire',{x:10,y:10},1);
  fx.update(w,0);fx.update(w,8);
  const floors=fx.geometry.getAttribute('effectFloor'),positions=Array.from(fx.geometry.getAttribute('effectCenter').array);
  expect(Array.from(floors.array).some(y=>y>0)).toBe(true);
  fx.setLowered(true);expect(fx.material.uniforms.lowered.value).toBe(1);
  fx.setLowered(false);expect(fx.material.uniforms.lowered.value).toBe(0);
  expect(Array.from(fx.geometry.getAttribute('effectCenter').array)).toEqual(positions);
  fx.dispose();
 });
 it('holds the original building presentation until bomb impact without delaying simulation damage',()=>{
  const w=world(),fx=new CityEffects(w,new THREE.Scene()),before={id:12,state:'trading'} as Building;
  w.buildings[12]={...before,state:'destroyed'};
  presentBuildingEffect(w,'explosion',{x:1,y:2},12,2.25,before);fx.update(w,0);
  expect(fx.buildingBeforeImpact(12)?.state).toBe('trading');expect(w.buildings[12].state).toBe('destroyed');
  const revision=fx.revision;fx.update(w,2.24);expect(fx.buildingBeforeImpact(12)).toBe(before);
  fx.update(w,.02);expect(fx.buildingBeforeImpact(12)).toBeUndefined();expect(fx.revision).toBeGreaterThan(revision);fx.dispose();
 });
 it('fades the radial burst without changing it into flame strips or smoke mid-flight',()=>{
  const w=world(),fx=new CityEffects(w,new THREE.Scene());
  presentBuildingEffect(w,'explosion',{x:1,y:2});fx.update(w,0);fx.update(w,.39);
  const data=fx.geometry.getAttribute('effectData');
  expect(data.getZ(0)).toBe(2);const alpha=data.getY(0);expect(alpha).toBeGreaterThan(0);
  fx.update(w,.02);expect(data.getZ(0)).toBe(2);expect(data.getY(0)).toBeLessThan(alpha);
  fx.update(w,.1);expect(data.getY(0)).toBe(0);expect(data.getY(12)).toBeGreaterThan(0);fx.dispose();
 });
 it('clears visible cues without replaying them on the next update',()=>{
  const w=world(),fx=new CityEffects(w,new THREE.Scene());
  presentBuildingEffect(w,'fire',{x:1,y:2});fx.update(w,0);fx.update(w,1);expect(fx.mesh.visible).toBe(true);
  fx.clear();fx.update(w,0);expect(fx.count).toBe(0);expect(fx.geometry.instanceCount).toBe(0);expect(fx.mesh.visible).toBe(false);fx.dispose();
 });
 it('waits for the thrown object to arrive before showing the fire or explosion',()=>{
  const w=world(),fx=new CityEffects(w,new THREE.Scene());
  presentBuildingEffect(w,'fire',{x:1,y:2},undefined,2.25);fx.update(w,0);
  expect(fx.geometry.instanceCount).toBe(0);fx.update(w,2.24);expect(fx.geometry.instanceCount).toBe(0);
  fx.update(w,.02);expect(fx.geometry.instanceCount).toBeGreaterThan(0);fx.dispose();
 });
 it('preserves the save/RNG, freezes on pause, bounds the batch and expires',()=>{
  const w=world(),before=JSON.stringify(w),scene=new THREE.Scene(),fx=new CityEffects(w,scene);
  for(let n=0;n<20;n++)presentBuildingEffect(w,'fire',{x:n,y:20});
  fx.update(w,.1);expect(fx.count).toBe(12);expect(fx.geometry.instanceCount).toBe(288);
  expect(JSON.stringify(w)).toBe(before);
  const data=Array.from(fx.geometry.getAttribute('effectCenter').array);
  fx.update(w,0);expect(Array.from(fx.geometry.getAttribute('effectCenter').array)).toEqual(data);
  fx.update(w,20);expect(fx.count).toBe(0);expect(fx.mesh.visible).toBe(false);
  fx.dispose();expect(scene.children).toHaveLength(0);
 });
 it('does not replay past events after entering the city, loading or a new week',()=>{
  const w=world();presentBuildingEffect(w,'explosion',{x:1,y:2});
  const fx=new CityEffects(w,new THREE.Scene());fx.update(w,0);expect(fx.count).toBe(0);
  presentBuildingEffect(w,'explosion',{x:1,y:2});fx.update(w,.1);expect(fx.count).toBe(1);
  w.week++;fx.update(w,0);expect(fx.count).toBe(0);
  presentBuildingEffect(w,'fire',{x:1,y:2});fx.update(structuredClone(w),0);expect(fx.count).toBe(0);
  fx.dispose();
 });
 it('does not turn building damage into a person attack and ignores unrelated events',()=>{
  const w=world(),fx=new CityEffects(w,new THREE.Scene()),actions=new CharacterActions(w);
  presentBuildingEffect(w,'explosion',{x:1,y:2});actions.update(w,0);expect(actions.has(0)).toBe(false);
  const p={id:1,pos:{x:1,y:2}} as Person;presentAttack(w,p,p,undefined,false);
  fx.update(w,.1);expect(fx.count).toBe(1);fx.dispose();
 });
});
