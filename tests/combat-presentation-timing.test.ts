import {describe,it,expect} from 'vitest';
import {CharacterActions,ATTACK_CONTACT,actionFlash} from '../src/render/characterActions';
import {drawDuration} from '../src/render/weaponHandling';
import {SHOOT_DURATION,PUNCH_CONTACT,hitDuration} from '../src/render/combatMotionTiming';
import {presentAttack,presentDeath} from '../src/sim/presentationEvents';
import type {Person,WeaponId,WorldState} from '../src/sim/types';

function fixture(police=false){
 const actor={id:1,pos:{x:10,y:20},status:'active',hp:100,role:police?'police':'hood',skills:{firearms:3}} as Person;
 const target={id:2,pos:{x:20,y:20},status:'active',hp:100,role:'hood',skills:{firearms:3}} as Person;
 const world={week:1,minute:10,people:{1:actor,2:target},policeIds:police?[1]:[],rngState:87} as unknown as WorldState;
 const view=new CharacterActions(world);
 return {actor,target,world,view};
}
describe('combat presentation contact timing',()=>{
 it.each(['pistol','rifle','shotgun','tommy','twinPistols'] as WeaponId[])('delays a lethal %s reaction until the drawn weapon fires',weapon=>{
  const {actor,target,world,view}=fixture();
  presentAttack(world,actor,target,weapon,true);presentDeath(world,target);target.status='dead';target.hp=0;
  const saved=JSON.stringify(world);view.update(world,0);
  expect(view.presentation(actor.id)?.kind).toBe('draw');
  expect(view.get(target.id)?.time).toBeCloseTo(-drawDuration(weapon)-ATTACK_CONTACT);
  expect(view.hasPendingDeath(target.id)).toBe(true);
  view.update(world,drawDuration(weapon));expect(view.presentation(actor.id)?.kind).toBe('shoot');
  expect(view.get(target.id)?.time).toBeCloseTo(-ATTACK_CONTACT);
  view.update(world,ATTACK_CONTACT+.001);
  expect(actionFlash(view.presentation(actor.id))).toBeGreaterThan(.95);
  expect(view.get(target.id)?.time).toBeCloseTo(.001);expect(view.hasPendingDeath(target.id)).toBe(false);
  expect(JSON.stringify(world)).toBe(saved);
 });
 it('finishes a police officer\'s actual lethal shot, then puts the weapon away',()=>{
  const {actor,target,world,view}=fixture(true);
  presentAttack(world,actor,target,'pistol',true);presentDeath(world,target);target.status='dead';target.hp=0;
  view.update(world,0);expect(view.drawnWeapon(actor.id)).toBeUndefined();
  for(let n=0;n<8;n++)view.update(world,.25);
  expect(view.presentation(actor.id)?.kind).toBe('shoot');view.update(world,ATTACK_CONTACT);
  expect(actionFlash(view.presentation(actor.id))).toBeCloseTo(1);
  view.update(world,SHOOT_DURATION);expect(view.presentation(actor.id)?.kind).toBe('holster');
  view.update(world,2.1);expect(view.heldWeapon(actor.id)).toBeUndefined();
 });
 it('uses only the remaining draw time and keeps main/Tagged readers independent during pause',()=>{
  const {actor,target,world,view}=fixture(),tagged=new CharacterActions(world);
  presentAttack(world,actor,target,'pistol',false);view.update(world,0);tagged.update(world,0);
  view.update(world,1);tagged.update(world,1);
  presentAttack(world,actor,target,'pistol',true);view.update(world,0);tagged.update(world,0);
  expect(view.get(target.id)?.time).toBeCloseTo(-1-ATTACK_CONTACT);
  const paused={...view.get(target.id)};view.update(world,0);expect(view.get(target.id)).toEqual(paused);
  expect(tagged.get(target.id)).toEqual(view.get(target.id));
  view.update(world,.5);expect(tagged.get(target.id)?.time).toBeCloseTo(-1-ATTACK_CONTACT);
 });
 it('does not replace a queued firing cue with a simultaneous hit on the attacker',()=>{
  const {actor,target,world,view}=fixture();
  presentAttack(world,actor,target,'pistol',true);presentAttack(world,target,actor,'rifle',true);
  view.update(world,0);
  expect(view.get(actor.id)?.kind).toBe('hit');expect(view.get(target.id)?.kind).toBe('hit');
  expect(view.get(actor.id)?.time).toBeCloseTo(-drawDuration('rifle')-ATTACK_CONTACT);
  expect(view.get(target.id)?.time).toBeCloseTo(-drawDuration('pistol')-ATTACK_CONTACT);
  view.update(world,2.4);view.update(world,hitDuration()+.01);
  // Incoming reactions finish; each actor retains its own firearm and neither
  // WeaponHandling queue contains the other actor's hit reaction.
  expect(view.heldWeapon(actor.id)).toBe('pistol');expect(view.heldWeapon(target.id)).toBe('rifle');
  expect(view.presentation(actor.id)?.kind).not.toBe('hit');
  expect(view.presentation(target.id)?.kind).not.toBe('hit');
 });
 it('does not restart an earlier reaction on every burst or replay it after restore',()=>{
  const {actor,target,world,view}=fixture();
  presentAttack(world,actor,target,'tommy',true);view.update(world,0);view.update(world,1);
  const before=view.get(target.id)!.time;
  presentAttack(world,actor,target,'tommy',true);view.update(world,0);expect(view.get(target.id)?.time).toBe(before);
  view.reset(world);expect(view.hasPendingDeath(target.id)).toBe(false);view.update(world,0);expect(view.get(target.id)).toBeUndefined();
 });
 it('ties an unarmed reaction to the existing punch contact instead of firearm draw time',()=>{
  const {actor,target,world,view}=fixture();presentAttack(world,actor,target,undefined,true);view.update(world,0);
  expect(view.get(target.id)?.time).toBe(-PUNCH_CONTACT);view.update(world,PUNCH_CONTACT);
  expect(view.get(actor.id)?.time).toBe(PUNCH_CONTACT);expect(view.get(target.id)?.time).toBe(0);
 });
});
