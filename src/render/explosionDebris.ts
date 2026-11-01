import * as THREE from 'three';
import {BatchedRenderer,ParticleSystem,RenderMode,ConstantValue,PointEmitter,
  type Behavior,type Particle,Quaternion,Vector3} from 'three.quarks';
import {KERB_H,r01} from './util';
import {rubbleGeometry} from './rubble';

export interface DebrisSource {seed:number;x:number;z:number;width:number;depth:number;height:number;faceX:number;faceZ:number;color:string}
interface Fragment {x:number;y:number;z:number;dx:number;dz:number;vy:number;land:number;bounce:number;axis:Vector3;spin:number;size:Vector3}
const GRAVITY=9.81,LIFE=9;

/** Analytic flight keeps capture, accelerated play and frame skips consistent.
 * Quarks owns mesh batching; fragments leave the street-facing facade and land
 * within its pavement apron rather than tunnelling into adjacent shops. */
export class MasonryFlight implements Behavior {
  type='MasonryFlight';private index=0;private fragments=new WeakMap<Particle,Fragment>();
  constructor(readonly source:DebrisSource){}
  initialize(p:Particle):void {
    const s=this.source,n=s.seed*113+this.index++,u=(salt:number)=>r01(n,salt);
    const apron=this.index%3===0,along=(u(10)-.5)*s.width*.86,out=apron?s.depth/2:(u(23)-.5)*s.depth*.7;
    const y=KERB_H+1+u(11)*Math.min(s.height,8),vy=2+u(12)*4;
    const ground=KERB_H+.14,land=(vy+Math.sqrt(vy*vy+2*GRAVITY*(y-ground)))/GRAVITY;
    const outward=apron?1.4+u(13)*2.2:Math.max(-s.depth*.4,Math.min(s.depth*.4,out+(out<0?-1:1)*(1+u(13)*2)))-out;
    const speed=outward/land;
    const size=new Vector3(.22+u(14)*.42,.15+u(15)*.25,.18+u(16)*.35);
    if(this.index%5===0)size.set(.7+u(14)*.7,.13,.2); // roof timber among masonry
    const f:Fragment={x:s.x+s.faceZ*along+s.faceX*out,y,z:s.z-s.faceX*along+s.faceZ*out,
      dx:s.faceX*speed+s.faceZ*(u(17)-.5)*.3,dz:s.faceZ*speed-s.faceX*(u(17)-.5)*.3,
      vy,land,bounce:Math.abs(vy-GRAVITY*land)*.15,axis:new Vector3(u(18),u(19),u(20)).normalize(),spin:3+u(21)*5,size};
    this.fragments.set(p,f);p.velocity.set(0,0,0);p.size.copy(size);p.startSize.copy(size);
    const c=new THREE.Color(this.index%5===0?'#514136':s.color).multiplyScalar(.7+u(22)*.5);
    p.color.set(c.r,c.g,c.b,1);p.startColor.copy(p.color);this.place(p,f,0);
  }
  private place(p:Particle,f:Fragment,t:number):void {
    const after=Math.max(0,t-f.land),bounceTime=2*f.bounce/GRAVITY;
    const travel=Math.min(t,f.land)+Math.min(after,bounceTime)*.25;
    const ground=KERB_H+f.size.y/2;
    p.position.set(f.x+f.dx*travel,t<f.land?Math.max(ground,f.y+f.vy*t-.5*GRAVITY*t*t)
      :ground+Math.max(0,f.bounce*after-.5*GRAVITY*after*after),f.z+f.dz*travel);
    (p.rotation as Quaternion).setFromAxisAngle(f.axis,f.spin*Math.min(t,f.land+bounceTime));
    if(after>0)(p.rotation as Quaternion).slerp(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),f.spin),Math.min(1,after/bounceTime));
    p.size.copy(f.size).multiplyScalar(1-THREE.MathUtils.smoothstep(t,LIFE-1,LIFE));
  }
  update(p:Particle,dt:number):void {const f=this.fragments.get(p);if(f)this.place(p,f,p.age+dt);}
  frameUpdate():void{}
  reset():void {this.index=0;this.fragments=new WeakMap();}
  clone():MasonryFlight {return new MasonryFlight(this.source);}
  toJSON():object {return {type:this.type};}
}

export class ExplosionDebris {
  readonly batch=new BatchedRenderer();
  private systems=new Map<number,{system:ParticleSystem;time:number}>();
  private geometry=rubbleGeometry();
  private material=new THREE.MeshStandardMaterial({roughness:1,metalness:0});
  constructor(private scene:THREE.Scene){this.batch.name='building-debris';scene.add(this.batch);}
  get count():number {let n=0;for(const {system} of this.systems.values())n+=system.particleNum;return n;}
  add(source:DebrisSource):void {
    if(this.systems.has(source.seed))return;
    if(this.systems.size>=12)this.remove(this.systems.keys().next().value!);
    const system=new ParticleSystem({duration:.1,looping:false,autoDestroy:false,worldSpace:true,
      shape:new PointEmitter(),startLife:new ConstantValue(LIFE),startSpeed:new ConstantValue(0),startSize:new ConstantValue(1),
      emissionOverTime:new ConstantValue(0),emissionBursts:[{time:0,count:new ConstantValue(52),cycle:1,interval:0,probability:1}],
      instancingGeometry:this.geometry,material:this.material,renderMode:RenderMode.Mesh,behaviors:[new MasonryFlight(source)]});
    this.scene.add(system.emitter);this.batch.addSystem(system);this.systems.set(source.seed,{system,time:0});
    // Quarks initializes burst particles on update; a zero-delta update is safe.
    this.batch.update(0);
  }
  update(delta:number,visible:boolean):void {
    this.batch.visible=visible;
    for(const [id,item] of this.systems){item.time+=delta;if(item.time>=LIFE)this.remove(id);}
    if(!this.systems.size){this.batch.update(0);return;}
    // Quarks clamps a single update to 0.1 seconds. Subdivide rather than lose time.
    for(let remaining=delta;remaining>1e-8;){const dt=Math.min(.05,remaining);this.batch.update(dt);remaining-=dt;}
  }
  private remove(id:number):void {this.systems.get(id)?.system.dispose();this.systems.delete(id);}
  clear():void {for(const id of this.systems.keys())this.remove(id);this.batch.update(0);}
  dispose():void {
    this.clear();const materials=new Set<THREE.Material>([this.material]);
    for(const b of this.batch.batches){b.dispose();materials.add(b.settings.material);
      for(const material of Array.isArray(b.material)?b.material:[b.material])materials.add(material);}
    materials.forEach(material=>material.dispose());this.batch.removeFromParent();this.geometry.dispose();
  }
}
