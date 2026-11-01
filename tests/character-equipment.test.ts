import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { EquipmentModels } from '../src/render/equipmentModels';
import { CharacterEquipment, prepareClothMask } from '../src/render/characterEquipment';
import { characterStyle, characterPriority, streetPersonVisible, useDetailedModels, carriesExplosives } from '../src/render/characterPresentation';
import { allocateWeapons } from '../src/sim/weapons';
import { Sim } from '../src/sim/sim';
import { defaultGameOptions } from '../src/app/newGame';
import type { Person, Order, WeaponId } from '../src/sim/types';
import { tickAmbient } from '../src/sim/systems/ambient';
import { Rng } from '../src/sim/rng';

function rig(dedicatedBody=false) {
 const group=new THREE.Group(),model=new THREE.Group();group.add(model);
 const names=['Hips','Spine','LeftUpLeg','RightUpLeg','Head','LeftHand','RightHand','LeftFoot'];
 const positions=[[0,.95,0],[0,1.3,0],[.1,.9,0],[-.1,.9,0],[0,1.6,0],[.3,.85,0],[-.3,.85,0],[.1,.05,0]];
 const bones=names.map((name,i)=>{const b=new THREE.Bone();b.name=name;b.position.fromArray(positions[i]);model.add(b);return b;});
 const geometry=new THREE.BoxGeometry(.4,1.8,.3);geometry.translate(0,.9,0);
 const n=geometry.getAttribute('position').count,idx=new Uint16Array(n*4),w=new Float32Array(n*4);
 for(let i=0;i<n;i++){idx[i*4]=i%names.length;w[i*4]=1;}
 geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(idx,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(w,4));
 const material=new THREE.MeshStandardMaterial(),mesh=new THREE.SkinnedMesh(geometry,material);model.add(mesh);group.updateMatrixWorld(true);mesh.bind(new THREE.Skeleton(bones));
 const library=new EquipmentModels();const outfit=new CharacterEquipment(group,model,library,true,dedicatedBody);
 return {group,model,bones,mesh,geometry,material,library,outfit,close(){outfit.dispose();library.dispose();geometry.dispose();material.dispose();mesh.skeleton.dispose();}};
}
function person(role:Person['role'],extra:Partial<Person>={}):Person {
 return {id:1,role,female:false,gangId:null,status:'active',dest:null,streetOrder:null,inVehicle:false,orderId:null,...extra} as Person;
}

