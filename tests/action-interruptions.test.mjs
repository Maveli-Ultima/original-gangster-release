import {readFileSync} from 'node:fs';
import {describe,it,expect,vi,beforeAll,afterAll} from 'vitest';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {SculptReviewLayer} from '../src/render/sculptReviewLayer';
import {INTERRUPTION_FADE} from '../src/render/characterMotion';

// Delivered geometry and clips, without images (as character-motion-assets).
async function geometryAsset(url){
 const raw=readFileSync('public'+url),length=raw.readUInt32LE(12),g=JSON.parse(raw.subarray(20,20+length).toString());
 g.materials=(g.materials??[]).map(()=>({}));delete g.images;delete g.textures;delete g.samplers;
 const binary=raw.subarray(28+length),j=Buffer.from(JSON.stringify(g));
 const json=Buffer.concat([j,Buffer.alloc((4-j.length%4)%4,32)]),head=Buffer.alloc(20),bh=Buffer.alloc(8);
 head.write('glTF');head.writeUInt32LE(2,4);head.writeUInt32LE(28+json.length+binary.length,8);head.writeUInt32LE(json.length,12);head.write('JSON',16);
 bh.writeUInt32LE(binary.length);bh.write('BIN\0',4);const packed=Buffer.concat([head,json,bh,binary]);
 return new GLTFLoader().parseAsync(packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.byteLength),'');
}
let scene,layer,spy;
beforeAll(async()=>{
 spy=vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(url=>geometryAsset(url));
 vi.stubGlobal('fetch',async url=>({ok:true,json:async()=>JSON.parse(readFileSync('public'+url,'utf8'))}));
 scene=new THREE.Scene();layer=new SculptReviewLayer(scene,4,()=>{});await layer.load();
});
afterAll(()=>{layer.dispose();spy.mockRestore();vi.unstubAllGlobals();});
const bone=(id,name)=>{const g=scene.getObjectByName('sculpt-review-actor-'+id);g.updateMatrixWorld(true);return g.getObjectByName(name);};
const forearm=id=>bone(id,'RightForeArm').getWorldQuaternion(new THREE.Quaternion());

describe('action interruptions and held props',()=>{
 it('fades an aiming gunman into his hit reaction instead of dropping the arm in one frame',()=>{
  const gun={role:'hood',coat:0x555555,weapon:'pistol'},m=new THREE.Matrix4();
  const shoot={kind:'shoot',time:.6,weapon:'pistol'},hit={kind:'hit',time:-.1,weapon:'pistol'};
  // Reference poses on separate rigs: the aim, and the reaction alone.
  layer.pushCharacter(1,'fedora',m,0,false,gun,{clock:0,delta:1,action:shoot,previewActions:true});
  layer.pushCharacter(2,'fedora',m,0,false,gun,{clock:0,delta:1,action:hit,previewActions:true});
  layer.commitCharacters();
  const aim=forearm(1),reaction=forearm(2);
  expect(aim.angleTo(reaction)).toBeGreaterThan(.3);
  // The interrupted rig: aiming, then hit on the next frame.
  layer.pushCharacter(3,'fedora',m,0,false,gun,{clock:0,delta:1,action:shoot,previewActions:true});
  layer.pushCharacter(3,'fedora',m,0,false,gun,{clock:0,delta:1/60,action:hit,previewActions:true});
  expect(forearm(3).angleTo(aim)).toBeLessThan(.05);
  // Then it moves steadily towards the reaction and arrives when the fade ends.
  let previous=0;
  for(let t=0;t<=INTERRUPTION_FADE;t+=1/60){
   layer.pushCharacter(3,'fedora',m,0,false,gun,{clock:0,delta:1/60,action:hit,previewActions:true});
   const travelled=forearm(3).angleTo(aim);expect(travelled).toBeGreaterThanOrEqual(previous-1e-6);previous=travelled;
  }
  expect(forearm(3).angleTo(reaction)).toBeLessThan(.02);
 });

 it('puts both hands on a carried crate through the whole stride',()=>{
  const carrier={role:'hood',coat:0x555555,carriedProp:'crate'},m=new THREE.Matrix4();
  for(let n=0;n<8;n++){
   layer.pushCharacter(4,'fedora',m,n/8*Math.PI*2,true,carrier,{clock:n/8,delta:1,gait:'carry'});
   const g=scene.getObjectByName('sculpt-review-actor-4');g.updateMatrixWorld(true);
   const crate=g.getObjectByName('equipment-crate'),centre=crate.getWorldPosition(new THREE.Vector3());
   const across=new THREE.Vector3(1,0,0).transformDirection(crate.matrixWorld);
   for(const [side,sign] of [['LeftHand',1],['RightHand',-1]]){
    const wrist=bone(4,side).getWorldPosition(new THREE.Vector3());
    // Wrists sit just outside the case's sides (half-width .25 m), never a metre apart.
    expect(Math.abs(wrist.clone().sub(centre).dot(across)*sign-.29),`${side} frame ${n}`).toBeLessThan(.12);
   }
  }
 });
});
