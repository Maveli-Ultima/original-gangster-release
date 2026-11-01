import * as THREE from 'three';
/** Two firemen, two shared line draws; no physics bodies, lights or particles. */
export class EmergencyHoses{
  private waterGeometry=new THREE.BufferGeometry();private hoseGeometry=new THREE.BufferGeometry();
  private water=new THREE.LineSegments(this.waterGeometry,new THREE.LineBasicMaterial({color:0xcee6eb,transparent:true,opacity:.65,depthWrite:false}));
  private hose=new THREE.LineSegments(this.hoseGeometry,new THREE.LineBasicMaterial({color:0x2c302c}));
  private jet=new Float32Array(2*24*6);private pipe=new Float32Array(2*24*6);private count=0;
  constructor(scene:THREE.Scene){
    this.waterGeometry.setAttribute('position',new THREE.BufferAttribute(this.jet,3).setUsage(THREE.DynamicDrawUsage));
    this.hoseGeometry.setAttribute('position',new THREE.BufferAttribute(this.pipe,3).setUsage(THREE.DynamicDrawUsage));
    this.water.frustumCulled=this.hose.frustumCulled=false;this.water.raycast=this.hose.raycast=()=>{};
    scene.add(this.water,this.hose);this.commit();
  }
  reset():void{this.count=0;}
  push(nozzle:THREE.Vector3,target:{x:number;y:number},floor:number,time:number):void{
    if(this.count>=2)return;
    const n=this.count++,dx=target.x-nozzle.x,dz=target.y-nozzle.z,len=Math.hypot(dx,dz)||1;
    const reach=Math.min(len,7),x=dx/len,z=dz/len;
    for(let i=0;i<24;i++)for(let end=0;end<2;end++){
      const t=(i+end)/24,index=n*144+i*6+end*3;
      this.jet.set([nozzle.x+x*reach*t+Math.sin(t*17+time*6)*t*.028,
        nozzle.y+Math.sin(t*Math.PI)*.5+t*.25,nozzle.z+z*reach*t],index);
      this.pipe.set([nozzle.x-x*t*.5+z*Math.sin(t*Math.PI)*.35,
        floor+.03+Math.max(0,1-t*2)*(nozzle.y-floor),nozzle.z-z*t*.5-x*t*3],index);
    }
  }
  commit():void{
    for(const [geometry,line] of [[this.waterGeometry,this.water],[this.hoseGeometry,this.hose]] as const){
      geometry.setDrawRange(0,this.count*48);geometry.getAttribute('position').needsUpdate=true;line.visible=this.count>0;
    }
  }
  dispose():void{for(const line of [this.water,this.hose]){line.removeFromParent();line.geometry.dispose();line.material.dispose();}}
}
