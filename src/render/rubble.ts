import * as THREE from 'three';
import {r01} from './util';

/** Shared irregular masonry chunk for airborne fragments and settled ruins. */
export function rubbleGeometry(crushed=false):THREE.BufferGeometry {
  const g=crushed?new THREE.IcosahedronGeometry(.64,0):new THREE.BoxGeometry(1,1,1),p=g.getAttribute('position');
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i),key=(x>0?1:0)+(y>0?2:0)+(z>0?4:0);
    p.setXYZ(i,x*(.72+r01(key,610)*.28),y*(.72+r01(key,611)*.28),z*(.72+r01(key,612)*.28));
  }
  g.computeVertexNormals();return g;
}
export function ruinRubble(id:number,width:number,depth:number){
  return Array.from({length:Math.min(64,Math.max(24,Math.round(width*depth/4)))},(_,i)=>{
    const seed=id*101+i,u=r01(seed,601),v=r01(seed,602);
    const w=.65+r01(seed,603)*1.25,d=.55+r01(seed,604)*1.15;
    const central=1-Math.min(1,Math.hypot((u-.5)*2,(v-.5)*2));
    return {x:(u-.5)*Math.max(0,width-2.5),z:(v-.5)*Math.max(0,depth-2.5),
      y:.02,w,d,h:.25+r01(seed,605)*.7+central*(.6+r01(seed,607)),yaw:r01(seed,606)*Math.PI,tint:.45+r01(seed,608)*.35};
  });
}
