import type { Material } from 'three';

/** Pavement top, where walls meet the ground, and how dark their foot is. */
const KERB_TOP = .34, CONTACT_SHADE = .58;

/** One photographic flat-roof tile covers the same six metres on every mass. */
export const FLAT_ROOF_TILE_METRES = 6;

/** Keep window bays at the same world width on front and side elevations. */
export function patchInstancedUv(mat: Material, facade = false): void {
  mat.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aUvXform;' + (facade ? '\nvarying float vWallHeight;' : ''))
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vec2 instanceUvScale = aUvXform.xy;
        ${facade ? `
        #ifdef USE_INSTANCING
          // X-facing shell walls run along local Z. The supplied scale uses
          // local X width, so account for depth without stretching the bays.
          float frontWidth = max(length(instanceMatrix[0].xyz), 0.0001);
          float sideWidth = length(instanceMatrix[2].xyz);
          instanceUvScale.x *= mix(1.0, sideWidth / frontWidth, step(0.5, abs(normal.x)));
        #endif` : ''}
        #ifdef USE_MAP
          vMapUv = vMapUv * instanceUvScale + aUvXform.zw;
        #endif
        #ifdef USE_EMISSIVEMAP
          vEmissiveMapUv = vEmissiveMapUv * instanceUvScale + aUvXform.zw;
        #endif`);
    if (facade) {
      // Ground contact: a wall darkens over its lowest metre and a half, where
      // the street's bounce light cannot reach, so a building sits on the
      // pavement instead of floating above it.
      shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 wallWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wallWorld = instanceMatrix * wallWorld;
        #endif
        vWallHeight = (modelMatrix * wallWorld).y;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWallHeight;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          diffuseColor.rgb *= mix(${CONTACT_SHADE.toFixed(2)}, 1.0, smoothstep(${KERB_TOP.toFixed(2)}, ${(KERB_TOP + 1.6).toFixed(2)}, vWallHeight));`);
    }
  };
  mat.customProgramCacheKey = () => `og-instanced-uv-v3-${facade ? 'facade' : 'frontage'}`;
}

/** Unit shell-roof UVs become metre-based rather than repeating per building. */
export function patchRoofUv(mat: Material): void {
  mat.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aUvXform;\nvarying vec4 vRoofFace;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        #if defined(USE_MAP) && defined(USE_INSTANCING)
          vec2 roofSize = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
          vRoofFace = vec4(vMapUv, roofSize);
          vMapUv = vMapUv * roofSize / ${FLAT_ROOF_TILE_METRES.toFixed(1)} + aUvXform.zw;
        #else
          vRoofFace = vec4(0.5, 0.5, 100.0, 100.0);
        #endif`);
    // A flat roof read as one flat tone from the air. Shade it as built: the
    // tar darkens toward the parapet, the parapet's coping catches the light,
    // and the felt is patched in large, faint rectangles.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vRoofFace;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 roofAt = vRoofFace.xy * vRoofFace.zw;
        vec2 toEdge = min(roofAt, vRoofFace.zw - roofAt);
        float edge = min(toEdge.x, toEdge.y);
        float gutter = mix(0.74, 1.0, smoothstep(0.35, 2.4, edge));
        float coping = 1.0 + 0.32 * (1.0 - smoothstep(0.12, 0.34, edge));
        vec2 patchCell = floor(roofAt / vec2(3.7, 2.9));
        float patchTone = fract(sin(dot(patchCell, vec2(12.9898, 78.233))) * 43758.5453);
        diffuseColor.rgb *= gutter * coping * (0.93 + 0.12 * patchTone);`);
  };
  mat.customProgramCacheKey = () => 'og-roof-world-uv-v2';
}