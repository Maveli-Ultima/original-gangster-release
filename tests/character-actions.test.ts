import {describe,it,expect} from 'vitest';
import {presentAttack,presentDeath,presentPhoto,presentThrow,presentationEvents,THROW_TIMING} from '../src/sim/presentationEvents';
import {CharacterActions,actionFlash,ATTACK_CONTACT} from '../src/render/characterActions';
import {drawDuration} from '../src/render/weaponHandling';
import {SHOOT_DURATION} from '../src/render/combatMotionTiming';
import type {Person,WorldState} from '../src/sim/types';
import * as THREE from 'three';
import {characterClips,CharacterMotion} from '../src/render/characterMotion';
function fixture(){
 const a={id:1,pos:{x:10,y:20},status:'active'} as Person;
 const b={id:2,pos:{x:11,y:22},status:'active'} as Person;
 const world={week:1,minute:10,people:{1:a,2:b},rngState:87} as unknown as WorldState;
 return {a,b,world};
}
describe('character action playback',()=>{
 it('draws guns for actual combat, retains them through rapid fire and holsters after combat or death',()=>{
  const {a,b,world}=fixture(),reader=new CharacterActions(world);
  expect(reader.drawnWeapon(a.id)).toBeUndefined();
  presentAttack(world,a,b,'pistol',false);reader.update(world,0);
  expect(reader.drawnWeapon(a.id)).toBe('pistol');reader.update(world,2.5);
  expect(reader.drawnWeapon(a.id)).toBe('pistol');
  presentAttack(world,a,b,'pistol',false);reader.update(world,0);reader.update(world,1);
  expect(reader.drawnWeapon(a.id)).toBe('pistol');reader.update(world,2.1);
  expect(reader.drawnWeapon(a.id)).toBeUndefined();
  presentAttack(world,a,b,'rifle',false);presentDeath(world,a);reader.update(world,0);
  expect(reader.drawnWeapon(a.id)).toBeUndefined();
  reader.reset(world);expect(reader.drawnWeapon(a.id)).toBeUndefined();
 });
 it('aims at a man where he is shown carrying crates, not at the truck he is seated in',()=>{
  const {a,b,world}=fixture(),reader=new CharacterActions(world),shown={x:30,y:40};
  presentAttack(world,a,b,'pistol',true);reader.update(world,0,id=>id===b.id?shown:undefined);
  expect(reader.get(a.id)?.target).toEqual(shown);
  expect(reader.get(b.id)?.target).toEqual(a.pos);
 });
 it('plays a distinct throw in normal mode, freezes on pause and does not add a muzzle flash',()=>{
  const {a,world}=fixture(),reader=new CharacterActions(world),saved=JSON.stringify(world);
  presentThrow(world,a,{x:15,y:25},'molotov');reader.update(world,0);
  expect(reader.get(a.id)).toMatchObject({kind:'throw',throwable:'molotov',target:{x:15,y:25},time:0});
  reader.update(world,THROW_TIMING.release);expect(reader.get(a.id)?.time).toBe(THROW_TIMING.release);
  reader.update(world,0);expect(reader.get(a.id)?.time).toBe(THROW_TIMING.release);
  expect(actionFlash(reader.get(a.id))).toBe(0);expect(JSON.stringify(world)).toBe(saved);
  reader.update(world,THROW_TIMING.duration);expect(reader.get(a.id)).toBeUndefined();
 });
 it('holds a quiet idle and removes hand IK when an action is interrupted or paused',()=>{
  const root=new THREE.Group(),arm=new THREE.Bone();arm.name='RightArm';root.add(arm);
  const a=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-.3),b=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.3);
  const walk=new THREE.AnimationClip('walk',1,[new THREE.QuaternionKeyframeTrack('RightArm.quaternion',[0,.5,1],[...a.toArray(),...b.toArray(),...a.toArray()])]);
  const mixer=new THREE.AnimationMixer(root),clips=characterClips(root,walk),motion=new CharacterMotion(mixer,walk,clips);
  motion.sample(0,false,{clock:0,delta:0});const neutral=arm.quaternion.clone();
  for(let n=0;n<16;n++){
   arm.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1),1.5); // previous hand IK
   motion.sample(0,false,{clock:n/4,delta:0});expect(arm.quaternion.angleTo(neutral)).toBeLessThan(1e-6);
  }
  motion.sample(Math.PI,true,{clock:4,delta:.08});expect(arm.quaternion.angleTo(neutral)).toBeGreaterThan(.05);
  motion.sample(Math.PI,false,{clock:4.08,delta:.08});expect(arm.quaternion.angleTo(neutral)).toBeLessThan(.15);
  mixer.stopAllAction();
 });
 it('keeps transient cues out of saves and provides independent city/Tagged readers',()=>{
  const {a,b,world}=fixture(),saved=JSON.stringify(world);
  const main=new CharacterActions(world),tagged=new CharacterActions(world);
  presentAttack(world,a,b,'pistol',true);
  main.update(world,0);tagged.update(world,0);
  expect(JSON.stringify(world)).toBe(saved);
  expect(main.get(1)).toEqual(tagged.get(1));expect(main.get(2)?.kind).toBe('hit');
  a.pos.x=99;expect(presentationEvents(world).events[0].pos.x).toBe(10);
  main.update(world,.24);expect(actionFlash(main.get(1))).toBeCloseTo(1);
  expect(tagged.get(1)?.time).toBe(0);
 });
 it('retains a fall over hit reactions, holds it while paused and expires it once',()=>{
  const {a,b,world}=fixture(),reader=new CharacterActions(world);
  presentDeath(world,b);presentAttack(world,a,b,'rifle',true);reader.update(world,0);
  expect(reader.get(2)?.kind).toBe('death');
  reader.update(world,0);expect(reader.get(2)?.time).toBeCloseTo(-drawDuration('rifle')-ATTACK_CONTACT);
  reader.update(world,3);expect(reader.get(2)?.kind).toBe('death');
  reader.update(world,8);expect(reader.get(2)).toBeUndefined();reader.update(world,0);expect(reader.get(2)).toBeUndefined();
 });
 it('coalesces rapid shots without starving the aim/flash and lets them recover when fire stops',()=>{
  const {a,b,world}=fixture(),reader=new CharacterActions(world);
  let flashes=0;
  for(let n=0;n<240;n++){
   presentAttack(world,a,b,'tommy',true);reader.update(world,1/60);
   if(actionFlash(reader.presentation(a.id))>.5)flashes++;
   if(n>20)expect(reader.get(a.id)!.time).toBeGreaterThanOrEqual(.18);
  }
  expect(flashes).toBeGreaterThan(10);
  expect(reader.get(b.id)!.time).toBeGreaterThan(0);
  reader.update(world,SHOOT_DURATION+.01);expect(reader.get(a.id)).toBeUndefined();
 });
 it('finishes a punch through frequent attack events, but changes weapon and target immediately',()=>{
  const {a,b,world}=fixture(),reader=new CharacterActions(world);
  for(let n=0;n<30;n++){presentAttack(world,a,b,undefined,true);reader.update(world,1/60);}
  expect(reader.get(a.id)!.time).toBeCloseTo(29/60);
  b.pos={x:25,y:30};presentAttack(world,a,b,'pistol',false);reader.update(world,0);
  expect(reader.get(a.id)).toMatchObject({kind:'shoot',time:0,target:{x:25,y:30}});
 });
 it('does not replay old shots on entering a view, restoring a save or starting a week',()=>{
  const {a,b,world}=fixture();presentAttack(world,a,b,'rifle',false);
  const reader=new CharacterActions(world);reader.update(world,0);expect(reader.has(1)).toBe(false);
  presentAttack(world,a,b,'rifle',false);world.minute+=4;reader.update(world,0);expect(reader.has(1)).toBe(false);
  presentPhoto(world,a);reader.update(world,0);expect(reader.get(1)?.kind).toBe('photo');
  world.week++;reader.update(world,0);expect(reader.has(1)).toBe(false);
  reader.update(structuredClone(world),0);expect(reader.has(1)).toBe(false);
 });
 it('bounds event storage and distinguishes missed shots and unarmed strikes',()=>{
  const {a,b,world}=fixture(),reader=new CharacterActions(world);
  for(let i=0;i<160;i++)presentAttack(world,a,b,undefined,false);
  expect(presentationEvents(world).events).toHaveLength(128);
  reader.update(world,0);expect(reader.get(1)?.kind).toBe('strike');expect(reader.has(2)).toBe(false);
  expect(actionFlash(reader.get(1))).toBe(0);
 });
});
