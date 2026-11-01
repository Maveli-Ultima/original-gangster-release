import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { automaticRoofsPreference, viewForZoom, VIEW_ZOOM } from '../src/render/viewModes';
import { TaggedView } from '../src/render/taggedView';
import { InstancePool } from '../src/render/pool';
import { Sim, MINUTES_PER_SECOND } from '../src/sim/sim';
import { defaultGameOptions } from '../src/app/newGame';
import { WALK_SPEED } from '../src/sim/constants';
import { previewActorMotion } from '../src/render/previewActorMotion';

describe('street presentation', () => {
  it('opens roofs by default and preserves an explicit roofs-up preference', () => {
    expect(automaticRoofsPreference(null)).toBe(true);
    expect(automaticRoofsPreference('0')).toBe(false);
    expect(automaticRoofsPreference('1')).toBe(true);
    expect(viewForZoom(VIEW_ZOOM.street)).toBe('street');
    expect(viewForZoom(3)).toBe('street');
    expect(viewForZoom(VIEW_ZOOM.roof)).toBe('roof');
  });

  it('reverses the tagged camera around an obstruction and keeps the character centred', () => {
    const view = new TaggedView();
    view.set({ personId: 1, mode: 'street', x: 10, y: 100, width: 300, height: 180, clipTop: 100, clipBottom: 280 }, false);
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(6, 12, 6), new THREE.MeshBasicMaterial(), 1);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(5, 6, 5));
    view.update(0, 1, 0, mesh, 1);
    expect(view.side).toBe(-1);
    expect(view.obscured).toBe(false);
    expect(new THREE.Vector3(0,1,0).project(view.camera).length()).toBeLessThan(1); // depth remains in frustum
    const point = new THREE.Vector3(0,1,0).project(view.camera);
    expect(Math.abs(point.x) + Math.abs(point.y)).toBeLessThan(1e-8);
    view.update(-2, 1, -3, mesh, 1);
    expect(view.side).toBe(-1); // no alternating clear-side flicker
    expect(view.contains(-2,-3)).toBe(true);
    expect(view.contains(1000,1000)).toBe(false);
    view.set(null,false); expect(view.contains(-2,-3)).toBe(false);
    mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
  });

  it('reverses when a wall hides the edge of a vehicle but misses its centre', () => {
    const view = new TaggedView();
    view.set({ personId: 1, mode: 'street', x: 0, y: 0, width: 300, height: 180, clipTop: 0, clipBottom: 180 }, false);
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 12, 1), new THREE.MeshBasicMaterial(), 1);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(6.77, 6, 3.23));
    view.update(0, 1, 0, mesh, 1, .35);
    expect(view.side).toBe(1);
    view.update(0, 1, 0, mesh, 1, 2.5);
    expect(view.side).toBe(-1);
    expect(view.obscured).toBe(false);
    mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
  });

  it('restores all instance data after drawing an independent building view', () => {
    const pool = new InstancePool(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 3, { color: true, uv: true });
    pool.push(new THREE.Matrix4().makeTranslation(10,2,30), new THREE.Color('red'), new THREE.Vector4(2,3,4,5));
    pool.commit(); const original = pool.snapshot();
    pool.reset(); pool.push(new THREE.Matrix4(), new THREE.Color('blue'), new THREE.Vector4()); pool.commit();
    pool.restore(original);
    const matrix = new THREE.Matrix4(); pool.mesh.getMatrixAt(0, matrix);
    const color = new THREE.Color(); pool.mesh.getColorAt(0, color);
    expect(matrix.elements.slice(12,15)).toEqual([10,2,30]);
    expect(color.getHex()).toBe(0xff0000);
    expect(Array.from(pool.mesh.geometry.getAttribute('aUvXform').array).slice(0,4)).toEqual([2,3,4,5]);
    expect(pool.push(new THREE.Matrix4())).toBe(1);
    pool.commit(); expect(pool.mesh.count).toBe(2); pool.dispose();
  });

  it('uses walking pace and one interpolated clock for every acceleration stage', () => {
    expect(WALK_SPEED * MINUTES_PER_SECOND).toBeCloseTo(1.8);   // the original's ~1 body height a second
    const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 });
    sim.launchWeek();
    const person = Object.values(sim.world.people).find(p => p.role === 'citizen')!;
    person.pos = {x:100,y:100}; person.dest={x:200,y:100}; person.path=[{x:200,y:100}]; person.halted=false; person.inVehicle=false;
    sim.advance(2,1);
    const slow=previewActorMotion(person,sim.subMinute,{x:0,y:0,moving:false,facing:0});
    expect(slow.x).toBeCloseTo(103.6);
    sim.advance(.5,4);
    const fast=previewActorMotion(person,sim.subMinute,{x:0,y:0,moving:false,facing:0});
    expect(fast.x-slow.x).toBeCloseTo(3.6);
    sim.advance(4,0);
    expect(previewActorMotion(person,sim.subMinute,{x:0,y:0,moving:false,facing:0}).x).toBeCloseTo(fast.x);
  });
});
