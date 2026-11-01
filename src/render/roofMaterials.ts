import * as THREE from 'three';
import type { TextureOwner } from './textureOwnership';

/** Authored tile dimensions, not measurements extracted from original pixels. */
export const ROOF_COURSE = { width: .42, rise: .27, columns: 4, rows: 4, pixels: 256 } as const;

export interface RoofCourses { albedo: THREE.DataTexture; height: THREE.DataTexture }

function grain(x: number, y: number): number {
  return ((Math.imul(x + 1, 73856093) ^ Math.imul(y + 3, 19349663)) >>> 0) % 23;
}

/** Code-native roof material: staggered slate/tile courses, small grain and
 * separate non-colour relief. No delivered bitmap is replaced or modified. */
export function createRoofCourses(style: 'slate' | 'weathered-tile'): RoofCourses {
  const size = ROOF_COURSE.pixels, cell = size / ROOF_COURSE.rows;
  const albedo = new Uint8Array(size * size * 4), height = new Uint8Array(size * size * 4);
  const base = style === 'slate' ? [64, 76, 86] : [94, 81, 65];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const row = Math.floor(y / cell), localY = y % cell;
    const staggeredX = (x + (row % 2) * cell / 2) % size;
    const column = Math.floor(staggeredX / cell), localX = staggeredX % cell;
    const courseSeam = localY < 2, sideSeam = localX < 2;
    const variant = (grain(column, row) - 11) * .55;
    const fine = (grain(x, y) - 11) * .22;
    // The lower lip catches light while the small lap below it stays dark.
    const edge = localY >= cell - 3 ? 8 : localY < 5 ? -7 : 0;
    const joint = courseSeam || sideSeam;
    const index = (y * size + x) * 4;
    for (let channel = 0; channel < 3; channel++) albedo[index + channel] =
      Math.round(THREE.MathUtils.clamp(base[channel] + variant + fine + edge - (joint ? 26 : 0), 12, 132));
    albedo[index + 3] = 255;
    const elevation = joint ? 75 : Math.round(179 + localY / cell * 20 + fine * .6);
    height[index] = height[index + 1] = height[index + 2] = elevation;
    height[index + 3] = 255;
  }
  const configure = (bytes: Uint8Array<ArrayBuffer>, name: string, colour: boolean) => {
    const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
    texture.name = name;
    texture.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  };
  return { albedo: configure(albedo, `roof-${style}-albedo`, true), height: configure(height, `roof-${style}-relief`, false) };
}

/** Coordinates in metres along a roof slope; kept public for dimensional tests.
 * Hip end ridges terminate at local Z ±.28, matching pitchedRoofGeometry. */
export function roofSurfaceMetres(position: THREE.Vector3, size: THREE.Vector3, hipEnd = false): THREE.Vector2 {
  return hipEnd
    ? new THREE.Vector2((position.x + .5) * size.x, (Math.abs(position.z) - .28) / .22 * Math.hypot(size.z * .22, size.y))
    : new THREE.Vector2((position.z + .5) * size.z, Math.abs(position.x) * 2 * Math.hypot(size.x * .5, size.y));
}

function physicalRoofUv(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      vec3 roofSize = vec3(1.0);
      #ifdef USE_INSTANCING
        roofSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
      #endif
      vec2 roofMetres = vec2((position.z + 0.5) * roofSize.z,
        abs(position.x) * 2.0 * length(vec2(roofSize.x * 0.5, roofSize.y)));
      if (abs(normal.z) > abs(normal.x)) {
        roofMetres = vec2((position.x + 0.5) * roofSize.x,
          (abs(position.z) - 0.28) / 0.22 * length(vec2(roofSize.z * 0.22, roofSize.y)));
      }
      vec2 roofCourseUv = roofMetres / vec2(${(ROOF_COURSE.width * ROOF_COURSE.columns).toFixed(4)}, ${(ROOF_COURSE.rise * ROOF_COURSE.rows).toFixed(4)});
      #ifdef USE_MAP
        vMapUv = roofCourseUv;
      #endif
      #ifdef USE_BUMPMAP
        vBumpMapUv = roofCourseUv;
      #endif`);
  };
  material.customProgramCacheKey = () => 'og-pitched-physical-courses-v1';
}

export function createPitchedRoofMaterials(owner: TextureOwner): {
  gable: THREE.MeshStandardMaterial[]; hip: THREE.MeshStandardMaterial; gableWall: THREE.MeshStandardMaterial;
} {
  const material = (style: 'slate' | 'weathered-tile') => {
    const textures = createRoofCourses(style);
    const mat = new THREE.MeshStandardMaterial({ map: owner.own(textures.albedo), bumpMap: owner.own(textures.height),
      bumpScale: .022, roughness: .96, metalness: 0, color: 0xffffff });
    physicalRoofUv(mat);
    return mat;
  };
  // Only vertical gable-end triangles use this masonry colour. It is specified
  // as sRGB so Three converts it to linear; roof slopes use their colour map.
  const gableWall = new THREE.MeshStandardMaterial({ color: 0x776956, roughness: .97, metalness: 0 });
  return { gable: [material('weathered-tile'), gableWall], hip: material('slate'), gableWall };
}
