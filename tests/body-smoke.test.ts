import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {BodySmoke,BODY_SMOKE_PARTICLES} from '../src/render/bodySmoke';

describe('smoke from burning people',()=>{
 it('leaves puff origins behind a runner, stays fixed while paused and clears unseen emitters',()=>{
  const scene=new THREE.Scene(),smoke=new BodySmoke(scene,8);
  for(let i=0;i<=90;i++){smoke.reset();smoke.push(1,new THREE.Vector3(i/15,1,0),i/60,0);smoke.commit();}
  const positions=Array.from(smoke.geometry.getAttribute('smokeCenter').array).slice(0,smoke.geometry.instanceCount*3);
  expect(positions.some((x,i)=>i%3===0&&x<4)).toBe(true); // Current body is x=6.
  smoke.reset();smoke.push(1,new THREE.Vector3(6,1,0),1.5,0);smoke.commit();
  expect(Array.from(smoke.geometry.getAttribute('smokeCenter').array).slice(0,positions.length)).toEqual(positions);
  smoke.reset();smoke.commit();expect(smoke.mesh.visible).toBe(false);expect(smoke.geometry.instanceCount).toBe(0);
  smoke.dispose();expect(scene.children).toHaveLength(0);
 });
 it('bounds all particles in one batch, continues a lighter corpse wisp and handles time rewind',()=>{
  const scene=new THREE.Scene(),smoke=new BodySmoke(scene,8);
  smoke.reset();for(let i=0;i<100;i++)smoke.push(i,new THREE.Vector3(i,1,0),3,0);smoke.commit();
  expect(smoke.geometry.instanceCount).toBe(8*BODY_SMOKE_PARTICLES);expect(scene.children).toHaveLength(1);
  const burningAlpha=(smoke.geometry.getAttribute('smokeData').array as Float32Array)[1];
  smoke.reset();smoke.push(0,new THREE.Vector3(0,.25,0),15,10);smoke.commit();
  expect(smoke.mesh.visible).toBe(true);expect((smoke.geometry.getAttribute('smokeData').array as Float32Array)[1]).toBeLessThan(burningAlpha);
  smoke.reset();smoke.push(0,new THREE.Vector3(20,1,0),.1,0);smoke.commit();
  expect(smoke.geometry.instanceCount).toBeLessThan(BODY_SMOKE_PARTICLES);
  const x=(smoke.geometry.getAttribute('smokeCenter').array as Float32Array)[0];expect(x).toBeGreaterThan(19);
  smoke.dispose();expect(smoke.geometry.instanceCount).toBe(0);
 });
});