describe('period equipment and roles',()=> {
 it('preserves the geometry and textures of dedicated role bodies while adding held equipment',()=> {
  const r=rig(true);try {
   const originalGeometry=r.mesh.geometry,originalMaterial=r.mesh.material;
   r.outfit.set({role:'judge',coat:0xffffff});
   expect(r.mesh.material).toBe(originalMaterial);expect(r.mesh.geometry).toBe(originalGeometry);
   expect(r.geometry.hasAttribute('aCloth')).toBe(false);
   expect(r.group.getObjectByName('role-judge-robe')).toBeUndefined();
   expect(r.group.getObjectByName('equipment-collar')).toBeUndefined();
   expect(r.group.getObjectByName('equipment-gavel')?.parent?.name).toBe('RightHand');
   r.outfit.set({role:'fbi',coat:0xff0000,weapon:'tommy'});
   expect(r.group.getObjectByName('equipment-badge')).toBeUndefined();
   expect(r.group.getObjectByName('equipment-tommy')?.parent?.name).toBe('RightHand');
   expect(r.mesh.material).toBe(originalMaterial);
  } finally {r.close();}
 });

 it('uses actual metre-scale weapons with shared geometry and a single owned material',()=> {
  const library=new EquipmentModels();
  try{
   const lengths:Record<WeaponId,[number,number]>={pistol:[.25,.34],twinPistols:[.20,.25],shotgun:[1.14,1.25],rifle:[1.03,1.15],tommy:[.81,.91],explosives:[.22,.28]};
   for(const [name,[min,max]] of Object.entries(lengths)){
    const a=library.create(name as WeaponId) as THREE.Mesh,b=library.create(name as WeaponId) as THREE.Mesh;
    const size=a.geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.z).toBeGreaterThanOrEqual(min);expect(size.z).toBeLessThanOrEqual(max);
    expect(a.geometry).toBe(b.geometry);expect(a.material).toBe(b.material);
    expect(a.geometry.getAttribute('position').count).toBeLessThan(15000);
   }
  }finally{library.dispose();}
 });
 it('follows the animated hand and clears guns/badges when the rig becomes a photographer',()=> {
  const r=rig();try{
   r.outfit.set({role:'fbi',coat:0x303840,weapon:'tommy'});
   const gun=r.group.getObjectByName('equipment-tommy')!;expect(gun.parent?.name).toBe('RightHand');
   r.group.updateMatrixWorld(true);const before=gun.getWorldPosition(new THREE.Vector3());
   r.bones[6].position.x+=.2;r.group.position.z=10;r.group.updateMatrixWorld(true);
   expect(gun.getWorldPosition(new THREE.Vector3()).sub(before).toArray()).toEqual([.2,0,10]);
   r.outfit.set({role:'reporter',coat:0x6f6557});expect(r.group.getObjectByName('equipment-tommy')).toBeUndefined();
   expect(r.group.getObjectByName('equipment-badge')).toBeUndefined();expect(r.group.getObjectByName('equipment-camera')?.parent?.name).toBe('Spine');
  }finally{r.close();}
 });
 it('binds a pair to different hands and removes all equipment for an unarmed reuse',()=> {
  const r=rig();try{
   r.outfit.set({role:'hood',coat:0x555555,weapon:'twinPistols'});
   expect(r.bones[5].getObjectByName('equipment-twinPistols')).toBeDefined();expect(r.bones[6].getObjectByName('equipment-twinPistols')).toBeDefined();
   r.outfit.set();expect(r.group.getObjectByName('equipment-twinPistols')).toBeUndefined();
  }finally{r.close();}
 });
 it('restores shared geometry and disposes a judge robe when a pooled body changes role',()=> {
  const r=rig();try{
   const sourceDispose=vi.spyOn(r.geometry,'dispose');
   r.outfit.set({role:'judge',coat:0x29282a});const robe=r.group.getObjectByName('role-judge-robe') as THREE.SkinnedMesh;
   expect(robe).toBeDefined();expect(r.mesh.geometry).not.toBe(r.geometry);
   const geo=vi.spyOn(robe.geometry,'dispose'),mat=vi.spyOn(robe.material as THREE.Material,'dispose'),skel=vi.spyOn(robe.skeleton,'dispose');
   r.outfit.set({role:'citizen',coat:0x776655});expect(r.mesh.geometry).toBe(r.geometry);expect(r.group.getObjectByName('role-judge-robe')).toBeUndefined();
   expect(geo).toHaveBeenCalledOnce();expect(mat).toHaveBeenCalledOnce();expect(skel).toHaveBeenCalledOnce();expect(sourceDispose).not.toHaveBeenCalled();
  }finally{r.close();}
 });
 it('keeps skin, hair, hands and shoes out of the cloth tint',()=> {
  const r=rig();try{prepareClothMask(r.mesh);const mask=r.geometry.getAttribute('aCloth');
   expect(mask.getX(0)).toBe(1);expect(mask.getX(1)).toBe(1);
   for(const i of [4,5,6,7])expect(mask.getX(i)).toBe(0);
  }finally{r.close();}
 });
 it('caps bright gang colours at bold cloth without sharing clothing uniforms between people',()=> {
  const a=rig(),b=rig();try{
   a.outfit.set({role:'hood',coat:0xff3333});b.outfit.set({role:'hood',coat:0x3333ff});
   const uniforms=(r:ReturnType<typeof rig>)=> {
    const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <map_fragment>'} as Parameters<THREE.Material['onBeforeCompile']>[0];
    (r.mesh.material as THREE.Material).onBeforeCompile(shader,{} as THREE.WebGLRenderer);return shader.uniforms;
   };
   const ca=uniforms(a).wardrobeColor.value as THREE.Color,cb=uniforms(b).wardrobeColor.value as THREE.Color;
   expect(ca).not.toBe(cb);expect(ca.equals(cb)).toBe(false);
   const hsl={h:0,s:0,l:0};ca.getHSL(hsl);expect(hsl.s).toBeLessThanOrEqual(.601);expect(hsl.l).toBeLessThanOrEqual(.321);
  }finally{a.close();b.close();}
 });
 it('loads detailed assets without a review flag and maps civic roles consistently',()=> {
  expect(useDetailedModels('')).toBe(true);expect(useDetailedModels('?sculptModels=0')).toBe(false);
  expect(characterStyle(person('policeChief'))).toBe('police');expect(characterStyle(person('reporter'))).toBe('fedora');expect(characterStyle(person('fbiHead'))).toBe('fedora');
  for(const role of ['judge','reporter','fbiHead','policeChief'] as const){expect(streetPersonVisible(person(role),null)).toBe(true);expect(streetPersonVisible(person(role,{status:'jailed'}),1)).toBe(false);}
  expect(streetPersonVisible(person('owner'),null)).toBe(false);expect(streetPersonVisible(person('owner'),1)).toBe(true);
  expect(characterPriority(person('citizen'),1,null,2)).toBeLessThan(characterPriority(person('police',{id:3}),1,null,2));
 });
});

