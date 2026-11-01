import * as THREE from 'three';
import {FireShader} from '@wolffo/three-fire/vanilla';

/** THREE.Fire's GLSL volume, adapted for the game's orthographic cameras. */
export class FireVolume {
  readonly mesh:THREE.Mesh<THREE.BoxGeometry,THREE.ShaderMaterial>;
  constructor(texture:THREE.Texture,seed:number){
    const uniforms={...(THREE.UniformsUtils.clone({...FireShader.uniforms}) as typeof FireShader.uniforms),
      fade:{value:0},viewDirection:{value:new THREE.Vector3()},orthographic:{value:1}};
    uniforms.fireTex.value=texture;uniforms.seed.value=seed;
    uniforms.color.value.setRGB(1,.95,.85);uniforms.magnitude.value=.95;
    const fragmentShader=FireShader.fragmentShader
      .replace('uniform vec3 color;','uniform float fade; uniform vec3 viewDirection; uniform float orthographic; uniform vec3 color;')
      .replace('normalize(rayPos - cameraPosition)','orthographic > .5 ? viewDirection : normalize(rayPos - cameraPosition)')
      .replace('gl_FragColor = col;','gl_FragColor = vec4(clamp(col.rgb,0.0,1.0),clamp(col.a,0.0,1.0)*fade);');
    const material=new THREE.ShaderMaterial({uniforms,defines:{ITERATIONS:'20',OCTAVES:'3'},
      vertexShader:FireShader.vertexShader,fragmentShader,transparent:true,depthWrite:false,depthTest:true,toneMapped:false});
    this.mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material);
    this.mesh.name='volumetric-building-fire';this.mesh.raycast=()=>{};
    this.mesh.onBeforeRender=(_renderer,_scene,camera)=>{
      camera.getWorldDirection(uniforms.viewDirection.value);
      uniforms.orthographic.value=(camera as THREE.OrthographicCamera).isOrthographicCamera?1:0;
      uniforms.invModelMatrix.value.copy(this.mesh.matrixWorld).invert();
      this.mesh.getWorldScale(uniforms.scale.value);
    };
  }
  update(time:number,fade:number,visible:boolean):void {
    this.mesh.material.uniforms.time.value=time;
    this.mesh.material.uniforms.fade.value=fade;
    this.mesh.visible=visible&&fade>0;
  }
  dispose():void {this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
