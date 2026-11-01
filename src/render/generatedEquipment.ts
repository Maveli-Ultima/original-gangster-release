import * as THREE from 'three';
import type { EquipmentModel } from './equipmentModels';
import { addMuzzleAnchor } from './equipmentAnchors';

/** Grip positions are normalized to the reviewed source's longest dimension. */
export const GENERATED_EQUIPMENT = {
  pistol:{file:'revolver',length:.30,yaw:Math.PI/2,grip:[.34,-.12,0]},
  twinPistols:{file:'automatic',length:.23,yaw:Math.PI/2,grip:[.30,-.12,0]},
  shotgun:{file:'shotgun',length:1.18,yaw:Math.PI/2,grip:[.16,-.035,0]},
  rifle:{file:'rifle',length:1.07,yaw:Math.PI/2,grip:[.16,-.035,0]},
  tommy:{file:'tommy',length:.86,yaw:Math.PI/2,grip:[.12,-.06,0]},
  explosives:{file:'explosives',length:.26,yaw:0,grip:[0,0,0]},
  camera:{file:'camera',length:.19,yaw:0,grip:[0,0,0]},
} as const;
export type GeneratedEquipmentKind=keyof typeof GENERATED_EQUIPMENT;
export const GENERATED_EQUIPMENT_KINDS=Object.keys(GENERATED_EQUIPMENT) as GeneratedEquipmentKind[];
export function prepareGeneratedEquipment(kind:GeneratedEquipmentKind,source:THREE.Group):THREE.Group {
  const spec=GENERATED_EQUIPMENT[kind];source.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(source),size=box.getSize(new THREE.Vector3());
  const span=Math.max(size.x,size.y,size.z);
  if(!Number.isFinite(span)||span<=0)throw Error('Invalid generated equipment bounds: '+kind);
  const center=box.getCenter(new THREE.Vector3());
  source.position.sub(center.add(new THREE.Vector3(...spec.grip).multiplyScalar(span)));
  source.updateMatrix();
  const root=new THREE.Group(),normalized=new THREE.Group();root.add(normalized);normalized.add(source);
  // Attachment transforms replace the outer root. Keep metre scale and source
  // orientation in a child so bone binding cannot overwrite normalization.
  normalized.rotation.y=spec.yaw;normalized.scale.setScalar(spec.length/span);
  root.name='generated-equipment-template-'+kind;
  source.traverse(node=>{
    if(!(node instanceof THREE.Mesh))return;
    if(!node.geometry.hasAttribute('normal'))node.geometry.computeVertexNormals();
    node.castShadow=true;node.receiveShadow=false;node.raycast=()=>{};
    for(const material of Array.isArray(node.material)?node.material:[node.material]) {
      if(!(material instanceof THREE.MeshStandardMaterial))continue;
      material.emissive.set(0);material.emissiveMap=null;
      if(material.map){material.map.minFilter=THREE.LinearFilter;material.map.generateMipmaps=false;material.map.needsUpdate=true;}
      material.roughness=Math.max(.65,material.roughness);material.metalness=Math.min(.6,material.metalness);
      if(material instanceof THREE.MeshPhysicalMaterial)material.specularIntensity=.4;
    }
  });
  addMuzzleAnchor(kind,root);
  return root;
}
export function isGeneratedEquipment(kind:EquipmentModel):kind is GeneratedEquipmentKind{return kind in GENERATED_EQUIPMENT;}
