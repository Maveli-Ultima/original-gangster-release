import {readFileSync,writeFileSync} from 'node:fs';
import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {SculptReviewLayer} from '../src/render/sculptReviewLayer';

// Decode the delivered geometry, skin and clips. Image decoding needs a browser;
// materials are omitted here and are reviewed separately in the WebGL gallery.
async function geometryAsset(url){
 const raw=readFileSync('public'+url),length=raw.readUInt32LE(12),g=JSON.parse(raw.subarray(20,20+length).toString());
 g.materials=(g.materials??[]).map(()=>({}));delete g.images;delete g.textures;delete g.samplers;
 const binary=raw.subarray(28+length),j=Buffer.from(JSON.stringify(g));
 const json=Buffer.concat([j,Buffer.alloc((4-j.length%4)%4,32)]),head=Buffer.alloc(20),bh=Buffer.alloc(8);
 head.write('glTF');head.writeUInt32LE(2,4);head.writeUInt32LE(28+json.length+binary.length,8);head.writeUInt32LE(json.length,12);head.write('JSON',16);
 bh.writeUInt32LE(binary.length);bh.write('BIN\0',4);const packed=Buffer.concat([head,json,bh,binary]);
 return new GLTFLoader().parseAsync(packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.byteLength),'');
}
describe('delivered character motion geometry',()=>{
 it('keeps ten breathing idles quiet and imported action bodies grounded and human-sized',async()=>{
  const spy=vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(url=>geometryAsset(url));
  vi.stubGlobal('fetch',async url=>({ok:true,json:async()=>JSON.parse(readFileSync('public'+url,'utf8'))}));
  const scene=new THREE.Scene(),layer=new SculptReviewLayer(scene,1,()=>{});
  const rows=[['fedora','hood'],['woman','citizen'],['worker','citizen'],['police','police'],['fedora','fbi'],['fedora','fbiHead'],['police','policeChief'],['worker','judge'],['woman','judge'],['fedora','reporter']];
  const metrics=[];
  try{
   await layer.load();expect(layer.error).toBeNull();
   for(const [i,[base,role]] of rows.entries()){
    const appearance={role,coat:0x555555},matrix=new THREE.Matrix4();
    layer.pushCharacter(i,base,matrix,0,false,appearance,{clock:0,delta:1});
    const group=scene.getObjectByName('sculpt-review-actor-'+i);
    const bounds=()=>{group.updateMatrixWorld(true);return new THREE.Box3().setFromObject(group,true);};
    const idle=bounds();
    for(let n=1;n<=16;n++){
     layer.pushCharacter(i,base,matrix,0,false,appearance,{clock:n/4,delta:.25});
     // Breathing includes a small relaxed sway, bounded to 20 cm rather than
     // the old invariant silhouette (which deliberately froze the idle).
     expect(bounds().min.distanceTo(idle.min)).toBeLessThan(.2);expect(bounds().max.distanceTo(idle.max)).toBeLessThan(.2);
    }
    let min=Infinity,max=-Infinity;
    for(const kind of ['hit','death','strike'])for(let n=0;n<=16;n++){
     const duration=kind==='death'?5.2:kind==='hit'?43/30:31/30;
     layer.pushCharacter(i,base,matrix,0,false,appearance,{clock:0,delta:1,action:{kind,time:n/16*duration}});
     const box=bounds(),size=box.getSize(new THREE.Vector3());min=Math.min(min,box.min.y);max=Math.max(max,box.max.y);
     expect(Number.isFinite(size.length())).toBe(true);expect(size.length()).toBeLessThan(4.5);
     expect(box.min.y,`${group.userData.modelStyle} ${kind} ${n/16*duration}`).toBeGreaterThan(-.015);expect(box.max.y).toBeLessThan(2.4);
    }
    metrics.push({style:group.userData.modelStyle,idleFloor:idle.min.y,actionFloor:min,actionTop:max});
   }
   if(process.env.MOTION_REPORT)writeFileSync(process.env.MOTION_REPORT,JSON.stringify(metrics,null,2)+'\n');
  }finally{layer.dispose();spy.mockRestore();vi.unstubAllGlobals();}
 },90000);
});
