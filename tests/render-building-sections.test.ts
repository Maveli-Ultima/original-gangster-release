import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CUT_WALL, sectionMasses, topStoreyFloor } from '../src/render/architecture';
import { STOREY_H } from '../src/render/util';
import { profileFor } from '../src/render/profile';
import { CityRenderer } from '../src/render/scene';
import { BUILDING_TYPES } from '../src/sim/data/buildings';
import type { Building } from '../src/sim/types';

function building(type: typeof BUILDING_TYPES[number], id: number): Building {
  return { id, typeId: type.id, cls: type.cls, state: 'trading' } as Building;
}

describe('building cutaway sections', () => {
  it('puts every exposed floor at ground level for every building family', () => {
    for (const type of BUILDING_TYPES) for (const id of [1, 404, 938]) {
      const profile = profileFor(building(type, id), type);
      const before = structuredClone(profile.masses);
      const section = sectionMasses(profile.masses, true);
      const floors = section.filter(m => m.floorY != null);
      expect(floors.length, type.id).toBeGreaterThan(0);
      for (const room of floors) {
        expect(room.floorY!, type.id).toBe(0);
        expect(room.y + room.h, type.id).toBeGreaterThanOrEqual(room.floorY! + 1.275);
        expect(room.y + room.h, type.id).toBeLessThanOrEqual(room.floorY! + 1.351);
      }
      expect(profile.masses).toEqual(before);
      expect(sectionMasses(profile.masses, false)).toEqual(before.map(m => ({...m, open:false})));
    }
  });
  it('removes setback towers and upper floors without moving the ground footprint', () => {
    const masses = [
      {dx:0,dz:0,y:0,w:12,d:12,h:16,cap:true},
      {dx:0,dz:0,y:16,w:8,d:8,h:3,cap:true},
      {dx:0,dz:0,y:19,w:5,d:5,h:2,cap:true},
    ];
    const section = sectionMasses(masses, true);
    expect(section).toEqual([{...masses[0],h:1.35,open:true,floorY:0}]);
    expect(sectionMasses(masses, false)).toEqual(masses.map(m => ({...m,open:false})));
  });
  it('opens foreground buildings at the pavement and discards all raised upper masses', () => {
    for (const type of BUILDING_TYPES) {
      const p = profileFor(building(type,404), type);
      const section = sectionMasses(p.masses,true);
      expect(section.length).toBeGreaterThan(0);
      for (const m of section) {
        expect(m.y).toBe(0); expect(m.floorY).toBe(0);
        expect(m.h).toBeLessThanOrEqual(1.35);
      }
    }
  });
  it('opens the top storey in the original manner, keeping the facades below', () => {
    for (const type of BUILDING_TYPES) for (const id of [1, 404, 938]) {
      const profile = profileFor(building(type, id), type);
      const section = sectionMasses(profile.masses, true, false);
      const floor = topStoreyFloor(profile.masses);
      const floors = section.filter(m => m.floorY != null);
      expect(floors.length, type.id).toBeGreaterThan(0);
      for (const room of floors) expect(room.floorY, type.id).toBe(floor);
      for (const m of section) expect(m.y + m.h, type.id).toBeLessThanOrEqual(floor + CUT_WALL + 1e-9);
      const tallest = Math.max(...profile.masses.map(m => m.y + m.h));
      if (tallest > STOREY_H + 1) expect(floor, type.id).toBeGreaterThan(0);
    }
  });
  it('keeps a lower wing closed and drops a tower above the cut', () => {
    const masses = [
      {dx:0,dz:0,y:0,w:12,d:12,h:12.6,cap:true},
      {dx:8,dz:0,y:0,w:4,d:6,h:4.2,cap:true},
      {dx:0,dz:0,y:12.6,w:5,d:5,h:6,cap:true},
    ];
    const floor = topStoreyFloor(masses);
    expect(floor).toBeCloseTo(16.8, 6);
    expect(sectionMasses(masses, true, false)).toEqual([
      {...masses[0],open:false},
      {...masses[1],open:false},
      {...masses[2],h:floor + CUT_WALL - 12.6,open:true,floorY:floor},
    ]);
    const flat = [{dx:0,dz:0,y:0,w:12,d:12,h:12.6,cap:true}];
    expect(sectionMasses(flat, true, false)).toEqual([{...flat[0],h:8.4 + CUT_WALL,open:true,floorY:8.4}]);
  });
});

