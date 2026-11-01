import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {prepareGeneratedEquipment} from '../src/render/generatedEquipment';
import {EquipmentModels} from '../src/render/equipmentModels';
import {CharacterEquipment} from '../src/render/characterEquipment';
import {addMuzzleAnchor} from '../src/render/equipmentAnchors';

describe('generated equipment attachment',()=> {
 it('finds the barrel lip through source transforms without modifying geometry',()=> {
  const root=new THREE.Group(),geometry=new THREE.CylinderGeometry(.02,.02,.8,12),material=new THREE.MeshBasicMaterial();
  const barrel=new THREE.Mesh(geometry,material);barrel.rotation.x=Math.PI/2;barrel.position.set(.03,.07,.4);root.add(barrel);
  root.position.set(40,2,-10);root.rotation.y=.7;root.scale.setScalar(2);
  const original=geometry.attributes.position.array.slice();
  addMuzzleAnchor('rifle',root);
  const marker=root.getObjectByName('equipment-muzzle')!;
  expect(marker.position.x).toBeCloseTo(.03);expect(marker.position.y).toBeCloseTo(.07);expect(marker.position.z).toBeCloseTo(.8);
  expect(geometry.attributes.position.array).toEqual(original);
  const camera=new THREE.Group();addMuzzleAnchor('camera',camera);expect(camera.children).toHaveLength(0);
  geometry.dispose();material.dispose();
 });
 it('places a flash at each held pistol muzzle after aiming and hides effects on interruption',()=> {
  const root=new THREE.Group(),model=new THREE.Group();root.add(model);
  const bone=(name:string,parent:THREE.Object3D,x:number,y:number)=>{const b=new THREE.Bone();b.name=name;b.position.set(x,y,0);parent.add(b);return b;};
  bone('Head',model,0,1.7);
  for(const side of ['Left','Right']){
   const upper=bone(side+'Arm',model,side==='Left'?.18:-.18,1.45);
   const lower=bone(side+'ForeArm',upper,0,-.3);bone(side+'Hand',lower,0,-.28);
  }
  const library=new EquipmentModels(),clothing=new CharacterEquipment(root,model,library,false,true);
  clothing.set({role:'hood',coat:0x555555,weapon:'twinPistols'});
  root.position.set(17,.2,42);root.rotation.y=1.2;root.updateMatrixWorld(true);
  clothing.pose({kind:'shoot',time:.24,weapon:'twinPistols'});root.updateMatrixWorld(true);
  const flashes:THREE.Object3D[]=[],muzzles:THREE.Object3D[]=[];
  root.traverse(o=>{if(o.name==='action-flash')flashes.push(o);if(o.name==='equipment-muzzle')muzzles.push(o);});
  expect(flashes).toHaveLength(2);expect(muzzles).toHaveLength(2);
  for(const flash of flashes){
   expect(flash.visible).toBe(true);
   const position=flash.getWorldPosition(new THREE.Vector3());
   expect(Math.min(...muzzles.map(m=>position.distanceTo(m.getWorldPosition(new THREE.Vector3()))))).toBeLessThan(1e-6);
  }
  clothing.pose();expect(flashes.every(f=>!f.visible)).toBe(true);
  clothing.dispose();library.dispose();expect(flashes.every(f=>!f.parent)).toBe(true);
 });
 it('fits the grip to hand skin whose bind direction differs from an arms-down offset',()=> {
  const root=new THREE.Group(),model=new THREE.Group();root.add(model);
  const upper=new THREE.Bone(),lower=new THREE.Bone(),hand=new THREE.Bone(),head=new THREE.Bone();
  upper.name='RightArm';upper.position.set(-.18,1.45,0);lower.name='RightForeArm';lower.position.y=-.3;
  hand.name='RightHand';hand.position.y=-.28;head.name='Head';head.position.y=1.7;
  model.add(upper,head);upper.add(lower);lower.add(hand);root.updateMatrixWorld(true);
  const geometry=new THREE.BoxGeometry(.06,.03,.04);geometry.translate(-.11,.87,0);
  const count=geometry.attributes.position.count,weights=new Float32Array(count*4);
  for(let i=0;i<count;i++)weights[i*4]=1;
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(count*4),4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  const material=new THREE.MeshStandardMaterial(),mesh=new THREE.SkinnedMesh(geometry,material);
  model.add(mesh);root.updateMatrixWorld(true);mesh.bind(new THREE.Skeleton([hand]));
  const library=new EquipmentModels(),clothing=new CharacterEquipment(root,model,library,false,true);
  clothing.set({role:'hood',coat:0x555555,weapon:'pistol'});root.updateMatrixWorld(true);
  // The held pose must use the palm too, not just the fully raised firing pose.
  const initialCenter=new THREE.Vector3(-.11,.87,0);
  expect(root.getObjectByName('equipment-pistol')!.getWorldPosition(new THREE.Vector3()).distanceTo(initialCenter)).toBeLessThan(1e-6);
  clothing.pose({kind:'shoot',time:.24,weapon:'pistol'});root.updateMatrixWorld(true);
  const center=new THREE.Vector3(),point=new THREE.Vector3();
  for(let i=0;i<count;i++)center.add(mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld));
  center.divideScalar(count);
  expect(root.getObjectByName('equipment-pistol')!.getWorldPosition(new THREE.Vector3()).distanceTo(center)).toBeLessThan(1e-6);
  clothing.dispose();library.dispose();geometry.dispose();material.dispose();mesh.skeleton.dispose();
 });
 it('retains metre scale through bone binding and shares source resources across instances',()=> {
  const source=new THREE.Group(),geometry=new THREE.BoxGeometry(10,1,1),material=new THREE.MeshStandardMaterial();
  source.add(new THREE.Mesh(geometry,material));
  const library=new EquipmentModels();library.install('pistol',prepareGeneratedEquipment('pistol',source));
  const geometryDisposal=vi.spyOn(geometry,'dispose'),materialDisposal=vi.spyOn(material,'dispose');
  const root=new THREE.Group(),model=new THREE.Group(),hand=new THREE.Bone();
  hand.name='RightHand';hand.position.set(.3,.9,0);model.add(hand);root.add(model);
  const clothing=new CharacterEquipment(root,model,library,false,true);
  try {
   clothing.set({role:'fbi',coat:0xffffff,weapon:'pistol'});root.updateMatrixWorld(true);
   const attached=root.getObjectByName('equipment-pistol')!;
   expect(attached.parent).toBe(hand);
   const bounds=new THREE.Box3().setFromObject(attached).getSize(new THREE.Vector3());
   expect(Math.max(...bounds.toArray())).toBeLessThan(.35);expect(Math.max(...bounds.toArray())).toBeGreaterThan(.2);
   const another=library.create('pistol');
   expect((another.getObjectByProperty('isMesh',true) as THREE.Mesh).geometry).toBe(geometry);
   expect((attached.getObjectByProperty('isMesh',true) as THREE.Mesh).material).toBe(material);
   const before=attached.getWorldPosition(new THREE.Vector3());hand.position.z+=2;root.updateMatrixWorld(true);
   expect(attached.getWorldPosition(new THREE.Vector3()).z-before.z).toBeCloseTo(2);
  }finally {clothing.dispose();library.dispose();}
  expect(geometryDisposal).not.toHaveBeenCalled();expect(materialDisposal).not.toHaveBeenCalled();
  geometry.dispose();material.dispose();
 });
});
