import * as THREE from 'three';
import {FireVolume} from './fireVolume';
import {BAY_W,KERB_H,STOREY_H,TILE_BAYS,r01} from './util';
import type {Profile} from './profile';

export interface FireBay {
  offset:number;width:number;height:number;ignition:number;elevation?:number;frontOffset?:number;
  /** Other facades use coordinates relative to the original doorway and quarter turns. */
  localX?:number;localZ?:number;turn?:number;intactOnly?:boolean;
}

export function fireBayLocal(bay:FireBay):{x:number;z:number;turn:number} {
  return {x:bay.localX??bay.offset,z:bay.localZ??(.8+(bay.frontOffset??0)),turn:bay.turn??0};
}

/** The door lights first. Adjacent window sections catch in distance order;
 * all flames remain inside this frontage, including narrow corner shops. */
export function shopfrontFireBays(width:number,spread:boolean,seed:number):FireBay[] {
  const doorWidth=Math.min(3.8,Math.max(1,width-.5));
  const bays:FireBay[]=[{offset:0,width:doorWidth,height:5.2,ignition:0}];
  if(!spread||width<5.5)return bays;
  const pairs=Math.min(4,Math.max(1,Math.ceil((width-3.8)/5)));
  const step=(width-.8)/(pairs*2+1),windowWidth=Math.min(3.8,step*1.55);
  for(let n=1;n<=pairs;n++)for(const side of [-1,1]){
    const offset=side*n*((width-.8-windowWidth)/2/pairs);
    bays.push({offset,width:windowWidth,height:3.9+r01(seed+n*5+side,82)*1.1,
      ignition:1.15+Math.abs(offset)*.4+r01(seed+n*5+side,83)*.3});
  }
  return bays;
}

/** Window centres along one face, in the mass's local coordinates. The facade
 * tile has TILE_BAYS windows every BAY_W metres; the scene shifts each mass's
 * texture by `facadeOffset + massIndex·0.37` tiles. `dir` is +1 when the face's
 * texture u runs with the local axis (front +x, −X side +z) and −1 against it
 * (back, +X side). Windows too near a corner are left out, as the tile's are. */
export function faceWindowCentres(length:number,uvOffset:number,dir:1|-1):number[] {
  const phase=(((uvOffset%1)+1)%1)*TILE_BAYS*BAY_W,out:number[]=[];
  for(let k=-1;k<Math.ceil(length/BAY_W)+2;k++){
    const along=BAY_W*(k+.5)-phase;              // metres from the face's u=0 edge
    if(along<.8||along>length-.8)continue;
    out.push(dir*(along-length/2));
  }
  return out.sort((a,b)=>a-b);
}

/** Most flames one building may carry: every window of a large terrace fits;
 * a department store keeps its nearest floors and faces. */
const MAX_FIRE_BAYS=160;
/** Window opening in each 4.2 m storey of the facade tile, and the flame's reach. */
const SILL=.3,FLAME_H=3.3,FLAME_W=1.5;

/** The original's burning building: fire in every window opening. The door
 * lights first; a shop keeps its storefront fire on the ground floor; each
 * window catches in turn outward from the door, every floor after the one
 * below it, then the side and rear walls. `facadeOffset` is the building's
 * texture shift (r01(id, 20)) so flames sit in the painted windows. */
