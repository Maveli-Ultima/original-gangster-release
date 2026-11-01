import * as THREE from 'three';
import type { TextureOwner } from './textureOwnership';

/** Authored dimensions for readability, not measurements extracted from original pixels. */
export const TIMBER_FLOOR = { boardWidth: .18, boardLength: 1.6, columns: 8, rows: 2, pixelsX: 256, pixelsY: 512 } as const;
export const CONCRETE_FLOOR = { slabSize: 1.2, columns: 2, rows: 2, pixelsX: 256, pixelsY: 256 } as const;
export const INTERIOR_PALETTE = { timberBase: 0x6b441e, concreteBase: 0x706e65,
  plaster: 0xa69c87, industrialPlaster: 0x858176, slabEdge: 0x292017 } as const;
export type FloorStyle = 'timber' | 'concrete';
export interface FloorSurface { albedo: THREE.DataTexture; height: THREE.DataTexture }

/** Only interior geometry calls this: doors retain their existing vertex palette. */
export function interiorLinearRgb(hex: number): [number, number, number] {
  return new THREE.Color(hex).toArray() as [number, number, number];
}

function grain(x: number, y: number): number {
  return ((Math.imul(x + 19, 73856093) ^ Math.imul(y + 37, 19349663)) >>> 0) % 29;
}

export function floorRepeatMetres(style: FloorStyle): [number, number] {
  return style === 'timber'
    ? [TIMBER_FLOOR.boardWidth * TIMBER_FLOOR.columns, TIMBER_FLOOR.boardLength * TIMBER_FLOOR.rows]
    : [CONCRETE_FLOOR.slabSize * CONCRETE_FLOOR.columns, CONCRETE_FLOOR.slabSize * CONCRETE_FLOOR.rows];
}

/** Staggered timber joints and restrained longitudinal grain; industrial floors
 * use neutral worn concrete with sparse expansion joints, never timber stripes. */
export function createFloorSurface(style: FloorStyle): FloorSurface {
  const spec = style === 'timber' ? TIMBER_FLOOR : CONCRETE_FLOOR;
  const width = spec.pixelsX, height = spec.pixelsY;
  const albedo = new Uint8Array(width * height * 4), relief = new Uint8Array(width * height * 4);
  const cellX = width / spec.columns, cellY = height / spec.rows;
  const hex = style === 'timber' ? INTERIOR_PALETTE.timberBase : INTERIOR_PALETTE.concreteBase;
  const base = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const col = Math.floor(x / cellX), localX = x % cellX;
    const shiftedY = (y + (style === 'timber' ? (col % 4) * cellY / 4 : 0)) % height;
    const row = Math.floor(shiftedY / cellY), localY = shiftedY % cellY;
    const joint = localX < 1 || localY < 1;
    const edge = localX < 3 || localX >= cellX - 1 || localY < 3 || localY >= cellY - 1;
    const variation = (grain(col, row) - 14) * (style === 'timber' ? .50 : .20);
    const fine = (grain(x, y) - 14) * (style === 'timber' ? .18 : .30);
    const grainLine = style === 'timber'
      ? Math.sin(localX * 2.8 + Math.sin(y * Math.PI * 4 / height) * .45 + col) * 2.3 : 0;
    const index = (y * width + x) * 4;
    const shade = joint ? (style === 'timber' ? 31 : 16) : edge ? (style === 'timber' ? 9 : 3) : 0;
    for (let channel = 0; channel < 3; channel++) albedo[index + channel] =
      Math.round(THREE.MathUtils.clamp(base[channel] + variation + fine + grainLine - shade, 9, 150));
    albedo[index + 3] = 255;
    const bump = joint ? 90 : Math.round(178 + fine + grainLine * .7 - (edge ? 8 : 0));
    relief[index] = relief[index + 1] = relief[index + 2] = bump;
    relief[index + 3] = 255;
  }
  const configure = (bytes: Uint8Array<ArrayBuffer>, suffix: string, colour: boolean) => {
    const texture = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat);
    texture.name = `cutaway-${style}-${suffix}`;
    texture.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  };
  return { albedo: configure(albedo, 'albedo', true), height: configure(relief, 'relief', false) };
}

/** Building-local floor coordinates in metres: quarter-turns cannot stretch boards. */
export function floorSurfaceMetres(position: THREE.Vector3, size: THREE.Vector3): THREE.Vector2 {
  return new THREE.Vector2((position.x + .5) * size.x, (position.z + .5) * size.z);
}

function physicalFloorUv(material: THREE.MeshStandardMaterial, style: FloorStyle): void {
  const [width, depth] = floorRepeatMetres(style);
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      vec2 floorSize = vec2(1.0);
      #ifdef USE_INSTANCING
        floorSize = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
      #endif
      vec2 floorUv = (position.xz + vec2(0.5)) * floorSize / vec2(${width.toFixed(4)}, ${depth.toFixed(4)});
      #ifdef USE_MAP
        vMapUv = floorUv;
      #endif
      #ifdef USE_BUMPMAP
        vBumpMapUv = floorUv;
      #endif`);
  };
  material.customProgramCacheKey = () => `og-cutaway-physical-floor-${style}-v1`;
}

/** Group 0 is the floor; group 1 is the slab edge.
 * Each renderer owns four generated textures; materials belong to their pools. */
export function createInteriorMaterials(owner: TextureOwner): {
  rooms: THREE.MeshStandardMaterial[]; works: THREE.MeshStandardMaterial[];
} {
  const pair = (style: FloorStyle) => {
    const surface = createFloorSurface(style);
    const floor = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .97, metalness: 0,
      map: owner.own(surface.albedo), bumpMap: owner.own(surface.height), bumpScale: style === 'timber' ? .008 : .004 });
    floor.name = `cutaway-${style}-floor`;
    physicalFloorUv(floor, style);
    const slab = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .97, metalness: 0 });
    slab.name = `cutaway-${style}-slab-edge`;
    return [floor, slab];
  };
  return { rooms: pair('timber'), works: pair('concrete') };
}