describe('models follow simulation inventory and street roles',()=> {
 it('displays finite firearms and only one existing explosives bundle on a live assignment',()=> {
  const sim=new Sim({...defaultGameOptions(),seed:404,citySize:10});const w=sim.world;
  const team=Object.values(w.teams).find(t=>t.gangId===sim.playerGang.id)!;
  const ids=[team.lieutenantId,...team.memberIds],hood=w.people[ids[0]],other=w.people[ids[1]];
  for(const key of Object.keys(team.weapons))team.weapons[key as WeaponId]=0;
  team.weapons.tommy=1;team.weapons.explosives=1;
  const order:Order={id:w.nextId++,gangId:team.gangId,teamId:team.id,type:'bomb',assignedIds:ids,state:'travelling',opts:{repeat:false,isPublic:false,priority:false,manpower:1,wait:false,preferredHoodId:null},targetBuildingIds:[],targetBlockIds:[],targetPersonId:null,targetPos:null,cursor:0,workLeft:1,estimatedMinutes:1,results:[],failReason:null,isStreetOrder:false,completedTargets:0};
  w.orders[order.id]=order;for(const id of ids)w.people[id].orderId=order.id;
  const loadout=allocateWeapons(w);expect(ids.filter(id=>loadout.has(id))).toHaveLength(1);
  expect(carriesExplosives(w,hood)).toBe(true);expect(carriesExplosives(w,other)).toBe(false);
  order.state='done';expect(carriesExplosives(w,hood)).toBe(false);order.state='travelling';
  team.weapons.explosives=0;sim.playerGang.weapons.explosives=0;expect(carriesExplosives(w,hood)).toBe(false);
 });
 it('lets field reporters and civic visitors walk while retaining the newspaper editor',()=> {
  const sim=new Sim({...defaultGameOptions(),seed:405,citySize:10});const w=sim.world;
  const paper=Object.values(w.buildings).find(b=>b.typeId==='newspaper')!;
  const editor=w.people[paper.ownerPersonId!],reporter=Object.values(w.people).find(p=>p.role==='reporter' && p.buildingId===paper.id && p.id!==editor.id)!;
  const judge=w.people[w.judgeIds[0]];const rng=new Rng(10);vi.spyOn(rng,'chance').mockReturnValue(true);
  tickAmbient(w,rng,1);expect(editor.dest).toBeNull();expect(reporter.dest).not.toBeNull();expect(judge.dest).not.toBeNull();
  const old={...reporter.pos};tickAmbient(w,rng,1);expect(reporter.pos).not.toEqual(old);
 });
});
