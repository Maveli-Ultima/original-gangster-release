import * as THREE from 'three';
import {InstancePool} from './pool';
import {TextureOwner} from './textureOwnership';
import {patchInstancedUv} from './materialUv';
import type {Mass} from './profile';
import {KERB_H,STOREY_H,r01} from './util';
import type {fireDamageStage} from '../sim/buildingDamage';

/** Static, instanced soot, boarded openings and repair scaffolding. Rebuilt only
 * when building presentation changes; shares the main/Tagged building cache. */
export class FireDamageDecor {
  readonly pools:InstancePool[];
  private dummy=new THREE.Object3D();
  private uv=new THREE.Vector4();
  constructor(owner:TextureOwner,capacity:number){
    const size=128,data=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const u=x/(size-1),v=y/(size-1);let streak=0;
      for(let k=0;k<4;k++)streak=Math.max(streak,Math.exp(-(((u-(k+.5)/4)/(.035+r01(k,88)*.05))**2)));
      const edge=THREE.MathUtils.smoothstep(u,0,.04)*(1-THREE.MathUtils.smoothstep(u,.96,1));
      data[(y*size+x)*4+3]=Math.round(255*edge*(.13+streak*.74)*(1-v*.5)*(.72+r01(x+y*size,86)*.28));
    }
    const soot=owner.own(new THREE.DataTexture(data,size,size,THREE.RGBAFormat));
    soot.generateMipmaps=false;soot.minFilter=soot.magFilter=THREE.LinearFilter;soot.needsUpdate=true;
    const plane=new THREE.PlaneGeometry(1,1);plane.translate(0,.5,0);
    const stain=new InstancePool(plane,new THREE.MeshBasicMaterial({map:soot,transparent:true,depthWrite:false,
      polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}),capacity*12);
    const boards=new InstancePool(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0x776449,roughness:1}),capacity*6,{castShadow:true});
    const rails=new InstancePool(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0x687273,roughness:.85}),capacity*10,{castShadow:true});
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#d1c3a4';ctx.fillRect(0,0,1024,128);
    ctx.fillStyle='#3a3026';ctx.textAlign='center';ctx.font='bold 38px serif';
    ctx.fillText('AWAITING REPAIRS',256,76);ctx.fillText('UNDER REPAIR',768,76);
    const map=owner.own(new THREE.CanvasTexture(canvas));map.colorSpace=THREE.SRGBColorSpace;
    map.generateMipmaps=false;map.minFilter=map.magFilter=THREE.LinearFilter;
    const mat=new THREE.MeshStandardMaterial({map,roughness:1});patchInstancedUv(mat);
    const signs=new InstancePool(new THREE.PlaneGeometry(1,1),mat,capacity,{uv:true});
    this.pools=[stain,boards,rails,signs];
  }
  add(masses:Mass[],x:number,z:number,yaw:number,stage:NonNullable<ReturnType<typeof fireDamageStage>>,lowered:boolean):void {
    const [stain,boards,rails,signs]=this.pools,sin=Math.sin(yaw),cos=Math.cos(yaw);
    const place=(pool:InstancePool,dx:number,y:number,dz:number,w:number,h:number,d:number,turn=0)=>{
      this.dummy.position.set(x+dx*cos+dz*sin,KERB_H+y,z-dx*sin+dz*cos);
      this.dummy.rotation.set(0,yaw+turn,0);this.dummy.scale.set(w,h,d);this.dummy.updateMatrix();pool.push(this.dummy.matrix,undefined,this.uv);
    };
    for(const m of masses)for(let face=0;face<4;face++){
      const angle=face*Math.PI/2,front=face%2===0;
      place(stain,m.dx+Math.sin(angle)*(m.w/2+.065),m.y,m.dz+Math.cos(angle)*(m.d/2+.065),front?m.w:m.d,m.h,1,angle);
    }
    if(stage==='scorched')return;
    const m=masses[0],front=m.dz+m.d/2+.16,bh=lowered?.8:1.7;
    for(const dx of [-.3,0,.3])for(const y of [-.18,.18])
      place(boards,m.dx+m.w*dx,bh+y,front,Math.min(3.4,m.w*.27),.25,.14);
    this.uv.set(.5,1,stage==='repairing'?.5:0,0);
    place(signs,m.dx,lowered?.73:2.65,front+.1,Math.min(4.6,m.w*.65),.65,1);
    if(stage!=='repairing')return;
    const height=lowered?1.25:Math.max(...masses.map(body=>body.y+body.h))+.3;
    for(const dx of [-.45,0,.45])place(rails,m.dx+dx*m.w,height/2,front+.7,.10,height,.10);
    for(let y=lowered?.9:2.4;y<height;y+=STOREY_H)place(rails,m.dx,y,front+.7,m.w*.92,.10,.10);
  }
}
