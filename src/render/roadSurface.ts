import * as THREE from 'three';
import { BLOCK_SIZE, CELL, PAVEMENT_OFFSET, STREET_WIDTH } from '../sim/constants';
import { STREET_NAMES_EW, STREET_NAMES_NS } from '../sim/data/names';
import { TextureOwner } from './textureOwnership';
import { PAVE_W } from './util';

/** Detail resolution is independent of city size and the strategic overlay map. */
export const ROAD_MARKING_SIZE = 2048;
export const ROAD_ASPHALT_METRES = 24;
const LABEL_WIDTH = 512, LABEL_HEIGHT = 128, LABEL_COLUMNS = 4;
const LABEL_PX_PER_METRE = 16;
const LABEL_WORLD_W = LABEL_WIDTH / LABEL_PX_PER_METRE;
const LABEL_WORLD_H = LABEL_HEIGHT / LABEL_PX_PER_METRE;
const LABEL_COUNT = STREET_NAMES_NS.length + STREET_NAMES_EW.length;
const LABEL_ROWS = Math.ceil(LABEL_COUNT / LABEL_COLUMNS);

function canvas(width: number, height: number): HTMLCanvasElement {
  const image = document.createElement('canvas'); image.width = width; image.height = height;
  return image;
}

/** One block of markings; its edges join at the street centre lines. */
function markingTile(streetInset: number, paveW = PAVE_W): HTMLCanvasElement {
  const image = canvas(ROAD_MARKING_SIZE, ROAD_MARKING_SIZE);
  const ctx = image.getContext('2d')!;
  const scale = ROAD_MARKING_SIZE / CELL;
  // Crossing boundaries sit the same distance beyond the kerb in every city.
  const pavementOffset = PAVEMENT_OFFSET + streetInset - (paveW - PAVE_W);
  const streetWidth = STREET_WIDTH + streetInset * 2;
  ctx.scale(scale, scale);
  ctx.strokeStyle = 'rgba(226,214,178,0.3)'; ctx.lineWidth = .5; ctx.setLineDash([3.2, 4.4]);
  for (const edge of [0, CELL]) {
    ctx.beginPath(); ctx.moveTo(edge, streetWidth); ctx.lineTo(edge, CELL - streetWidth); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(streetWidth, edge); ctx.lineTo(CELL - streetWidth, edge); ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const x of [0, CELL]) for (const y of [0, CELL]) {
    // Quiet crossing boundaries leave the asphalt readable as open space.
    // Two narrow lines replace the four bright zebra bands at each junction.
    ctx.fillStyle = 'rgba(226,218,196,0.25)';
    for (const sign of [-1, 1]) for (const edge of [-.9, .9]) {
      ctx.fillRect(x - pavementOffset + .5, y + sign * pavementOffset + edge, pavementOffset * 2 - 1, .14);
      ctx.fillRect(x + sign * pavementOffset + edge, y - pavementOffset + .5, .14, pavementOffset * 2 - 1);
    }
  }
  const half = BLOCK_SIZE / 2 + paveW - streetInset, start = CELL / 2 - half, size = half * 2;
  ctx.fillStyle = 'rgba(12,13,15,0.4)';
  ctx.fillRect(start - 1.2, start - 1.2, size + 2.4, 1.2);
  ctx.fillRect(start - 1.2, start + size, size + 2.4, 1.2);
  ctx.fillRect(start - 1.2, start, 1.2, size);
  ctx.fillRect(start + size, start, 1.2, size);
  return image;
}

function paintLabels(image: HTMLCanvasElement): void {
  const ctx = image.getContext('2d')!;
  ctx.clearRect(0, 0, image.width, image.height);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${2.2 * LABEL_PX_PER_METRE}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  const names = [...STREET_NAMES_NS.map(name => `${name} Ave`), ...STREET_NAMES_EW.map(name => `${name} St`)];
  names.forEach((name, index) => ctx.fillText(name,
    (index % LABEL_COLUMNS + .5) * LABEL_WIDTH, (Math.floor(index / LABEL_COLUMNS) + .5) * LABEL_HEIGHT,
    LABEL_WIDTH - 32));
}

