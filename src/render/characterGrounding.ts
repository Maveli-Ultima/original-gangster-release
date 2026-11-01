import * as THREE from 'three';
export interface GroundSupport {mesh:THREE.SkinnedMesh;indices:number[]}
/** Surface landmarks selected once per geometry, then skinned only for actions.
 * Bone origins alone cannot locate shoe soles, a coat hem or a fallen head. */
const cache=new WeakMap<THREE.BufferGeometry,number[]>();
function supports(geometry:THREE.BufferGeometry):number[]{
 const existing=cache.get(geometry);if(existing)return existing;
 const position=geometry.getAttribute('position'),skin=geometry.getAttribute('skinIndex'),weight=geometry.getAttribute('skinWeight');
 const directions:number[][]=[];
 for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)if(x||y||z)directions.push([x,y,z]);
 const buckets=new Map<string,{values:number[];indices:number[]}>();
 for(let i=0;i<position.count;i++){
  // Vertices at a blended elbow/hem can move below every dominant-joint
  // landmark. Preserve extrema for each quantized blend as well as each bone.
  const blend=[];
  for(let s=0;s<4;s++){
   const w=Math.round(weight.getComponent(i,s)*8);
   if(w)blend.push([skin.getComponent(i,s),w]);
  }
  blend.sort((a,b)=>a[0]-b[0]);
  const key=blend.map(pair=>pair.join(':')).join('/');let b=buckets.get(key);
  if(!b){b={values:Array(26).fill(-Infinity),indices:Array(26).fill(i)};buckets.set(key,b);}
  for(let d=0;d<26;d++){
   const dir=directions[d],value=position.getX(i)*dir[0]+position.getY(i)*dir[1]+position.getZ(i)*dir[2];
   if(value>b.values[d]){b.values[d]=value;b.indices[d]=i;}
  }
 }
 const result=[...new Set([...buckets.values()].flatMap(b=>b.indices))];cache.set(geometry,result);return result;
}
export function characterSupports(model:THREE.Object3D):GroundSupport[]{
 const result:GroundSupport[]=[];model.traverse(o=>{if(o instanceof THREE.SkinnedMesh)result.push({mesh:o,indices:supports(o.geometry)});});return result;
}
const point=new THREE.Vector3();
export function characterFloor(support:GroundSupport[]):number {
 let min=Infinity;
 for(const {mesh,indices}of support)for(const index of indices){mesh.getVertexPosition(index,point).applyMatrix4(mesh.matrixWorld);min=Math.min(min,point.y);}
 return min;
}
