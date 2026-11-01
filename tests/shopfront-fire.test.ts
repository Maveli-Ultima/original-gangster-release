import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {shopfrontFireBays,buildingFireBays,faceWindowCentres,fireBayGrowth,fireBayLocal,ShopfrontFire} from '../src/render/shopfrontFire';
import {KERB_H} from '../src/render/util';
import type {Profile} from '../src/render/profile';

describe('shopfront fire spread',()=>{
  const profile={base:'shop',ruin:false,masses:[{dx:0,dz:0,y:0,w:16,d:20,h:12.6,cap:true},
    {dx:0,dz:-1,y:12.6,w:12,d:14,h:8.4,cap:true}]} as Profile;
  const OFFSET=.25,STOREY=4.2;
  const frontOf=(bays:ReturnType<typeof buildingFireBays>)=>bays.filter(b=>!b.turn&&b.elevation);
  it('puts a flame in every painted window of every floor, each floor catching after the one below',()=>{
    const bays=buildingFireBays(profile,51,OFFSET);
    profile.masses.forEach((mass,mi)=>{
      const centres=faceWindowCentres(mass.w,OFFSET+mi*.37,1);
      for(let s=mass===profile.masses[0]?1:0;mass.y+s*STOREY+2.7<=mass.y+mass.h+.01;s++){
        const row=frontOf(bays).filter(b=>Math.abs(b.elevation!-(mass.y+s*STOREY+.3))<.01);
        expect(row.map(b=>+(b.offset-(mass.dx-profile.masses[0].dx)).toFixed(6))).toEqual(centres.map(c=>+c.toFixed(6)));
        for(const bay of row){
          // The flame sits on a painted window: bay centres of the 12 m facade tile.
          const u=(bay.offset-(mass.dx-profile.masses[0].dx)+mass.w/2)/12+OFFSET+mi*.37;
          expect(Math.abs(((u*4)%1+1)%1-.5)).toBeLessThan(1e-6);
          expect(Math.abs(bay.offset-(mass.dx-profile.masses[0].dx))+bay.width/2).toBeLessThanOrEqual(mass.w/2);
        }
      }
    });
    const floors=[...new Set(frontOf(bays).map(b=>b.elevation!))].sort((a,b)=>a-b);
    expect(floors.length).toBe(4);
    floors.forEach((f,i)=>{if(i)expect(Math.min(...frontOf(bays).filter(b=>b.elevation===f).map(b=>b.ignition)))
      .toBeGreaterThanOrEqual(Math.min(...frontOf(bays).filter(b=>b.elevation===floors[i-1]).map(b=>b.ignition))+1.65-.01);});
    expect(bays.filter(b=>fireBayGrowth(.5,b)>0).map(b=>b.offset)).toEqual([0]);   // the door lights first
    expect(buildingFireBays({...profile,ruin:true},51).some(b=>b.elevation)).toBe(false);
  });
  it('follows round the side and rear walls after the front of each floor',()=>{
    const bays=buildingFireBays(profile,9,OFFSET),base=profile.masses[0],wrapped=bays.filter(b=>b.turn);
    expect(new Set(wrapped.map(b=>b.turn))).toEqual(new Set([-1,1,2]));
    expect(wrapped.every(b=>b.intactOnly&&fireBayGrowth(1,b)===0)).toBe(true);
    for(const bay of wrapped){
      const mass=profile.masses.find(m=>bay.elevation!>=m.y&&bay.elevation!<m.y+m.h)!,local=fireBayLocal(bay);
      if(bay.turn===2)expect(local.z).toBeCloseTo(mass.dz-mass.d/2-1-(base.dz+base.d/2+.2));
      else expect(local.x).toBeCloseTo(mass.dx-base.dx+bay.turn!*(mass.w/2+1));
      const floorFront=bays.filter(b=>!b.turn&&(b.elevation??0)>=mass.y&&Math.round((b.elevation??0)/STOREY)===Math.round(bay.elevation!/STOREY));
      if(floorFront.length)expect(bay.ignition).toBeGreaterThan(Math.min(...floorFront.map(b=>b.ignition)));
    }
    // A long terrace gets a flame in every window rather than a handful.
    const terrace={base:'none',ruin:false,masses:[{dx:0,dz:0,y:0,w:34,d:11,h:8.4,cap:true}]} as Profile;
    expect(frontOf(buildingFireBays(terrace,3,0)).length+buildingFireBays(terrace,3,0).filter(b=>!b.turn&&!b.elevation).length)
      .toBe(2*faceWindowCentres(34,0,1).length+1);   // two floors of windows, plus the door
  });
  it('hides upper flames per camera, restoring the same phase and setback in all facings',()=>{
    const texture=new THREE.Texture(),bays=buildingFireBays(profile,9);
    for(const [sideX,sideZ] of [[1,0],[0,-1],[-1,0],[0,1]]){
      const scene=new THREE.Scene(),fire=new ShopfrontFire(texture,9,bays,scene,100,200,sideX,sideZ);
      fire.update(16,1,true);
      const phases=fire.volumes.map(v=>v.mesh.material.uniforms.time.value);
      fire.setLowered(true);
      fire.volumes.forEach((v,i)=>{
        const bay=bays[i],local=fireBayLocal(bay);
        expect(v.mesh.visible).toBe(!bay.elevation&&!bay.intactOnly);
        expect(v.mesh.position.y-v.mesh.scale.y/2).toBeCloseTo(KERB_H+(bay.elevation??0));
        expect(v.mesh.position.x).toBeCloseTo(100+sideX*local.x-sideZ*local.z);
        expect(v.mesh.position.z).toBeCloseTo(200+sideZ*local.x+sideX*local.z);
      });
      fire.setLowered(false);expect(fire.volumes.every(v=>v.mesh.visible)).toBe(true);
      expect(fire.volumes.map(v=>v.mesh.material.uniforms.time.value)).toEqual(phases);
      fire.update(14,1,false);fire.setLowered(false);expect(fire.volumes.every(v=>!v.mesh.visible)).toBe(true);
      fire.dispose();expect(scene.children).toHaveLength(0);
    }
    texture.dispose();
  });
  it('starts only at the doorway, then catches neighbouring windows in order without crossing the lot edge',()=>{
    for(const width of [3,6,14,28,60]){
      const bays=shopfrontFireBays(width,true,51);
      expect(bays.length).toBeLessThanOrEqual(9);
      expect(bays.filter(b=>fireBayGrowth(.5,b)>0).map(b=>b.offset)).toEqual([0]);
      for(const side of [-1,1]){
        const windows=bays.filter(b=>Math.sign(b.offset)===side);
        for(let i=0;i<windows.length;i++){
          const bay=windows[i];expect(Math.abs(bay.offset)+bay.width/2).toBeLessThanOrEqual(width/2);
          expect(fireBayGrowth(bay.ignition,bay)).toBe(0);
          expect(fireBayGrowth(bay.ignition+1.35,bay)).toBeCloseTo(1);
          if(i)expect(bay.ignition).toBeGreaterThan(windows[i-1].ignition);
        }
      }
    }
    expect(shopfrontFireBays(20,false,51)).toHaveLength(1);
  });
  it('stays grounded and on the frontage for all four facings, freezes when time is held, and disposes every bay',()=>{
    const texture=new THREE.Texture();
    for(const [sideX,sideZ] of [[1,0],[0,-1],[-1,0],[0,1]]){
      const scene=new THREE.Scene(),bays=shopfrontFireBays(15,true,14);
      const fire=new ShopfrontFire(texture,14,bays,scene,100,200,sideX,sideZ);
      fire.update(8,1,true);
      const states=fire.volumes.map(v=>({position:v.mesh.position.clone(),scale:v.mesh.scale.clone()}));
      fire.update(8,1,true);expect(fire.volumes.map(v=>({position:v.mesh.position,scale:v.mesh.scale}))).toEqual(states);
      fire.volumes.forEach((v,i)=>{
        expect(v.mesh.position.x).toBeCloseTo(100+sideX*bays[i].offset-sideZ*.8);
        expect(v.mesh.position.z).toBeCloseTo(200+sideZ*bays[i].offset+sideX*.8);
        expect(v.mesh.position.y-v.mesh.scale.y/2).toBeCloseTo(KERB_H);
      });
      fire.update(8,1,false);expect(fire.volumes.every(v=>!v.mesh.visible)).toBe(true);
      fire.update(18,0,true);expect(fire.volumes.every(v=>!v.mesh.visible)).toBe(true);
      fire.dispose();expect(scene.children).toHaveLength(0);
    }
    texture.dispose();
  });
});