/** Same lit, shadow-receiving plane; detail never passes through the 2 px/m city map. */
export class RoadSurfaceMaterial extends THREE.MeshStandardMaterial {
  // Explicit properties also let prepareScene upload these before the first draw.
  asphaltMap: THREE.Texture;
  private readonly asphaltUniform: { value: THREE.Texture };
  private readonly owner: TextureOwner;
  readonly markingMap: THREE.CanvasTexture;
  readonly labelMap: THREE.CanvasTexture;
  /** Painted street names: off by default — the original names the street in
   * the view's header only (Game Options can paint them back). */
  readonly labelStrength = { value: 0 };
  readonly legacyRails = { value: 1 };
  /** One texel per block: red = the whole block is roadway (an avenue); green and
   * blue = an east-west or north-south centre line along the avenue. */
  readonly roadBlocks: THREE.DataTexture;
  readonly roadBlockGrid = { value: new THREE.Vector2(1, 1) };
  /** Distance from a street centre line beyond which avenue markings are hidden:
   * just inside this city's kerb line, so lane marks stay and the kerb frame goes. */
  readonly roadMaskFrom = { value: 5 };
  /** Which name each street line carries: row 0 north-south lines, row 1 east-west. */
  readonly lineNames: THREE.DataTexture;
  readonly lineCount = { value: 1 };

