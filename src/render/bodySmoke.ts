import * as THREE from 'three';
import {createSmokeTexture} from './smokeTexture';
import {r01} from './util';

export const BODY_SMOKE_PARTICLES=10;
const LIFE=2.4,MAX_HISTORY=64;
interface Sample {time:number;x:number;y:number;z:number}

/** One instanced draw for the whole crowd. Puff origins stay in world space,
 * so smoke trails behind a runner instead of travelling as a rigid accessory. */
export class BodySmoke {
  readonly geometry=new THREE.InstancedBufferGeometry();
  readonly mesh:THREE.Mesh<THREE.InstancedBufferGeometry,THREE.ShaderMaterial>;
  private centers:THREE.InstancedBufferAttribute;
  private data:THREE.InstancedBufferAttribute;
  private texture=createSmokeTexture();
  private histories=new Map<number,Sample[]>();
  private used=new Set<number>();
  private count=0;
  constructor(scene:THREE.Scene,private capacity:number){
    const plane=new THREE.PlaneGeometry(1,1);this.geometry.index=plane.index;
    this.geometry.setAttribute('position',plane.getAttribute('position'));this.geometry.setAttribute('uv',plane.getAttribute('uv'));
    this.centers=new THREE.InstancedBufferAttribute(new Float32Array(capacity*BODY_SMOKE_PARTICLES*3),3).setUsage(THREE.DynamicDrawUsage);
    this.data=new THREE.InstancedBufferAttribute(new Float32Array(capacity*BODY_SMOKE_PARTICLES*4),4).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('smokeCenter',this.centers);this.geometry.setAttribute('smokeData',this.data);this.geometry.instanceCount=0;
    const material=new THREE.ShaderMaterial({transparent:true,depthTest:true,depthWrite:false,toneMapped:false,
      uniforms:{smokeMap:{value:this.texture}},
      vertexShader:`attribute vec3 smokeCenter;attribute vec4 smokeData;varying vec2 vUv;varying vec4 vData;
        void main(){vData=smokeData;float a=smokeData.z;vUv=mat2(cos(a),-sin(a),sin(a),cos(a))*(uv-.5)+.5;
          vec4 p=modelViewMatrix*vec4(smokeCenter,1.0);p.xy+=position.xy*smokeData.x;gl_Position=projectionMatrix*p;}`,
      fragmentShader:`uniform sampler2D smokeMap;varying vec2 vUv;varying vec4 vData;
        void main(){vec4 puff=texture2D(smokeMap,vUv);float alpha=puff.a*vData.y;if(alpha<.006)discard;
          vec3 color=mix(puff.rgb,vec3(.40,.39,.37),vData.w*.55);gl_FragColor=vec4(color,alpha);}`});
    this.mesh=new THREE.Mesh(this.geometry,material);this.mesh.name='body-smoke';this.mesh.frustumCulled=false;this.mesh.visible=false;this.mesh.raycast=()=>{};
    this.mesh.renderOrder=1;scene.add(this.mesh);
  }
  reset():void{this.count=0;this.used.clear();}
  push(id:number,source:THREE.Vector3,time:number,deathTime:number):void{
    if(time<0||this.used.has(id)||this.used.size>=this.capacity)return;this.used.add(id);
    let history=this.histories.get(id);
    if(!history||time<history[history.length-1].time){history=[];this.histories.set(id,history);}
    const sample={time,x:source.x,y:source.y,z:source.z},last=history[history.length-1];
    if(last&&(time===last.time||history.length>1&&time-history[history.length-2].time<.04))history[history.length-1]=sample;else history.push(sample);
    while(history.length>MAX_HISTORY||history.length>2&&history[1].time<time-LIFE)history.shift();
    const smolder=THREE.MathUtils.smoothstep(deathTime,1.5,4.5);
    for(let i=0;i<BODY_SMOKE_PARTICLES;i++){
      const seed=id*31+i,phase=r01(seed,41),cycle=(time/LIFE+i/BODY_SMOKE_PARTICLES)%1,age=cycle*LIFE,born=time-age;
      if(born<0)continue;
      let from=history[0],to=from;
      for(let k=1;k<history.length;k++){to=history[k];if(to.time>=born)break;from=to;}
      const mix=to.time>from.time?THREE.MathUtils.clamp((born-from.time)/(to.time-from.time),0,1):0;
      const x=THREE.MathUtils.lerp(from.x,to.x,mix),y=THREE.MathUtils.lerp(from.y,to.y,mix),z=THREE.MathUtils.lerp(from.z,to.z,mix);
      this.centers.setXYZ(this.count,x+(phase-.5)*.30+age*.13,y+.12+age*(.66-smolder*.20),z+(r01(seed,43)-.5)*.30+age*.07);
      const alpha=Math.sin(cycle*Math.PI)*(.46-smolder*.26);
      this.data.setXYZW(this.count,.38+cycle*(1.20-smolder*.45),alpha,phase*6+age*.12,smolder);this.count++;
    }
  }
  commit():void{
    for(const id of this.histories.keys())if(!this.used.has(id))this.histories.delete(id);
    this.geometry.instanceCount=this.count;this.mesh.visible=this.count>0;
    if(this.count){this.centers.needsUpdate=true;this.data.needsUpdate=true;}
  }
  dispose():void{this.mesh.removeFromParent();this.geometry.instanceCount=0;this.mesh.visible=false;this.geometry.dispose();this.mesh.material.dispose();this.texture.dispose();this.histories.clear();}
}
