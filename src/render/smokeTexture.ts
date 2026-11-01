import * as THREE from 'three';
import {r01} from './util';

/** Bake soft billows once; the live smoke shader needs one texture sample,
 * rather than evaluating layered procedural noise for every covered pixel. */
export function createSmokeTexture():THREE.DataTexture {
  const size=128,data=new Uint8Array(size*size*4);
  const noise=(x:number,y:number)=>{
    const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
    const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(r01(ix+iy*157,91),r01(ix+1+iy*157,91),sx),
      THREE.MathUtils.lerp(r01(ix+(iy+1)*157,91),r01(ix+1+(iy+1)*157,91),sx),sy);
  };
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/(size-1),v=y/(size-1),radius=Math.hypot((u-.5)*2,(v-.5)*2);
    const n=.6*noise(u*5,v*5)+.28*noise(u*11+7,v*11)+.12*noise(u*23,v*23+13);
    const edge=1-THREE.MathUtils.smoothstep(radius+.2*(n-.5),.25,.98);
    const shade=.11+n*.25,i=(y*size+x)*4;
    data[i]=Math.round(shade*255);data[i+1]=Math.round(shade*.96*255);data[i+2]=Math.round(shade*.90*255);
    data[i+3]=Math.round(edge*(.45+.55*n)*255);
  }
  const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
  texture.generateMipmaps=false;texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;
  return texture;
}
