import * as THREE from 'three';
import type { PersonRole, WeaponId } from '../sim/types';
import { EquipmentModels, type EquipmentModel } from './equipmentModels';
import { roleCoat } from './characterPresentation';
import { actionEnvelope, actionFlash, THROW_RELEASE, type CharacterAction } from './characterActions';
import {THROW_TIMING} from '../sim/presentationEvents';
import {handlingAction,longGun,weaponVisible,drawDuration} from './weaponHandling';

export interface CharacterAppearance { role:PersonRole; coat:number; weapon?:WeaponId; carriedProp?:'explosives'|'crate'; throwable?:'molotov'|'bomb'; charred?:number; firefighting?:boolean; }
const palmOffsetCache=new WeakMap<THREE.BufferGeometry,Map<string,THREE.Vector3>>();

/** Skin weights identify cloth without tinting faces, hair, hands or shoes. */
export function prepareClothMask(mesh:THREE.SkinnedMesh):void {
  if(mesh.geometry.hasAttribute('aCloth')) return;
  const indices=mesh.geometry.getAttribute('skinIndex'), weights=mesh.geometry.getAttribute('skinWeight');
  const cloth=new Float32Array(indices.count), headwear=new Float32Array(indices.count), covered=new Float32Array(indices.count);
  const head=mesh.skeleton.bones.find(b=>b.name==='Head');
  const headY=head?.getWorldPosition(new THREE.Vector3()).y??Infinity;
  const v=new THREE.Vector3();
  for(let i=0;i<indices.count;i++) {
    let amount=0, body=0;
    for(let j=0;j<4;j++) {
      const name=mesh.skeleton.bones[indices.getComponent(i,j)]?.name??'';
      if(/^(Hips|Spine\d*|(?:Left|Right)(?:UpLeg|Leg))$/.test(name)) body+=weights.getComponent(i,j);
      if(/^(Hips|Spine\d*|(?:Left|Right)(?:UpLeg|Leg|Arm|ForeArm|Shoulder))$/.test(name)) amount+=weights.getComponent(i,j);
    }
    cloth[i]=THREE.MathUtils.smoothstep(amount,.7,.99);
    mesh.getVertexPosition(i,v).applyMatrix4(mesh.matrixWorld);
    headwear[i]=v.y>headY+.075?1:0;
    covered[i]=body>.7 && v.y>.34 && v.y<1.46?1:0;
  }
  mesh.geometry.setAttribute('aCloth',new THREE.Float32BufferAttribute(cloth,1));
  mesh.geometry.setAttribute('aHeadwear',new THREE.Float32BufferAttribute(headwear,1));
  mesh.geometry.setAttribute('aRobeCovered',new THREE.Float32BufferAttribute(covered,1));
}

/** Per-rig uniforms keep identities independent when cached rigs change owner. */
export class CharacterEquipment {
  private originals=new Map<THREE.Mesh,THREE.Material|THREE.Material[]>();
  private materials:THREE.Material[]=[];
  private color={value:new THREE.Color()};
  private mix={value:0};
  /** 1 keeps the cloth's own folds and shading under the role colour (uniforms). */
  private shade={value:0};
  private charred={value:0};
  private hsl={h:0,s:0,l:0};
  private shirt={value:1};
  private geometryOverrides=new Map<THREE.Mesh,THREE.BufferGeometry>();
  private attachments:THREE.Object3D[]=[];
  private ownedGeometry:THREE.BufferGeometry[]=[];
  private ownedSkeletons:THREE.Skeleton[]=[];
  private signature='';
  private rest=new Map<string,THREE.Matrix4>();
  private restPositions=new Map<string,THREE.Vector3>();
  private boneMap=new Map<string,THREE.Bone>();
  private palmOffsets=new Map<string,THREE.Vector3>();
  private attachmentRest=new Map<THREE.Object3D,THREE.Matrix4>();
  private appearance?:CharacterAppearance;
  private flashes:THREE.Mesh[]=[];
  private flashGeometry?:THREE.BufferGeometry;
  private flashMaterial?:THREE.MeshBasicMaterial;
  private throwRelease?:THREE.Vector3;
  private throwRotation?:THREE.Quaternion;
  private weaponGrips=new Map<THREE.Object3D,THREE.Quaternion>();

