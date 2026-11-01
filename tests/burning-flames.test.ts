import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {BurningPeople,MAX_BURNING_ACTORS,FLAMES_PER_ACTOR} from '../src/render/burningPeople';

describe('body-attached volumetric fire',()=>{
 it('follows the posed body, bounds the volume pool and releases the settled corpse',()=>{
  const scene=new THREE.Scene(),fx=new BurningPeople(scene);
  const anchors=[[0,1.15,0],[0,1.4,0],[0,.9,0],[-.4,1.4,0],[.4,1.4,0],[-.15,.5,0],[.15,.5,0]].map(p=>new THREE.Vector3(...p));
  fx.reset();fx.push(0,0,0,2,0,anchors);fx.commit();
  const first=fx.volumes[0].mesh.position.clone();
  expect(fx.volumes).toHaveLength(3);
  for(const v of fx.volumes){expect(v.mesh.material.fragmentShader).toContain('samplerFire');expect(v.mesh.castShadow).toBe(false);}
  anchors.forEach(p=>p.add(new THREE.Vector3(7,0,3)));
  fx.reset();fx.push(0,0,0,2,0,anchors);fx.commit();
  expect(fx.volumes[0].mesh.position.clone().sub(first).toArray()).toEqual([7,0,3]);
  fx.reset();for(let n=0;n<100;n++)fx.push(0,0,0,3,0,anchors);fx.commit();
  expect(fx.volumes).toHaveLength(MAX_BURNING_ACTORS*FLAMES_PER_ACTOR);
  fx.reset();fx.push(0,0,0,10,5,anchors);fx.commit();expect(fx.volumes.every(v=>!v.mesh.visible)).toBe(true);
  fx.dispose();expect(scene.children).toHaveLength(0);
 });
});
