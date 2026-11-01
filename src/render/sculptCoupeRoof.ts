import * as THREE from 'three';

/** Roof treatment for the normalized, single-material Midnight Motorcar GLB. */
export function prepareSculptCoupeRoof(geometry: THREE.BufferGeometry, height: number): THREE.MeshStandardMaterial {
  const positions = geometry.getAttribute('position');
  const index = geometry.index;
  const bodyIndices: number[] = [];
  const roofIndices: number[] = [];
  // The imported roof has bright scratches baked into both its colour and normal
  // maps. Its upper cap lies above 85% of the normalized height, clear of the glass.
  // Assign whole triangles so no geometry, UVs, normals or silhouettes are changed.
  const roofBase = height * .85;
  for (let face = 0; face < (index?.count ?? positions.count); face += 3) {
    const a = index ? index.getX(face) : face;
    const b = index ? index.getX(face + 1) : face + 1;
    const c = index ? index.getX(face + 2) : face + 2;
    const isRoof = Math.min(positions.getY(a), positions.getY(b), positions.getY(c)) >= roofBase;
    (isRoof ? roofIndices : bodyIndices).push(a, b, c);
  }
  // Two contiguous groups keep this instanced vehicle to two material draws.
  geometry.setIndex([...bodyIndices, ...roofIndices]);
  geometry.clearGroups();
  geometry.addGroup(0, bodyIndices.length, 0);
  geometry.addGroup(bodyIndices.length, roofIndices.length, 1);
  const roof = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: .55, metalness: .15 });
  roof.name = 'midnight-coupe-clean-roof';
  return roof;
}