  constructor(private group:THREE.Group,model:THREE.Object3D,private library:EquipmentModels,private bareJudgeHead=false,private dedicatedBody=false) {
    // The caller supplies the normalized reference pose with an identity root.
    group.updateMatrixWorld(true);
    model.traverse(node=> {
      if(node instanceof THREE.Bone) {
        this.boneMap.set(node.name,node); this.rest.set(node.name,node.matrixWorld.clone());
        this.restPositions.set(node.name,new THREE.Vector3().setFromMatrixPosition(node.matrixWorld));
      }
      if(!(node instanceof THREE.SkinnedMesh)) return;
      if(!this.dedicatedBody)prepareClothMask(node);
      this.originals.set(node,node.material);
      const tint=(source:THREE.Material) => {
        const mat=source.clone(); this.materials.push(mat);
        mat.onBeforeCompile=shader=> {
          shader.uniforms.wardrobeColor=this.color; shader.uniforms.wardrobeMix=this.mix;shader.uniforms.wardrobeShade=this.shade;shader.uniforms.keepShirt=this.shirt;shader.uniforms.charred=this.charred;
          shader.vertexShader=shader.vertexShader.replace('#include <common>',
            '#include <common>\n'+(this.dedicatedBody?'':'attribute float aCloth; ')+'varying float vCloth;')
            .replace('#include <begin_vertex>','#include <begin_vertex>\nvCloth='+(this.dedicatedBody?'0.0':'aCloth')+';');
          shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
            '#include <common>\nvarying float vCloth; uniform vec3 wardrobeColor; uniform float wardrobeMix; uniform float wardrobeShade; uniform float keepShirt; uniform float charred;')
            .replace('#include <map_fragment>',`#include <map_fragment>
              float clothLight=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
              float preserveShirt=smoothstep(.5,.75,clothLight)*keepShirt;
              vec3 fabric=wardrobeColor*mix(.85+.3*clamp(clothLight,0.0,1.0),.42+1.7*clamp(clothLight,0.0,.9),wardrobeShade);
              diffuseColor.rgb=mix(diffuseColor.rgb,fabric,vCloth*wardrobeMix*(1.0-preserveShirt));
              // The original's figures are bold, high-contrast sprites that stand
              // out from grey stone: lift contrast, and saturation a little (a
              // 1.4 lift turned blue cloth to paint).
              float boldLight=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
              diffuseColor.rgb=max((mix(vec3(boldLight),diffuseColor.rgb,1.15)-.18)*1.18+.18,0.0);
              float ash=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
              diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.023,.021,.019)+ash*.085,charred);`);
        };
        mat.customProgramCacheKey=()=> 'og-role-clothing-burn-v4-'+Number(this.dedicatedBody); return mat;
      };
      node.material=Array.isArray(node.material)?node.material.map(tint):tint(node.material);
    });
    // Sculpt hands have no finger bones. Locate the palm from vertices assigned
    // to each hand rather than assuming every source was bound with arms down.
    const body=model.getObjectByProperty('isSkinnedMesh',true) as THREE.SkinnedMesh|undefined;
    const cached=body&&palmOffsetCache.get(body.geometry);
    if(cached)this.palmOffsets=cached;
    else for(const name of ['LeftHand','RightHand']){
      const bone=this.boneMap.get(name),wrist=this.restPositions.get(name);if(!bone||!wrist)continue;
      const bounds=new THREE.Box3(),point=new THREE.Vector3();
      model.traverse(node=>{
        if(!(node instanceof THREE.SkinnedMesh))return;
        const hand=node.skeleton.bones.indexOf(bone);if(hand<0)return;
        const indices=node.geometry.getAttribute('skinIndex'),weights=node.geometry.getAttribute('skinWeight');
        for(let i=0;i<indices.count;i++){
          let weight=0;for(let j=0;j<4;j++)if(indices.getComponent(i,j)===hand)weight+=weights.getComponent(i,j);
          if(weight<.8)continue;
          node.getVertexPosition(i,point).applyMatrix4(node.matrixWorld);
          if(point.distanceTo(wrist)<.18)bounds.expandByPoint(point);
        }
      });
      const palm=bounds.isEmpty()?wrist.clone().add(new THREE.Vector3(0,-.06,.018)):bounds.getCenter(new THREE.Vector3());
      this.palmOffsets.set(name,palm.applyMatrix4(this.rest.get(name)!.clone().invert()));
    }
    if(body&&!cached)palmOffsetCache.set(body.geometry,this.palmOffsets);
  }

  set(appearance?:CharacterAppearance):void {
    this.appearance=appearance;
    this.mix.value=this.dedicatedBody?0:appearance ? appearance.role==='judge'?1:.88 : 0;
    this.charred.value=appearance?.charred??0;
    this.shirt.value=appearance?.role==='judge'?0:1;
    // Uniforms keep their folds, belt and buttons rather than a flat wash of colour.
    this.shade.value=appearance?.role==='police'||appearance?.role==='policeChief'?1:0;
    if(appearance) {
      this.color.value.setHex(roleCoat(appearance.role,appearance.coat));
      if(!['police','policeChief','fbi','fbiHead','judge'].includes(appearance.role)) {
        // Gang UI colours are brighter than cloth, but the original's street
        // clothes are bold (cream suits, red dresses): a looser cap than wool
        // grey, short of the saturation that made blue read as paint.
        this.color.value.getHSL(this.hsl);
        this.color.value.setHSL(this.hsl.h,Math.min(.45,this.hsl.s),Math.min(.32,this.hsl.l));
      }
    }
    const key=appearance?`${appearance.role}/${appearance.weapon??''}/${appearance.carriedProp??''}/${appearance.throwable??''}/${!!appearance.firefighting}`:'';
    if(key===this.signature) return;
    this.clearAttachments(); this.signature=key;
    if(!appearance) return;
    const {role,weapon,carriedProp}=appearance;
    if(appearance.firefighting){
      const wrist=this.restPositions.get('RightHand');if(wrist)this.fixed('fireHose','RightHand',wrist.clone());return;
    }
    if(appearance.throwable){
      const wrist=this.restPositions.get('RightHand');
      if(wrist)this.fixed(appearance.throwable==='bomb'?'explosives':'molotov','RightHand',wrist.clone());
      return;
    }
    if(weapon) {
      this.hand(weapon,'RightHand');
      if(weapon==='twinPistols' && !carriedProp) this.hand(weapon,'LeftHand');
    }
    // A goods case is held in both arms in front of the chest.
    if(carriedProp==='crate') this.fixed('crate','Spine',new THREE.Vector3(0,1.02,.30));
    else if(carriedProp) this.hand(carriedProp,'LeftHand');
    if(!this.dedicatedBody && (role==='fbi' || role==='fbiHead' || role==='policeChief'))
      this.fixed('badge','Spine',new THREE.Vector3(-.108,1.38,.16));
    if(role==='reporter') {
      this.fixed('camera','Spine',new THREE.Vector3(0,1.18,.20));
      this.fixed('cameraStrap','Spine',new THREE.Vector3(0,1.18,.20));
    }
    if(role==='judge') {
      if(!this.dedicatedBody) { this.robe(); this.fitJudgeBody(); this.fixed('collar','Spine',new THREE.Vector3(0,1.405,.16)); }
      if(!weapon) this.hand('gavel','RightHand');
    }
  }

  private fixed(kind:EquipmentModel,boneName:string,position:THREE.Vector3,rotation=new THREE.Euler()):void {
    const bone=this.boneMap.get(boneName), rest=this.rest.get(boneName);
    if(!bone || !rest) return; // An incomplete imported rig still renders safely.
    const mesh=this.library.create(kind);
    const matrix=new THREE.Matrix4().compose(position,new THREE.Quaternion().setFromEuler(rotation),new THREE.Vector3(1,1,1));
    matrix.premultiply(rest.clone().invert()); matrix.decompose(mesh.position,mesh.quaternion,mesh.scale);
    bone.add(mesh); this.attachments.push(mesh);
    mesh.updateMatrix();this.attachmentRest.set(mesh,mesh.matrix.clone());
  }

  /** Fit both hands to held objects after the animation has been sampled. */
  pose(action?:CharacterAction,authoredCombat=false):void {
    for(const [mesh,matrix] of this.attachmentRest){matrix.decompose(mesh.position,mesh.quaternion,mesh.scale);mesh.visible=true;}
    for(const [mesh,rotation] of this.weaponGrips)mesh.quaternion.copy(rotation);
    for(const flash of this.flashes)flash.visible=false;
    if(action?.kind==='death'||action?.kind==='burnDeath'){
      // A fallen reporter's rigid camera (or a held prop) must rest on the
      // pavement rather than follow the torso through it. The body is grounded
      // separately; moving the whole body here would make the corpse float.
      const floor=this.group.matrixWorld.elements[13];
      for(const mesh of this.attachments){
        if(!mesh.name.startsWith('equipment-'))continue;
        mesh.updateWorldMatrix(true,true);
        const low=new THREE.Box3().setFromObject(mesh,true).min.y;
        if(low>=floor)continue;
        const position=mesh.getWorldPosition(new THREE.Vector3());position.y+=floor-low;
        mesh.position.copy(mesh.parent!.worldToLocal(position));mesh.updateWorldMatrix(false,true);
      }
      return;
    }
    if(handlingAction(action))for(const mesh of this.attachments)
      if(mesh.name==='equipment-'+this.appearance?.weapon)mesh.visible=weaponVisible(action);
    if(action?.kind==='throw'&&this.appearance?.throwable){this.poseThrow(action);return;}
    const handling=handlingAction(action)&&longGun(this.appearance?.weapon)&&!this.appearance?.carriedProp;
    const support=handling&&action?(action.kind==='ready'?1:action.kind==='draw'?
      THREE.MathUtils.smoothstep(action.time,1.4,drawDuration(action.weapon)):
      action.reverseDraw?THREE.MathUtils.smoothstep(drawDuration(action.weapon)-action.time,1.4,drawDuration(action.weapon)):
      1-THREE.MathUtils.smoothstep(action.time,0,.35)):0;
    const amount=handling?support:action?.kind==='strike'?(authoredCombat?0:actionEnvelope(action.time,1.05,.12,.45)):
      action?.kind==='shoot'?(authoredCombat?1:actionEnvelope(action.time,1.05,.16,.25)):
      action?.kind==='firefight'?1:action?.kind==='photo'?actionEnvelope(action.time,2.2,.55,.55):0;
    // Carry-heavy-object holds the hands a metre apart; bring them to the case.
    const crate=this.appearance?.carriedProp==='crate'&&(!action||amount<=0)?this.attachments.find(o=>o.name==='equipment-crate'):undefined;
    if((!action||amount<=0)&&!crate)return;
    const inv=this.group.matrixWorld.clone().invert();
    const point=(name:string)=>this.boneMap.get(name)?.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const palm=(name:string)=>{
      const bone=this.boneMap.get(name),offset=this.palmOffsets.get(name);
      return bone&&offset?offset.clone().applyMatrix4(bone.matrixWorld).applyMatrix4(inv):point(name)!;
    };
    const head=point('Head'),shoulder=point('RightArm');if(!head||!shoulder)return;
    const world=(p:THREE.Vector3)=>p.clone().applyMatrix4(this.group.matrixWorld);
    const orient=(bone:THREE.Bone,child:THREE.Bone,target:THREE.Vector3)=>{
      const origin=bone.getWorldPosition(new THREE.Vector3());
      const from=child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
      const to=world(target).sub(origin).normalize();
      const rotation=new THREE.Quaternion().setFromUnitVectors(from,to).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
      if(bone.parent)rotation.premultiply(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
      bone.quaternion.copy(rotation);bone.updateWorldMatrix(false,true);
    };
    const arm=(side:'Left'|'Right',target:THREE.Vector3,weight=amount)=>{
      const upper=this.boneMap.get(side+'Arm'),lower=this.boneMap.get(side+'ForeArm'),hand=this.boneMap.get(side+'Hand');
      if(!upper||!lower||!hand)return;
      const a=point(side+'Arm')!,b=point(side+'ForeArm')!,c=point(side+'Hand')!;
      const end=c.clone().lerp(target,weight),direction=end.clone().sub(a);
      const first=a.distanceTo(b),second=b.distanceTo(c),d=Math.min(direction.length(),(first+second)*.995);
      if(d<.001)return;direction.normalize();
      const along=(first*first-second*second+d*d)/(2*d);
      const elbowWidth=action?.kind==='strike'?.12:.8;
      const bend=new THREE.Vector3(side==='Right'?-elbowWidth:elbowWidth,-1,0);
      bend.addScaledVector(direction,-bend.dot(direction)).normalize();
      const elbow=a.clone().addScaledVector(direction,along).addScaledVector(bend,Math.sqrt(Math.max(0,first*first-along*along)));
      orient(upper,lower,elbow);orient(lower,hand,a.clone().addScaledVector(direction,d));
    };
    const place=(mesh:THREE.Object3D,p:THREE.Vector3,rotation=new THREE.Quaternion())=>{
      const desired=new THREE.Matrix4().compose(p,rotation,new THREE.Vector3(1,1,1));
      desired.premultiply(this.group.matrixWorld).premultiply(mesh.parent!.matrixWorld.clone().invert());
      desired.decompose(mesh.position,mesh.quaternion,mesh.scale);mesh.updateWorldMatrix(false,true);
    };
    if(crate){
      // Palms on the case's sides, just below its middle (crate half-width .25).
      crate.updateWorldMatrix(true,false);
      const centre=crate.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
      const across=new THREE.Vector3(1,0,0).transformDirection(crate.matrixWorld).transformDirection(inv);
      arm('Left',centre.clone().addScaledVector(across,.29).add(new THREE.Vector3(0,-.04,0)),1);
      arm('Right',centre.clone().addScaledVector(across,-.29).add(new THREE.Vector3(0,-.04,0)),1);
      return;
    }
    if(!action)return;
    const flashPoints:THREE.Vector3[]=[];
    const muzzle=(gun:THREE.Object3D)=>{
      const anchor=gun.getObjectByName('equipment-muzzle');
      if(anchor)flashPoints.push(anchor.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv));
    };
    if(action.kind==='firefight'){
      arm('Right',new THREE.Vector3(-.17,shoulder.y-.38,.34));
      arm('Left',new THREE.Vector3(.07,shoulder.y-.34,.47));
      const nozzle=this.attachments.find(o=>o.name==='equipment-fireHose');
      if(nozzle)place(nozzle,palm('RightHand'),new THREE.Quaternion().setFromEuler(new THREE.Euler(-.16,0,0)));
    }else if(handling){
      const gun=this.attachments.find(o=>o.name==='equipment-'+this.appearance?.weapon&&o.parent?.name==='RightHand');
      if(gun){
        gun.updateWorldMatrix(true,false);
        const supportPoint=new THREE.Vector3(0,-.025,.25).applyMatrix4(gun.matrixWorld).applyMatrix4(inv);
        arm('Left',supportPoint.sub(palm('LeftHand')).add(point('LeftHand')!));
      }
    }else if(action.kind==='strike'){
      // Wind up, extend to contact with the reaction cue, then recover to guard.
      // Targets are in the normalized body's forward frame; two-bone IK clamps
      // extension to the actual limb lengths without moving either planted foot.
      const extend=THREE.MathUtils.smoothstep(action.time,.06,.24)*
        (1-THREE.MathUtils.smoothstep(action.time,.30,.62));
      arm('Right',new THREE.Vector3(-.17,shoulder.y-.09,.20+.48*extend));
      arm('Left',new THREE.Vector3(.18,shoulder.y-.15,.23));
    }else if(action.kind==='shoot'&&this.appearance?.weapon){
      const weapon=this.appearance.weapon,long=['rifle','shotgun','tommy'].includes(weapon);
      const recoil=Math.max(0,1-Math.abs(action.time-.27)/.12)*.045;
      const target=new THREE.Vector3(long?-.15:-.19,shoulder.y-(long?.13:.07),long?.32:.48);
      target.z-=recoil;if(!authoredCombat)arm('Right',target);
      const gun=this.attachments.find(o=>o.name==='equipment-'+weapon&&o.parent?.name==='RightHand');
      const grip=gun?gun.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv).lerp(palm('RightHand'),amount):palm('RightHand');
      if(gun){
        const currentQ=gun.getWorldQuaternion(new THREE.Quaternion()).premultiply(this.group.getWorldQuaternion(new THREE.Quaternion()).invert());
        currentQ.slerp(new THREE.Quaternion(),amount);place(gun,grip,currentQ);
        muzzle(gun);
      }
      if(long&&!this.appearance.carriedProp)arm('Left',grip.clone().add(new THREE.Vector3(.02,.015,.29)));
      else if(weapon==='twinPistols'&&!this.appearance.carriedProp){
        if(!authoredCombat)arm('Left',new THREE.Vector3(.19,target.y,target.z));
        const second=this.attachments.find(o=>o.name==='equipment-'+weapon&&o.parent?.name==='LeftHand');
        if(second){
          const position=second.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv).lerp(palm('LeftHand'),amount);
          const rotation=second.getWorldQuaternion(new THREE.Quaternion()).premultiply(this.group.getWorldQuaternion(new THREE.Quaternion()).invert());
          place(second,position,rotation.slerp(new THREE.Quaternion(),amount));muzzle(second);
        }
      }
    }else if(action.kind==='photo'){
      const camera=this.attachments.find(o=>o.name==='equipment-camera');
      if(camera){
        const position=camera.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv).lerp(new THREE.Vector3(0,head.y-.065,.27),amount);
        arm('Right',position.clone().add(new THREE.Vector3(-.13,-.025,-.03)));
        arm('Left',position.clone().add(new THREE.Vector3(.13,-.045,-.02)));
        place(camera,position);flashPoints.push(position.clone().add(new THREE.Vector3(-.13,.17,.11)));
        const strap=this.attachments.find(o=>o.name==='equipment-cameraStrap');if(strap)strap.visible=amount<.15;
      }
    }
    const flash=actionFlash(action);
    if(flash>0&&flashPoints.length){
      if(!this.flashGeometry){
        this.flashGeometry=new THREE.OctahedronGeometry(1);
        this.flashMaterial=new THREE.MeshBasicMaterial({color:0xffe7a0,transparent:true,depthWrite:false,toneMapped:false});
      }
      flashPoints.forEach((point,i)=>{
        if(!this.flashes[i]){
          const mesh=new THREE.Mesh(this.flashGeometry,this.flashMaterial);mesh.name='action-flash';this.group.add(mesh);this.flashes.push(mesh);
        }
        const mesh=this.flashes[i];mesh.visible=true;mesh.position.copy(point);mesh.scale.setScalar((action.kind==='photo'?.16:.065)*flash);
      });
      this.flashMaterial!.color.setHex(action.kind==='photo'?0xffffff:0xffdf8a);
    }
  }

  get hasWeaponGrip():boolean{return this.weaponGrips.size>0;}
  /** Calibrate local grip axes in the authored ready pose, once per weapon/rig. */
  captureWeaponGrip():void {
    const weapon=this.appearance?.weapon;if(!weapon)return;
    const groupRotation=this.group.getWorldQuaternion(new THREE.Quaternion());
    const palm=(name:string)=>{
      const b=this.boneMap.get(name),p=this.palmOffsets.get(name);
      return b&&p?p.clone().applyMatrix4(b.matrixWorld):b?.getWorldPosition(new THREE.Vector3());
    };
    const right=palm('RightHand'),left=palm('LeftHand');
    const direction=longGun(weapon)&&left&&right?left.sub(right).normalize().applyQuaternion(groupRotation.clone().invert()):
      new THREE.Vector3(0,-.12,1).normalize();
    const rotation=groupRotation.clone().multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),direction));
    for(const mesh of this.attachments)if(mesh.name==='equipment-'+weapon&&mesh.parent)
      this.weaponGrips.set(mesh,mesh.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
  }

  /** Capture from the actual grounded release pose, also valid when scrubbing. */
  get hasThrowRelease():boolean{return !!this.throwRelease;}
  captureThrowRelease():void {
    this.throwRelease=this.throwPalm();
    const prop=this.attachments[0],matrix=prop&&this.attachmentRest.get(prop);
    if(prop&&matrix){
      matrix.decompose(prop.position,prop.quaternion,prop.scale);prop.updateWorldMatrix(false,true);
      this.throwRotation=prop.getWorldQuaternion(new THREE.Quaternion()).premultiply(this.group.getWorldQuaternion(new THREE.Quaternion()).invert());
    }
  }
  private throwPalm():THREE.Vector3|undefined {
    const hand=this.boneMap.get('RightHand'),offset=this.palmOffsets.get('RightHand');
    return hand&&offset?offset.clone().applyMatrix4(hand.matrixWorld).applyMatrix4(this.group.matrixWorld.clone().invert()):undefined;
  }
  private poseThrow(action:CharacterAction):void {
    const prop=this.attachments[0],palm=this.throwPalm();if(!prop||!palm)return;
    const position=palm.clone(),rotation=prop.getWorldQuaternion(new THREE.Quaternion()).premultiply(this.group.getWorldQuaternion(new THREE.Quaternion()).invert());
    if(action.time>=THROW_RELEASE){
      const start=this.throwRelease??palm;
      const progress=THREE.MathUtils.clamp((action.time-THROW_RELEASE)/THROW_TIMING.flight,0,1);
      if(action.time>=THROW_RELEASE+THROW_TIMING.flight){prop.visible=false;return;}
      const target=action.target?new THREE.Vector3(action.target.x,this.group.matrixWorld.elements[13]+.15,action.target.y)
        .applyMatrix4(this.group.matrixWorld.clone().invert()):new THREE.Vector3(0,.15,3.5);
      position.copy(start).lerp(target,progress);position.y+=Math.sin(Math.PI*progress)*1.2;
      rotation.copy(this.throwRotation??rotation).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),progress*Math.PI*2));
    }
    // Keep the physical object in metres despite centimetre-scaled skeletons.
    const desired=new THREE.Matrix4().compose(position,rotation,new THREE.Vector3(1,1,1));
    desired.premultiply(this.group.matrixWorld);
    desired.premultiply(prop.parent!.matrixWorld.clone().invert());
    desired.decompose(prop.position,prop.quaternion,prop.scale);prop.updateWorldMatrix(false,true);
  }

  private hand(kind:EquipmentModel,boneName:string):void {
    const wrist=this.restPositions.get(boneName); if(!wrist) return;
    const offset=this.palmOffsets.get(boneName),bind=this.rest.get(boneName);
    const position=offset&&bind?offset.clone().applyMatrix4(bind):wrist.clone().add(new THREE.Vector3(0,-.06,.018));
    this.fixed(kind,boneName,position,new THREE.Euler(kind==='gavel'?.4:kind==='explosives'?0:1.0,0,0));
  }

  private robe():void {
    const spine=this.boneMap.get('Spine'), hips=this.boneMap.get('Hips'), left=this.boneMap.get('LeftUpLeg'), right=this.boneMap.get('RightUpLeg');
    if(!hips || !left || !right || !spine) return;
    const pos:number[]=[], indices:number[]=[], weights:number[]=[], joints:number[]=[];
    const rings=[{y:.32,w:.30,d:.36},{y:.52,w:.28,d:.32},{y:.83,w:.24,d:.21},{y:1.1,w:.19,d:.15},{y:1.28,w:.215,d:.15},{y:1.43,w:.23,d:.135},{y:1.48,w:.10,d:.10}];
    const sides=32;
    rings.forEach((ring,r)=> {
      for(let n=0;n<=sides;n++) {
        const angle=n/sides*Math.PI*2, fold=1+.045*Math.cos(angle*12);
        const x=Math.sin(angle)*ring.w*fold, z=Math.cos(angle)*ring.d*fold;
        pos.push(x,ring.y,z);
        const leg=Math.max(0,(1-ring.y/1.1))*.48;
        const upper=THREE.MathUtils.smoothstep(ring.y,1.05,1.4);
        const leftAmount=THREE.MathUtils.smoothstep(x,-.16,.16);
        joints.push(0,1,2,3);weights.push(1-leg-upper,leg*leftAmount,leg*(1-leftAmount),upper);
        if(r && n) {const a=r*(sides+1)+n,b=a-(sides+1);indices.push(a-1,b-1,b,a-1,b,a);}
      }
    });
    const geometry=new THREE.BufferGeometry(); geometry.setIndex(indices);
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(joints,4));
    geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));geometry.computeVertexNormals();
    const material=new THREE.MeshStandardMaterial({color:0x28272a,roughness:1,side:THREE.DoubleSide});
    material.name='role-robe-material';
    const mesh=new THREE.SkinnedMesh(geometry,material);
    const bones=[hips,left,right,spine];
    const skeleton=new THREE.Skeleton(bones,bones.map(b=>this.rest.get(b.name)!.clone().invert()));
    mesh.bind(skeleton,new THREE.Matrix4()); mesh.name='role-judge-robe';
    mesh.castShadow=true;mesh.receiveShadow=false;mesh.frustumCulled=false;mesh.raycast=()=>{};
    this.group.add(mesh);this.attachments.push(mesh);this.ownedGeometry.push(geometry);this.ownedSkeletons.push(skeleton);
    this.materials.push(material);
  }

  private fitJudgeBody():void {
    this.originals.forEach((_material,mesh)=> {
      const original=mesh.geometry, mask=original.getAttribute('aHeadwear'), covered=original.getAttribute('aRobeCovered');
      if(!mask || !covered) return;
      const indices=original.index, kept:number[]=[], count=indices?.count??mask.count;
      for(let i=0;i<count;i+=3) {
        const a=indices?indices.getX(i):i, b=indices?indices.getX(i+1):i+1, c=indices?indices.getX(i+2):i+2;
        const cap=this.bareJudgeHead && mask.getX(a)+mask.getX(b)+mask.getX(c)>0;
        const underRobe=covered.getX(a)+covered.getX(b)+covered.getX(c)>1.5;
        if(!cap && !underRobe)kept.push(a,b,c);
      }
      const geometry=original.clone();geometry.setIndex(kept);
      this.geometryOverrides.set(mesh,original);mesh.geometry=geometry;this.ownedGeometry.push(geometry);
    });
    const head=this.restPositions.get('Head');
    if(head && this.bareJudgeHead)this.fixed('judgeHair','Head',head.clone().add(new THREE.Vector3(0,.073,-.012)));
  }

  private clearAttachments():void {
    this.weaponGrips.clear();
    this.throwRelease=undefined;
    this.throwRotation=undefined;
    this.attachments.forEach(o=>o.removeFromParent());this.attachments.length=0;
    this.attachmentRest.clear();
    this.geometryOverrides.forEach((original,mesh)=>{mesh.geometry=original;});this.geometryOverrides.clear();
    this.ownedGeometry.forEach(g=>g.dispose());this.ownedGeometry.length=0;
    this.ownedSkeletons.forEach(s=>s.dispose());this.ownedSkeletons.length=0;
    // Only the robe owns its material; shared equipment materials belong to the library.
    this.materials=this.materials.filter(material=> {
      if(material.name==='role-robe-material') {material.dispose();return false;} return true;
    });
  }

  dispose():void {
    this.flashes.forEach(flash=>flash.removeFromParent());this.flashes.length=0;this.flashGeometry?.dispose();this.flashMaterial?.dispose();
    this.clearAttachments();this.originals.forEach((material,mesh)=> {mesh.material=material;});
    this.originals.clear(); this.materials.forEach(m=>m.dispose());this.materials.length=0;
  }
}
