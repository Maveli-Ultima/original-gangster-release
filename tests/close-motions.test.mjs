import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {attackClip,CLOSE_DURATION,ENDS_IN_POSTURE,postureHold,reactionClip} from '../src/render/closeMotion';
import {CART,CART_REACTIONS} from '../src/sim/data/cart';
const bank=JSON.parse(readFileSync('public/art/city/sculpt/close-motions.json','utf8'));
const hip=(name,style='fedora')=>bank.clips[name].styles[style].tracks.find(t=>t.name==='Hips.position').values;

describe('close-combat motions (Cart.txt reactions)',()=>{
 it('has every clip on all eleven rigs, finite and normalized, at its declared length',()=>{
  expect(Object.keys(bank.clips).sort()).toEqual(Object.keys(CLOSE_DURATION).sort());
  for(const [name,clip] of Object.entries(bank.clips)){
   expect(clip.duration).toBeCloseTo(CLOSE_DURATION[name],5);
   expect(Object.keys(clip.styles)).toHaveLength(11);
   for(const rig of Object.values(clip.styles))for(const track of rig.tracks){
    const size=track.name.endsWith('.quaternion')?4:3;
    expect(track.values.length).toBe(track.times.length*size);
    expect(track.values.every(Number.isFinite)).toBe(true);
    if(size===4)for(let i=0;i<track.values.length;i+=4)expect(Math.abs(new THREE.Quaternion().fromArray(track.values,i).length()-1)).toBeLessThan(.000002);
   }
  }
 });

 it('stays over the actor’s pivot, so a fallen man does not jump when he gets up',()=>{
  for(const name of Object.keys(bank.clips))for(const style of Object.keys(bank.clips[name].styles)){
   const v=hip(name,style);
   for(let i=0;i<v.length;i+=3){expect(v[i]).toBeCloseTo(v[0],6);expect(v[i+2]).toBeCloseTo(v[2],6);}
  }
 });

 it('kneels and falls to the ground, and the get-ups start there',()=>{
  const standing=hip('headBack')[1];
  const end=name=>hip(name).at(-2),start=name=>hip(name)[1];
  expect(end('kneelDown')).toBeLessThan(standing*.65);
  expect(end('knockDown')).toBeLessThan(standing*.3);
  expect(start('getUpKnees')).toBeLessThan(standing*.65);
  expect(start('standUp')).toBeLessThan(standing*.3);
  expect(end('standUp')).toBeGreaterThan(standing*.9);
 });

 it('maps every Cart attack and reaction, and holds kneeling and lying poses',()=>{
  expect(attackClip({attack:14,reaction:7})).toBe('kick');
  expect(attackClip({attack:0,reaction:7})).toBe('swing');
  expect(attackClip({attack:1,reaction:7})).toBeNull();          // fists keep the punch
  expect(CART_REACTIONS.map((_,r)=>reactionClip({attack:0,reaction:r}))).toEqual(
   ['headBack','stomachHit','stomachHit','kneelDown','knockDown','knockDown','twitch',null,'stomachHit','knockDown','getUpKnees','standUp','standUp']);
  for(const t of CART)for(const list of [t.missBehind,t.hitBehind,t.missFront,t.hitFront])
   for(const [reaction] of list)expect(reaction).toBeLessThan(CART_REACTIONS.length);
  expect(postureHold('kneeling')).toBe('kneelDown');expect(postureHold('down')).toBe('knockDown');expect(postureHold('standing')).toBeNull();
  expect([...ENDS_IN_POSTURE].sort()).toEqual(['kneelDown','knockDown','twitch']);
 });
});
