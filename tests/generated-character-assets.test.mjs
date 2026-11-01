import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {DETAILED_CHARACTER_STYLES,hasDedicatedBody} from '../src/render/detailedCharacters';


function model(name){
 const raw=readFileSync(`public/art/city/sculpt/${name}.glb`);
 expect(raw.toString('ascii',0,4)).toBe('glTF');expect(raw.readUInt32LE(8)).toBe(raw.length);
 const jsonBytes=raw.readUInt32LE(12),g=JSON.parse(raw.subarray(20,20+jsonBytes).toString());
 function value(index,row,column=0){
  const a=g.accessors[index],v=g.bufferViews[a.bufferView];
  const width=a.type==='VEC4'?4:a.type==='VEC3'?3:1,bytes=a.componentType===5126||a.componentType===5125?4:a.componentType===5123?2:1;
  const offset=28+jsonBytes+(v.byteOffset??0)+(a.byteOffset??0)+row*(v.byteStride??width*bytes)+column*bytes;
  return a.componentType===5126?raw.readFloatLE(offset):bytes===2?raw.readUInt16LE(offset):bytes===4?raw.readUInt32LE(offset):raw.readUInt8(offset);
 }
 return {g,value};
}
describe('installed generated character assets',()=>{
 it.each(DETAILED_CHARACTER_STYLES.filter(hasDedicatedBody))('%s has valid weights and a head attached to the upper skeleton',name=>{
  const {g,value}=model(name);expect(g.animations.length).toBeGreaterThan(0);expect(g.skins).toHaveLength(1);
  const joints=g.skins[0].joints.map((i)=>g.nodes[i].name);
  for(const mesh of g.meshes)for(const primitive of mesh.primitives){
   const attrs=primitive.attributes,positions=g.accessors[attrs.POSITION];
   let headPoints=0,headWeight=0,footWeight=0;
   const height=positions.max[1]-positions.min[1],top=positions.max[1]-height*.1;
   for(let i=0;i<positions.count;i++){
    let sum=0;
    for(let j=0;j<4;j++){
     const joint=value(attrs.JOINTS_0,i,j),weight=value(attrs.WEIGHTS_0,i,j);
     expect(joint).toBeLessThan(joints.length);expect(Number.isFinite(weight)&&weight>=0&&weight<=1).toBe(true);sum+=weight;
     if(value(attrs.POSITION,i,1)>top){if(/head|neck/i.test(joints[joint]))headWeight+=weight;if(/leg|foot|toe/i.test(joints[joint]))footWeight+=weight;}
    }
    expect(sum).toBeCloseTo(1,4);if(value(attrs.POSITION,i,1)>top)headPoints++;
   }
   expect(headPoints).toBeGreaterThan(0);expect(headWeight/headPoints).toBeGreaterThan(.8);expect(footWeight/headPoints).toBeLessThan(.01);
  }
  for(const sampler of g.samplers)expect(sampler.minFilter).toBe(9729);
 });
});