  constructor(overlay: THREE.Texture, owner: TextureOwner, fallback: HTMLCanvasElement, streetInset = 0, paveW = PAVE_W) {
    super({ map: overlay, roughness: .93, metalness: .02 });
    this.name = 'road-surface';
    this.owner = owner;
    this.asphaltMap = owner.own(new THREE.Texture(fallback));
    this.markingMap = owner.own(new THREE.CanvasTexture(markingTile(streetInset, paveW)));
    this.roadMaskFrom.value = STREET_WIDTH / 2 + streetInset - paveW - 1.4;
    this.labelMap = owner.own(new THREE.CanvasTexture(canvas(LABEL_COLUMNS * LABEL_WIDTH, LABEL_ROWS * LABEL_HEIGHT)));
    this.roadBlocks = owner.own(new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat));
    this.roadBlocks.magFilter = this.roadBlocks.minFilter = THREE.NearestFilter;
    this.roadBlocks.needsUpdate = true;
    this.lineNames = owner.own(new THREE.DataTexture(new Uint8Array(8), 1, 2, THREE.RGBAFormat));
    this.lineNames.magFilter = this.lineNames.minFilter = THREE.NearestFilter;
    this.lineNames.needsUpdate = true;
    for (const texture of [this.asphaltMap, this.markingMap]) {
      // Match the original canvas compositing before converting once for lighting.
      texture.colorSpace = THREE.NoColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 16;
      texture.needsUpdate = true;
    }
    this.asphaltUniform = { value: this.asphaltMap };
    this.labelMap.anisotropy = 16;
    this.refreshLabels();
    this.onBeforeCompile = shader => {
      shader.uniforms.roadAsphalt = this.asphaltUniform;
      shader.uniforms.roadMarkings = { value: this.markingMap };
      shader.uniforms.roadLabels = { value: this.labelMap };
      shader.uniforms.roadLabelStrength = this.labelStrength;
      shader.uniforms.legacyRails = this.legacyRails;
      shader.uniforms.roadBlocks = { value: this.roadBlocks };
      shader.uniforms.roadBlockGrid = this.roadBlockGrid;
      shader.uniforms.roadMaskFrom = this.roadMaskFrom;
      shader.uniforms.lineNames = { value: this.lineNames };
      shader.uniforms.lineCount = this.lineCount;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vRoadPosition;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoadPosition = (modelMatrix * vec4(position, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec2 vRoadPosition;
          uniform sampler2D roadAsphalt;
          uniform sampler2D roadMarkings;
          uniform sampler2D roadLabels;
          uniform float roadLabelStrength;
          uniform float legacyRails;
          uniform sampler2D roadBlocks;
          uniform vec2 roadBlockGrid;
          uniform float roadMaskFrom;
          uniform sampler2D lineNames;
          uniform float lineCount;
          float lineName(float line, float row) {
            float i = clamp(line, 0.0, lineCount - 1.0);
            return floor(texture2D(lineNames, vec2((i + 0.5) / lineCount, row)).r * 255.0 + 0.5);
          }
          float roadLabel(vec2 uv, float index) {
            vec2 cell = vec2(mod(index, ${LABEL_COLUMNS.toFixed(1)}), floor(index / ${LABEL_COLUMNS.toFixed(1)}));
            vec2 atlas = (cell + clamp(uv, 0.0, 1.0)) / vec2(${LABEL_COLUMNS.toFixed(1)}, ${LABEL_ROWS.toFixed(1)});
            float ink = texture2D(roadLabels, vec2(atlas.x, 1.0 - atlas.y)).a;
            float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
            // Suppress averaged atlas rectangles once letters are sub-pixel.
            return ink * inside * (1.0 - smoothstep(0.12, 0.3, length(fwidth(uv))));
          }`)
        .replace('#include <map_fragment>', `
          vec2 roadGrid = vRoadPosition / ${CELL.toFixed(1)};
          vec2 streetIndex = floor(roadGrid + 0.5);
          vec2 streetOffset = vRoadPosition - streetIndex * ${CELL.toFixed(1)};
          vec3 roadColour = texture2D(roadAsphalt, vec2(vRoadPosition.x, -vRoadPosition.y) / ${ROAD_ASPHALT_METRES.toFixed(1)}).rgb;
          // Rails differ by avenue. Analytic edges stay sharp without another city-size image.
          vec2 railDistance = abs(abs(streetOffset) - 0.72);
          vec2 aa = max(fwidth(vRoadPosition), vec2(0.001));
          vec2 railCoverage = 1.0 - smoothstep(vec2(0.3) - aa * 0.5, vec2(0.3) + aa * 0.5, railDistance);
          float rails = max(railCoverage.x * (1.0 - step(0.5, mod(streetIndex.x, 3.0))),
                            railCoverage.y * (1.0 - step(0.5, mod(streetIndex.y + 1.0, 3.0))));
          roadColour = mix(roadColour, vec3(190.0, 180.0, 150.0) / 255.0, rails * 0.24 * legacyRails);
          vec4 markings = texture2D(roadMarkings, vec2(roadGrid.x, -roadGrid.y));
          // Inside an avenue block there is no kerb: keep only the street-line marks.
          vec3 blockInfo = texture2D(roadBlocks, (floor(roadGrid) + 0.5) / roadBlockGrid).rgb;
          float avenueBlock = blockInfo.r;
          float interior = step(roadMaskFrom, min(abs(streetOffset.x), abs(streetOffset.y)));
          markings.a *= 1.0 - step(0.5, avenueBlock) * interior;
          roadColour = mix(roadColour, markings.rgb, markings.a);
          // Avenue centre line: a dashed stripe down the middle of the avenue block.
          vec2 fromCentre = (fract(roadGrid) - 0.5) * ${CELL.toFixed(1)};
          vec2 lineAa = max(fwidth(vRoadPosition), vec2(0.001));
          float alongX = (1.0 - smoothstep(0.12 - lineAa.y, 0.12 + lineAa.y, abs(fromCentre.y))) * step(0.5, fract(vRoadPosition.x / 6.0));
          float alongY = (1.0 - smoothstep(0.12 - lineAa.x, 0.12 + lineAa.x, abs(fromCentre.x))) * step(0.5, fract(vRoadPosition.y / 6.0));
          float centreLine = max(alongX * step(0.5, blockInfo.g), alongY * step(0.5, blockInfo.b));
          roadColour = mix(roadColour, vec3(226.0, 214.0, 178.0) / 255.0, centreLine * 0.55);
          vec2 segmentOffset = (fract(roadGrid) - 0.5) * ${CELL.toFixed(1)};
          vec2 nsUv = vec2(0.5 - segmentOffset.y / ${LABEL_WORLD_W.toFixed(1)}, 0.5 + streetOffset.x / ${LABEL_WORLD_H.toFixed(1)});
          vec2 ewUv = vec2(0.5 + segmentOffset.x / ${LABEL_WORLD_W.toFixed(1)}, 0.5 + streetOffset.y / ${LABEL_WORLD_H.toFixed(1)});
          float nsInk = roadLabel(nsUv, mod(lineName(streetIndex.x, 0.25), ${STREET_NAMES_NS.length.toFixed(1)})) * (1.0 - mod(floor(roadGrid.y), 2.0));
          float ewInk = roadLabel(ewUv, ${STREET_NAMES_NS.length.toFixed(1)} + mod(lineName(streetIndex.y, 0.75), ${STREET_NAMES_EW.length.toFixed(1)})) * (1.0 - mod(floor(roadGrid.x), 2.0));
          roadColour = mix(roadColour, vec3(236.0, 228.0, 206.0) / 255.0, max(nsInk, ewInk) * roadLabelStrength);
          vec4 overlayPaint = texture2D(map, vMapUv);
          // The strategic wash must tint the names and crossings as well as asphalt.
          vec3 painted = mix(roadColour, overlayPaint.rgb, overlayPaint.a);
          diffuseColor.rgb *= mix(painted / 12.92, pow((painted + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), painted));
        `);
    };
    this.customProgramCacheKey = () => 'og-road-detail-v6';
  }

  override dispose(): void {
    // These two source canvases belong exclusively to this renderer.
    for (const texture of [this.markingMap, this.labelMap]) {
      const image = texture.image as HTMLCanvasElement;
      image.width = image.height = 0;
    }
    super.dispose();
  }

  /** Mark the blocks that are roadway from kerb to kerb (row-major, gridW × gridH),
   * and the direction of their centre line, if any. */
  setRoadBlocks(gridW: number, gridH: number, road: (index: number) => { road: boolean; line?: 'x' | 'y' }): void {
    const data = new Uint8Array(gridW * gridH * 4);
    for (let i = 0; i < gridW * gridH; i++) {
      const r = road(i);
      data[i * 4] = r.road ? 255 : 0;
      data[i * 4 + 1] = r.line === 'x' ? 255 : 0;
      data[i * 4 + 2] = r.line === 'y' ? 255 : 0;
    }
    this.roadBlocks.image = { data, width: gridW, height: gridH };
    this.roadBlockGrid.value.set(gridW, gridH);
    this.roadBlocks.needsUpdate = true;
  }

  /** The name index of every street line (see streetNameIndex). */
  setLineNames(nsLines: number, ewLines: number, name: (axis: 'ns' | 'ew', line: number) => number): void {
    const count = Math.max(nsLines, ewLines), data = new Uint8Array(count * 2 * 4);
    for (let i = 0; i < count; i++) {
      data[i * 4] = name('ns', i) & 255;
      data[(count + i) * 4] = name('ew', i) & 255;
    }
    this.lineNames.image = { data, width: count, height: 2 };
    this.lineCount.value = count;
    this.lineNames.needsUpdate = true;
  }

  setAsphalt(image: HTMLImageElement): void {
    // A texture already uploaded has fixed storage: a larger image written into
    // it was refused (the grit stayed). A new texture takes the photograph;
    // the old one is freed and never uploaded again (refilling it re-uploaded
    // a disposed texture, after the city had closed).
    const next = new THREE.Texture(image);
    next.colorSpace = this.asphaltMap.colorSpace;
    next.wrapS = next.wrapT = THREE.RepeatWrapping;
    next.anisotropy = this.asphaltMap.anisotropy;
    next.needsUpdate = true;
    this.asphaltMap = this.asphaltUniform.value = this.owner.replace(this.asphaltMap, next);
    next.dispose();
  }

  refreshLabels(): void {
    paintLabels(this.labelMap.image as HTMLCanvasElement);
    this.labelMap.needsUpdate = true;
  }
}
