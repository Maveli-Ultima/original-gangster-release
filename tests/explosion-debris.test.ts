import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {ExplosionDebris,MasonryFlight,type DebrisSource} from '../src/render/explosionDebris';
import {SpriteParticle,Quaternion} from 'three.quarks';
import {KERB_H} from '../src/render/util';
import {ruinRubble} from '../src/render/rubble';
import {FireVolume} from '../src/render/fireVolume';
const source:DebrisSource={seed:4,x:100,z:100,width:14,depth:18,height:10,faceX:0,faceZ:1,color:'#8e4c39'};
describe('building VFX integration',()=>{
 it('uses depth-tested orthographic rays independently for main and reverse cameras',()=>{
  const texture=new THREE.Texture(),fire=new FireVolume(texture,4),a=new THREE.OrthographicCamera(),b=new THREE.OrthographicCamera();
  a.position.set(10,10,10);a.lookAt(0,0,0);a.updateMatrixWorld();b.position.set(-10,10,-10);b.lookAt(0,0,0);b.updateMatrixWorld();
  fire.mesh.position.set(4,2,3);fire.mesh.scale.set(2,4,2);fire.mesh.updateMatrixWorld();
  for(const camera of [a,b]){fire.mesh.onBeforeRender(null!,null!,camera,null!,null!,null!);
   expect(fire.mesh.material.uniforms.viewDirection.value.distanceTo(camera.getWorldDirection(new THREE.Vector3()))).toBeLessThan(1e-8);}
  expect(fire.mesh.material.depthTest).toBe(true);expect(fire.mesh.material.depthWrite).toBe(false);
  fire.update(1,.5,true);expect(fire.mesh.visible).toBe(true);fire.update(1,.5,false);expect(fire.mesh.visible).toBe(false);
  fire.dispose();texture.dispose();
 });
 it('throws 52 solid fragments, freezes on pause, settles and cleans up its batch',()=>{
  const scene=new THREE.Scene(),debris=new ExplosionDebris(scene);debris.add(source);debris.update(.2,true);expect(debris.count).toBe(52);
  const ps=[...debris.batch.systemToBatchIndex.keys()][0] as unknown as {particles:SpriteParticle[]};
  const before=ps.particles.map(p=>p.position.clone());debris.update(0,false);
  expect(debris.batch.visible).toBe(false);expect(ps.particles.map(p=>p.position)).toEqual(before);
  debris.update(5,true);
  for(const p of ps.particles){expect(p.position.y).toBeCloseTo(KERB_H+p.size.y/2,5);expect(Number.isFinite(p.position.x)).toBe(true);}
  debris.update(4,true);expect(debris.count).toBe(0);debris.dispose();expect(scene.children).toHaveLength(0);
 });
 it('keeps seeded flight independent of timestep and within the lot/pavement apron',()=>{
  const create=()=>{const f=new MasonryFlight(source),p=new SpriteParticle();p.rotation=new Quaternion();f.initialize(p);return {f,p};};
  const a=create(),b=create();a.f.update(a.p,1.6);
  for(let i=0;i<16;i++){b.f.update(b.p,.1);b.p.age+=.1;}
  expect(a.p.position.distanceTo(b.p.position)).toBeLessThan(1e-7);
  for(let i=0;i<60;i++){const p=new SpriteParticle();p.rotation=new Quaternion();a.f.initialize(p);a.f.update(p,5);
   expect(Math.abs(p.position.x-source.x)).toBeLessThan(source.width/2);
   expect(p.position.z).toBeGreaterThan(source.z-source.depth/2);
   expect(p.position.z).toBeLessThan(source.z+source.depth/2+5);}
 });
 it('bounds concurrent bursts and retains deterministic rubble for restored ruins',()=>{
  const scene=new THREE.Scene(),d=new ExplosionDebris(scene);for(let i=0;i<16;i++)d.add({...source,seed:i});d.update(.1,true);
  expect(d.batch.systemToBatchIndex.size).toBe(12);expect(d.count).toBe(12*52);d.dispose();
  expect(ruinRubble(404,14,18)).toEqual(ruinRubble(404,14,18));expect(ruinRubble(404,14,18).length).toBeLessThanOrEqual(64);
 });
});
