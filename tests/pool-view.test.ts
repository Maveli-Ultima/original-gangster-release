import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {InstancePool,PoolView} from '../src/render/pool';

describe('retained Tagged building geometry',()=>{
 it('keeps an independent snapshot with identical transforms, colour and UVs without updating the main buffers',()=>{
  const pool=new InstancePool(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial(),2,{color:true,uv:true,castShadow:true,receiveShadow:true});
  pool.push(new THREE.Matrix4().makeTranslation(10,2,30),new THREE.Color(0x123456),new THREE.Vector4(2,3,.1,.2));pool.commit();
  const snapshot=pool.snapshot(),view=new PoolView(pool.mesh,snapshot),version=pool.mesh.instanceMatrix.version;
  pool.reset();pool.push(new THREE.Matrix4().makeTranslation(70,8,90));pool.commit();
  const changedVersion=pool.mesh.instanceMatrix.version;
  for(let i=0;i<8;i++){view.mesh.visible=true;view.mesh.visible=false;}
  expect(pool.mesh.instanceMatrix.version).toBe(changedVersion);expect(changedVersion).toBeGreaterThan(version);
  expect(Array.from(view.mesh.instanceMatrix.array)).toEqual(Array.from(snapshot.matrices));
  expect(Array.from(view.mesh.instanceColor!.array)).toEqual(Array.from(snapshot.colors!));
  expect(Array.from(view.mesh.geometry.getAttribute('aUvXform').array)).toEqual(Array.from(snapshot.uv!));
  expect(view.mesh.geometry).not.toBe(pool.mesh.geometry);expect(view.mesh.material).toBe(pool.mesh.material);
  expect(view.mesh.castShadow&&view.mesh.receiveShadow).toBe(true);
  const materialDispose=vi.spyOn(pool.mesh.material as THREE.Material,'dispose'),geometryDispose=vi.spyOn(view.mesh.geometry,'dispose');
  view.dispose();view.dispose();expect(geometryDispose).toHaveBeenCalledTimes(1);expect(materialDispose).not.toHaveBeenCalled();
  pool.dispose();expect(materialDispose).toHaveBeenCalledTimes(1);
 });
});
