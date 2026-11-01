import * as THREE from 'three';
import type { EquipmentModel } from './equipmentModels';

/** The normalized equipment convention is metres, grip at zero, muzzle +Z.
 * Sample the front lip of the actual mesh so shorter barrels and imported
 * proportions do not inherit a generic effect offset. No geometry is changed. */
export function addMuzzleAnchor(kind:EquipmentModel,root:THREE.Object3D):void {
  if(!['pistol','twinPistols','rifle','shotgun','tommy'].includes(kind))return;
  root.updateMatrixWorld(true);
  const inverse=root.matrixWorld.clone().invert(),points:THREE.Vector3[]=[];
  const bounds=new THREE.Box3();
  root.traverse(node=>{
    if(!(node instanceof THREE.Mesh))return;
    const position=node.geometry.getAttribute('position');
    for(let i=0;i<position.count;i++){
      const p=new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(node.matrixWorld).applyMatrix4(inverse);
      points.push(p);bounds.expandByPoint(p);
    }
  });
  if(bounds.isEmpty())return;
  const lip=new THREE.Box3(),depth=Math.max(.002,(bounds.max.z-bounds.min.z)*.012);
  for(const point of points)if(point.z>=bounds.max.z-depth)lip.expandByPoint(point);
  const anchor=new THREE.Object3D();anchor.name='equipment-muzzle';
  lip.getCenter(anchor.position);anchor.position.z=bounds.max.z;
  root.add(anchor);
}