function foregroundFixture() {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(6,12,6),new THREE.MeshBasicMaterial(),2);
  mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(8,6,8));
  mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(-8,6,-8));
  const state = {
    world:{people:{}}, selectedPersonId:null, selectedBuildingId:null as number|null,
    hiddenRoofs:true, buildingsRemoved:false, streetsOpen:true, target:new THREE.Vector3(),
    foregroundCutaways:new Set<number>(), cutawayRay:new THREE.Raycaster(),
    cutawayPoint:new THREE.Vector3(Infinity,Infinity,Infinity), cutawayCamera:new THREE.Vector3(Infinity,Infinity,Infinity),
    cutawayPerson:null, cutawayBuilding:null, cutawayFlipped:false, flipped:false,
    cutawayRevision:-2, cutawayRadius:-1, buildingSig:7, buildingViews:new Map(), buildingViewMeshes:new Map(),
    buildingIds:[100,200], mat4:new THREE.Matrix4(), picks:{mesh}, useTaggedBuildings:vi.fn(()=>null), buildingsDirty:false,
  };
  Object.setPrototypeOf(state,CityRenderer.prototype);
  const update=()=> (state as unknown as {updateForegroundCutaways():void}).updateForegroundCutaways();
  const dispose=()=>{mesh.dispose();mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();};
  return {state,update,dispose};
}

describe('automatic foreground visibility',()=>{
  it('leaves every building at its top-storey cut while the player watches nothing, however the camera pans',()=>{
    const f=foregroundFixture();
    try {
      f.update(); expect(f.state.foregroundCutaways.size).toBe(0);
      f.state.target.set(8,0,8); f.update(); expect(f.state.foregroundCutaways.size).toBe(0);
      f.state.flipped=true; f.update(); expect(f.state.foregroundCutaways.size).toBe(0);
      // No sightline test, so panning never rebuilds the city.
      expect(f.state.useTaggedBuildings).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });
  it('opens the obstruction in front of a watched site, and reverses it when the camera flips',()=>{
    const f=foregroundFixture();
    try {
      f.state.selectedBuildingId=300; f.update();
      expect(f.state.foregroundCutaways.has(100)).toBe(true);
      expect(f.state.foregroundCutaways.has(200)).toBe(false);
      f.state.flipped=true; f.update();
      expect(f.state.foregroundCutaways.has(100)).toBe(false);
      expect(f.state.foregroundCutaways.has(200)).toBe(true);
    } finally { f.dispose(); }
  });
  it('opens the selected building itself and one containing the camera focus',()=>{
    const f=foregroundFixture();
    try {
      f.state.selectedBuildingId=200; f.state.target.set(8,0,8); f.update();
      expect(f.state.foregroundCutaways.has(200)).toBe(true);
      expect(f.state.foregroundCutaways.has(100)).toBe(true);
    } finally { f.dispose(); }
  });
  it('caches a stationary watched view, recomputes after panning, and clears when roofs are restored or the selection ends',()=>{
    const f=foregroundFixture();
    try {
      f.state.selectedBuildingId=300;
      f.update(); f.update(); expect(f.state.useTaggedBuildings).toHaveBeenCalledTimes(1);
      f.state.target.set(80,0,80); f.update();
      expect(f.state.useTaggedBuildings).toHaveBeenCalledTimes(2);
      f.state.selectedBuildingId=100; f.update(); expect(f.state.foregroundCutaways.has(100)).toBe(true);
      f.state.hiddenRoofs=false; f.update(); expect(f.state.foregroundCutaways.size).toBe(0);
      f.state.hiddenRoofs=true; f.state.selectedBuildingId=null; f.update(); expect(f.state.foregroundCutaways.size).toBe(0);
    } finally { f.dispose(); }
  });
});
