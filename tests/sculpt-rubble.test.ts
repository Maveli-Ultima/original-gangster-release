import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {prepareRubbleGeometry,rubblePiles} from '../src/render/sculptRubble';

describe('Sculpt rubble placement',()=>{
 it('normalizes the full model to one metre across with a grounded pivot, preserving its source',()=>{
  const root=new THREE.Group(),geometry=new THREE.BoxGeometry(4,1,3),material=new THREE.MeshStandardMaterial();
  const mesh=new THREE.Mesh(geometry,material);mesh.position.set(9,5,-3);mesh.rotation.y=Math.PI/2;root.add(mesh);
  const original=Array.from(geometry.getAttribute('position').array),parts=prepareRubbleGeometry(root),bounds=parts[0].geometry.boundingBox!;
  expect(bounds.min.y).toBeCloseTo(0);expect(bounds.max.y).toBeCloseTo(.25);
  expect(Math.max(...[bounds.max.x-bounds.min.x,bounds.max.z-bounds.min.z])).toBeCloseTo(1);
  expect(bounds.getCenter(new THREE.Vector3()).x).toBeCloseTo(0);expect(bounds.getCenter(new THREE.Vector3()).z).toBeCloseTo(0);
  expect(Array.from(geometry.getAttribute('position').array)).toEqual(original);
  parts.forEach(p=>p.geometry.dispose());geometry.dispose();material.dispose();
 });
 it('keeps every rotated pile inside the footprint and bounds model instances',()=>{
  for(const [width,depth] of [[3,4],[14,18],[40,60],[60,10]]){
   const piles=rubblePiles(71,width,depth);expect(piles).toEqual(rubblePiles(71,width,depth));expect(piles.length).toBeLessThanOrEqual(9);
   for(const p of piles){expect(Math.abs(p.x)+p.size/2).toBeLessThan(width/2);expect(Math.abs(p.z)+p.size/2).toBeLessThan(depth/2);}
  }
 });
});