export function buildingFireBays(profile:Profile|undefined,seed:number,facadeOffset=0):FireBay[] {
  const base=profile?.masses[0];
  const shop=profile?.base==='shop';
  const bays=shopfrontFireBays(base?.w??3.8,shop,seed);
  if(!base||!profile||profile.ruin)return bays;
  const offset=profile.spire?0:facadeOffset;
  const front=base.dz+base.d/2+.2;                // the fire's local origin, beside the base front
  const storeyStart=new Map<number,number>();      // ignition of each storey's front, for the floor above
  let count=bays.length;
  const add=(bay:FireBay)=>{if(count<MAX_FIRE_BAYS){bays.push(bay);count++;}};
  profile.masses.forEach((mass,mi)=>{
    // Decorative towers beside the main body are not another floor above it.
    if(mass!==base&&mass.y<STOREY_H)return;
    const uv=offset+mi*.37;
    for(let s=0;mass.y+s*STOREY_H+SILL+2.4<=mass.y+mass.h+.01;s++){
      const elevation=mass.y+s*STOREY_H+SILL;
      const storey=Math.round(elevation/STOREY_H);
      const height=Math.min(FLAME_H,mass.y+mass.h-elevation+.55);
      // A floor catches 1.65 s after the first flame on the floor below.
      const floorBase=storey===0?1.15:Math.max(4.4+(storey-1)*1.65,(storeyStart.get(storey-1)??0)+1.65);
      const first=(ignition:number)=>{storeyStart.set(storey,Math.min(storeyStart.get(storey)??Infinity,ignition));return ignition;};
      const jitter=(i:number,salt:number)=>r01(seed+storey*31+mi*7+i,salt)*.3;
      if(!storeyStart.has(storey)&&mass===base&&storey===0&&shop)storeyStart.set(0,Math.min(...bays.map(b=>b.ignition)));
      // Front: the storefront already burns on a shop's ground floor.
      if(!(mass===base&&storey===0&&shop))
        faceWindowCentres(mass.w,uv,1).forEach((x,i)=>{
          const along=x+mass.dx-base.dx;
          add({offset:along,width:FLAME_W,height,elevation:storey===0?0:elevation,
            ...(storey===0?{}:{frontOffset:mass.dz+mass.d/2-base.dz-base.d/2}),
            ignition:first(floorBase+Math.abs(along)*(storey===0?.4:.12)+jitter(i,84))});
        });
      // Sides (turn ±1) and rear (turn 2) follow the front of the same floor.
      for(const turn of [1,-1] as const)
        faceWindowCentres(mass.d,uv,turn===1?-1:1).forEach((z,i)=>add({offset:z,
          localX:mass.dx-base.dx+turn*(mass.w/2+1),localZ:mass.dz+z-front,turn,intactOnly:true,
          width:FLAME_W,height,elevation,ignition:floorBase+2.1+(turn<0?1.1:0)+Math.abs(z)*.1+jitter(i,85)}));
      faceWindowCentres(mass.w,uv,-1).forEach((x,i)=>add({offset:x,
        localX:mass.dx-base.dx+x,localZ:mass.dz-mass.d/2-1-front,turn:2,intactOnly:true,
        width:FLAME_W,height,elevation,ignition:floorBase+3.4+Math.abs(x)*.1+jitter(i,86)}));
    }
  });
  return bays;
}

export function fireBayGrowth(time:number,bay:FireBay):number {
  return THREE.MathUtils.smoothstep(time-bay.ignition,0,bay.ignition===0?.25:1.35);
}

/** Shared by the main and Tagged cameras; spreading is presentation-only. */
export class ShopfrontFire {
  readonly volumes:FireVolume[];
  private lowered=false;
  private visible=false;
  constructor(texture:THREE.Texture,seed:number,readonly bays:FireBay[],scene:THREE.Scene,
    private x:number,private z:number,private sideX:number,private sideZ:number){
    this.volumes=bays.map((bay,i)=>{
      const volume=new FireVolume(texture,r01(seed+i*97,123)*19);
      volume.mesh.rotation.y=Math.atan2(-sideZ,sideX)+(bay.turn??0)*Math.PI/2;scene.add(volume.mesh);return volume;
    });
  }
  update(time:number,fade:number,visible:boolean):void {
    this.visible=visible;
    this.bays.forEach((bay,i)=>{
      const growth=fireBayGrowth(time,bay),volume=this.volumes[i];
      const height=bay.height*(.35+.65*growth),width=bay.width*(.45+.55*growth);
      volume.mesh.scale.set(width,height,1.8);
      const local=fireBayLocal(bay);
      volume.mesh.position.set(this.x+this.sideX*local.x-this.sideZ*local.z,KERB_H+(bay.elevation??0)+height/2,
        this.z+this.sideZ*local.x+this.sideX*local.z);
      volume.update(Math.max(0,time-bay.ignition),fade*growth,visible&&(!this.lowered||(!bay.elevation&&!bay.intactOnly)));
    });
  }
  setLowered(lowered:boolean):void {
    this.lowered=lowered;
    this.volumes.forEach((v,i)=>{const bay=this.bays[i];v.mesh.visible=this.visible&&v.mesh.material.uniforms.fade.value>0&&(!lowered||(!bay.elevation&&!bay.intactOnly));});
  }
  dispose():void {this.volumes.forEach(volume=>volume.dispose());}
}
