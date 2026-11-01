import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {characterClips,CharacterMotion} from '../src/render/characterMotion';
import {liveCharacterAction} from '../src/render/characterActions';
import {shootingTime,PUNCH_CONTACT,hitDuration} from '../src/render/combatMotionTiming';
const bank=JSON.parse(readFileSync('public/art/city/sculpt/combat-motions.json','utf8'));

describe('supplied Mixamo combat motions',()=>{
 it('retains source provenance and complete finite normalized tracks on all eleven rigs',()=>{
  expect(Object.keys(bank.clips)).toHaveLength(10);
  for(const clip of Object.values(bank.clips)){
   expect(clip.sha256).toMatch(/^[a-f0-9]{64}$/);expect(Object.keys(clip.styles)).toHaveLength(11);
   for(const rig of Object.values(clip.styles))for(const track of rig.tracks){
    const size=track.name.endsWith('.quaternion')?4:3;
    expect(track.times.length).toBe(Math.round(clip.duration*30)+1);
    expect(track.values.length).toBe(track.times.length*size);
    expect(track.values.every(Number.isFinite)).toBe(true);
    if(size===4){let maxError=0;for(let i=0;i<track.values.length;i+=4)maxError=Math.max(maxError,Math.abs(new THREE.Quaternion().fromArray(track.values,i).length()-1));expect(maxError).toBeLessThan(.000002);}
   }
  }
 });
 it('maps authored recoil and left-jab contact without changing simulation time',()=>{
  expect(shootingTime(.24,'pistol')).toBeCloseTo(6/30);
  expect(shootingTime(.24,'rifle')).toBeCloseTo(3/30);
  expect(shootingTime(.24,'tommy')).toBeCloseTo(0);
  expect(PUNCH_CONTACT).toBe(17/30);
  expect(hitDuration()).toBe(bank.clips.hit.duration);
  expect(hitDuration('pistol')).toBe(bank.clips.hitPistol.duration);
  expect(hitDuration('tommy')).toBe(bank.clips.hitRifle.duration);
 });
 it('uses the imported reaction in normal play, holds a fall, and remains deterministic when paused',()=>{
  const root=new THREE.Group(),arm=new THREE.Bone();arm.name='RightArm';root.add(arm);
  const walk=new THREE.AnimationClip('walk',1,[new THREE.QuaternionKeyframeTrack('RightArm.quaternion',[0,1],[0,0,0,1,0,0,0,1])]);
  const clips=characterClips(root,walk,'fedora',undefined,bank),motion=new CharacterMotion(new THREE.AnimationMixer(root),walk,clips);
  for(const kind of ['hit','strike','death']){
   const action={kind,time:.5};expect(liveCharacterAction(action)).toBe(action);
   motion.sample(0,false,{clock:0,delta:1,action});const pose=arm.quaternion.clone();
   expect(pose.angleTo(new THREE.Quaternion())).toBeGreaterThan(.1);
   // Float32 mixer values are not exactly unit length; compare the unchanged
   // components instead of angleTo(q), which assumes perfectly unit inputs.
   motion.sample(0,false,{clock:0,delta:0,action});expect(arm.quaternion.toArray()).toEqual(pose.toArray());
  }
  motion.sample(0,false,{clock:0,delta:1,action:{kind:'death',time:4.5}});const fallen=arm.quaternion.clone();
  motion.sample(0,false,{clock:0,delta:1,action:{kind:'death',time:7.9}});expect(arm.quaternion.toArray()).toEqual(fallen.toArray());
  expect(liveCharacterAction({kind:'photo',time:1})?.kind).toBe('photo');
  expect(clips.get('pistolShoot').tracks.every(t=>!/^(Hips|(?:Left|Right)(?:UpLeg|Leg|Foot|ToeBase))\./.test(t.name))).toBe(true);
 });
});
